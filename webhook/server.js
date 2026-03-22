'use strict';

/**
 * Anima 灵枢 · Webhook 服务 v5.3
 * ─────────────────────────────────────────────────────────────
 * 修复记录（v5.3 相对于 v5.2）：
 *   #BUG-1  INCR_EXPIRE_LUA：新建 key 时 TTL=-2，旧逻辑只处理 TTL=-1，
 *           导致新 key 永远没有过期时间。修复：INCR 后若 new_c==1，
 *           表明是新创建的 key，立即执行 EXPIRE。
 *           同时将 early-return 分支也纳入 TTL 守护，彻底消除漏网场景。
 *   #BUG-7  与 BUG-1 配合：确保 early-return 路径不会绕过 TTL 守护。
 *   #BUG-8  /billing/record 同时警告旧版 outputChars 字段使用。
 *   #BUG-9  /billing/check 使用独立限速器（120次/分），避免正常 AI 对话
 *           预检被 readLimiter 的 20次/分 误限。
 */

/**
 * 之前修复记录（v5.0 → v5.2）保留供溯源：
 *   v5.1 #1  移除 /billing/check 的 requireServiceToken（公开只读接口）
 *   v5.1 #5  Redis Lua 脚本增加 TTL 守护（FIX-B）
 *   v5.1 #6  /billing/record 增加独立限速（600次/分）
 *   v5.1 #7  calculateChargedFen 增加 promptTokens+historyTokens 一致性校验
 *   v5.1 #11 FREE_DAILY_LIMIT / MAX_SINGLE_REQUEST_FEN 改为运行时读取
 *   v5.2 FIX-A  全局限速跳过 /billing/record
 *   v5.2 FIX-B  INCR_EXPIRE_LUA early-return 分支也执行 TTL 守护
 *   v5.2 FIX-C  calculateChargedFen inputTokens=0 但 partitionSum>0 时回退
 *   v5.2 FIX-D  免费模型 DB 插入失败时尝试 Redis DECR 回滚
 *   v5.2 FIX-E  PUT /admin/models/:id 先查 DB is_free 再验证价格字段
 */

const crypto    = require('crypto');
const express   = require('express');
const helmet    = require('helmet');
const rateLimit = require('express-rate-limit');
const { Pool }  = require('pg');
const winston   = require('winston');
const Redis     = require('ioredis');

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
      filename: '/tmp/anima-webhook.log',
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
      tailable: true,
    }),
  ],
});

// ─── 数据库连接池 ─────────────────────────────────────────────
const db = new Pool({
  host:     process.env.PG_HOST     || 'anima-db.postgres.database.azure.com',
  port:     parseInt(process.env.PG_PORT || '5432', 10),
  user:     process.env.PG_USER     || 'animaapp',
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE || 'librechat',
  ssl:      { rejectUnauthorized: true },
  max:      parseInt(process.env.PG_POOL_MAX || '15', 10),
  idleTimeoutMillis:   30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout:  10_000,
  keepAlive:          true,
  keepAliveInitialDelayMillis: 10_000,
});

db.on('error', (err) => logger.error('DB pool error', { err: err.message }));

// ─── Redis 连接 ───────────────────────────────────────────────
const REDIS_URL = process.env.REDIS_URL || 'redis://172.16.1.6:6379';
const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    return Math.min(times * 200, 2000);
  },
  lazyConnect: true,
});
redis.connect().catch((err) => logger.warn('Redis connect error (free daily limits disabled)', { err: err.message }));
redis.on('error', (err) => logger.error('Redis error', { err: err.message }));

// ─────────────────────────────────────────────────────────────
// BUG-1 修复：完整的 INCR+EXPIRE Lua 脚本
// ─────────────────────────────────────────────────────────────
// 问题：原脚本 TTL 守护只检查 ttl==-1（key 存在但无 TTL）。
// 当 key 不存在时 TTL==-2，守护不生效，INCR 创建的新 key 没有过期时间，
// 导致计数器永不过期，用户首次使用免费模型后该 key 会永久存在。
//
// 修复方案：
//   1. 先执行 TTL 守护（修复 ttl==-1 的已有 key）
//   2. early-return 分支（超限）直接返回前也通过步骤1保证 TTL
//   3. INCR 后检查 new_c==1：若为1表明是新创建的 key，立即设置 TTL
//
// 保证所有路径下的 key 都有 TTL，彻底消除计数器永不过期问题。
// ─────────────────────────────────────────────────────────────
const INCR_EXPIRE_LUA =
  'local key = KEYS[1]\n' +
  'local limit = tonumber(ARGV[1])\n' +
  // 步骤1：TTL 守护 —— 修复已有 key 丢失 TTL 的情况（如 PERSIST 命令或故障恢复）
  // 注：ttl==-2 表示 key 不存在，此时 EXPIRE 无效但 INCR 后新 key 由步骤3处理
  'local ttl = redis.call("TTL", key)\n' +
  'if ttl == -1 then redis.call("EXPIRE", key, 86400) end\n' +
  // 步骤2：读当前值（GET 对不存在的 key 返回 nil，or "0" 保证 tonumber 成功）
  'local c = tonumber(redis.call("GET", key) or "0")\n' +
  // 步骤2a：已超限 —— 不递增，直接返回当前值，防止计数器无限增长
  'if c > limit then return c end\n' +
  // 步骤3：递增
  'local new_c = redis.call("INCR", key)\n' +
  // 步骤3a：BUG-1 核心修复 —— new_c==1 表明 key 是刚被 INCR 新创建的，立即设置 TTL
  'if new_c == 1 then redis.call("EXPIRE", key, 86400) end\n' +
  'return new_c';

