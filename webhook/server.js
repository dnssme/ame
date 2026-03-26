'use strict';

/**
 * Anima 灵枢 · Webhook 服务 v5.11
 * ─────────────────────────────────────────────────────────────
 * 修复记录（v5.11 相对于 v5.10）：
 *
 *   #FIX-5.11-1  INCR_EXPIRE_LUA 免费每日限额绕过修复
 *                原：c >= limit 时返回 c（= limit），导致后续
 *                count <= FREE_DAILY_LIMIT 恒为 true，免费限额形同虚设。
 *                修：返回 limit + 1，使 count > limit 正确触发拒绝。
 *
 *   #FIX-5.11-2  付费模型 chargedFen=0 时跳过 billing_transactions INSERT
 *                原：管理员将付费模型价格设为 0 但未标记 is_free 时，
 *                chargedFen=0 的 INSERT 违反 CHECK (amount_fen != 0) 约束
 *                导致整个计费事务回滚并返回 500 错误。
 *                修：chargedFen > 0 时才写入流水，与 admin/adjust FIX-5.8-1 对齐。
 *
 * 修复记录（v5.10 相对于 v5.9）：
 *
 *   #FIX-5.10-1  幂等键预检查询新增 AND au.user_email = $2 用户隔离
 *                原实现仅按 idempotency_key 查询，理论上不同用户使用相同
 *                key 时（极低概率）会返回另一用户的计费记录，绕过计费。
 *                修复：预检查询（两处）均添加 user_email 约束。
 *
 *   #FIX-5.10-2  INCR_EXPIRE_LUA 修正超限判断条件
 *                原：if c > limit（c=limit 时仍做 INCR 到 limit+1，再判断）
 *                修：if c >= limit（c=limit 时直接返回，避免无效 INCR）
 *                效果：消除第 limit+1 次请求时的多余 Redis 写操作。
 *
 *   #FIX-5.10-3  modelCache 新增最大条目限制（MAX_MODEL_CACHE_SIZE=1000）
 *                防止长期运行后缓存无限增长（尤其是已停用模型的条目）。
 *                淘汰策略：超限时清除最早写入的条目（FIFO）。
 *
 *   #FIX-5.10-4  email processor 级别对齐：logout cleanup 改为 warn
 *                （此修复在 processor.js，server.js 无需改动）
 *
 * 历史修复记录（v5.0 → v5.9）见下方内嵌注释。
 *
 * v5.9 修复：
 *   #FIX-5.9-1  /health 新增 Redis 状态字段
 *   #FIX-5.9-2  /billing/check 模型查询内存缓存（60s TTL）
 *   #FIX-5.9-3  IDEMPOTENCY_KEY_RE 字符类修正（连字符置末尾）
 *   #FIX-5.9-4  POST /admin/providers 新增 description 长度校验
 *   #FIX-5.9-5  新增 PUT /admin/providers/:id 端点
 *   #FIX-5.9-6  模型写操作后清除 modelCache
 *
 * v5.8 修复：
 *   #FIX-5.8-1  admin/adjust 余额截断为 0 时跳过零金额流水 INSERT
 *   #FIX-5.8-2  幂等预检响应包含真实 is_free 字段
 *   #FIX-5.8-3  免费模型 INSERT 含幂等键 + ON CONFLICT DO NOTHING
 *
 * v5.7 修复：
 *   TOCTOU 竞态（lookupModelInTx FOR SHARE）、safeRollback 辅助函数、
 *   validateChargedFen 安全熔断、Redis Lua 原子操作等
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
  idleTimeoutMillis:           30_000,
  connectionTimeoutMillis:      5_000,
  statement_timeout:           10_000,
  keepAlive:                    true,
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
redis.connect().catch((err) =>
  logger.warn('Redis connect error (free daily limits disabled)', { err: err.message })
);
redis.on('error', (err) => logger.error('Redis error', { err: err.message }));

// ─────────────────────────────────────────────────────────────
// FIX-5.10-2: INCR+EXPIRE Lua 脚本（原子操作）
// 修正：if c >= limit（原为 c > limit，多余一次 INCR）
// ─────────────────────────────────────────────────────────────
const INCR_EXPIRE_LUA =
  'local key = KEYS[1]\n' +
  'local limit = tonumber(ARGV[1])\n' +
  'local ttl = redis.call("TTL", key)\n' +
  // 若 key 存在但无 TTL（edge case），补设 24h 防止永久有效
  'if ttl == -1 then redis.call("EXPIRE", key, 86400) end\n' +
  'local c = tonumber(redis.call("GET", key) or "0")\n' +
  // FIX-5.10-2: >= limit（原为 > limit，在 c=limit 时会多做一次 INCR）
  // FIX-5.11-1: 返回 limit+1（原返回 c=limit，导致 count<=limit 恒真，免费限额无效）
  'if c >= limit then return limit + 1 end\n' +
  'local new_c = redis.call("INCR", key)\n' +
  // 首次写入：设置 24h TTL（北京时间日期前缀确保次日自然重置）
  'if new_c == 1 then redis.call("EXPIRE", key, 86400) end\n' +
  'return new_c';

// ─── 模型内存缓存（FIX-5.9-2 / FIX-5.10-3）───────────────────
// 仅用于只读路径（/billing/check、/models）；事务路径不用此缓存
// FIX-5.10-3：新增最大条目限制，防止长期运行后无限增长
const MODEL_CACHE_TTL_MS   = 60_000; // 60 秒
const MAX_MODEL_CACHE_SIZE = 1000;   // 最多缓存 1000 个模型条目
const modelCache = new Map();

function modelCacheGet(modelName) {
  const entry = modelCache.get(modelName);
  if (!entry) return null;
  if (Date.now() >= entry.exp) { modelCache.delete(modelName); return null; }
  return entry.data;
}

function modelCacheSet(modelName, data) {
  // FIX-5.10-3：超限时删除最早写入的条目（Map 按插入顺序迭代）
  if (modelCache.size >= MAX_MODEL_CACHE_SIZE) {
    const firstKey = modelCache.keys().next().value;
    if (firstKey !== undefined) modelCache.delete(firstKey);
  }
  modelCache.set(modelName, { data, exp: Date.now() + MODEL_CACHE_TTL_MS });
}

function modelCacheDelete(modelName) {
  modelCache.delete(modelName);
}

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

// 上海时区日期，确保每日限额在北京时间 00:00 准时重置
function getShanghaiDate() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(0, 10);
}

async function peekFreeDailyUsage(userEmail) {
  const FREE_DAILY_LIMIT = getFreeDailyLimit();
  try {
    if (redis.status !== 'ready') {
      return { allowed: true, used: 0, limit: FREE_DAILY_LIMIT };
    }
    const today = getShanghaiDate();
    const key = `anima:free_daily:${userEmail}:${today}`;
    const count = parseInt(await redis.get(key) || '0', 10);
    return {
      allowed: count < FREE_DAILY_LIMIT,
      used:    Math.min(count, FREE_DAILY_LIMIT),
      limit:   FREE_DAILY_LIMIT,
    };
  } catch (err) {
    logger.warn('Redis daily peek failed, allowing request', { err: err.message });
    return { allowed: true, used: 0, limit: FREE_DAILY_LIMIT };
  }
}

async function incrFreeDailyUsage(userEmail) {
  const FREE_DAILY_LIMIT = getFreeDailyLimit();
  try {
    if (redis.status !== 'ready') {
      logger.warn('Redis unavailable: free daily limit NOT enforced', { userEmail });
      return { allowed: true, used: 0, limit: FREE_DAILY_LIMIT, key: null };
    }
    const today = getShanghaiDate();
    const key = `anima:free_daily:${userEmail}:${today}`;
    const count = await redis.eval(INCR_EXPIRE_LUA, 1, key, FREE_DAILY_LIMIT);
    return { allowed: count <= FREE_DAILY_LIMIT, used: count, limit: FREE_DAILY_LIMIT, key };
  } catch (err) {
    logger.warn('Redis daily limit incr failed, allowing request', { err: err.message });
    return { allowed: true, used: 0, limit: FREE_DAILY_LIMIT, key: null };
  }
}

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
app.use(rateLimit({
  windowMs: 60_000,
  max:      60,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, msg: '请求过于频繁，请稍后再试' },
  skip: (req) => req.path === '/billing/record',
}));

const activateLimiter = rateLimit({
  windowMs: 10 * 60_000,
  max:      5,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, msg: '激活尝试过于频繁，请 10 分钟后再试' },
});

const readLimiter = rateLimit({
  windowMs: 60_000,
  max:      20,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, msg: '查询过于频繁，请稍后再试' },
});

const billingCheckLimiter = rateLimit({
  windowMs: 60_000,
  max:      120,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, msg: '预检请求过于频繁，请稍后再试' },
});

const billingRecordLimiter = rateLimit({
  windowMs: 60_000,
  max:      600,
  keyGenerator: (req) => req.ip,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, msg: '计费记录请求过于频繁' },
});

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
  const len  = Math.max(aBuf.length, bBuf.length);
  const paddedA = Buffer.concat([aBuf, Buffer.alloc(len - aBuf.length)]);
  const paddedB = Buffer.concat([bBuf, Buffer.alloc(len - bBuf.length)]);
  const equal = crypto.timingSafeEqual(paddedA, paddedB);
  return equal && aBuf.length === bBuf.length;
}

function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) {
    return res.status(503).json({ success: false, msg: '管理员接口未启用（未设置 ADMIN_TOKEN）' });
  }
  const auth  = req.headers['authorization'] || '';
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
// 连字符置末尾，语义清晰，避免与字符范围操作符混淆
const IDEMPOTENCY_KEY_RE = /^[a-zA-Z0-9:_-]+$/;

function isValidEmail(email) {
  return typeof email === 'string' && email.length <= MAX_EMAIL_LEN && EMAIL_RE.test(email);
}

function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

const MAX_TOKEN_VALUE = 10_000_000;

function parseOptionalNonNegInt(value) {
  if (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_TOKEN_VALUE
  ) {
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

/**
 * 只读模型查询（不带缓存），用于直接 DB 访问。
 */
