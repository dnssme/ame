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
const { encoding_for_model, get_encoding } = require('tiktoken');

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
      filename: '/var/log/anima-webhook.log',
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
  max:      10,
  idleTimeoutMillis:   30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout:  10_000, // 10s 查询超时
});

db.on('error', (err) => logger.error('DB pool error', { err: err.message }));

// ─── Express 应用 ─────────────────────────────────────────────
const app = express();

app.use(helmet());
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

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

// ─── 工具函数 ─────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// RFC 5321：邮箱最大长度 254 字符（PCI-DSS 6.5.1 输入验证）
const MAX_EMAIL_LEN = 254;

/** 验证邮箱格式和长度 */
function isValidEmail(email) {
  return typeof email === 'string' && email.length <= MAX_EMAIL_LEN && EMAIL_RE.test(email);
}

/** 确保 user_billing 行存在，不存在则自动创建 */
async function ensureUser(client, userEmail) {
  await client.query(
    `INSERT INTO user_billing (user_email) VALUES ($1)
     ON CONFLICT (user_email) DO NOTHING`,
    [userEmail]
  );
}

// ─── Tiktoken 编码器缓存 ──────────────────────────────────────
// 缓存大小有限：tiktoken 仅有少量编码（cl100k_base, p50k_base, o200k_base 等），
// 且模型名会映射到这些编码之一，因此缓存不会无限增长。
const encoderCache = new Map();
// cl100k_base 覆盖 GPT-4 / GPT-3.5-turbo / Claude 等主流模型族
const FALLBACK_ENCODING = 'cl100k_base';

/**
 * 获取指定模型的 Tiktoken 编码器（带缓存）。
 * 若模型未识别则回退到 cl100k_base（覆盖 GPT-4 / Claude 等主流模型）。
 */
function getEncoder(modelName) {
  if (encoderCache.has(modelName)) return encoderCache.get(modelName);
  try {
    const enc = encoding_for_model(modelName);
    encoderCache.set(modelName, enc);
    return enc;
  } catch {
    // 模型未识别，使用通用编码
    if (!encoderCache.has(FALLBACK_ENCODING)) {
      encoderCache.set(FALLBACK_ENCODING, get_encoding(FALLBACK_ENCODING));
    }
    return encoderCache.get(FALLBACK_ENCODING);
  }
}

/**
 * 使用 Tiktoken 计算文本的 Token 数量。
 * @param {string} text - 输入文本
 * @param {string} modelName - 模型名称（用于选择编码器）
 * @returns {number} Token 数量
 */
function countTokens(text, modelName) {
  if (!text || typeof text !== 'string') return 0;
  const enc = getEncoder(modelName);
  return enc.encode(text).length;
}

/**
 * 从 api_models 表查询模型定价。
 * 若模型未注册，返回 null（调用方按"未知付费模型"处理）。
 */