// ─── 运行时读取配置（热更新无需重启）──────────────────────────
function getFreeDailyLimit() {
  const v = parseInt(process.env.FREE_DAILY_LIMIT || '20', 10);
  if (!Number.isFinite(v) || v <= 0) {
    logger.warn('FREE_DAILY_LIMIT 非法，使用默认值 20');
    return 20;
  }
  return v;
}

function getMaxSingleRequestFen() {
  const v = parseInt(process.env.MAX_SINGLE_REQUEST_FEN || '1000', 10);
  if (!Number.isFinite(v) || v <= 0) {
    logger.warn('MAX_SINGLE_REQUEST_FEN 非法，使用默认值 1000');
    return 1000;
  }
  return v;
}

function getUsdToCnyRate() {
  const v = parseFloat(process.env.USD_TO_CNY_RATE || '7.2');
  if (!Number.isFinite(v) || v < 1 || v > 15) {
    logger.warn('USD_TO_CNY_RATE 非法，使用默认值 7.2', { raw: process.env.USD_TO_CNY_RATE });
    return 7.2;
  }
  return v;
}

/**
 * 查询免费用户当日已使用次数（只读，不递增）。
 */
async function peekFreeDailyUsage(userEmail) {
  const FREE_DAILY_LIMIT = getFreeDailyLimit();
  try {
    if (redis.status !== 'ready') {
      return { allowed: true, used: 0, limit: FREE_DAILY_LIMIT };
    }
    const today = new Date().toISOString().slice(0, 10);
    const key = `anima:free_daily:${userEmail}:${today}`;
    const count = parseInt(await redis.get(key) || '0', 10);
    return { allowed: count < FREE_DAILY_LIMIT, used: Math.min(count, FREE_DAILY_LIMIT), limit: FREE_DAILY_LIMIT };
  } catch (err) {
    logger.warn('Redis daily peek failed, allowing request', { err: err.message });
    return { allowed: true, used: 0, limit: FREE_DAILY_LIMIT };
  }
}

/**
 * 递增免费用户当日调用计数器，返回递增后的值。
 * 返回 { allowed, used, limit, key } — key 用于失败时回滚。
 */
async function incrFreeDailyUsage(userEmail) {
  const FREE_DAILY_LIMIT = getFreeDailyLimit();
  try {
    if (redis.status !== 'ready') {
      return { allowed: true, used: 0, limit: FREE_DAILY_LIMIT, key: null };
    }
    const today = new Date().toISOString().slice(0, 10);
    const key = `anima:free_daily:${userEmail}:${today}`;
    const count = await redis.eval(INCR_EXPIRE_LUA, 1, key, FREE_DAILY_LIMIT);
    return { allowed: count <= FREE_DAILY_LIMIT, used: count, limit: FREE_DAILY_LIMIT, key };
  } catch (err) {
    logger.warn('Redis daily limit incr failed, allowing request', { err: err.message });
    return { allowed: true, used: 0, limit: FREE_DAILY_LIMIT, key: null };
  }
}

/**
 * 尝试回滚 Redis 计数器（DECR），用于 DB 插入失败时减少不一致窗口。
 * 采用"尽力而为"策略：失败仅记日志，不抛出错误。
 */
async function tryDecrFreeDailyUsage(key) {
  if (!key) return;
  try {
    if (redis.status !== 'ready') return;
    await redis.decr(key);
  } catch (err) {
    logger.warn('Redis daily counter decr (rollback) failed', { err: err.message, key });
  }
}

// ─── Express 应用 ─────────────────────────────────────────────
const app = express();

app.set('trust proxy', process.env.TRUST_PROXY || '172.16.1.1');

app.use(helmet());
app.use(express.json({ limit: '1mb' }));

app.use((_req, res, next) => {
  res.set('Cache-Control', 'private, no-store, no-cache, must-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// ─── 限速器 ──────────────────────────────────────────────────

// 全局通用限速：60次/分（跳过内部服务路由 /billing/record）
app.use(rateLimit({
  windowMs: 60_000,
  max:      60,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, msg: '请求过于频繁，请稍后再试' },
  // /billing/record 由 OpenClaw 内部调用，有独立限速器 + SERVICE_TOKEN 保护
  skip: (req) => req.path === '/billing/record',
}));

// 激活接口限速：5 次/10 分（防暴力枚举卡密）
const activateLimiter = rateLimit({
  windowMs: 10 * 60_000,
  max:      5,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, msg: '激活尝试过于频繁，请 10 分钟后再试' },
});

// 只读查询限速：20 次/分（余额查询、消费历史等低频接口）
const readLimiter = rateLimit({
  windowMs: 60_000,
  max:      20,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, msg: '查询过于频繁，请稍后再试' },
});

// BUG-9 修复：/billing/check 使用独立限速器
// 原因：/billing/check 是每次 AI 对话前的预检，正常使用场景下
// 每分钟可能调用数十次（用户连续对话），readLimiter 的 20次/分
// 会误限合法用户。设为 120次/分（2次/秒），足够应对正常对话。
const billingCheckLimiter = rateLimit({
  windowMs: 60_000,
  max:      120,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, msg: '预检请求过于频繁，请稍后再试' },
});

// /billing/record 独立限速：600 次/分（内部服务 ~10次/秒）
const billingRecordLimiter = rateLimit({
  windowMs: 60_000,
  max:      600,
  keyGenerator: (req) => req.ip,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, msg: '计费记录请求过于频繁' },
});

// 管理员接口限速：10 次/15 分
const adminLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max:      10,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, msg: '管理员接口请求过于频繁，请 15 分钟后再试' },
});

// ─── 鉴权中间件 ──────────────────────────────────────────────
const ADMIN_TOKEN   = process.env.ADMIN_TOKEN;
const SERVICE_TOKEN = process.env.SERVICE_TOKEN;