async function lookupModel(modelName) {
  const res = await db.query(
    `SELECT id, is_free, price_input_per_1k_tokens, price_output_per_1k_tokens,
            currency, is_active, supports_cache
       FROM api_models WHERE model_name = $1`,
    [modelName]
  );
  return res.rows[0] || null;
}

/**
 * 只读模型查询（带 60s 内存缓存）。
 * 用于 /billing/check 等高频只读路径，减少 DB 压力。
 * 管理员更新/创建模型后会自动清除对应缓存（FIX-5.9-6）。
 */
async function lookupModelCached(modelName) {
  const cached = modelCacheGet(modelName);
  if (cached !== null) return cached;
  const model = await lookupModel(modelName);
  if (model) modelCacheSet(modelName, model);
  return model;
}

/**
 * 事务内模型查询（FOR SHARE 锁），防止 TOCTOU 竞态。
 * 用于 /billing/record 等写路径，确保读到最新数据。
 * FOR SHARE：允许并发读，阻止并发写（admin 更新模型价格时需等待）。
 */
async function lookupModelInTx(client, modelName) {
  const res = await client.query(
    `SELECT id, is_free, price_input_per_1k_tokens, price_output_per_1k_tokens,
            currency, is_active, supports_cache
       FROM api_models WHERE model_name = $1
       FOR SHARE`,
    [modelName]
  );
  return res.rows[0] || null;
}

