'use strict';

/**
 * Anima 灵枢 · 微信接入模块
 * 基于 Wechaty 框架，将微信消息桥接到 OpenClaw Agent API
 *
 * 修复记录：
 *   #FIX-W1  callAgent 增加 undici 超时（bodyTimeout/headersTimeout: 60s）
 *   #FIX-W2  callAgent 增加 AbortController 总时限兜底（90s）
 *   #BUG-5a  添加 bot.on('error', ...) 监听 Wechaty puppet 内部错误，
 *            防止未捕获的错误触发 unhandledRejection 导致进程崩溃。
 *   #BUG-5b  修复 Message.Type 访问方式。
 *            原代码使用 bot.Message.Type.Text 和 bot.Message.Type.Audio，
 *            在 Wechaty v1.20 中 bot 实例上没有 .Message 属性。
 *            修复：从 wechaty 包直接导入 types 枚举。
 *   #FIX-W3  WECHAT_MSG_LIMIT 从 4000 修正为 2000（微信单条消息上限约 2000 字符）
 *            原值 4000 可能导致消息被微信服务端静默截断，用户收不到完整回复。
 */

const http       = require('http');
const { WechatyBuilder, types } = require('wechaty');
const { request } = require('undici');
const winston    = require('winston');
const Redis      = require('ioredis');

// ─── 超时配置常量 ─────────────────────────────────────────────
const AGENT_REQUEST_TIMEOUT_MS = parseInt(process.env.AGENT_REQUEST_TIMEOUT_MS || '60000', 10);

// ─── 日志 ────────────────────────────────────────────────────
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.Console(),
    new winston.transports.File({
      filename: '/app/data/wechat-bot.log',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 3,
      tailable: true,
    }),
  ],
});

// ─── 配置 ────────────────────────────────────────────────────
const AGENT_API_URL   = (process.env.AGENT_API_URL || 'http://172.16.1.2:3000').replace(/\/$/, '');
const DEFAULT_MODEL   = process.env.AGENT_DEFAULT_MODEL || 'glm-4-flash';
const GROUP_AT_ONLY   = process.env.GROUP_AT_ONLY !== 'false';
const BOT_NAME        = process.env.BOT_NAME || 'Anima';
const VOICE_ENABLED   = process.env.VOICE_ENABLED === 'true';
const REDIS_URL       = process.env.REDIS_URL;

// ─── Redis（用户邮箱绑定持久化）──────────────────────────────
const redis = REDIS_URL
  ? new Redis(REDIS_URL, { maxRetriesPerRequest: 3, lazyConnect: true })
  : null;

if (redis) {
  redis.connect().catch((err) => {
    logger.error('Redis 连接失败（用户绑定将不可用）', { err: err.message });
  });
  redis.on('error', (err) => {
    logger.error('Redis 连接错误', { err: err.message });
  });
}

/** 转义正则特殊字符，防止 new RegExp() 注入 */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── 会话上下文缓存 ──────────────────────────────────────────
const sessions = new Map();
const SESSION_TTL = parseInt(process.env.SESSION_TTL || '3600', 10) * 1000;
const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS || '500', 10);

const REDIS_EMAIL_KEY = 'anima:wechat_emails';

async function getUserEmail(userId) {
  if (!redis) return undefined;
  try {
    return await redis.hget(REDIS_EMAIL_KEY, String(userId)) || undefined;
  } catch (err) {
    logger.error('Redis hget 失败', { err: err.message, userId });
    return undefined;
  }
}

async function setUserEmail(userId, email) {
  if (!redis) return;
  try {
    await redis.hset(REDIS_EMAIL_KEY, String(userId), email);
  } catch (err) {
    logger.error('Redis hset 失败', { err: err.message, userId });
  }
}

function getSession(userId) {
  const session = sessions.get(userId);
  if (session && Date.now() - session.lastActive < SESSION_TTL) {
    session.lastActive = Date.now();
    return session;
  }
  // LRU 淘汰：找到最久未活跃的会话删除
  if (sessions.size >= MAX_SESSIONS) {
    let oldest = null;
    let oldestKey = null;
    for (const [key, s] of sessions) {
      if (!oldest || s.lastActive < oldest.lastActive) {
        oldest = s;
        oldestKey = key;
      }
    }
    if (oldestKey) sessions.delete(oldestKey);
  }
  const newSession = { messages: [], lastActive: Date.now() };
  sessions.set(userId, newSession);
  return newSession;
}