function safeCompare(a, b) {
  const aBuf = Buffer.from(typeof a === 'string' ? a : '');
  const bBuf = Buffer.from(typeof b === 'string' ? b : '');
  const len = Math.max(aBuf.length, bBuf.length);
  const paddedA = Buffer.concat([aBuf, Buffer.alloc(len - aBuf.length)]);
  const paddedB = Buffer.concat([bBuf, Buffer.alloc(len - bBuf.length)]);
  const equal = crypto.timingSafeEqual(paddedA, paddedB);
  return equal && aBuf.length === bBuf.length;
}

function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) {
    return res.status(503).json({ success: false, msg: '管理员接口未启用（未设置 ADMIN_TOKEN）' });
  }
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!safeCompare(token, ADMIN_TOKEN)) {
    logger.warn('Admin auth failed', { ip: req.ip, path: req.path });
    return res.status(401).json({ success: false, msg: '未授权' });
  }
  next();
}

function requireServiceToken(req, res, next) {
  if (!SERVICE_TOKEN) {
    logger.error('SERVICE_TOKEN 未配置，拒绝 /billing 写入请求', { path: req.path, ip: req.ip });
    return res.status(503).json({ success: false, msg: '服务鉴权未配置，请联系管理员' });
  }
  const token = req.headers['x-service-token'] || '';
  if (!safeCompare(token, SERVICE_TOKEN)) {
    logger.warn('Service token auth failed', { ip: req.ip, path: req.path });
    return res.status(401).json({ success: false, msg: '内部服务鉴权失败' });
  }
  next();
}

// ─── 工具函数 ─────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LEN = 254;

function isValidEmail(email) {
  return typeof email === 'string' && email.length <= MAX_EMAIL_LEN && EMAIL_RE.test(email);
}

function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

const MAX_TOKEN_VALUE = 10_000_000;

function parseOptionalNonNegInt(value) {
  if (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0 && value <= MAX_TOKEN_VALUE) {
    return value;
  }
  return undefined;
}

async function ensureUser(client, userEmail) {
  await client.query(
    `INSERT INTO user_billing (user_email) VALUES ($1)
     ON CONFLICT (user_email) DO NOTHING`,
    [userEmail]
  );
}

async function lookupModel(modelName) {
  const res = await db.query(
    `SELECT id, is_free, price_input_per_1k_tokens, price_output_per_1k_tokens, currency, is_active, supports_cache
       FROM api_models WHERE model_name = $1`,
    [modelName]
  );
  return res.rows[0] || null;
}

// ─── 缓存感知分层计费 ─────────────────────────────────────────
const CACHE_THRESHOLD_TOKENS = 2000;
const CACHE_DISCOUNT = 0.1;

/**
 * 计算本次请求的费用（分），支持缓存感知分层定价。
 */
function calculateChargedFen({ inputTokens, outputTokens, priceIn, priceOut, currency, supportsCache, promptTokens, historyTokens }) {
  const fxRate = (currency === 'USD') ? getUsdToCnyRate() : 1;
  const cnyPriceIn  = priceIn  * fxRate;
  const cnyPriceOut = priceOut * fxRate;

  let inputCostYuan;
  const hasPartition = typeof promptTokens === 'number' && typeof historyTokens === 'number';

  if (supportsCache && hasPartition && historyTokens > CACHE_THRESHOLD_TOKENS) {
    const partitionSum = promptTokens + historyTokens;

    if (inputTokens === 0 && partitionSum > 0) {
      logger.warn('calculateChargedFen: inputTokens=0 但 partitionSum>0，数据不一致，回退到标准计费', {
        inputTokens, promptTokens, historyTokens, partitionSum,
      });
      inputCostYuan = 0;
    } else {
      const deviation = inputTokens > 0 ? Math.abs(partitionSum - inputTokens) / inputTokens : 0;
      if (deviation > 0.01) {
        logger.warn('calculateChargedFen: promptTokens+historyTokens 与 inputTokens 偏差超过 1%，回退到标准计费', {
          inputTokens, promptTokens, historyTokens, partitionSum,
          deviation: `${(deviation * 100).toFixed(2)}%`,
        });
        inputCostYuan = (inputTokens / 1000) * cnyPriceIn;
      } else {
        const fullPriceTokens  = promptTokens + CACHE_THRESHOLD_TOKENS;
        const discountedTokens = historyTokens - CACHE_THRESHOLD_TOKENS;
        inputCostYuan = (fullPriceTokens  / 1000) * cnyPriceIn
                      + (discountedTokens / 1000) * cnyPriceIn * CACHE_DISCOUNT;
      }
    }
  } else {
    inputCostYuan = (inputTokens / 1000) * cnyPriceIn;
  }

  const outputCostYuan = (outputTokens / 1000) * cnyPriceOut;
  return Math.ceil((inputCostYuan + outputCostYuan) * 100);
}

// =============================================================
// ─── 路由 ────────────────────────────────────────────────────
// =============================================================

app.get('/health', async (_req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', db: 'ok', ts: new Date().toISOString() });
  } catch (err) {
    logger.error('Health check DB error', { err: err.message });
    res.status(503).json({ status: 'degraded', db: 'error' });
  }
});

