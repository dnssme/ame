'use strict';

/**
 * Anima 灵枢 · Telegram 接入模块
 * 基于 Telegraf 框架，将 Telegram 消息桥接到 OpenClaw Agent API
 */

const http        = require('http');
const { Telegraf } = require('telegraf');
const { request }  = require('undici');
const winston     = require('winston');
const Redis       = require('ioredis');

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
      filename: '/app/data/telegram-bot.log',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 3,
      tailable: true,
    }),
  ],
});

// ─── 配置 ────────────────────────────────────────────────────
const BOT_TOKEN     = process.env.TELEGRAM_BOT_TOKEN;
const AGENT_API_URL = process.env.AGENT_API_URL || 'http://172.16.1.2:3000';
const DEFAULT_MODEL = process.env.AGENT_DEFAULT_MODEL || 'glm-4-flash';
const BILLING_URL   = process.env.BILLING_WEBHOOK_URL || 'http://172.16.1.5:3002';
const REDIS_URL     = process.env.REDIS_URL;
const ALLOWED_IDS   = (process.env.ALLOWED_USER_IDS || '')
  .split(',').map(s => s.trim()).filter(Boolean);

if (!BOT_TOKEN) {
  logger.error('TELEGRAM_BOT_TOKEN 未设置');
  process.exit(1);
}

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

// ─── 会话上下文 ──────────────────────────────────────────────
const sessions = new Map();
const SESSION_TTL = parseInt(process.env.SESSION_TTL || '3600', 10) * 1000;
const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS || '500', 10);

/** userId → email 绑定表（通过 Redis 持久化，重启不丢失）*/
const REDIS_EMAIL_KEY = 'anima:user_emails';
/** userId → model 选择（通过 Redis 持久化，重启不丢失）*/
const REDIS_MODELS_KEY = 'anima:user_models';

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

async function getUserModel(userId) {
  if (!redis) return undefined;
  try {
    return await redis.hget(REDIS_MODELS_KEY, String(userId)) || undefined;
  } catch (err) {
    logger.error('Redis hget 失败（user_models）', { err: err.message, userId });
    return undefined;
  }
}

async function setUserModel(userId, model) {
  if (!redis) return;
  try {
    await redis.hset(REDIS_MODELS_KEY, String(userId), model);
  } catch (err) {
    logger.error('Redis hset 失败（user_models）', { err: err.message, userId });
  }
}

