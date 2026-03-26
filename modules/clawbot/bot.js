'use strict';

/**
 * Anima 灵枢 · 微信 ClawBot 插件接入模块
 * 基于 Express HTTP Webhook，接收微信 ClawBot 插件回调，
 * 桥接到 OpenClaw Agent API 实现 AI 对话。
 *
 * 功能：
 *   - 微信 ClawBot 插件签名验证（token + timestamp + nonce SHA1）
 *   - 强制登录认证（用户必须绑定邮箱后才可使用 AI 功能）
 *   - 用户强隔离（独立 Redis 键空间、独立会话、独立计费）
 *   - 文字消息 → AI 对话
 *   - 语音消息 → Whisper STT → AI → TTS → 语音回复
 *   - 图片/文件 → 文件分析
 *   - /model 切换模型
 *   - /balance 查询余额
 *   - /clear 清除对话上下文
 *   - /help 帮助信息
 *   - 长耗时任务异步回复
 *   - 消息分段发送（适配微信消息长度限制）
 */

const crypto     = require('crypto');
const express    = require('express');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const { request } = require('undici');
const winston    = require('winston');
const Redis      = require('ioredis');

// ─── 超时配置常量 ─────────────────────────────────────────────
const AGENT_REQUEST_TIMEOUT_MS = parseInt(process.env.AGENT_REQUEST_TIMEOUT_MS || '60000', 10);
const BILLING_REQUEST_TIMEOUT_MS = parseInt(process.env.BILLING_REQUEST_TIMEOUT_MS || '10000', 10);
// AbortController 兜底超时缓冲：在 undici 超时之上额外等待，确保请求被取消
const ABORT_TIMEOUT_BUFFER_MS = 30_000;

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
      filename: '/app/data/clawbot.log',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 3,
      tailable: true,
    }),
  ],
});

// ─── 配置 ────────────────────────────────────────────────────
const CLAWBOT_TOKEN           = process.env.CLAWBOT_TOKEN;
const CLAWBOT_APP_ID          = process.env.CLAWBOT_APP_ID;
const CLAWBOT_APP_SECRET      = process.env.CLAWBOT_APP_SECRET;
// EncodingAESKey 用于消息加密模式（当微信服务器配置为"安全模式"时使用）
// 当前实现使用明文模式，后续启用加密模式时需要此密钥进行 AES 解密
const CLAWBOT_ENCODING_AES_KEY = process.env.CLAWBOT_ENCODING_AES_KEY || '';
const AGENT_API_URL  = (process.env.AGENT_API_URL || 'http://172.16.1.2:3000').replace(/\/$/, '');
const DEFAULT_MODEL  = process.env.AGENT_DEFAULT_MODEL || 'glm-4-flash';
const BILLING_URL    = (process.env.BILLING_WEBHOOK_URL || 'http://172.16.1.6:3002').replace(/\/$/, '');
const REDIS_URL      = process.env.REDIS_URL;
const VOICE_ENABLED  = process.env.VOICE_ENABLED === 'true';
const WHISPER_URL    = process.env.WHISPER_URL || 'http://172.16.1.5:8080/transcribe';
const TTS_URL        = process.env.TTS_URL || 'http://172.16.1.5:8082/api/tts';
const PORT           = parseInt(process.env.PORT || '3004', 10);

if (!CLAWBOT_TOKEN) {
  logger.error('CLAWBOT_TOKEN 未设置，无法启动');
  process.exit(1);
}
if (!CLAWBOT_APP_ID) {
  logger.error('CLAWBOT_APP_ID 未设置，无法启动');
  process.exit(1);
}
if (!CLAWBOT_APP_SECRET) {
  logger.error('CLAWBOT_APP_SECRET 未设置，无法启动');
  process.exit(1);
}

// ─── Redis（用户认证 + 邮箱绑定 + 会话持久化）────────────────
const redis = REDIS_URL
  ? new Redis(REDIS_URL, {
      maxRetriesPerRequest: 3,
      lazyConnect: true,
      enableOfflineQueue: false,
      enableReadyCheck: true,
    })
  : null;