// 定期清理过期会话
const sessionCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [userId, session] of sessions) {
    if (now - session.lastActive >= SESSION_TTL) {
      sessions.delete(userId);
    }
  }
}, SESSION_TTL);

// ─── 消息分段发送 ─────────────────────────────────────────────
// FIX-W3：微信单条消息上限约 2000 字符（原值 4000 会被服务端静默截断）
const WECHAT_MSG_LIMIT = 2000;

async function saySplitMessage(msg, text) {
  if (text.length <= WECHAT_MSG_LIMIT) {
    await msg.say(text);
  } else {
    for (let i = 0; i < text.length; i += WECHAT_MSG_LIMIT) {
      await msg.say(text.substring(i, i + WECHAT_MSG_LIMIT));
    }
  }
}

// ─── Agent API 调用 ──────────────────────────────────────────

const LONG_RUNNING_KEYWORDS = (process.env.LONG_RUNNING_KEYWORDS || '搜索,搜一下,查一下,帮我搜,search,分析文件,分析一下,看看这个文件,analyze')
  .split(',').map(s => s.trim()).filter(Boolean);

function isLongRunningTask(message) {
  const lower = message.toLowerCase();
  return LONG_RUNNING_KEYWORDS.some(kw => lower.includes(kw));
}

async function callAgent(userId, message) {
  const session = getSession(userId);
  session.messages.push({ role: 'user', content: message });

  if (session.messages.length > 20) {
    session.messages = session.messages.slice(-20);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AGENT_REQUEST_TIMEOUT_MS + 30_000);

  try {
    const { body } = await request(`${AGENT_API_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: session.messages,
        userId: userId,
        userEmail: await getUserEmail(userId),
      }),
      bodyTimeout: AGENT_REQUEST_TIMEOUT_MS,
      headersTimeout: AGENT_REQUEST_TIMEOUT_MS,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const data = await body.json();
    const reply = data.reply || data.choices?.[0]?.message?.content || '抱歉，我暂时无法回答。';
    session.messages.push({ role: 'assistant', content: reply });
    return reply;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      logger.error('Agent API 请求超时', { userId, timeoutMs: AGENT_REQUEST_TIMEOUT_MS + 30_000 });
      return '抱歉，AI 响应超时，请稍后重试。';
    }
    logger.error('Agent API call failed', { err: err.message, userId });
    return '抱歉，AI 服务暂时不可用，请稍后再试。';
  }
}

// ─── Wechaty Bot ─────────────────────────────────────────────
const bot = WechatyBuilder.build({
  name: 'anima-wechat',
  puppet: process.env.WECHATY_PUPPET || 'wechaty-puppet-wechat',
  puppetOptions: {
    token: process.env.WECHATY_TOKEN || undefined,
  },
});

bot.on('scan', (qrcode, status) => {
  const qrcodeUrl = `https://wechaty.js.org/qrcode/${encodeURIComponent(qrcode)}`;
  logger.info('扫码登录', { status, qrcodeUrl });
  console.log(`\n扫描二维码登录: ${qrcodeUrl}\n`);
});

bot.on('login', (user) => {
  logger.info('微信登录成功', { user: user.name() });
});

bot.on('logout', (user) => {
  logger.info('微信已登出', { user: user.name() });
});

// BUG-5a 修复：监听 Wechaty error 事件
// Wechaty puppet 内部错误（如网络断开、协议异常）会通过 error 事件抛出。
// 若无监听器，Node.js 会将 EventEmitter 的 error 事件当作未捕获异常处理，
// 导致进程崩溃。此处记录错误并继续运行，Wechaty 会自动尝试重连。
bot.on('error', (err) => {
  logger.error('Wechaty puppet 错误', { err: err.message, stack: err.stack });
  // 不退出进程，让 Wechaty 自动尝试恢复
});

bot.on('message', async (msg) => {
  if (msg.self()) return;

  const contact = msg.talker();
  const room = msg.room();
  const userId = contact.id;
  const isGroup = !!room;

  if (isGroup && GROUP_AT_ONLY) {
    const mentionSelf = await msg.mentionSelf();
    if (!mentionSelf) return;
  }

  try {
    // BUG-5b 修复：不再使用 bot.Message.Type.xxx（Wechaty v1.20 中不存在）
    // 改为使用从 wechaty 包导入的 types 枚举，若 types 不可用则用数值比对。
    // msg.type() 返回 MessageType 枚举数值（Text=7, Audio=1 等）
    const msgType = msg.type();

    // 安全地获取 MessageType 枚举（兼容不同 Wechaty 版本）
    const MessageType = (typeof types !== 'undefined' && types.Message)
      ? types.Message
      : null;

    // Wechaty MessageType 枚举值：Text=7, Audio=1（已验证）
    const isText  = MessageType ? msgType === MessageType.Text  : msgType === 7;
    const isAudio = MessageType ? msgType === MessageType.Audio : msgType === 1;

    if (isText) {
      let text = msg.text().trim();
      if (isGroup) {
        text = text.replace(new RegExp(`@${escapeRegExp(BOT_NAME)}\\s*`, 'g'), '').trim();
      }
      if (!text) return;

      if (text.length > 10000) {
        await msg.say('❌ 消息过长（最多 10000 字符），请精简后重试。');
        return;
      }

      logger.info('收到文字消息', { userId, text: text.substring(0, 100), isGroup });

      if (text === '/clear') {
        sessions.delete(userId);
        logger.info('用户清除对话上下文', { userId });
        await msg.say('🗑 对话上下文已清除。');
        return;
      }

      if (text.startsWith('/bind ')) {
        const email = text.slice(6).trim().toLowerCase();
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
          await msg.say('❌ 邮箱格式不正确，请重新输入。\n示例：/bind yourname@example.com');
        } else {
          await setUserEmail(userId, email);
          logger.info('用户绑定邮箱', { userId, email });
          await msg.say(`✅ 已绑定计费邮箱：${email}\n后续 AI 对话将归入该账户计费。`);
        }
        return;
      }

      const longRunning = isLongRunningTask(text);

      if (longRunning) {
        try {
          await msg.say('⏳ 任务处理中，完成后会通知你...');
        } catch (sayErr) {
          logger.error('发送等待提示失败', { err: sayErr.message, userId });
        }
        callAgent(userId, text)
          .then(async (reply) => {
            try {
              await saySplitMessage(msg, `✅ 任务完成：\n\n${reply}`);
            } catch (sendErr) {
              logger.error('发送任务结果失败', { err: sendErr.message, userId });
            }
          })
          .catch(async (err) => {
            logger.error('Long-running task failed', { err: err.message, userId });
            try {
              await msg.say('❌ 任务执行失败，请稍后重试。');
            } catch (sendErr) {
              logger.error('发送错误消息失败', { err: sendErr.message, userId });
            }
          });
        return;
      }

      const reply = await callAgent(userId, text);
      await saySplitMessage(msg, reply);
    }

    if (isAudio && VOICE_ENABLED) {
      logger.info('收到语音消息', { userId });
      await msg.say('语音处理中，请稍候...');
      await msg.say('语音功能开发中，请先发送文字消息。');
    }
  } catch (err) {
    logger.error('消息处理失败', { err: err.message, userId });
    try {
      await msg.say('处理消息时出错，请稍后再试。');
    } catch (sayErr) {
      logger.error('发送错误提示失败（微信 API 不可用）', { err: sayErr.message, userId });
    }
  }
});

