'use strict';

/**
 * Anima 灵枢 · 微信接入模块
 * 基于 Wechaty 框架，将微信消息桥接到 OpenClaw Agent API
 */

const http       = require('http');
const { WechatyBuilder } = require('wechaty');
const { request } = require('undici');
const winston    = require('winston');

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
const AGENT_API_URL   = process.env.AGENT_API_URL || 'http://172.16.1.2:3000';
const DEFAULT_MODEL   = process.env.AGENT_DEFAULT_MODEL || 'claude-haiku-4-5-20251001';
const GROUP_AT_ONLY   = process.env.GROUP_AT_ONLY !== 'false';
const BOT_NAME        = process.env.BOT_NAME || 'Anima';
const VOICE_ENABLED   = process.env.VOICE_ENABLED === 'true';
const WHISPER_URL     = process.env.WHISPER_URL || 'http://172.16.1.5:8080/transcribe';
const TTS_URL         = process.env.TTS_URL || 'http://172.16.1.1:8082/api/tts';

/** 转义正则特殊字符，防止 new RegExp() 注入 */
function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// ─── 会话上下文缓存（简易内存版，生产环境建议用 Redis）──────
const sessions = new Map();
const SESSION_TTL = parseInt(process.env.SESSION_TTL || '3600', 10) * 1000;

function getSession(userId) {
  const session = sessions.get(userId);
  if (session && Date.now() - session.lastActive < SESSION_TTL) {
    session.lastActive = Date.now();
    return session;
  }
  const newSession = { messages: [], lastActive: Date.now() };
  sessions.set(userId, newSession);
  return newSession;
}

// 定期清理过期会话（防止内存泄漏）
const sessionCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [userId, session] of sessions) {
    if (now - session.lastActive >= SESSION_TTL) {
      sessions.delete(userId);
    }
  }
}, SESSION_TTL);

// ─── Agent API 调用 ──────────────────────────────────────────

/** 标记长耗时任务类型（web-search / file-analysis），可通过 LONG_RUNNING_KEYWORDS 环境变量覆盖 */
const LONG_RUNNING_KEYWORDS = (process.env.LONG_RUNNING_KEYWORDS || '搜索,搜一下,查一下,帮我搜,search,分析文件,分析一下,看看这个文件,analyze')
  .split(',').map(s => s.trim()).filter(Boolean);

function isLongRunningTask(message) {
  const lower = message.toLowerCase();
  return LONG_RUNNING_KEYWORDS.some(kw => lower.includes(kw));
}

async function callAgent(userId, message) {
  const session = getSession(userId);
  session.messages.push({ role: 'user', content: message });

  // 保留最近 20 条上下文
  if (session.messages.length > 20) {
    session.messages = session.messages.slice(-20);
  }

  try {
    const { body } = await request(`${AGENT_API_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: session.messages,
        userId: userId,
      }),
    });
    const data = await body.json();
    const reply = data.reply || data.choices?.[0]?.message?.content || '抱歉，我暂时无法回答。';
    session.messages.push({ role: 'assistant', content: reply });
    return reply;
  } catch (err) {
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

bot.on('message', async (msg) => {
  // 忽略自己发的消息
  if (msg.self()) return;

  const contact = msg.talker();
  const room = msg.room();
  const userId = contact.id;
  const isGroup = !!room;

  // 群聊：仅响应 @机器人 的消息
  if (isGroup && GROUP_AT_ONLY) {
    const mentionSelf = await msg.mentionSelf();
    if (!mentionSelf) return;
  }

  try {
    const msgType = msg.type();

    // 文字消息
    if (msgType === bot.Message.Type.Text) {
      let text = msg.text().trim();
      // 去除群聊中的 @机器人 前缀
      if (isGroup) {
        text = text.replace(new RegExp(`@${escapeRegExp(BOT_NAME)}\\s*`, 'g'), '').trim();
      }
      if (!text) return;

      logger.info('收到文字消息', { userId, text: text.substring(0, 100), isGroup });

      const longRunning = isLongRunningTask(text);

      if (longRunning) {
        await msg.say('⏳ 任务处理中，完成后会通知你...');
        callAgent(userId, text)
          .then(async (reply) => {
            await msg.say(`✅ 任务完成：\n\n${reply}`);
          })
          .catch(async (err) => {
            logger.error('Long-running task failed', { err: err.message, userId });
            await msg.say('❌ 任务执行失败，请稍后重试。');
          });
        return;
      }

      const reply = await callAgent(userId, text);
      await msg.say(reply);
    }

    // 语音消息（需要语音模块启用）
    if (msgType === bot.Message.Type.Audio && VOICE_ENABLED) {
      logger.info('收到语音消息', { userId });
      await msg.say('语音处理中，请稍候...');
      // 语音 → 文字 → AI → 文字回复
      // 完整实现需要下载语音文件、调用 Whisper API、再调用 Agent
      await msg.say('语音功能开发中，请先发送文字消息。');
    }
  } catch (err) {
    logger.error('消息处理失败', { err: err.message, userId });
    await msg.say('处理消息时出错，请稍后再试。');
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
  logger.error('Unhandled promise rejection', { err: String(reason) });
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception, shutting down', { err: err.message, stack: err.stack });
  process.exit(1);
});