app.get('/models', readLimiter, async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT provider, model_name, display_name, is_free,
              price_input_per_1k_tokens, price_output_per_1k_tokens,
              currency, supports_cache, description
         FROM api_models
        WHERE is_active = true
        ORDER BY provider, model_name`
    );
    res.json({ success: true, models: result.rows });
  } catch (err) {
    logger.error('Models query error', { err: err.message });
    res.status(500).json({ success: false, msg: '服务器内部错误' });
  }
});

app.post('/activate', activateLimiter, async (req, res) => {
  let { cardKey, userEmail } = req.body ?? {};

  if (!cardKey || !userEmail) {
    return res.status(400).json({ success: false, msg: '参数缺失：需要 cardKey 和 userEmail' });
  }
  if (typeof cardKey !== 'string') {
    return res.status(400).json({ success: false, msg: 'cardKey 必须为字符串' });
  }
  userEmail = normalizeEmail(userEmail);
  if (!isValidEmail(userEmail)) {
    return res.status(400).json({ success: false, msg: '邮箱格式不正确' });
  }
  if (cardKey.length > 64 || !/^[A-Z0-9-]+$/i.test(cardKey)) {
    return res.status(400).json({ success: false, msg: '卡密格式不正确' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    const cardRes = await client.query(
      `SELECT id, credit_fen, label
         FROM recharge_cards
        WHERE key=$1 AND used=false
        FOR UPDATE`,
      [cardKey]
    );
    if (cardRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.json({ success: false, msg: '卡密无效或已使用' });
    }

    const card = cardRes.rows[0];

    await ensureUser(client, userEmail);

    const rechargeRes = await client.query(
      `UPDATE user_billing
          SET balance_fen = balance_fen + $1
        WHERE user_email = $2
        RETURNING balance_fen`,
      [card.credit_fen, userEmail]
    );
    const newBalance = Number(rechargeRes.rows[0].balance_fen);

    await client.query(
      `UPDATE recharge_cards
          SET used=true, used_at=NOW(), used_by=$1
        WHERE id=$2`,
      [userEmail, card.id]
    );

    await client.query(
      `INSERT INTO billing_transactions
           (user_email, type, amount_fen, balance_after_fen, description, ref_id)
         VALUES ($1, 'recharge', $2, $3, $4, $5)`,
      [userEmail, card.credit_fen, newBalance, `充值卡: ${card.label || cardKey}`, cardKey]
    );

    await client.query('COMMIT');

    logger.info('Card activated', { userEmail, cardKey, credit: card.credit_fen });

    res.json({
      success:     true,
      msg:         '充值成功',
      credit_fen:  Number(card.credit_fen),
      balance_fen: newBalance,
      label:       card.label || null,
    });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('Activation error', { err: err.message, userEmail });
    res.status(500).json({ success: false, msg: '服务器内部错误，请稍后重试' });
  } finally {
    client.release();
  }
});

app.get('/billing/balance/:email', readLimiter, async (req, res) => {
  const email = normalizeEmail(req.params.email);
  if (!isValidEmail(email)) {
    return res.status(400).json({ success: false, msg: '邮箱格式不正确' });
  }

  try {
    const result = await db.query(
      `SELECT balance_fen, total_charged_fen, is_suspended
         FROM user_billing WHERE user_email=$1`,
      [email]
    );
    if (result.rows.length === 0) {
      return res.json({ success: true, balance_fen: 0, total_charged_fen: 0, is_suspended: false });
    }
    const r = result.rows[0];
    res.json({
      success:          true,
      balance_fen:      Number(r.balance_fen),
      total_charged_fen: Number(r.total_charged_fen),
      is_suspended:     r.is_suspended,
    });
  } catch (err) {
    logger.error('Balance query error', { err: err.message, email });
    res.status(500).json({ success: false, msg: '服务器内部错误' });
  }
});

app.get('/billing/history/:email', readLimiter, async (req, res) => {
  const email = normalizeEmail(req.params.email);
  if (!isValidEmail(email)) {
    return res.status(400).json({ success: false, msg: '邮箱格式不正确' });
  }

  const limit  = Math.min(Math.max(parseInt(req.query.limit  || '20', 10) || 20,  1), 100);
  const offset = Math.max(parseInt(req.query.offset || '0',  10) || 0, 0);

  try {
    const [result, countRes] = await Promise.all([
      db.query(
        `SELECT type, amount_fen, balance_after_fen, description, created_at
           FROM billing_transactions
          WHERE user_email=$1
          ORDER BY created_at DESC
          LIMIT $2 OFFSET $3`,
        [email, limit, offset]
      ),
      db.query(
        'SELECT COUNT(*) AS total FROM billing_transactions WHERE user_email=$1',
        [email]
      ),
    ]);
    res.json({ success: true, records: result.rows, total: Number(countRes.rows[0]?.total ?? 0) });
  } catch (err) {
    logger.error('History query error', { err: err.message, email });
    res.status(500).json({ success: false, msg: '服务器内部错误' });
  }
});

/**
 * POST /billing/check — 公开只读预检接口，无需服务鉴权
 * BUG-9 修复：使用独立的 billingCheckLimiter（120次/分）
 */
app.post('/billing/check', billingCheckLimiter, async (req, res) => {
  let { userEmail, modelName, estimatedInputTokens, estimatedOutputTokens,
          estimatedInputChars, estimatedOutputChars,
          estimatedPromptTokens, estimatedHistoryTokens } = req.body ?? {};

  userEmail = normalizeEmail(userEmail || '');
  if (!isValidEmail(userEmail)) {
    return res.status(400).json({ success: false, msg: '邮箱格式不正确' });
  }
  if (!modelName) {
    return res.status(400).json({ success: false, msg: '缺少 modelName' });
  }
  if (typeof modelName !== 'string' || modelName.length > 128) {
    return res.status(400).json({ success: false, msg: 'modelName 长度不能超过 128 字符' });
  }

  let model;
  try {
    model = await lookupModel(modelName);
  } catch (err) {
    logger.error('Model lookup error in /billing/check', { err: err.message, modelName });
    return res.status(500).json({ success: false, msg: '服务器内部错误' });
  }

  if (!model) {
    return res.status(404).json({ success: false, msg: '模型不存在，请先通过 POST /admin/models 注册' });
  }
  if (!model.is_active) {
    return res.status(400).json({ success: false, msg: '该模型当前未启用' });
  }

  if (model.is_free) {
    const dailyCheck = await peekFreeDailyUsage(userEmail);
    if (!dailyCheck.allowed) {
      return res.status(429).json({
        success: false, can_proceed: false, is_free: true,
        msg: `免费用户每日限 ${dailyCheck.limit} 次调用，今日已使用 ${dailyCheck.used} 次。充值后可无限使用。`,
        daily_used: dailyCheck.used, daily_limit: dailyCheck.limit,
      });
    }
    return res.json({ success: true, can_proceed: true, is_free: true, estimated_fen: 0, balance_fen: null, is_suspended: false, daily_used: dailyCheck.used, daily_limit: dailyCheck.limit });
  }

  const inTokens  = Math.max(0, parseInt(estimatedInputTokens  ?? estimatedInputChars  ?? '0', 10) || 0);
  const outTokens = Math.max(0, parseInt(estimatedOutputTokens ?? estimatedOutputChars ?? '0', 10) || 0);
  if (inTokens > MAX_TOKEN_VALUE || outTokens > MAX_TOKEN_VALUE) {
    return res.status(400).json({ success: false, msg: 'estimatedInputTokens/estimatedOutputTokens 单次上限为 10,000,000' });
  }
  const priceIn  = Number(model.price_input_per_1k_tokens);
  const priceOut = Number(model.price_output_per_1k_tokens);

  const promptTk  = parseOptionalNonNegInt(estimatedPromptTokens);
  const historyTk = parseOptionalNonNegInt(estimatedHistoryTokens);

  const estimatedFen = calculateChargedFen({
    inputTokens: inTokens, outputTokens: outTokens,
    priceIn, priceOut,
    currency: model.currency || 'CNY',
    supportsCache: !!model.supports_cache,
    promptTokens: promptTk, historyTokens: historyTk,
  });

  const MAX_SINGLE_REQUEST_FEN = getMaxSingleRequestFen();
  if (estimatedFen > MAX_SINGLE_REQUEST_FEN) {
    return res.status(402).json({
      success:  false,
      msg:      'Single request cost exceeds safety limit. Please start a new thread or reduce context.',
      estimated_fen: estimatedFen,
      limit_fen:     MAX_SINGLE_REQUEST_FEN,
    });
  }

  try {
    const balRes = await db.query(
      'SELECT balance_fen, is_suspended FROM user_billing WHERE user_email=$1',
      [userEmail]
    );
    const userExists  = balRes.rows.length > 0;
    const balance     = userExists ? Number(balRes.rows[0].balance_fen) : 0;
    const isSuspended = userExists ? balRes.rows[0].is_suspended : false;

    res.json({
      success:       true,
      can_proceed:   !isSuspended && balance >= estimatedFen,
      is_free:       false,
      estimated_fen: estimatedFen,
      balance_fen:   balance,
      is_suspended:  isSuspended,
    });
  } catch (err) {
    logger.error('Billing check error', { err: err.message, userEmail });
    res.status(500).json({ success: false, msg: '服务器内部错误' });
  }
});

/**
 * POST /billing/record — 内部服务专用，需要 SERVICE_TOKEN（x-service-token 请求头）
 */
app.post('/billing/record', billingRecordLimiter, requireServiceToken, async (req, res) => {
  let { userEmail, apiProvider, modelName,
          inputTokens: rawInputTokens, outputTokens: rawOutputTokens,
          inputChars, outputChars,
          promptTokens: rawPromptTokens, historyTokens: rawHistoryTokens } = req.body ?? {};

  const inputTokens  = rawInputTokens  ?? inputChars  ?? 0;
  const outputTokens = rawOutputTokens ?? outputChars ?? 0;

  // BUG-8 修复：同时警告 inputChars 和 outputChars 旧版字段
  if (rawInputTokens == null && inputChars != null) {
    logger.warn('billing/record: 调用方使用旧版 inputChars 字段，请迁移到 inputTokens', { userEmail, modelName });
  }
  if (rawOutputTokens == null && outputChars != null) {
    logger.warn('billing/record: 调用方使用旧版 outputChars 字段，请迁移到 outputTokens', { userEmail, modelName });
  }

  if (!userEmail || !apiProvider || !modelName) {
    return res.status(400).json({ success: false, msg: '参数缺失：需要 userEmail、apiProvider、modelName' });
  }
  userEmail = normalizeEmail(userEmail);
  if (typeof apiProvider !== 'string' || apiProvider.length > 32) {
    return res.status(400).json({ success: false, msg: 'apiProvider 长度不能超过 32 字符' });
  }
  if (typeof modelName !== 'string' || modelName.length > 128) {
    return res.status(400).json({ success: false, msg: 'modelName 长度不能超过 128 字符' });
  }
  if (typeof inputTokens !== 'number' || typeof outputTokens !== 'number'
      || !Number.isFinite(inputTokens) || !Number.isFinite(outputTokens)
      || !Number.isInteger(inputTokens) || !Number.isInteger(outputTokens)
      || inputTokens < 0 || outputTokens < 0) {
    return res.status(400).json({ success: false, msg: 'inputTokens/outputTokens 必须为有限的非负整数' });
  }
  if (inputTokens > 10_000_000 || outputTokens > 10_000_000) {
    return res.status(400).json({ success: false, msg: 'inputTokens/outputTokens 单次上限为 10,000,000' });
  }
  if (!isValidEmail(userEmail)) {
    return res.status(400).json({ success: false, msg: '邮箱格式不正确' });
  }

  let model;
  try {
    model = await lookupModel(modelName);
  } catch (err) {
    logger.error('Model lookup error in /billing/record', { err: err.message, modelName });
    return res.status(500).json({ success: false, msg: '服务器内部错误' });
  }

  if (!model) {
    logger.warn('Model not registered in api_models', { modelName, apiProvider });
    return res.status(404).json({ success: false, msg: '模型不存在，请先通过 POST /admin/models 注册' });
  }

  if (!model.is_active) {
    return res.status(400).json({ success: false, msg: '该模型当前未启用，无法计费' });
  }

  const modelId  = model.id;
  const isFree   = model.is_free;
  const priceIn  = Number(model.price_input_per_1k_tokens);
  const priceOut = Number(model.price_output_per_1k_tokens);

  const promptTk  = parseOptionalNonNegInt(rawPromptTokens);
  const historyTk = parseOptionalNonNegInt(rawHistoryTokens);

  if (isFree) {
    const dailyCheck = await incrFreeDailyUsage(userEmail);
    if (!dailyCheck.allowed) {
      return res.status(429).json({
        success: false, is_free: true,
        msg: `免费用户每日限 ${dailyCheck.limit} 次调用，今日已使用 ${dailyCheck.used - 1} 次。充值后可无限使用。`,
        daily_used: dailyCheck.used - 1, daily_limit: dailyCheck.limit,
      });
    }
    try {
      await db.query(
        `INSERT INTO api_usage
             (user_email, api_model_id, api_provider, model_name,
              is_free, input_tokens, output_tokens, charged_fen, status)
           VALUES ($1,$2,$3,$4,true,$5,$6,0,'ok')`,
        [userEmail, modelId, apiProvider, modelName, inputTokens, outputTokens]
      );
    } catch (err) {
      logger.error('Free usage DB insert failed, attempting Redis counter rollback', { err: err.message });
      await tryDecrFreeDailyUsage(dailyCheck.key);
      return res.status(500).json({ success: false, msg: '服务器内部错误' });
    }
    return res.json({
      success: true, is_free: true, charged_fen: 0, balance_fen: null,
      daily_used: dailyCheck.used, daily_limit: dailyCheck.limit,
    });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    await ensureUser(client, userEmail);

    const userRes = await client.query(
      'SELECT balance_fen, is_suspended FROM user_billing WHERE user_email=$1 FOR UPDATE',
      [userEmail]
    );
    const u = userRes.rows[0];

    if (u.is_suspended) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, msg: '账户已被暂停' });
    }

    const MAX_SINGLE_REQUEST_FEN = getMaxSingleRequestFen();
    const chargedFen = calculateChargedFen({
      inputTokens, outputTokens,
      priceIn, priceOut,
      currency: model.currency || 'CNY',
      supportsCache: !!model.supports_cache,
      promptTokens: promptTk, historyTokens: historyTk,
    });

    if (chargedFen > MAX_SINGLE_REQUEST_FEN) {
      await client.query('ROLLBACK');
      return res.status(402).json({
        success:  false,
        msg:      'Single request cost exceeds safety limit. Please start a new thread or reduce context.',
        charged_fen: chargedFen,
        limit_fen:   MAX_SINGLE_REQUEST_FEN,
      });
    }

    if (Number(u.balance_fen) < chargedFen) {
      await client.query('ROLLBACK');
      return res.status(402).json({
        success:      false,
        msg:          '余额不足，请充值后继续使用',
        balance_fen:  Number(u.balance_fen),
        required_fen: chargedFen,
      });
    }

    const deductRes = await client.query(
      `UPDATE user_billing
          SET balance_fen       = balance_fen - $1,
              total_charged_fen = total_charged_fen + $1
        WHERE user_email = $2
        RETURNING balance_fen`,
      [chargedFen, userEmail]
    );
    const newBalance = Number(deductRes.rows[0].balance_fen);

    const usageRes = await client.query(
      `INSERT INTO api_usage
           (user_email, api_model_id, api_provider, model_name,
            is_free, input_tokens, output_tokens, charged_fen, status)
         VALUES ($1,$2,$3,$4,false,$5,$6,$7,'ok')
         RETURNING id`,
      [userEmail, modelId, apiProvider, modelName, inputTokens, outputTokens, chargedFen]
    );

    await client.query(
      `INSERT INTO billing_transactions
           (user_email, type, amount_fen, balance_after_fen, description, ref_id)
         VALUES ($1,'charge',$2,$3,$4,$5)`,
      [
        userEmail,
        chargedFen,
        newBalance,
        `${modelName}（输入 ${inputTokens} Token / 输出 ${outputTokens} Token）`,
        String(usageRes.rows[0].id),
      ]
    );

    await client.query('COMMIT');

    logger.info('Billing recorded', { userEmail, modelName, chargedFen, newBalance });

    res.json({ success: true, is_free: false, charged_fen: chargedFen, balance_fen: newBalance });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('Billing record error', { err: err.message, userEmail });
    res.status(500).json({ success: false, msg: '服务器内部错误' });
  } finally {
    client.release();
  }
});

// ─── 管理员接口 ───────────────────────────────────────────────

app.get('/admin/models', adminLimiter, requireAdmin, async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT id, provider, model_name, display_name, is_free,
              price_input_per_1k_tokens, price_output_per_1k_tokens,
              currency, is_active, supports_cache, description, created_at, updated_at
         FROM api_models
         ORDER BY provider, model_name`
    );
    res.json({ success: true, models: result.rows });
  } catch (err) {
    logger.error('Admin models query error', { err: err.message });
    res.status(500).json({ success: false, msg: '服务器内部错误' });
  }
});