// ─── 健康检查 HTTP 服务 ──────────────────────────────────────
const healthServer = http.createServer((req, res) => {
  if (req.url !== '/health' || req.method !== 'GET') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
    return;
  }
  const isLoggedIn = bot.isLoggedIn;
  res.writeHead(isLoggedIn ? 200 : 503, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: isLoggedIn ? 'ok' : 'not_logged_in' }));
});

healthServer.listen(3001, () => {
  logger.info('健康检查服务已启动 :3001');
});

// ─── 启动 ────────────────────────────────────────────────────
bot.start()
  .then(() => logger.info('微信 Bot 已启动，等待扫码登录...'))
  .catch((err) => {
    logger.error('微信 Bot 启动失败', { err: err.message });
    process.exit(1);
  });

// ─── 优雅退出 ────────────────────────────────────────────────
const shutdown = (signal) => {
  logger.info(`收到 ${signal}，正在关闭...`);
  clearInterval(sessionCleanupTimer);
  if (redis) redis.disconnect();
  bot.stop()
    .then(() => {
      healthServer.close();
      process.exit(0);
    })
    .catch(() => process.exit(1));
  setTimeout(() => process.exit(1), 10_000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection, shutting down', { err: String(reason) });
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception, shutting down', { err: err.message, stack: err.stack });
  process.exit(1);
});
