'use strict';

/**
 * Anima 灵枢 · Webhook 服务 v5
 * ─────────────────────────────────────────────────────────────
 * 功能：
 *   1. 充值卡激活           POST  /activate
 *   2. API 计费记录         POST  /billing/record
 *   3. 用户余额查询         GET   /billing/balance/:email
 *   4. 用户消费历史         GET   /billing/history/:email
 *   5. 预检余额是否充足      POST  /billing/check
 *   6. 查看可用模型（用户）  GET   /models
 *   7. 健康检查             GET   /health
 *   ── 管理员接口（需 ADMIN_TOKEN）──────────────────────────
 *   8.  查看所有模型         GET   /admin/models
 *   9.  添加/更新模型定价    POST  /admin/models
 *   10. 修改模型定价         PUT   /admin/models/:id
 *   11. 人工调整余额         POST  /admin/adjust
 *
 * 计费规则（v5: 按 Token 计费，对齐上游 API 定价）：
 *   · 每个模型在 api_models 表中独立定价（管理员自由设定），无套餐绑定
 *   · is_free=true 的模型永久免费，不扣余额
 *   · 付费模型按 Token 计费：(inputTokens/1000)*price_in + (outputTokens/1000)*price_out
 *   · 支持缓存感知分层计费：supports_cache 模型对超过阈值的历史上下文 Token 享受 90% 折扣
 *   · 单次请求安全熔断：预估费用超过阈值时拒绝请求（防余额耗尽）
 *   · 支持通过 Tiktoken 库在服务端估算 Token 数（当调用方传入文本时）
 *   · 余额不足时拒绝请求，返回 402
 *   · is_active=false 的模型（如本地 Ollama）保留接口定义，拒绝计费调用
 *
 * 安全：
 *   · helmet 安全响应头
 *   · express-rate-limit 分级限速
 *   · 仅监听内网 172.16.1.5
 *   · 全部 DB 操作参数化查询，防 SQL 注入
 *   · 充值激活使用 FOR UPDATE 行锁，防并发重复激活
 *   · 管理员接口通过 ADMIN_TOKEN 环境变量保护
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
      maxsize: 10 * 1024 * 1024, // 10 MB rotate
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
  password: process.env.PG_PASSWORD,           // 必须通过环境变量注入，不得硬编码
  database: process.env.PG_DATABASE || 'librechat',
  ssl:      { rejectUnauthorized: true },
  max:      parseInt(process.env.PG_POOL_MAX || '15', 10),   // CXI4 8GB 可用更大连接池
  idleTimeoutMillis:   30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout:  10_000, // 10s 查询超时
  keepAlive:          true,   // TCP keepalive 减少空闲连接断开
  keepAliveInitialDelayMillis: 10_000,
});

db.on('error', (err) => logger.error('DB pool error', { err: err.message }));

// ─── Redis 连接（免费用户每日调用次数限制）────────────────────────
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

// 免费用户每日调用次数上限（付费用户无限制）
// Lua 脚本：原子执行条件 INCR + EXPIRE，防止 key 永不过期（PCI-DSS 6.5.5 安全失效）
// 当计数器已超过限额时跳过 INCR，防止被拒请求无限膨胀计数器
const INCR_EXPIRE_LUA =
  'local c = tonumber(redis.call("GET", KEYS[1]) or "0")\n' +
  'if c > tonumber(ARGV[1]) then return c end\n' +
  'c = redis.call("INCR", KEYS[1])\n' +
  'if c == 1 then redis.call("EXPIRE", KEYS[1], 86400) end\n' +
  'return c';

const FREE_DAILY_LIMIT = (() => {
  const v = parseInt(process.env.FREE_DAILY_LIMIT || '20', 10);
  if (!Number.isFinite(v) || v <= 0) {
    logger.warn('FREE_DAILY_LIMIT 非法，使用默认值 20');
    return 20;
  }
  return v;
})();

/**
 * 查询免费用户当日已使用次数（不递增，用于预检）。
 * Redis 不可用时放行（fail-open）。
 *
 * @param {string} userEmail - 归一化后的邮箱
 * @returns {{ allowed: boolean, used: number, limit: number }}
 */