if (redis) {
  redis.connect().catch((err) => {
    logger.error('Redis 连接失败（用户认证/绑定将不可用）', { err: err.message });
  });
  redis.on('error', (err) => {
    logger.error('Redis 连接错误', { err: err.message });
  });
} else {
  logger.warn('REDIS_URL 未设置，用户认证和邮箱绑定功能将不可用');
}

// ─── 用户隔离：Redis 键空间 ──────────────────────────────────
// 每个通道使用独立前缀，保证跨通道用户数据不互相干扰
const REDIS_EMAIL_KEY  = 'anima:clawbot:emails';      // Hash: openid → email
const REDIS_MODELS_KEY = 'anima:clawbot:user_models';  // Hash: openid → model
const REDIS_AUTH_KEY   = 'anima:clawbot:authed';       // Set:  已认证用户 openid

// ─── 用户认证/邮箱管理 ──────────────────────────────────────
async function isUserAuthed(openId) {
  if (!redis) return false;
  try {
    return await redis.sismember(REDIS_AUTH_KEY, openId) === 1;
  } catch (err) {
    logger.error('Redis sismember 失败', { err: err.message, openId });
    return false;
  }
}

async function setUserAuthed(openId) {
  if (!redis) return;
  try {
    await redis.sadd(REDIS_AUTH_KEY, openId);
  } catch (err) {
    logger.error('Redis sadd 失败', { err: err.message, openId });
  }
}

async function getUserEmail(openId) {
  if (!redis) return undefined;
  try {
    return await redis.hget(REDIS_EMAIL_KEY, openId) || undefined;
  } catch (err) {
    logger.error('Redis hget 失败', { err: err.message, openId });
    return undefined;
  }
}

async function setUserEmail(openId, email) {
  if (!redis) return;
  try {
    await redis.hset(REDIS_EMAIL_KEY, openId, email);
  } catch (err) {
    logger.error('Redis hset 失败', { err: err.message, openId });
  }
}

async function getUserModel(openId) {
  if (!redis) return undefined;
  try {
    return await redis.hget(REDIS_MODELS_KEY, openId) || undefined;
  } catch (err) {
    logger.error('Redis hget 失败（user_models）', { err: err.message, openId });
    return undefined;
  }
}

async function setUserModel(openId, model) {
  if (!redis) return;
  try {
    await redis.hset(REDIS_MODELS_KEY, openId, model);
  } catch (err) {
    logger.error('Redis hset 失败（user_models）', { err: err.message, openId });
  }
}

// ─── 会话上下文（强隔离：每用户独立会话）──────────────────────
const sessions = new Map();
const SESSION_TTL = parseInt(process.env.SESSION_TTL || '3600', 10) * 1000;
const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS || '500', 10);

function getSession(openId) {
  const session = sessions.get(openId);
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
  sessions.set(openId, newSession);
  return newSession;
}

// 定期清理过期会话
const sessionCleanupTimer = setInterval(() => {
  const now = Date.now();
  for (const [openId, session] of sessions) {
    if (now - session.lastActive >= SESSION_TTL) {
      sessions.delete(openId);
    }
  }
}, SESSION_TTL);

// ─── 签名验证（微信 ClawBot 回调签名校验）──────────────────
function verifySignature(signature, timestamp, nonce) {
  const arr = [CLAWBOT_TOKEN, timestamp, nonce].sort();
  const hash = crypto.createHash('sha1').update(arr.join('')).digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(hash, 'utf8'),
    Buffer.from(signature, 'utf8')
  );
}

// ─── 消息分段（微信单条消息上限约 2000 字符）────────────────
const WECHAT_MSG_LIMIT = 2000;

function splitMessage(text) {
  if (text.length <= WECHAT_MSG_LIMIT) return [text];
  const parts = [];
  for (let i = 0; i < text.length; i += WECHAT_MSG_LIMIT) {
    parts.push(text.substring(i, i + WECHAT_MSG_LIMIT));
  }
  return parts;
}

// ─── 长耗时任务判定 ─────────────────────────────────────────
const LONG_RUNNING_KEYWORDS = (process.env.LONG_RUNNING_KEYWORDS || '搜索,搜一下,查一下,帮我搜,search,分析文件,分析一下,看看这个文件,analyze')
  .split(',').map(s => s.trim()).filter(Boolean);

function isLongRunningTask(message) {
  const lower = message.toLowerCase();
  return LONG_RUNNING_KEYWORDS.some(kw => lower.includes(kw));
}