// ─── 缓存感知分层计费 ─────────────────────────────────────────
const CACHE_THRESHOLD_TOKENS = 2000;
const CACHE_DISCOUNT         = 0.1;

function calculateChargedFen({
  inputTokens, outputTokens, priceIn, priceOut, currency,
  supportsCache, promptTokens, historyTokens,
}) {
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
      if (deviation > 0.05) {
        logger.warn('calculateChargedFen: 分区 Token 与总量偏差超过 5%，回退到标准计费', {
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

// ─── 安全的 ROLLBACK 辅助函数 ────────────────────────────────
async function safeRollback(client, context) {
  try {
    await client.query('ROLLBACK');
  } catch (rollbackErr) {
    logger.warn('ROLLBACK 失败，可能存在连接泄漏', {
      context,
      err: rollbackErr.message,
    });
  }
}

// =============================================================
// ─── 路由 ────────────────────────────────────────────────────
// =============================================================

// ─── 健康检查（FIX-5.9-1: 含 Redis 状态）────────────────────
app.get('/health', async (_req, res) => {
  const status  = { db: 'ok', redis: 'ok', ts: new Date().toISOString() };
  let httpStatus = 200;

  // DB 检查（必须健康，否则 HTTP 503）
  try {
    await db.query('SELECT 1');
  } catch (err) {
    logger.error('Health check DB error', { err: err.message });
    status.db = 'error';
    httpStatus = 503;
  }

  // Redis 检查（降级运行不影响 HTTP 状态码，但运维需感知）
  try {
    if (redis.status === 'ready') {
      await redis.ping();
      status.redis = 'ok';
    } else {
      // 连接中断或重连中——服务可降级运行（免费限额暂不生效）
      status.redis = 'disconnected';
    }
  } catch (err) {
    status.redis = 'error';
    logger.warn('Health check Redis error', { err: err.message });
  }

  res.status(httpStatus).json({
    status: httpStatus === 200 ? 'ok' : 'degraded',
    ...status,
  });
});

// ─── 模型列表（公开）──────────────────────────────────────────
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

// ─── Provider 配置列表（公开，不含 API Key）───────────────────
// 数据库统一调用：OpenClaw/LibreChat 从此接口动态获取 provider base URL。
// API Key 仍在各服务 .env（PCI-DSS 3.x 要求，不允许密钥入库）。
app.get('/providers', readLimiter, async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT provider_name, display_name, base_url, is_enabled, description
         FROM api_providers
        WHERE is_enabled = true
        ORDER BY provider_name`
    ).catch((err) => {
      if (err.code === '42P01') {
        // 表不存在（旧 schema），返回空列表兼容旧环境
        logger.warn('api_providers 表不存在，请执行 db/schema.sql 升级');
        return { rows: [] };
      }
      throw err;
    });
    res.json({ success: true, providers: result.rows });
  } catch (err) {
    logger.error('Providers query error', { err: err.message });
    res.status(500).json({ success: false, msg: '服务器内部错误' });
  }
});

// ─── 充值卡激活 ───────────────────────────────────────────────
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
      await safeRollback(client, '/activate card lookup');
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
    await safeRollback(client, '/activate error');
    logger.error('Activation error', { err: err.message, userEmail });
    res.status(500).json({ success: false, msg: '服务器内部错误，请稍后重试' });
  } finally {
    client.release();
  }
});

// ─── 余额查询 ─────────────────────────────────────────────────
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
      success:           true,
      balance_fen:       Number(r.balance_fen),
      total_charged_fen: Number(r.total_charged_fen),
      is_suspended:      r.is_suspended,
    });
  } catch (err) {
    logger.error('Balance query error', { err: err.message, email });
    res.status(500).json({ success: false, msg: '服务器内部错误' });
  }
});

// ─── 消费历史 ─────────────────────────────────────────────────
app.get('/billing/history/:email', readLimiter, async (req, res) => {
  const email = normalizeEmail(req.params.email);
  if (!isValidEmail(email)) {
    return res.status(400).json({ success: false, msg: '邮箱格式不正确' });
  }

  const limit  = Math.min(Math.max(parseInt(req.query.limit  || '20', 10) || 20, 1), 100);
  const offset = Math.max(parseInt(req.query.offset || '0', 10) || 0, 0);

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

// ─── 余额预检（只读，无需服务鉴权）──────────────────────────
app.post('/billing/check', billingCheckLimiter, async (req, res) => {
  let {
    userEmail, modelName,
    estimatedInputTokens, estimatedOutputTokens,
    estimatedInputChars, estimatedOutputChars,
    estimatedPromptTokens, estimatedHistoryTokens,
  } = req.body ?? {};

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

  // 使用带缓存的查询（60s TTL），减少高频场景 DB 压力（FIX-5.9-2）
  let model;
  try {
    model = await lookupModelCached(modelName);
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
    return res.json({
      success: true, can_proceed: true, is_free: true, estimated_fen: 0,
      balance_fen: 0, is_suspended: false,
      daily_used: dailyCheck.used, daily_limit: dailyCheck.limit,
    });
  }

  const inTokens  = Math.max(0, parseInt(estimatedInputTokens  ?? estimatedInputChars  ?? '0', 10) || 0);
  const outTokens = Math.max(0, parseInt(estimatedOutputTokens ?? estimatedOutputChars ?? '0', 10) || 0);
  if (inTokens > MAX_TOKEN_VALUE || outTokens > MAX_TOKEN_VALUE) {
    return res.status(400).json({ success: false, msg: 'estimatedInputTokens/outputTokens 单次上限为 10,000,000' });
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
      msg:      '预估费用超过单次安全上限，请新建对话或减少上下文。',
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

// ─── 计费记录（内部服务专用）──────────────────────────────────
app.post('/billing/record', billingRecordLimiter, requireServiceToken, async (req, res) => {
  let {
    userEmail, apiProvider, modelName,
    inputTokens: rawInputTokens, outputTokens: rawOutputTokens,
    inputChars, outputChars,
    promptTokens: rawPromptTokens, historyTokens: rawHistoryTokens,
    idempotencyKey,
  } = req.body ?? {};

  // 向后兼容旧版 inputChars/outputChars 字段名
  const inputTokens  = rawInputTokens  ?? inputChars  ?? 0;
  const outputTokens = rawOutputTokens ?? outputChars ?? 0;

  if (rawInputTokens == null && inputChars != null) {
    logger.warn('billing/record: 调用方使用旧版 inputChars 字段，请迁移到 inputTokens', { userEmail, modelName });
  }
  if (rawOutputTokens == null && outputChars != null) {
    logger.warn('billing/record: 调用方使用旧版 outputChars 字段，请迁移到 outputTokens', { userEmail, modelName });
  }

  // ── 参数校验 ──────────────────────────────────────────────
  if (!userEmail || !apiProvider || !modelName) {
    return res.status(400).json({ success: false, msg: '参数缺失：需要 userEmail、apiProvider、modelName' });
  }
  userEmail = normalizeEmail(userEmail);
  if (!isValidEmail(userEmail)) {
    return res.status(400).json({ success: false, msg: '邮箱格式不正确' });
  }
  if (typeof apiProvider !== 'string' || apiProvider.length > 32) {
    return res.status(400).json({ success: false, msg: 'apiProvider 长度不能超过 32 字符' });
  }
  if (typeof modelName !== 'string' || modelName.length > 128) {
    return res.status(400).json({ success: false, msg: 'modelName 长度不能超过 128 字符' });
  }
  if (
    typeof inputTokens !== 'number' || typeof outputTokens !== 'number' ||
    !Number.isFinite(inputTokens)   || !Number.isFinite(outputTokens) ||
    !Number.isInteger(inputTokens)  || !Number.isInteger(outputTokens) ||
    inputTokens < 0 || outputTokens < 0
  ) {
    return res.status(400).json({ success: false, msg: 'inputTokens/outputTokens 必须为有限的非负整数' });
  }
  if (inputTokens > MAX_TOKEN_VALUE || outputTokens > MAX_TOKEN_VALUE) {
    return res.status(400).json({ success: false, msg: 'inputTokens/outputTokens 单次上限为 10,000,000' });
  }

  if (idempotencyKey !== undefined) {
    if (
      typeof idempotencyKey !== 'string' ||
      idempotencyKey.length === 0 ||
      idempotencyKey.length > 128 ||
      !IDEMPOTENCY_KEY_RE.test(idempotencyKey)
    ) {
      return res.status(400).json({
        success: false,
        msg: 'idempotencyKey 不合法：必须为 1-128 字符，仅允许字母、数字、- : _ 字符',
      });
    }
  }
  const normalizedIdempKey = (typeof idempotencyKey === 'string') ? idempotencyKey : null;

  const promptTk  = parseOptionalNonNegInt(rawPromptTokens);
  const historyTk = parseOptionalNonNegInt(rawHistoryTokens);

  // ── 幂等键快速路径（事务外，减少锁争用）─────────────────
  // FIX-5.10-1：查询新增 AND au.user_email = $2，防止跨用户 key 碰撞
  if (normalizedIdempKey) {
    try {
      const idempRes = await db.query(
        `SELECT au.charged_fen, au.is_free, ub.balance_fen
           FROM api_usage au
           LEFT JOIN user_billing ub ON ub.user_email = $2
          WHERE au.idempotency_key = $1
            AND au.user_email = $2`,
        [normalizedIdempKey, userEmail]
      );
      if (idempRes.rows.length > 0) {
        logger.info('Idempotent billing record (pre-check hit)', { idempotencyKey: normalizedIdempKey, userEmail });
        const existRec = idempRes.rows[0];
        return res.json({
          success:     true,
          is_free:     existRec.is_free,
          charged_fen: existRec.is_free ? 0 : Number(existRec.charged_fen),
          balance_fen: existRec.balance_fen !== null ? Number(existRec.balance_fen) : 0,
          idempotent:  true,
        });
      }
    } catch (err) {
      logger.warn('Idempotency pre-check error, continuing with normal billing', { err: err.message });
    }
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // 事务内使用 FOR SHARE 锁，防止并发 TOCTOU
    const model = await lookupModelInTx(client, modelName);

    if (!model) {
      await safeRollback(client, '/billing/record model not found');
      logger.warn('Model not registered in api_models', { modelName, apiProvider });
      return res.status(404).json({ success: false, msg: '模型不存在，请先通过 POST /admin/models 注册' });
    }
    if (!model.is_active) {
      await safeRollback(client, '/billing/record model inactive');
      return res.status(400).json({ success: false, msg: '该模型当前未启用，无法计费' });
    }

    const modelId  = model.id;
    const isFree   = model.is_free;
    const priceIn  = Number(model.price_input_per_1k_tokens);
    const priceOut = Number(model.price_output_per_1k_tokens);

    // ── 免费模型路径 ──────────────────────────────────────
    if (isFree) {
      const dailyCheck = await incrFreeDailyUsage(userEmail);
      if (!dailyCheck.allowed) {
        await safeRollback(client, '/billing/record free daily limit');
        return res.status(429).json({
          success: false, is_free: true,
          msg: `免费用户每日限 ${dailyCheck.limit} 次调用，今日已使用 ${dailyCheck.used - 1} 次。充值后可无限使用。`,
          daily_used: dailyCheck.used - 1, daily_limit: dailyCheck.limit,
        });
      }

      try {
        const freeInsertRes = await client.query(
          `INSERT INTO api_usage
               (user_email, api_model_id, api_provider, model_name,
                is_free, input_tokens, output_tokens, charged_fen, status, idempotency_key)
             VALUES ($1,$2,$3,$4,true,$5,$6,0,'ok',$7)
             ON CONFLICT (idempotency_key)
               WHERE idempotency_key IS NOT NULL
               DO NOTHING
             RETURNING id`,
          [userEmail, modelId, apiProvider, modelName, inputTokens, outputTokens, normalizedIdempKey]
        );

        // 并发幂等冲突：另一请求已提交相同 key，本次 INSERT 被忽略
        if (freeInsertRes.rows.length === 0 && normalizedIdempKey) {
          await safeRollback(client, '/billing/record free concurrent idempotent');
          await tryDecrFreeDailyUsage(dailyCheck.key);
          return res.json({
            success:     true,
            is_free:     true,
            charged_fen: 0,
            balance_fen: 0,
            idempotent:  true,
            daily_used:  Math.max(0, dailyCheck.used - 1),
            daily_limit: dailyCheck.limit,
          });
        }

        await client.query('COMMIT');
      } catch (err) {
        logger.error('Free usage DB insert failed, attempting Redis counter rollback', { err: err.message });
        await safeRollback(client, '/billing/record free insert failed');
        await tryDecrFreeDailyUsage(dailyCheck.key);
        return res.status(500).json({ success: false, msg: '服务器内部错误' });
      }

      return res.json({
        success:     true,
        is_free:     true,
        charged_fen: 0,
        balance_fen: 0,
        daily_used:  dailyCheck.used,
        daily_limit: dailyCheck.limit,
      });
    }

    // ── 付费模型路径 ──────────────────────────────────────
    await ensureUser(client, userEmail);

    const userRes = await client.query(
      'SELECT balance_fen, is_suspended FROM user_billing WHERE user_email=$1 FOR UPDATE',
      [userEmail]
    );
    const u = userRes.rows[0];

    if (u.is_suspended) {
      await safeRollback(client, '/billing/record suspended');
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
      await safeRollback(client, '/billing/record over safety limit');
      return res.status(402).json({
        success:     false,
        msg:         '单次请求费用超过安全上限，请新建对话或减少上下文。',
        charged_fen: chargedFen,
        limit_fen:   MAX_SINGLE_REQUEST_FEN,
      });
    }

    if (Number(u.balance_fen) < chargedFen) {
      await safeRollback(client, '/billing/record insufficient balance');
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
            is_free, input_tokens, output_tokens, charged_fen, status, idempotency_key)
         VALUES ($1,$2,$3,$4,false,$5,$6,$7,'ok',$8)
         ON CONFLICT (idempotency_key)
           WHERE idempotency_key IS NOT NULL
           DO NOTHING
         RETURNING id`,
      [userEmail, modelId, apiProvider, modelName, inputTokens, outputTokens, chargedFen, normalizedIdempKey]
    );

    // 并发幂等冲突（付费模型）：回滚已扣费的事务，返回已有记录
    // FIX-5.10-1：查询新增 AND au.user_email = $2，防止跨用户 key 碰撞
    if (usageRes.rows.length === 0 && normalizedIdempKey) {
      await safeRollback(client, '/billing/record idempotency conflict');
      logger.info('Idempotent billing record (conflict resolution)', { idempotencyKey: normalizedIdempKey, userEmail });
      const existingRes = await db.query(
        `SELECT au.charged_fen, au.is_free, ub.balance_fen
           FROM api_usage au
           LEFT JOIN user_billing ub ON ub.user_email = $2
          WHERE au.idempotency_key = $1
            AND au.user_email = $2`,
        [normalizedIdempKey, userEmail]
      );
      return res.json({
        success:     true,
        is_free:     existingRes.rows.length > 0 ? existingRes.rows[0].is_free : false,
        charged_fen: existingRes.rows.length > 0 ? Number(existingRes.rows[0].charged_fen) : chargedFen,
        balance_fen: existingRes.rows.length > 0 && existingRes.rows[0].balance_fen !== null
          ? Number(existingRes.rows[0].balance_fen) : 0,
        idempotent:  true,
      });
    }

    const usageId = usageRes.rows[0]?.id;
    if (!usageId) {
      logger.error('api_usage INSERT returned no rows (non-idempotent path)', { userEmail, modelName });
      await safeRollback(client, '/billing/record no usage id');
      return res.status(500).json({ success: false, msg: '服务器内部错误' });
    }

    // FIX-5.11-2: chargedFen=0 时跳过流水 INSERT（避免违反 CHECK amount_fen != 0）
    // 场景：管理员将付费模型的输入/输出价格均设为 0 但未标记 is_free
    // 此时 chargedFen=0，INSERT 会违反 billing_transactions 的 CHECK 约束
    if (chargedFen > 0) {
      await client.query(
        `INSERT INTO billing_transactions
             (user_email, type, amount_fen, balance_after_fen, description, ref_id)
           VALUES ($1,'charge',$2,$3,$4,$5)`,
        [
          userEmail,
          chargedFen,
          newBalance,
          `${modelName}（输入 ${inputTokens} Token / 输出 ${outputTokens} Token）`,
          String(usageId),
        ]
      );
    }

    await client.query('COMMIT');

    logger.info('Billing recorded', { userEmail, modelName, chargedFen, newBalance, idempotencyKey: normalizedIdempKey });

    res.json({ success: true, is_free: false, charged_fen: chargedFen, balance_fen: newBalance });
  } catch (err) {
    await safeRollback(client, '/billing/record unhandled error');
    logger.error('Billing record error', { err: err.message, userEmail });
    res.status(500).json({ success: false, msg: '服务器内部错误' });
  } finally {
    client.release();
  }
});

// =============================================================
// ─── 管理员接口 ───────────────────────────────────────────────
// =============================================================

// ── 模型管理 ─────────────────────────────────────────────────

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
  const { provider, modelName, displayName, isFree, priceInput, priceOutput,
          currency, supportsCache, description } = req.body ?? {};

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
  if (!isFree) {
    if (typeof priceInput !== 'number' || typeof priceOutput !== 'number' ||
        !Number.isFinite(priceInput) || !Number.isFinite(priceOutput)) {
      return res.status(400).json({ success: false, msg: '付费模型必须提供有限数值的 priceInput 和 priceOutput' });
    }
    if (priceInput < 0 || priceOutput < 0) {
      return res.status(400).json({ success: false, msg: 'priceInput 和 priceOutput 必须为非负数' });
    }
    if (priceInput > 100 || priceOutput > 100) {
      return res.status(400).json({ success: false, msg: 'priceInput/priceOutput 不得超过 100（元/千 Token）' });
    }
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
           provider     = EXCLUDED.provider,
           display_name = EXCLUDED.display_name,
           is_free      = EXCLUDED.is_free,
           price_input_per_1k_tokens  = EXCLUDED.price_input_per_1k_tokens,
           price_output_per_1k_tokens = EXCLUDED.price_output_per_1k_tokens,
           currency     = EXCLUDED.currency,
           supports_cache = EXCLUDED.supports_cache,
           description  = EXCLUDED.description,
           is_active    = true
         RETURNING id, provider, model_name, display_name, is_free,
                   price_input_per_1k_tokens, price_output_per_1k_tokens,
                   currency, supports_cache, is_active`,
      [provider, modelName, displayName, isFree,
       isFree ? 0 : priceInput, isFree ? 0 : priceOutput,
       currencyVal, !!supportsCache, description || null]
    );

    // 清除模型缓存，确保 /billing/check 立即读到新价格（FIX-5.9-6）
    modelCacheDelete(modelName);

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
    const cur = await db.query('SELECT is_free, model_name FROM api_models WHERE id=$1', [id]);
    if (cur.rows.length === 0) {
      return res.status(404).json({ success: false, msg: '模型不存在' });
    }
    currentModel = cur.rows[0];
  } catch (err) {
    logger.error('Model fetch error in PUT', { err: err.message, id });
    return res.status(500).json({ success: false, msg: '服务器内部错误' });
  }

  const { isFree, priceInput, priceOutput, currency, isActive,
          supportsCache, displayName, description } = req.body ?? {};
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
    if (priceInput > 100) {
      return res.status(400).json({ success: false, msg: 'priceInput 不得超过 100（元/千 Token）' });
    }
    updates.push(`price_input_per_1k_tokens = $${values.length + 1}`);
    values.push(priceInput);
  } else if (effectiveIsFree && typeof priceInput === 'number' && priceInput !== 0) {
    return res.status(400).json({ success: false, msg: '免费模型不能设置非零输入价格' });
  }

  if (!effectiveIsFree && typeof priceOutput === 'number') {
    if (!Number.isFinite(priceOutput) || priceOutput < 0) {
      return res.status(400).json({ success: false, msg: 'priceOutput 必须为有限的非负数' });
    }
    if (priceOutput > 100) {
      return res.status(400).json({ success: false, msg: 'priceOutput 不得超过 100（元/千 Token）' });
    }
    updates.push(`price_output_per_1k_tokens = $${values.length + 1}`);
    values.push(priceOutput);
  } else if (effectiveIsFree && typeof priceOutput === 'number' && priceOutput !== 0) {
    return res.status(400).json({ success: false, msg: '免费模型不能设置非零输出价格' });
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

    // 清除模型缓存（FIX-5.9-6）
    modelCacheDelete(currentModel.model_name);

    logger.info('Model updated', { id, modelName: currentModel.model_name, updates: req.body });
    res.json({ success: true, model: result.rows[0] });
  } catch (err) {
    logger.error('Model update error', { err: err.message });
    res.status(500).json({ success: false, msg: '服务器内部错误' });
  }
});

// ── Provider 配置管理 ─────────────────────────────────────────

app.get('/admin/providers', adminLimiter, requireAdmin, async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT id, provider_name, display_name, base_url, is_enabled,
              description, created_at, updated_at
         FROM api_providers ORDER BY provider_name`
    ).catch((err) => {
      if (err.code === '42P01') { return { rows: [] }; }
      throw err;
    });
    res.json({ success: true, providers: result.rows });
  } catch (err) {
    logger.error('Admin providers query error', { err: err.message });
    res.status(500).json({ success: false, msg: '服务器内部错误' });
  }
});