app.post('/admin/models', adminLimiter, requireAdmin, async (req, res) => {
  const { provider, modelName, displayName, isFree, priceInput, priceOutput, currency, supportsCache, description } = req.body ?? {};

  if (!provider || !modelName || !displayName) {
    return res.status(400).json({ success: false, msg: '缺少必填字段：provider、modelName、displayName' });
  }
  if (typeof provider !== 'string' || provider.length > 32) {
    return res.status(400).json({ success: false, msg: 'provider 长度不能超过 32 字符' });
  }
  if (typeof modelName !== 'string' || modelName.length > 128) {
    return res.status(400).json({ success: false, msg: 'modelName 长度不能超过 128 字符' });
  }
  if (typeof displayName !== 'string' || displayName.length > 128) {
    return res.status(400).json({ success: false, msg: 'displayName 长度不能超过 128 字符' });
  }
  if (typeof isFree !== 'boolean') {
    return res.status(400).json({ success: false, msg: 'isFree 必须为布尔值' });
  }
  if (!isFree && (typeof priceInput !== 'number' || typeof priceOutput !== 'number'
        || !Number.isFinite(priceInput) || !Number.isFinite(priceOutput))) {
    return res.status(400).json({ success: false, msg: '付费模型必须提供有限数值的 priceInput 和 priceOutput' });
  }
  if (!isFree && (priceInput < 0 || priceOutput < 0)) {
    return res.status(400).json({ success: false, msg: 'priceInput 和 priceOutput 必须为非负数' });
  }
  const currencyVal = currency ?? 'CNY';
  if (!['USD', 'CNY'].includes(currencyVal)) {
    return res.status(400).json({ success: false, msg: 'currency 必须为 USD 或 CNY' });
  }
  if (description != null && (typeof description !== 'string' || description.length > 1000)) {
    return res.status(400).json({ success: false, msg: 'description 长度不能超过 1000 字符' });
  }

  try {
    const result = await db.query(
      `INSERT INTO api_models
           (provider, model_name, display_name, is_free,
            price_input_per_1k_tokens, price_output_per_1k_tokens, currency, supports_cache, description)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (model_name) DO UPDATE SET
           provider    = EXCLUDED.provider,
           display_name = EXCLUDED.display_name,
           is_free     = EXCLUDED.is_free,
           price_input_per_1k_tokens  = EXCLUDED.price_input_per_1k_tokens,
           price_output_per_1k_tokens = EXCLUDED.price_output_per_1k_tokens,
           currency    = EXCLUDED.currency,
           supports_cache = EXCLUDED.supports_cache,
           description = EXCLUDED.description,
           is_active   = true
         RETURNING id, provider, model_name, display_name, is_free,
                   price_input_per_1k_tokens, price_output_per_1k_tokens,
                   currency, supports_cache, is_active`,
      [provider, modelName, displayName, isFree, isFree ? 0 : priceInput, isFree ? 0 : priceOutput, currencyVal, !!supportsCache, description || null]
    );

    logger.info('Model upserted', { modelName, isFree });
    res.json({ success: true, model: result.rows[0] });
  } catch (err) {
    logger.error('Model upsert error', { err: err.message });
    res.status(500).json({ success: false, msg: '服务器内部错误' });
  }
});