async function peekFreeDailyUsage(userEmail) {
  try {
    if (redis.status !== 'ready') {
      return { allowed: true, used: 0, limit: FREE_DAILY_LIMIT };
    }
    const today = new Date().toISOString().slice(0, 10);
    const key = `anima:free_daily:${userEmail}:${today}`;
    const count = parseInt(await redis.get(key) || '0', 10);
    // 将 used 封顶为 limit，防止因首次被拒请求的单次额外 INCR 导致显示值偏大
    return { allowed: count < FREE_DAILY_LIMIT, used: Math.min(count, FREE_DAILY_LIMIT), limit: FREE_DAILY_LIMIT };
  } catch (err) {
    logger.warn('Redis daily peek failed, allowing request', { err: err.message });
    return { allowed: true, used: 0, limit: FREE_DAILY_LIMIT };
  }
}

/**
 * 递增免费用户当日调用计数器（仅在实际使用时调用）。
 * 使用 Redis 条件 INCR + EXPIRE 实现日计数器。
 * 当计数器已超过限额时跳过 INCR，防止被拒请求无限膨胀计数器。
 * Redis 不可用时放行（fail-open，避免阻塞服务）。
 *
 * @param {string} userEmail - 归一化后的邮箱
 * @returns {{ allowed: boolean, used: number, limit: number }}
 */
async function incrFreeDailyUsage(userEmail) {
  try {
    if (redis.status !== 'ready') {
      return { allowed: true, used: 0, limit: FREE_DAILY_LIMIT };
    }
    const today = new Date().toISOString().slice(0, 10);
    const key = `anima:free_daily:${userEmail}:${today}`;
    // 使用 Lua 脚本原子执行条件 INCR + EXPIRE，防止进程在两条命令之间崩溃
    // 导致 key 永不过期（PCI-DSS 6.5.5 安全失效）
    // ARGV[1] = FREE_DAILY_LIMIT，超过限额后跳过 INCR 避免计数器无限膨胀
    const count = await redis.eval(INCR_EXPIRE_LUA, 1, key, FREE_DAILY_LIMIT);
    return { allowed: count <= FREE_DAILY_LIMIT, used: count, limit: FREE_DAILY_LIMIT };
  } catch (err) {
    logger.warn('Redis daily limit incr failed, allowing request', { err: err.message });
    return { allowed: true, used: 0, limit: FREE_DAILY_LIMIT };
  }
}

// ─── Express 应用 ─────────────────────────────────────────────
const app = express();

// Webhook 运行在 Nginx 反向代理后面，启用 trust proxy 以正确获取客户端真实 IP
app.set('trust proxy', process.env.TRUST_PROXY || '172.16.1.1');

app.use(helmet());
app.use(express.json({ limit: '1mb' }));

// 防止代理或浏览器缓存敏感的计费/余额数据（PCI-DSS 4.2 传输保护）
// Nginx 已为外部流量设置 Cache-Control，此处覆盖内部服务间调用
app.use((_req, res, next) => {
  res.set('Cache-Control', 'private, no-store, no-cache, must-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  next();
});

// 全局限速：60 次/分
app.use(rateLimit({
  windowMs: 60_000,
  max:      60,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, msg: '请求过于频繁，请稍后再试' },
}));

// 激活接口限速：5 次/10 分（防暴力枚举卡密）
const activateLimiter = rateLimit({
  windowMs: 10 * 60_000,
  max:      5,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, msg: '激活尝试过于频繁，请 10 分钟后再试' },
});

// 只读查询限速：20 次/分（防信息枚举）
const readLimiter = rateLimit({
  windowMs: 60_000,
  max:      20,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, msg: '查询过于频繁，请稍后再试' },
});

// 管理员接口限速：10 次/15 分（PCI-DSS 8.1.4 防暴力破解 ADMIN_TOKEN）
const adminLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max:      10,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, msg: '管理员接口请求过于频繁，请 15 分钟后再试' },
});

// ─── 管理员鉴权中间件 ─────────────────────────────────────────
const ADMIN_TOKEN = process.env.ADMIN_TOKEN;