app.post('/admin/providers', adminLimiter, requireAdmin, async (req, res) => {
  const { providerName, displayName, baseUrl, isEnabled, description } = req.body ?? {};

  if (!providerName || !displayName || !baseUrl) {
    return res.status(400).json({ success: false, msg: '缺少必填字段：providerName、displayName、baseUrl' });
  }
  if (typeof providerName !== 'string' || providerName.length > 32) {
    return res.status(400).json({ success: false, msg: 'providerName 长度不能超过 32 字符' });
  }
  if (typeof displayName !== 'string' || displayName.length > 64) {
    return res.status(400).json({ success: false, msg: 'displayName 长度不能超过 64 字符' });
  }
  if (typeof baseUrl !== 'string' || baseUrl.length > 256) {
    return res.status(400).json({ success: false, msg: 'baseUrl 长度不能超过 256 字符' });
  }
  if (!/^https?:\/\/.+/.test(baseUrl)) {
    return res.status(400).json({ success: false, msg: 'baseUrl 必须以 http:// 或 https:// 开头' });
  }
  // FIX-5.9-4: description 长度校验
  if (description != null && (typeof description !== 'string' || description.length > 500)) {
    return res.status(400).json({ success: false, msg: 'description 长度不能超过 500 字符' });
  }

  try {
    const result = await db.query(
      `INSERT INTO api_providers
           (provider_name, display_name, base_url, is_enabled, description)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (provider_name) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           base_url     = EXCLUDED.base_url,
           is_enabled   = EXCLUDED.is_enabled,
           description  = EXCLUDED.description
         RETURNING *`,
      [providerName, displayName, baseUrl, isEnabled !== false, description || null]
    );
    logger.info('Provider upserted', { providerName });
    res.json({ success: true, provider: result.rows[0] });
  } catch (err) {
    logger.error('Provider upsert error', { err: err.message });
    res.status(500).json({ success: false, msg: '服务器内部错误' });
  }
});