app.put('/admin/models/:id', adminLimiter, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, msg: '模型 ID 无效' });
  }

  let currentModel;
  try {
    const cur = await db.query('SELECT is_free FROM api_models WHERE id=$1', [id]);
    if (cur.rows.length === 0) {
      return res.status(404).json({ success: false, msg: '模型不存在' });
    }
    currentModel = cur.rows[0];
  } catch (err) {
    logger.error('Model fetch error in PUT', { err: err.message, id });
    return res.status(500).json({ success: false, msg: '服务器内部错误' });
  }

  const { isFree, priceInput, priceOutput, currency, isActive, supportsCache, displayName, description } = req.body ?? {};
  const updates = [];
  const values  = [];

  const effectiveIsFree = (typeof isFree === 'boolean') ? isFree : currentModel.is_free;

  if (typeof isFree === 'boolean') {
    updates.push(`is_free = $${values.length + 1}`);
    values.push(isFree);
    if (isFree) {
      updates.push(`price_input_per_1k_tokens = $${values.length + 1}`);
      values.push(0);
      updates.push(`price_output_per_1k_tokens = $${values.length + 1}`);
      values.push(0);
    }
  }

  if (!effectiveIsFree && typeof priceInput === 'number') {
    if (!Number.isFinite(priceInput) || priceInput < 0) {
      return res.status(400).json({ success: false, msg: 'priceInput 必须为有限的非负数' });
    }
    updates.push(`price_input_per_1k_tokens = $${values.length + 1}`);
    values.push(priceInput);
  } else if (effectiveIsFree && typeof priceInput === 'number') {
    return res.status(400).json({ success: false, msg: '免费模型的价格必须为 0，不能修改 priceInput' });
  }

  if (!effectiveIsFree && typeof priceOutput === 'number') {
    if (!Number.isFinite(priceOutput) || priceOutput < 0) {
      return res.status(400).json({ success: false, msg: 'priceOutput 必须为有限的非负数' });
    }
    updates.push(`price_output_per_1k_tokens = $${values.length + 1}`);
    values.push(priceOutput);
  } else if (effectiveIsFree && typeof priceOutput === 'number') {
    return res.status(400).json({ success: false, msg: '免费模型的价格必须为 0，不能修改 priceOutput' });
  }

  if (typeof isActive === 'boolean') {
    updates.push(`is_active = $${values.length + 1}`);
    values.push(isActive);
  }
  if (typeof supportsCache === 'boolean') {
    updates.push(`supports_cache = $${values.length + 1}`);
    values.push(supportsCache);
  }
  if (currency !== undefined) {
    if (!['USD', 'CNY'].includes(currency)) {
      return res.status(400).json({ success: false, msg: 'currency 必须为 USD 或 CNY' });
    }
    updates.push(`currency = $${values.length + 1}`);
    values.push(currency);
  }
  if (typeof displayName === 'string') {
    if (displayName.trim().length === 0) {
      return res.status(400).json({ success: false, msg: 'displayName 不能为空' });
    }
    if (displayName.length > 128) {
      return res.status(400).json({ success: false, msg: 'displayName 长度不能超过 128 字符' });
    }
    updates.push(`display_name = $${values.length + 1}`);
    values.push(displayName);
  }
  if (typeof description === 'string') {
    if (description.length > 1000) {
      return res.status(400).json({ success: false, msg: 'description 长度不能超过 1000 字符' });
    }
    updates.push(`description = $${values.length + 1}`);
    values.push(description);
  }

  if (updates.length === 0) {
    return res.status(400).json({ success: false, msg: '没有任何要更新的字段' });
  }

  values.push(id);
  try {
    const result = await db.query(
      `UPDATE api_models SET ${updates.join(', ')} WHERE id=$${values.length} RETURNING *`,
      values
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, msg: '模型不存在' });
    }
    logger.info('Model updated', { id, updates: req.body });
    res.json({ success: true, model: result.rows[0] });
  } catch (err) {
    logger.error('Model update error', { err: err.message });
    res.status(500).json({ success: false, msg: '服务器内部错误' });
  }
});