// 内部服务 Token（用于 /billing/record 和 /billing/check 的来源鉴权）
// 通过 SERVICE_TOKEN 环境变量配置，防止内网其他进程伪造计费记录（CIS 网络分段 + PCI-DSS 7.x）
const SERVICE_TOKEN = process.env.SERVICE_TOKEN;

/**
 * 定时安全的字符串比较，防止计时攻击（PCI-DSS 6.3.2 / CIS）。
 * 对不同长度的输入补齐后再比较，保持固定时间路径，不泄露任何信息。
 */
function safeCompare(a, b) {
  const aBuf = Buffer.from(typeof a === 'string' ? a : '');
  const bBuf = Buffer.from(typeof b === 'string' ? b : '');
  // 补齐到相同长度后比较，确保长度不同时同样走固定时间路径
  const len = Math.max(aBuf.length, bBuf.length);
  const paddedA = Buffer.concat([aBuf, Buffer.alloc(len - aBuf.length)]);
  const paddedB = Buffer.concat([bBuf, Buffer.alloc(len - bBuf.length)]);
  const equal = crypto.timingSafeEqual(paddedA, paddedB);
  // 长度不同时即使字节相同（补零填充）也视为不等
  return equal && aBuf.length === bBuf.length;
}

function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) {
    return res.status(503).json({ success: false, msg: '管理员接口未启用（未设置 ADMIN_TOKEN）' });
  }
  const auth = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!safeCompare(token, ADMIN_TOKEN)) {
    // PCI-DSS 10.2.5：记录失败的认证尝试
    logger.warn('Admin auth failed', { ip: req.ip, path: req.path });
    return res.status(401).json({ success: false, msg: '未授权' });
  }
  next();
}

/**
 * 内部服务鉴权中间件（用于 /billing/record、/billing/check）。
 * 验证 X-Service-Token 请求头，防止内网未授权进程触发计费。
 * SERVICE_TOKEN 未配置时拒绝请求（fail-closed），防止在缺少鉴权的情况下暴露写入接口。
 */