// ─── Agent API 调用 ──────────────────────────────────────────
async function callAgent(openId, message) {
  const session = getSession(openId);
  session.messages.push({ role: 'user', content: message });

  if (session.messages.length > 20) {
    session.messages = session.messages.slice(-20);
  }

  const model = (await getUserModel(openId)) || DEFAULT_MODEL;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AGENT_REQUEST_TIMEOUT_MS + ABORT_TIMEOUT_BUFFER_MS);

  try {
    const { body } = await request(`${AGENT_API_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: session.messages,
        userId: `clawbot:${openId}`,
        userEmail: await getUserEmail(openId),
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
      logger.error('Agent API 请求超时', { openId, timeoutMs: AGENT_REQUEST_TIMEOUT_MS + ABORT_TIMEOUT_BUFFER_MS });
      return '抱歉，AI 响应超时，请稍后重试。';
    }
    logger.error('Agent API call failed', { err: err.message, openId });
    return '抱歉，AI 服务暂时不可用，请稍后再试。';
  }
}

// ─── 余额查询 ──────────────────────────────────────────────
async function queryBalance(email) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BILLING_REQUEST_TIMEOUT_MS + 5_000);

  try {
    const { body } = await request(`${BILLING_URL}/billing/balance/${encodeURIComponent(email)}`, {
      bodyTimeout: BILLING_REQUEST_TIMEOUT_MS,
      headersTimeout: BILLING_REQUEST_TIMEOUT_MS,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const data = await body.json();
    if (data.success) {
      return `💰 账户余额：¥${(data.balance_fen / 100).toFixed(2)}`;
    }
    return `查询失败：${data.msg || '未知错误'}`;
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      logger.error('余额查询超时');
      return '余额查询超时，请稍后重试。';
    }
    logger.error('余额查询失败', { err: err.message });
    return '余额查询服务暂不可用。';
  }
}

// ─── ClawBot 异步回复（通过客服消息接口回复用户）─────────────

/** Access Token 缓存 */
let accessTokenCache = { token: '', expiresAt: 0 };

async function getAccessToken() {
  if (accessTokenCache.token && Date.now() < accessTokenCache.expiresAt) {
    return accessTokenCache.token;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  try {
    const url = `https://api.weixin.qq.com/cgi-bin/token?grant_type=client_credential&appid=${encodeURIComponent(CLAWBOT_APP_ID)}&secret=${encodeURIComponent(CLAWBOT_APP_SECRET)}`;
    const { body } = await request(url, {
      bodyTimeout: 10_000,
      headersTimeout: 10_000,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const data = await body.json();
    if (data.access_token) {
      // 提前 5 分钟过期以确保 token 可用
      accessTokenCache = {
        token: data.access_token,
        expiresAt: Date.now() + ((data.expires_in || 7200) - 300) * 1000,
      };
      return data.access_token;
    }
    logger.error('获取 access_token 失败', { errcode: data.errcode, errmsg: data.errmsg });
    return '';
  } catch (err) {
    clearTimeout(timeoutId);
    logger.error('获取 access_token 请求异常', { err: err.message });
    return '';
  }
}

/**
 * 通过微信客服消息接口异步回复用户。
 * 用于长耗时任务的异步响应。
 */
async function sendAsyncReply(openId, text) {
  const token = await getAccessToken();
  if (!token) {
    logger.error('无法发送异步回复：access_token 不可用', { openId });
    return;
  }

  const parts = splitMessage(text);
  for (const part of parts) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);

    try {
      const { body } = await request(
        `https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=${encodeURIComponent(token)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            touser: openId,
            msgtype: 'text',
            text: { content: part },
          }),
          bodyTimeout: 10_000,
          headersTimeout: 10_000,
          signal: controller.signal,
        }
      );
      clearTimeout(timeoutId);
      const result = await body.json();
      if (result.errcode && result.errcode !== 0) {
        logger.error('客服消息发送失败', { errcode: result.errcode, errmsg: result.errmsg, openId });
      }
    } catch (err) {
      clearTimeout(timeoutId);
      logger.error('客服消息发送异常', { err: err.message, openId });
    }
  }
}

// ─── 输入验证 ────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MODEL_NAME_RE = /^[a-zA-Z0-9._:\/-]+$/;
const MAX_TEXT_LENGTH = 10000;

function stripControlChars(str) {
  return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

// ─── 消息处理核心 ────────────────────────────────────────────

/**
 * 处理来自 ClawBot 的文本消息。
 * 返回要回复给用户的文本（同步），对长任务发起异步回调。
 */
async function handleTextMessage(openId, rawText) {
  const text = stripControlChars(rawText).trim();
  if (!text) return '';

  if (text.length > MAX_TEXT_LENGTH) {
    return '❌ 消息过长（最多 10000 字符），请精简后重试。';
  }

  // ── 命令处理 ──

  // /bind <email> — 绑定邮箱（登录认证）
  if (text.startsWith('/bind ') || text.startsWith('/bind\u3000')) {
    const email = text.slice(6).trim().toLowerCase();
    if (!email || !EMAIL_RE.test(email) || email.length > 254) {
      return '❌ 邮箱格式不正确，请重新输入。\n\n用法：/bind yourname@example.com';
    }
    await setUserEmail(openId, email);
    await setUserAuthed(openId);
    logger.info('用户绑定邮箱并完成认证', { openId, email });
    return `✅ 已绑定计费邮箱：${email}\n\n你已通过认证，现在可以使用所有 AI 功能。\n后续对话将归入该账户计费。`;
  }

  // /help — 帮助
  if (text === '/help') {
    return '📖 Anima 灵枢 · ClawBot 命令列表\n\n' +
      '/bind <邮箱> — 绑定邮箱（首次使用必须绑定）\n' +
      '/balance — 查询账户余额\n' +
      '/model <模型名> — 切换 AI 模型\n' +
      '/clear — 清除对话上下文\n' +
      '/help — 显示此帮助\n\n' +
      '直接发送文字即可与 AI 对话。';
  }

  // ── 认证检查（/bind 和 /help 不需要认证）──
  const authed = await isUserAuthed(openId);
  if (!authed) {
    return '🔒 请先绑定邮箱完成认证后使用。\n\n' +
      '发送：/bind 你的邮箱@example.com\n\n' +
      '绑定后即可使用所有 AI 功能。';
  }

  // /balance — 查询余额
  if (text === '/balance') {
    const email = await getUserEmail(openId);
    if (!email) {
      return '请先绑定邮箱：/bind yourname@example.com';
    }
    return await queryBalance(email);
  }

  // /model [name] — 切换模型
  if (text === '/model' || text.startsWith('/model ') || text.startsWith('/model\u3000')) {
    if (text === '/model') {
      const current = (await getUserModel(openId)) || DEFAULT_MODEL;
      return `当前模型：${current}\n\n用法：/model <模型名>`;
    }
    const modelName = text.slice(7).trim();
    if (!modelName || modelName.length > 128) {
      return '❌ 模型名称无效（最多 128 字符）';
    }
    if (!MODEL_NAME_RE.test(modelName)) {
      return '❌ 模型名称格式不正确（仅支持字母、数字、._:/-）';
    }
    await setUserModel(openId, modelName);
    return `✅ 已切换到模型：${modelName}`;
  }

  // /clear — 清除上下文
  if (text === '/clear') {
    sessions.delete(openId);
    logger.info('用户清除对话上下文', { openId });
    return '🗑 对话上下文已清除。';
  }

  // ── 普通消息 → AI 对话 ──
  logger.info('收到文字消息', { openId, text: text.substring(0, 100) });

  // 长耗时任务：异步处理
  if (isLongRunningTask(text)) {
    callAgent(openId, text)
      .then(async (reply) => {
        await sendAsyncReply(openId, `✅ 任务完成：\n\n${reply}`);
      })
      .catch(async (err) => {
        logger.error('Long-running task failed', { err: err.message, openId });
        await sendAsyncReply(openId, '❌ 任务执行失败，请稍后重试。');
      });
    return '⏳ 任务处理中，完成后会通知你...';
  }

  // 普通对话：同步回复
  return await callAgent(openId, text);
}

/**
 * 处理语音消息（如已启用语音模块）
 */
async function handleVoiceMessage(openId) {
  if (!VOICE_ENABLED) {
    return '语音功能暂未启用，请发送文字消息。';
  }
  return '语音处理中...（语音转文字 → AI 对话 → 语音回复）\n暂请先发送文字消息。';
}

/**
 * 处理图片/文件消息
 */
async function handleImageMessage(openId) {
  const authed = await isUserAuthed(openId);
  if (!authed) {
    return '🔒 请先绑定邮箱完成认证后使用。\n\n发送：/bind 你的邮箱@example.com';
  }
  return '📎 已收到文件。文件分析功能可通过 Web 界面使用，ClawBot 通道将在后续版本支持文件直传分析。';
}

// ─── 构建微信 XML 被动回复 ──────────────────────────────────
function buildTextReply(toUser, fromUser, text) {
  const timestamp = Math.floor(Date.now() / 1000);
  // 只回复第一段（超长消息后续通过客服接口发送）
  const parts = splitMessage(text);
  const firstPart = parts[0] || '';

  // 如果有多段，通过客服消息接口异步发送剩余部分
  if (parts.length > 1) {
    const remaining = parts.slice(1);
    setImmediate(async () => {
      for (const part of remaining) {
        await sendAsyncReply(toUser, part);
      }
    });
  }

  return `<xml>
<ToUserName><![CDATA[${toUser}]]></ToUserName>
<FromUserName><![CDATA[${fromUser}]]></FromUserName>
<CreateTime>${timestamp}</CreateTime>
<MsgType><![CDATA[text]]></MsgType>
<Content><![CDATA[${firstPart}]]></Content>
</xml>`;
}

// ─── Express 服务器 ──────────────────────────────────────────
const app = express();

// 安全中间件
app.use(helmet());

app.disable('x-powered-by');
app.disable('etag');

// 速率限制：微信 ClawBot URL 验证（低频调用）
const verifyLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests',
});

// 速率限制：微信 ClawBot 消息回调（高频消息处理）
const webhookLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 300,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests',
});

// 微信回调需要原始 XML body
app.use('/clawbot/webhook', express.text({ type: ['text/xml', 'application/xml'], limit: '256kb' }));
app.use(express.json({ limit: '256kb' }));

// ─── 健康检查 ────────────────────────────────────────────────
app.get('/health', (req, res) => {
  const redisOk = redis ? redis.status === 'ready' : true;
  const status = redisOk ? 'ok' : 'degraded';
  res.status(redisOk ? 200 : 503).json({ status });
});

// ─── 微信 ClawBot Webhook 验证（GET）────────────────────────
// 微信服务器验证 URL 有效性时发送 GET 请求
app.get('/clawbot/webhook', verifyLimiter, (req, res) => {
  const { signature, timestamp, nonce, echostr } = req.query;

  if (!signature || !timestamp || !nonce || !echostr) {
    logger.warn('ClawBot 验证请求缺少参数');
    res.status(400).send('Missing parameters');
    return;
  }

  try {
    if (verifySignature(String(signature), String(timestamp), String(nonce))) {
      logger.info('ClawBot URL 验证成功');
      res.status(200).send(String(echostr));
    } else {
      logger.warn('ClawBot 签名验证失败', { signature, timestamp, nonce });
      res.status(403).send('Signature verification failed');
    }
  } catch (err) {
    logger.error('签名验证异常', { err: err.message });
    res.status(500).send('Internal error');
  }
});

// ─── 微信 ClawBot Webhook 消息接收（POST）──────────────────
app.post('/clawbot/webhook', webhookLimiter, async (req, res) => {
  const { signature, timestamp, nonce } = req.query;

  // 签名验证
  if (!signature || !timestamp || !nonce) {
    res.status(400).send('Missing parameters');
    return;
  }

  try {
    if (!verifySignature(String(signature), String(timestamp), String(nonce))) {
      logger.warn('ClawBot 消息签名验证失败');
      res.status(403).send('Signature verification failed');
      return;
    }
  } catch (err) {
    logger.error('签名验证异常', { err: err.message });
    res.status(500).send('Internal error');
    return;
  }

  // 解析 XML 消息体（简单正则解析，无需依赖 XML 库）
  const xmlBody = typeof req.body === 'string' ? req.body : '';
  if (!xmlBody) {
    res.status(400).send('Empty body');
    return;
  }

  // 预编译 XML 字段提取正则（避免每次调用重新编译）
  const xmlFieldCache = new Map();
  const getXmlValue = (xml, tag) => {
    let re = xmlFieldCache.get(tag);
    if (!re) {
      re = {
        cdata: new RegExp(`<${tag}><!\\[CDATA\\[([\\s\\S]*?)\\]\\]></${tag}>`),
        plain: new RegExp(`<${tag}>([^<]*)</${tag}>`),
      };
      xmlFieldCache.set(tag, re);
    }
    const match = xml.match(re.cdata);
    if (match) return match[1];
    const match2 = xml.match(re.plain);
    return match2 ? match2[1] : '';
  };

  const toUserName   = getXmlValue(xmlBody, 'ToUserName');
  const fromUserName = getXmlValue(xmlBody, 'FromUserName');   // 用户 OpenID
  const msgType      = getXmlValue(xmlBody, 'MsgType');
  const content      = getXmlValue(xmlBody, 'Content');
  const msgId        = getXmlValue(xmlBody, 'MsgId');

  if (!fromUserName || !msgType) {
    res.status(400).send('Invalid message');
    return;
  }

  const openId = fromUserName;

  logger.info('收到 ClawBot 消息', {
    openId,
    msgType,
    msgId,
    content: content ? content.substring(0, 50) : '',
  });

  try {
    let replyText = '';

    switch (msgType) {
      case 'text':
        replyText = await handleTextMessage(openId, content);
        break;

      case 'voice':
        replyText = await handleVoiceMessage(openId);
        break;

      case 'image':
      case 'video':
      case 'file':
        replyText = await handleImageMessage(openId);
        break;

      case 'event': {
        const eventType = getXmlValue(xmlBody, 'Event');
        if (eventType === 'subscribe') {
          replyText = '🤖 欢迎使用 Anima 灵枢 AI 助手！\n\n' +
            '首次使用请先绑定邮箱完成认证：\n' +
            '/bind 你的邮箱@example.com\n\n' +
            '绑定后即可直接发送消息与 AI 对话。\n\n' +
            '发送 /help 查看所有可用命令。';
        } else if (eventType === 'unsubscribe') {
          logger.info('用户取消关注', { openId });
        }
        break;
      }

      default:
        replyText = '暂不支持此类型消息，请发送文字消息。';
        break;
    }

    if (replyText) {
      const replyXml = buildTextReply(openId, toUserName, replyText);
      res.set('Content-Type', 'text/xml');
      res.status(200).send(replyXml);
    } else {
      // 微信要求返回 "success" 表示已处理
      res.status(200).send('success');
    }
  } catch (err) {
    logger.error('消息处理异常', { err: err.message, openId, msgType });
    const errorReply = buildTextReply(openId, toUserName, '处理消息时出错，请稍后再试。');
    res.set('Content-Type', 'text/xml');
    res.status(200).send(errorReply);
  }
});

// ─── 404 处理 ────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Not Found' });
});

// ─── 全局错误处理 ────────────────────────────────────────────
app.use((err, req, res, _next) => {
  logger.error('Express 未捕获错误', { err: err.message, stack: err.stack });
  res.status(500).json({ error: 'Internal Server Error' });
});

// ─── 启动服务器 ──────────────────────────────────────────────
const server = app.listen(PORT, '0.0.0.0', () => {
  logger.info(`ClawBot 接入服务已启动 :${PORT}`);
  logger.info('等待微信 ClawBot 插件回调...');
});

// 安全加固
server.maxHeadersCount = 50;
server.requestTimeout = 30_000;
server.maxRequestsPerSocket = 256;

// ─── 优雅退出 ────────────────────────────────────────────────
const shutdown = (signal) => {
  logger.info(`收到 ${signal}，正在关闭...`);
  clearInterval(sessionCleanupTimer);

  server.close(() => {
    if (redis) redis.disconnect();
    process.exit(0);
  });

  // 强制退出兜底
  setTimeout(() => {
    if (redis) redis.disconnect();
    process.exit(1);
  }, 10_000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection, shutting down', { err: String(reason) });
  setTimeout(() => process.exit(1), 100);
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception, shutting down', { err: err.message, stack: err.stack });
  setTimeout(() => process.exit(1), 100);
});