function getSession(userId) {
  const session = sessions.get(userId);
  if (session && Date.now() - session.lastActive < SESSION_TTL) {
    session.lastActive = Date.now();
    return session;
  }
  // LRU 淘汰：超过上限时删除最久未活跃的会话
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

  if (session.messages.length > 20) {
    session.messages = session.messages.slice(-20);
  }

  const model = (await getUserModel(userId)) || DEFAULT_MODEL;

  try {
    const { body } = await request(`${AGENT_API_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: session.messages,
        userId: String(userId),
        userEmail: await getUserEmail(userId),
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

// ─── 访问控制 ────────────────────────────────────────────────
function isAllowed(userId) {
  if (ALLOWED_IDS.length === 0) return true;
  return ALLOWED_IDS.includes(String(userId));
}

// ─── Telegraf Bot ─────────────────────────────────────────────
const bot = new Telegraf(BOT_TOKEN);

// 中间件：访问控制
bot.use((ctx, next) => {
  if (!isAllowed(ctx.from?.id)) {
    return ctx.reply('⛔ 你没有使用此 Bot 的权限。');
  }
  return next();
});

// /start 欢迎
bot.start((ctx) => {
  ctx.reply(
    '🤖 你好！我是 Anima 灵枢 AI 助手。\n\n' +
    '直接发送消息即可与 AI 对话。\n\n' +
    '可用命令：\n' +
    '/model <模型名> — 切换 AI 模型\n' +
    '/bind <邮箱> — 绑定计费邮箱（首次使用必须绑定）\n' +
    '/balance <邮箱> — 查询余额\n' +
    '/clear — 清除对话上下文\n' +
    '/help — 查看帮助'
  );
});

// /help 帮助
bot.help((ctx) => {
  ctx.reply(
    '📖 Anima 灵枢 命令列表：\n\n' +
    '/model <模型名> — 切换模型（如 claude-sonnet-4-5）\n' +
    '/bind <邮箱> — 绑定计费邮箱，用于计费归因\n' +
    '/balance <邮箱> — 查询账户余额\n' +
    '/clear — 清除当前对话上下文\n' +
    '/help — 显示此帮助'
  );
});

// /bind 绑定计费邮箱
bot.command('bind', async (ctx) => {
  const email = ctx.message.text.split(' ').slice(1).join(' ').trim().toLowerCase();
  if (!email) {
    const current = await getUserEmail(ctx.from.id);
    return ctx.reply(current
      ? `当前绑定邮箱：${current}\n\n用法：/bind <邮箱>`
      : '尚未绑定邮箱。\n\n用法：/bind <邮箱>\n示例：/bind yourname@example.com');
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 254) {
    return ctx.reply('❌ 邮箱格式不正确，请重新输入。\n示例：/bind yourname@example.com');
  }
  await setUserEmail(ctx.from.id, email);
  logger.info('用户绑定邮箱', { userId: ctx.from.id, email });
  ctx.reply(`✅ 已绑定计费邮箱：${email}\n后续 AI 对话将归入该账户计费。`);
});

// /model 切换模型
bot.command('model', async (ctx) => {
  const model = ctx.message.text.split(' ').slice(1).join(' ').trim();
  if (!model) {
    const current = (await getUserModel(ctx.from.id)) || DEFAULT_MODEL;
    return ctx.reply(`当前模型：${current}\n\n用法：/model <模型名>`);
  }
  if (model.length > 128) {
    return ctx.reply('❌ 模型名称过长（最多 128 字符）');
  }
  await setUserModel(ctx.from.id, model);
  ctx.reply(`✅ 已切换到模型：${model}`);
});

// /balance 查询余额
bot.command('balance', async (ctx) => {
  const email = ctx.message.text.split(' ').slice(1).join(' ').trim();
  if (!email) return ctx.reply('用法：/balance <邮箱>');
  try {
    const { body } = await request(`${BILLING_URL}/billing/balance/${encodeURIComponent(email)}`);
    const data = await body.json();
    if (data.success) {
      ctx.reply(`💰 余额：¥${(data.balance_fen / 100).toFixed(2)}`);
    } else {
      ctx.reply(`查询失败：${data.msg}`);
    }
  } catch (err) {
    ctx.reply('余额查询服务暂不可用。');
  }
});

// /clear 清除上下文
bot.command('clear', (ctx) => {
  sessions.delete(ctx.from.id);
  ctx.reply('🗑 对话上下文已清除。');
});

// 文字消息 → AI 对话
bot.on('text', async (ctx) => {
  const text = ctx.message.text.trim();
  if (!text || text.startsWith('/')) return;

  logger.info('收到消息', { userId: ctx.from.id, text: text.substring(0, 100) });

  const longRunning = isLongRunningTask(text);

  if (longRunning) {
    await ctx.reply('⏳ 任务处理中，完成后会通知你...');
  }

  await ctx.sendChatAction('typing');

  // 长耗时任务在后台执行，完成后主动推送通知
  if (longRunning) {
    callAgent(ctx.from.id, text)
      .then(async (reply) => {
        const prefix = '✅ 任务完成：\n\n';
        const fullReply = prefix + reply;
        if (fullReply.length <= 4096) {
          await ctx.reply(fullReply);
        } else {
          for (let i = 0; i < fullReply.length; i += 4096) {
            await ctx.reply(fullReply.substring(i, i + 4096));
          }
        }
      })
      .catch(async (err) => {
        logger.error('Long-running task failed', { err: err.message, userId: ctx.from.id });
        await ctx.reply('❌ 任务执行失败，请稍后重试。');
      });
    return;
  }

  const reply = await callAgent(ctx.from.id, text);

  // Telegram 消息限制 4096 字符，超长分段发送
  if (reply.length <= 4096) {
    await ctx.reply(reply);
  } else {
    for (let i = 0; i < reply.length; i += 4096) {
      await ctx.reply(reply.substring(i, i + 4096));
    }
  }
});

// ─── 健康检查 ────────────────────────────────────────────────
let botRunning = false;

const healthServer = http.createServer((req, res) => {
  if (req.url !== '/health' || req.method !== 'GET') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
    return;
  }
  res.writeHead(botRunning ? 200 : 503, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: botRunning ? 'ok' : 'starting' }));
});

healthServer.listen(3003, () => {
  logger.info('健康检查服务已启动 :3003');
});

// ─── 启动 ────────────────────────────────────────────────────
bot.launch()
  .then(() => {
    botRunning = true;
    logger.info('Telegram Bot 已启动');
  })
  .catch((err) => {
    logger.error('Telegram Bot 启动失败', { err: err.message });
    process.exit(1);
  });

// ─── 优雅退出 ────────────────────────────────────────────────
const shutdown = (signal) => {
  logger.info(`收到 ${signal}，正在关闭...`);
  clearInterval(sessionCleanupTimer);
  if (redis) redis.disconnect();
  bot.stop(signal);
  healthServer.close();
  process.exit(0);
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