app.post('/admin/adjust', adminLimiter, requireAdmin, async (req, res) => {
  let { userEmail, amount_fen, type, description } = req.body ?? {};

  userEmail = normalizeEmail(userEmail || '');
  if (!isValidEmail(userEmail)) {
    return res.status(400).json({ success: false, msg: '邮箱格式不正确' });
  }
  if (typeof amount_fen !== 'number' || !Number.isInteger(amount_fen) || amount_fen === 0) {
    return res.status(400).json({ success: false, msg: 'amount_fen 必须为非零整数' });
  }
  if (Math.abs(amount_fen) > 10_000_000) {
    return res.status(400).json({ success: false, msg: '单次调整金额不能超过 ¥100,000（10,000,000 分）' });
  }
  const validTypes = ['recharge', 'refund', 'admin_adjust'];
  if (!validTypes.includes(type)) {
    return res.status(400).json({ success: false, msg: `type 必须是 ${validTypes.join('/')} 之一` });
  }
  if (description != null && (typeof description !== 'string' || description.length > 500)) {
    return res.status(400).json({ success: false, msg: 'description 长度不能超过 500 字符' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    await ensureUser(client, userEmail);

    const prevRes = await client.query(
      'SELECT balance_fen FROM user_billing WHERE user_email=$1 FOR UPDATE',
      [userEmail]
    );
    const oldBalance = Number(prevRes.rows[0].balance_fen);

    const result = await client.query(
      `UPDATE user_billing
          SET balance_fen = GREATEST(0, balance_fen + $1)
        WHERE user_email = $2
        RETURNING balance_fen`,
      [amount_fen, userEmail]
    );
    const newBalance = Number(result.rows[0].balance_fen);
    const actualApplied = newBalance - oldBalance;

    await client.query(
      `INSERT INTO billing_transactions
           (user_email, type, amount_fen, balance_after_fen, description)
         VALUES ($1,$2,$3,$4,$5)`,
      [userEmail, type, actualApplied, newBalance, description || '管理员调整']
    );

    await client.query('COMMIT');

    logger.info('Admin balance adjusted', { userEmail, amount_fen, actualApplied, type });
    res.json({ success: true, balance_fen: newBalance, actual_applied_fen: actualApplied });
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    logger.error('Admin adjust error', { err: err.message });
    res.status(500).json({ success: false, msg: '服务器内部错误' });
  } finally {
    client.release();
  }
});

// ─── 404 & 全局错误处理 ───────────────────────────────────────
app.use((_req, res) => {
  res.status(404).json({ success: false, msg: '接口不存在' });
});

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  logger.error('Unhandled error', { err: err.message, stack: err.stack });
  if (res.headersSent) return;
  res.status(500).json({ success: false, msg: '服务器内部错误' });
});