async function lookupModel(modelName) {
  const res = await db.query(
    `SELECT id, is_free, price_input_per_1k_tokens, price_output_per_1k_tokens, is_active
       FROM api_models WHERE model_name = $1`,
    [modelName]
  );
  return res.rows[0] || null;
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
app.get('/models', async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT provider, model_name, display_name, is_free,
              price_input_per_1k_tokens, price_output_per_1k_tokens, description
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
  const { cardKey, userEmail } = req.body ?? {};

  if (!cardKey || !userEmail) {
    return res.status(400).json({ success: false, msg: '参数缺失：需要 cardKey 和 userEmail' });
  }
  if (typeof cardKey !== 'string') {
    return res.status(400).json({ success: false, msg: 'cardKey 必须为字符串' });
  }
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

    // 充值
    await client.query(
      `UPDATE user_billing
          SET balance_fen = balance_fen + $1
        WHERE user_email = $2`,
      [card.credit_fen, userEmail]
    );

    // 标记卡密已使用
    await client.query(
      `UPDATE recharge_cards
          SET used=true, used_at=NOW(), used_by=$1
        WHERE id=$2`,
      [userEmail, card.id]
    );

    // 获取充值后余额
    const balRes = await client.query(
      'SELECT balance_fen FROM user_billing WHERE user_email=$1',
      [userEmail]
    );
    const newBalance = Number(balRes.rows[0].balance_fen);

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
    await client.query('ROLLBACK');
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
app.get('/billing/balance/:email', async (req, res) => {
  const { email } = req.params;
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
app.get('/billing/history/:email', async (req, res) => {
  const { email } = req.params;
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
app.post('/billing/check', async (req, res) => {
  const { userEmail, modelName, estimatedInputTokens, estimatedOutputTokens,
          estimatedInputChars, estimatedOutputChars } = req.body ?? {};

  if (!isValidEmail(userEmail || '')) {
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
    return res.json({ success: true, can_proceed: true, is_free: true, estimated_fen: 0, balance_fen: null, is_suspended: false });
  }

  const inTokens  = Math.max(0, parseInt(estimatedInputTokens  || estimatedInputChars  || '0', 10) || 0);
  const outTokens = Math.max(0, parseInt(estimatedOutputTokens || estimatedOutputChars || '0', 10) || 0);
  const priceIn  = Number(model.price_input_per_1k_tokens);
  const priceOut = Number(model.price_output_per_1k_tokens);
  const estimatedFen = Math.ceil(((inTokens / 1000) * priceIn + (outTokens / 1000) * priceOut) * 100);

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
 *   userEmail:    string,
 *   apiProvider:  string,     // 'anthropic' | 'openai' | 'mistral' ...
 *   modelName:    string,     // 与 api_models.model_name 对应
 *   inputTokens:  number,     // v5: Tiktoken 计数（优先）
 *   outputTokens: number,
 *   inputChars?:  number,     // v4 兼容：若未提供 tokens 字段则回退使用
 *   outputChars?: number
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
app.post('/billing/record', async (req, res) => {
  const { userEmail, apiProvider, modelName,
          inputTokens: rawInputTokens, outputTokens: rawOutputTokens,
          inputChars, outputChars } = req.body ?? {};

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

  // ── 2. 免费模型：只记录，不扣费 ────────────────────────────
  if (isFree) {
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
    return res.json({ success: true, is_free: true, charged_fen: 0, balance_fen: null });
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

    // 计算本次费用（向上取整到整分；priceIn/priceOut 单位为 元/1000 Token，×100 转换为分）
    const chargedFen = Math.ceil(
      ((inputTokens / 1000) * priceIn + (outputTokens / 1000) * priceOut) * 100
    );

    if (Number(u.balance_fen) < chargedFen) {
      await client.query('ROLLBACK');
      return res.status(402).json({
        success:      false,
        msg:          '余额不足，请充值后继续使用',
        balance_fen:  Number(u.balance_fen),
        required_fen: chargedFen,
      });
    }

    // 扣除余额
    await client.query(
      `UPDATE user_billing
          SET balance_fen       = balance_fen - $1,
              total_charged_fen = total_charged_fen + $1
        WHERE user_email = $2`,
      [chargedFen, userEmail]
    );

    // 获取扣费后余额
    const balRes = await client.query(
      'SELECT balance_fen FROM user_billing WHERE user_email=$1',
      [userEmail]
    );
    const newBalance = Number(balRes.rows[0].balance_fen);

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
    await client.query('ROLLBACK');
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
              is_active, description, created_at, updated_at
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
 *   provider:    string,
 *   modelName:   string,
 *   displayName: string,
 *   isFree:      boolean,
 *   priceInput:  number,   // 元/1000 Token
 *   priceOutput: number,
 *   description: string    // 可选
 * }
 */
app.post('/admin/models', adminLimiter, requireAdmin, async (req, res) => {
  const { provider, modelName, displayName, isFree, priceInput, priceOutput, description } = req.body ?? {};

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
  if (description != null && (typeof description !== 'string' || description.length > 1000)) {
    return res.status(400).json({ success: false, msg: 'description 长度不能超过 1000 字符' });
  }

  try {
    const result = await db.query(
      `INSERT INTO api_models
           (provider, model_name, display_name, is_free,
            price_input_per_1k_tokens, price_output_per_1k_tokens, description)
         VALUES ($1,$2,$3,$4,$5,$6,$7)
         ON CONFLICT (model_name) DO UPDATE SET
           provider    = EXCLUDED.provider,
           display_name = EXCLUDED.display_name,
           is_free     = EXCLUDED.is_free,
           price_input_per_1k_tokens  = EXCLUDED.price_input_per_1k_tokens,
           price_output_per_1k_tokens = EXCLUDED.price_output_per_1k_tokens,
           description = EXCLUDED.description,
           is_active   = true
         RETURNING id, provider, model_name, display_name, is_free,
                   price_input_per_1k_tokens, price_output_per_1k_tokens, is_active`,
      [provider, modelName, displayName, isFree, isFree ? 0 : priceInput, isFree ? 0 : priceOutput, description || null]
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
 *   isFree?:      boolean,
 *   priceInput?:  number,
 *   priceOutput?: number,
 *   isActive?:    boolean,
 *   displayName?: string,
 *   description?: string
 * }
 */
app.put('/admin/models/:id', adminLimiter, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, msg: '模型 ID 无效' });
  }

  const { isFree, priceInput, priceOutput, isActive, displayName, description } = req.body ?? {};
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
  const { userEmail, amount_fen, type, description } = req.body ?? {};

  if (!isValidEmail(userEmail || '')) {
    return res.status(400).json({ success: false, msg: '邮箱格式不正确' });
  }
  if (typeof amount_fen !== 'number' || !Number.isFinite(amount_fen) || amount_fen === 0) {
    return res.status(400).json({ success: false, msg: 'amount_fen 必须为有限的非零数字' });
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
    await client.query('ROLLBACK');
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
  res.status(500).json({ success: false, msg: '服务器内部错误' });
});

// ─── 启动 ─────────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3002', 10);
const HOST = process.env.HOST || '172.16.1.5';

const server = app.listen(PORT, HOST, () => {
  logger.info(`Webhook 服务已启动 http://${HOST}:${PORT}`);
  if (!ADMIN_TOKEN) {
    logger.warn('ADMIN_TOKEN 未设置，管理员接口已禁用');
  } else if (ADMIN_TOKEN.length < 32) {
    // PCI-DSS 8.3.6：令牌长度至少 32 字节（64 个十六进制字符）
    logger.warn('ADMIN_TOKEN 过短（< 32 字符），建议执行 openssl rand -hex 32 重新生成');
  }
});

const shutdown = (signal) => {
  logger.info(`收到 ${signal}，正在优雅关闭...`);
  server.close(() => {
    db.end()
      .then(() => {
        logger.info('数据库连接池已关闭');
        process.exit(0);
      })
      .catch((err) => {
        logger.error('数据库连接池关闭失败', { err: err.message });
        process.exit(1);
      });
  });
  setTimeout(() => process.exit(1), 10_000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

module.exports = app;