// FIX-5.9-5: PUT /admin/providers/:id 端点
app.put('/admin/providers/:id', adminLimiter, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, msg: 'Provider ID 无效' });
  }

  const { displayName, baseUrl, isEnabled, description } = req.body ?? {};
  const updates = [];
  const values  = [];

  if (typeof displayName === 'string') {
    if (displayName.trim().length === 0 || displayName.length > 64) {
      return res.status(400).json({ success: false, msg: 'displayName 不能为空且长度不超过 64 字符' });
    }
    updates.push(`display_name = $${values.length + 1}`);
    values.push(displayName);
  }
  if (typeof baseUrl === 'string') {
    if (baseUrl.length > 256 || !/^https?:\/\/.+/.test(baseUrl)) {
      return res.status(400).json({ success: false, msg: 'baseUrl 格式不正确（长度 ≤ 256，必须以 http/https 开头）' });
    }
    updates.push(`base_url = $${values.length + 1}`);
    values.push(baseUrl);
  }
  if (typeof isEnabled === 'boolean') {
    updates.push(`is_enabled = $${values.length + 1}`);
    values.push(isEnabled);
  }
  if (typeof description === 'string') {
    if (description.length > 500) {
      return res.status(400).json({ success: false, msg: 'description 长度不能超过 500 字符' });
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
      `UPDATE api_providers SET ${updates.join(', ')} WHERE id=$${values.length} RETURNING *`,
      values
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, msg: 'Provider 不存在' });
    }
    logger.info('Provider updated', { id, updates: req.body });
    res.json({ success: true, provider: result.rows[0] });
  } catch (err) {
    logger.error('Provider update error', { err: err.message });
    res.status(500).json({ success: false, msg: '服务器内部错误' });
  }
});