// ─── 启动 ─────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3002', 10);
const HOST = process.env.HOST || '172.16.1.6';

const server = app.listen(PORT, HOST, () => {
  logger.info(`Webhook 服务已启动 http://${HOST}:${PORT}`);
  if (!ADMIN_TOKEN) {
    logger.warn('ADMIN_TOKEN 未设置，管理员接口已禁用');
  } else if (ADMIN_TOKEN.length < 32) {
    logger.warn('ADMIN_TOKEN 过短（< 32 字符），建议执行 openssl rand -hex 32 重新生成');
  }
  if (!SERVICE_TOKEN) {
    logger.warn('SERVICE_TOKEN 未设置，/billing 写入接口无内部服务鉴权（建议通过环境变量配置）');
  } else if (SERVICE_TOKEN.length < 32) {
    logger.warn('SERVICE_TOKEN 过短（< 32 字符），建议执行 openssl rand -hex 32 重新生成');
  }
  logger.info('运行时配置', {
    freeDailyLimit: getFreeDailyLimit(),
    maxSingleRequestFen: getMaxSingleRequestFen(),
    usdToCnyRate: getUsdToCnyRate(),
  });
});

const shutdown = (signal) => {
  logger.info(`收到 ${signal}，正在优雅关闭...`);
  server.close(() => {
    Promise.all([
      db.end(),
      redis.quit().catch(() => {}),
    ])
      .then(() => {
        logger.info('数据库连接池与 Redis 已关闭');
        process.exit(0);
      })
      .catch((err) => {
        logger.error('连接关闭失败', { err: err.message });
        process.exit(1);
      });
  });
  setTimeout(() => process.exit(1), 10_000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection, shutting down', { err: String(reason) });
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception, shutting down', { err: err.message, stack: err.stack });
  process.exit(1);
});

module.exports = app;