function requireServiceToken(req, res, next) {
  if (!SERVICE_TOKEN) {
    logger.error('SERVICE_TOKEN 未配置，拒绝 /billing 写入请求（请设置环境变量）', { path: req.path, ip: req.ip });
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
// RFC 5321：邮箱最大长度 254 字符（PCI-DSS 6.5.1 输入验证）
const MAX_EMAIL_LEN = 254;

/** 验证邮箱格式和长度 */
function isValidEmail(email) {
  return typeof email === 'string' && email.length <= MAX_EMAIL_LEN && EMAIL_RE.test(email);
}

/** 统一邮箱格式：小写化（数据库 UNIQUE 约束区分大小写，需要应用层归一化） */
function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

/** Token 分段字段允许的最大值（1000 万 tokens，防止恶意超大值） */
const MAX_TOKEN_VALUE = 10_000_000;

/** 解析可选的非负整数（用于 Token 分段字段），非法值或超限值返回 undefined */
function parseOptionalNonNegInt(value) {
  if (typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0 && value <= MAX_TOKEN_VALUE) {
    return value;
  }
  return undefined;
}

/** 确保 user_billing 行存在，不存在则自动创建 */
async function ensureUser(client, userEmail) {
  await client.query(
    `INSERT INTO user_billing (user_email) VALUES ($1)
     ON CONFLICT (user_email) DO NOTHING`,
    [userEmail]
  );
}

/**
 * 从 api_models 表查询模型定价。
 * 若模型未注册，返回 null（调用方按"未知付费模型"处理）。
 */
async function lookupModel(modelName) {
  const res = await db.query(
    `SELECT id, is_free, price_input_per_1k_tokens, price_output_per_1k_tokens, currency, is_active, supports_cache
       FROM api_models WHERE model_name = $1`,
    [modelName]
  );
  return res.rows[0] || null;
}

// ─── 缓存感知分层计费 ──────────────────────────────────────────
// 历史上下文中前 CACHE_THRESHOLD_TOKENS 个 Token 按全价计费，
// 超出部分享受 CACHE_DISCOUNT 折扣（仅限 supports_cache=true 的模型）
const CACHE_THRESHOLD_TOKENS = 2000;
const CACHE_DISCOUNT = 0.1;  // 超出阈值部分按 10% 的价格计费

// 单次请求安全熔断阈值（分），默认 1000 分 = 10 元
const MAX_SINGLE_REQUEST_FEN = (() => {
  const v = parseInt(process.env.MAX_SINGLE_REQUEST_FEN || '1000', 10);
  if (!Number.isFinite(v) || v <= 0) {
    logger.warn('MAX_SINGLE_REQUEST_FEN 非法，使用默认值 1000');
    return 1000;
  }
  return v;
})();

// USD → CNY 汇率（用于将 USD 定价模型换算为人民币分计费）
// 每次计费时从环境变量实时读取，管理员更新环境变量后无需重启服务即可生效。
// 默认值 7.2；可通过 USD_TO_CNY_RATE 环境变量在运行时热更新。
function getUsdToCnyRate() {
  const v = parseFloat(process.env.USD_TO_CNY_RATE || '7.2');
  if (!Number.isFinite(v) || v < 1 || v > 15) {
    logger.warn('USD_TO_CNY_RATE 非法或超出合理范围 (1~15)，使用默认值 7.2', { raw: process.env.USD_TO_CNY_RATE });
    return 7.2;
  }
  return v;
}

/**
 * 计算输入 Token 的费用（分），支持缓存感知分层定价。
 *
 * 当模型 supports_cache=true 且调用方提供了 promptTokens/historyTokens 分段，
 * 且 historyTokens > CACHE_THRESHOLD_TOKENS 时：
 *   费用 = (promptTokens + min(historyTokens, 阈值)) * 全价
 *        + max(historyTokens - 阈值, 0) * 全价 * 0.1
 *
 * 否则按标准定价：所有 inputTokens * 全价
 *
 * 若 currency='USD'，价格先乘以 USD_TO_CNY_RATE 换算为人民币再计费。
 *
 * @param {object} params
 * @param {number} params.inputTokens    - 总输入 Token 数
 * @param {number} params.outputTokens   - 总输出 Token 数
 * @param {number} params.priceIn        - 输入价格（原始货币/1000 Token）
 * @param {number} params.priceOut       - 输出价格（原始货币/1000 Token）
 * @param {string} [params.currency]     - 定价货币（'USD' 或 'CNY'，默认 'CNY'）
 * @param {boolean} params.supportsCache - 模型是否支持缓存
 * @param {number} [params.promptTokens]  - 新输入 Token 数（可选）
 * @param {number} [params.historyTokens] - 历史上下文 Token 数（可选）
 * @returns {number} 费用（分），向上取整
 */
function calculateChargedFen({ inputTokens, outputTokens, priceIn, priceOut, currency, supportsCache, promptTokens, historyTokens }) {
  // 若定价为 USD，换算为 CNY（每次计费时实时读取汇率，管理员可热更新）
  const fxRate = (currency === 'USD') ? getUsdToCnyRate() : 1;
  const cnyPriceIn  = priceIn  * fxRate;
  const cnyPriceOut = priceOut * fxRate;

  let inputCostYuan;
  const hasPartition = typeof promptTokens === 'number' && typeof historyTokens === 'number';

  if (supportsCache && hasPartition && historyTokens > CACHE_THRESHOLD_TOKENS) {
    // 分层计费：新输入 + 阈值内历史全价，阈值外历史打折
    const fullPriceTokens = promptTokens + CACHE_THRESHOLD_TOKENS;
    const discountedTokens = historyTokens - CACHE_THRESHOLD_TOKENS;
    inputCostYuan = (fullPriceTokens / 1000) * cnyPriceIn
                  + (discountedTokens / 1000) * cnyPriceIn * CACHE_DISCOUNT;
  } else {
    // 标准计费：所有输入 Token 全价
    inputCostYuan = (inputTokens / 1000) * cnyPriceIn;
  }

  const outputCostYuan = (outputTokens / 1000) * cnyPriceOut;
  // 转换为分并向上取整
  return Math.ceil((inputCostYuan + outputCostYuan) * 100);
}

// =============================================================
// ─── 路由 ────────────────────────────────────────────────────
// =============================================================

/**
 * GET /health
 * 服务 + 数据库联通性检查
 */
app.get('/health', async (_req, res) => {
  try {
    await db.query('SELECT 1');
    res.json({ status: 'ok', db: 'ok', ts: new Date().toISOString() });
  } catch (err) {
    logger.error('Health check DB error', { err: err.message });
    res.status(503).json({ status: 'degraded', db: 'error' });
  }
});

/**
 * GET /models
 * 返回所有已启用模型及其定价，供用户选择
 */
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

/**
 * POST /activate
 * 充值卡激活：验证卡密 → 为用户充值
 *
 * Body: { cardKey: string, userEmail: string }
 */
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

    // 行锁防并发重复激活
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

    // 确保用户存在
    await ensureUser(client, userEmail);

    // 充值（RETURNING 避免额外 SELECT 往返）
    const rechargeRes = await client.query(
      `UPDATE user_billing
          SET balance_fen = balance_fen + $1
        WHERE user_email = $2
        RETURNING balance_fen`,
      [card.credit_fen, userEmail]
    );
    const newBalance = Number(rechargeRes.rows[0].balance_fen);

    // 标记卡密已使用
    await client.query(
      `UPDATE recharge_cards
          SET used=true, used_at=NOW(), used_by=$1
        WHERE id=$2`,
      [userEmail, card.id]
    );

    // 记录充值流水
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

/**
 * GET /billing/balance/:email
 * 查询用户余额及账户状态
 */
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

/**
 * GET /billing/history/:email?limit=20&offset=0
 * 查询用户消费/充值历史
 */
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
 * POST /billing/check
 * 调用前预检：根据估算字数判断余额是否充足，不扣费
 *
 * Body: { userEmail, modelName, estimatedInputTokens?, estimatedOutputTokens? }
 * estimatedInputTokens/estimatedOutputTokens 默认为 0；
 * 如未提供，estimated_fen=0，can_proceed 仅反映账户是否可用而非余额充足。
 *
 * 返回：
 * {
 *   success:       boolean,
 *   can_proceed:   boolean,  // true = 余额充足可继续
 *   is_free:       boolean,
 *   estimated_fen: number,   // 估算费用（分）
 *   balance_fen:   number,
 *   is_suspended:  boolean
 * }
 */
app.post('/billing/check', readLimiter, requireServiceToken, async (req, res) => {
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

  // DB 错误单独捕获，避免与"模型不存在"混淆
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
    // 免费模型：检查每日调用次数限制（不递增，仅预检）
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

  // 解析可选的 promptTokens / historyTokens 分段（用于缓存感知计费）
  const promptTk  = parseOptionalNonNegInt(estimatedPromptTokens);
  const historyTk = parseOptionalNonNegInt(estimatedHistoryTokens);

  const estimatedFen = calculateChargedFen({
    inputTokens: inTokens, outputTokens: outTokens,
    priceIn, priceOut,
    currency: model.currency || 'CNY',
    supportsCache: !!model.supports_cache,
    promptTokens: promptTk, historyTokens: historyTk,
  });

  // 安全熔断：单次请求预估费用超过阈值，拒绝请求
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
 * POST /billing/record
 * 记录一次 API 调用并执行计费
 *
 * Body:
 * {
 *   userEmail:      string,
 *   apiProvider:    string,     // 'anthropic' | 'openai' | 'mistral' ...
 *   modelName:      string,     // 与 api_models.model_name 对应
 *   inputTokens:    number,     // v5: Tiktoken 计数（优先）
 *   outputTokens:   number,
 *   inputChars?:    number,     // v4 兼容：若未提供 tokens 字段则回退使用
 *   outputChars?:   number,
 *   promptTokens?:  number,     // 新输入 Token 数（用于缓存感知分层计费）
 *   historyTokens?: number      // 历史上下文 Token 数（用于缓存感知分层计费）
 * }
 *
 * 返回：
 * {
 *   success:     boolean,
 *   is_free:     boolean,
 *   charged_fen: number,  // 本次扣费（分）
 *   balance_fen: number   // 扣费后余额
 * }
 */
app.post('/billing/record', requireServiceToken, async (req, res) => {
  let { userEmail, apiProvider, modelName,
          inputTokens: rawInputTokens, outputTokens: rawOutputTokens,
          inputChars, outputChars,
          promptTokens: rawPromptTokens, historyTokens: rawHistoryTokens } = req.body ?? {};

  // v5: 优先使用 inputTokens/outputTokens，向后兼容 inputChars/outputChars
  // 注意：若调用方仍传 inputChars/outputChars，值会被当作 Token 数使用；
  // 调用方应尽快迁移到传 Token 数（Tiktoken 计数），以获得准确计费。
  const inputTokens  = rawInputTokens  ?? inputChars  ?? 0;
  const outputTokens = rawOutputTokens ?? outputChars ?? 0;

  if (rawInputTokens == null && inputChars != null) {
    logger.warn('billing/record: 调用方使用旧版 inputChars 字段，请迁移到 inputTokens', { userEmail, modelName });
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

  // ── 1. 查询模型定价 ─────────────────────────────────────────
  // DB 错误单独捕获，避免与"模型不注册"混淆
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

  // is_active=false 的模型（如本地 Ollama）保留接口定义，拒绝计费
  if (!model.is_active) {
    return res.status(400).json({ success: false, msg: '该模型当前未启用，无法计费' });
  }

  const modelId  = model.id;
  const isFree   = model.is_free;
  const priceIn  = Number(model.price_input_per_1k_tokens);
  const priceOut = Number(model.price_output_per_1k_tokens);

  // 解析可选的 promptTokens / historyTokens 分段（用于缓存感知计费）
  const promptTk  = parseOptionalNonNegInt(rawPromptTokens);
  const historyTk = parseOptionalNonNegInt(rawHistoryTokens);

  // ── 2. 免费模型：检查每日限额后记录，不扣费 ─────────────────
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
      logger.error('Free usage insert error', { err: err.message });
    }
    return res.json({ success: true, is_free: true, charged_fen: 0, balance_fen: null, daily_used: dailyCheck.used, daily_limit: dailyCheck.limit });
  }

  // ── 3. 付费模型：检查余额并扣费 ────────────────────────────
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // 确保用户存在
    await ensureUser(client, userEmail);

    // 锁定用户行，防止并发超额扣费
    const userRes = await client.query(
      'SELECT balance_fen, is_suspended FROM user_billing WHERE user_email=$1 FOR UPDATE',
      [userEmail]
    );
    const u = userRes.rows[0];

    if (u.is_suspended) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, msg: '账户已被暂停' });
    }

    // 计算本次费用（缓存感知分层计费）
    const chargedFen = calculateChargedFen({
      inputTokens, outputTokens,
      priceIn, priceOut,
      currency: model.currency || 'CNY',
      supportsCache: !!model.supports_cache,
      promptTokens: promptTk, historyTokens: historyTk,
    });

    // 安全熔断：单次请求费用超过阈值，拒绝请求
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

    // 扣除余额（RETURNING 避免额外 SELECT 往返）
    const deductRes = await client.query(
      `UPDATE user_billing
          SET balance_fen       = balance_fen - $1,
              total_charged_fen = total_charged_fen + $1
        WHERE user_email = $2
        RETURNING balance_fen`,
      [chargedFen, userEmail]
    );
    const newBalance = Number(deductRes.rows[0].balance_fen);

    // 记录调用日志
    const usageRes = await client.query(
      `INSERT INTO api_usage
           (user_email, api_model_id, api_provider, model_name,
            is_free, input_tokens, output_tokens, charged_fen, status)
         VALUES ($1,$2,$3,$4,false,$5,$6,$7,'ok')
         RETURNING id`,
      [userEmail, modelId, apiProvider, modelName, inputTokens, outputTokens, chargedFen]
    );

    // 记录扣费流水
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

// =============================================================
// ─── 管理员接口 ───────────────────────────────────────────────
// =============================================================

/**
 * GET /admin/models
 * 查看所有模型（含未启用的本地模型）
 */
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

/**
 * POST /admin/models
 * 新增 API 模型定价
 *
 * Body:
 * {
 *   provider:      string,
 *   modelName:     string,
 *   displayName:   string,
 *   isFree:        boolean,
 *   priceInput:    number,   // 元/1000 Token（货币单位见 currency）
 *   priceOutput:   number,
 *   currency:      string,   // 可选，'USD' 或 'CNY'，默认 'CNY'
 *   supportsCache: boolean,  // 可选，是否支持 Prompt Caching
 *   description:   string    // 可选
 * }
 */
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
    // 应用层提前拦截，与 db/schema.sql 中 CHECK(>= 0) 约束互为防御
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

/**
 * PUT /admin/models/:id
 * 修改已有模型定价或启用/停用
 *
 * Body（任意字段可选）：
 * {
 *   isFree?:        boolean,
 *   priceInput?:    number,
 *   priceOutput?:   number,
 *   currency?:      string,   // 'USD' 或 'CNY'
 *   isActive?:      boolean,
 *   supportsCache?: boolean,
 *   displayName?:   string,
 *   description?:   string
 * }
 */
app.put('/admin/models/:id', adminLimiter, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, msg: '模型 ID 无效' });
  }

  const { isFree, priceInput, priceOutput, currency, isActive, supportsCache, displayName, description } = req.body ?? {};
  const updates = [];
  const values  = [];

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
  if (!isFree && typeof priceInput === 'number') {
    if (!Number.isFinite(priceInput) || priceInput < 0) {
      return res.status(400).json({ success: false, msg: 'priceInput 必须为有限的非负数' });
    }
    updates.push(`price_input_per_1k_tokens = $${values.length + 1}`);
    values.push(priceInput);
  }
  if (!isFree && typeof priceOutput === 'number') {
    if (!Number.isFinite(priceOutput) || priceOutput < 0) {
      return res.status(400).json({ success: false, msg: 'priceOutput 必须为有限的非负数' });
    }
    updates.push(`price_output_per_1k_tokens = $${values.length + 1}`);
    values.push(priceOutput);
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

/**
 * POST /admin/adjust
 * 人工调整用户余额（充值/退款/扣款）
 *
 * Body: { userEmail, amount_fen, type, description }
 *   type: 'recharge' | 'refund' | 'admin_adjust'
 *   amount_fen: 正数 = 增加余额，负数 = 减少余额
 */
app.post('/admin/adjust', adminLimiter, requireAdmin, async (req, res) => {
  let { userEmail, amount_fen, type, description } = req.body ?? {};

  userEmail = normalizeEmail(userEmail || '');
  if (!isValidEmail(userEmail)) {
    return res.status(400).json({ success: false, msg: '邮箱格式不正确' });
  }
  if (typeof amount_fen !== 'number' || !Number.isInteger(amount_fen) || amount_fen === 0) {
    return res.status(400).json({ success: false, msg: 'amount_fen 必须为非零整数' });
  }
  // 应用层幅度限制：单次调整上限 ¥100,000（10,000,000 分），防止误操作
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

    // 先取当前余额并加行锁，防并发调整（ensureUser 保证行已存在）
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
    // 实际生效金额（减少时若余额不足会被截断到 0，实际扣减 = newBalance - oldBalance）
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
    // PCI-DSS 8.3.6：令牌长度至少 32 字节（64 个十六进制字符）
    logger.warn('ADMIN_TOKEN 过短（< 32 字符），建议执行 openssl rand -hex 32 重新生成');
  }
  if (!SERVICE_TOKEN) {
    // PCI-DSS 7.x / CIS 网络分段：SERVICE_TOKEN 未配置时，任何内网进程均可
    // 触发计费写入（/billing/record、/billing/check），建议在生产环境设置
    logger.warn('SERVICE_TOKEN 未设置，/billing 写入接口无内部服务鉴权（建议通过环境变量配置）');
  } else if (SERVICE_TOKEN.length < 32) {
    logger.warn('SERVICE_TOKEN 过短（< 32 字符），建议执行 openssl rand -hex 32 重新生成');
  }
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

// PCI-DSS 6.5.5: 确保未捕获的异常被正确记录，然后安全退出
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection, shutting down', { err: String(reason) });
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception, shutting down', { err: err.message, stack: err.stack });
  process.exit(1);
});

module.exports = app;