// ── 余额调整 ──────────────────────────────────────────────────

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
    const newBalance    = Number(result.rows[0].balance_fen);
    const actualApplied = newBalance - oldBalance;

    // FIX-5.8-1: actualApplied 为 0 时跳过流水 INSERT（避免违反 CHECK amount_fen != 0）
    // 场景：余额为 0 时执行负数扣减 → GREATEST(0,0-N)=0 → 无实际变动
    if (actualApplied !== 0) {
      await client.query(
        `INSERT INTO billing_transactions
             (user_email, type, amount_fen, balance_after_fen, description)
           VALUES ($1,$2,$3,$4,$5)`,
        [userEmail, type, actualApplied, newBalance, description || '管理员调整']
      );
    }

    await client.query('COMMIT');

    logger.info('Admin balance adjusted', { userEmail, amount_fen, actualApplied, type });

    const response = {
      success:            true,
      balance_fen:        newBalance,
      actual_applied_fen: actualApplied,
    };
    // 扣减被截断到 0 时附带说明
    if (actualApplied === 0 && amount_fen < 0) {
      response.note = `余额已为 0，扣减无效（请求扣减 ${Math.abs(amount_fen)} 分，实际扣减 0 分）`;
    }

    res.json(response);
  } catch (err) {
    await safeRollback(client, '/admin/adjust error');
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
  } else if (ADMIN_TOKEN.length < 64) {
    logger.warn('ADMIN_TOKEN 过短（< 64 字符），建议执行 openssl rand -hex 32 重新生成');
  }
  if (!SERVICE_TOKEN) {
    logger.warn('SERVICE_TOKEN 未设置，/billing 写入接口将拒绝所有请求（fail-closed）');
  } else if (SERVICE_TOKEN.length < 64) {
    logger.warn('SERVICE_TOKEN 过短（< 64 字符），建议执行 openssl rand -hex 32 重新生成');
  }
  logger.info('运行时配置', {
    freeDailyLimit:      getFreeDailyLimit(),
    maxSingleRequestFen: getMaxSingleRequestFen(),
    usdToCnyRate:        getUsdToCnyRate(),
    modelCacheTtlSec:    MODEL_CACHE_TTL_MS / 1000,
    modelCacheMaxSize:   MAX_MODEL_CACHE_SIZE,
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
