'use strict';

/**
 * Anima 灵枢 · Webhook 服务 v2
 * ─────────────────────────────────────────────────────────────
 * 功能：
 *   1. 卡密激活  POST /activate
 *   2. API 计费中间件  POST /billing/record
 *   3. 用户配额查询  GET /billing/quota/:email
 *   4. 健康检查  GET /health
 *
 * 计费规则：
 *   - is_free_model=true（本地 Ollama 等）→ 永久免费，不记录消耗
 *   - is_free_model=false（云端 API）→ 每用户每日前 20 次免费
 *     超出后按字数计费：¥0.01/1k 输入字 + ¥0.02/1k 输出字（基础版）
 *   - 余额不足时拒绝请求，返回 402
 *
 * 安全：
 *   - helmet 安全响应头
 *   - express-rate-limit 限速
 *   - 仅监听内网 IP 172.16.1.5
 *   - 所有 DB 操作使用参数化查询，防 SQL 注入
 *   - 卡密激活使用数据库事务防并发重复激活
 */

const express = require('express');
const helmet  = require('helmet');
const rateLimit = require('express-rate-limit');
const { Pool } = require('pg');
const winston = require('winston');

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
      maxsize: 10 * 1024 * 1024, // 10 MB
      maxFiles: 5,
      tailable: true,
    }),
  ],
});

// ─── 数据库连接池 ─────────────────────────────────────────────
const db = new Pool({
  host:            process.env.PG_HOST     || 'anima-db.postgres.database.azure.com',
  port:            parseInt(process.env.PG_PORT || '5432', 10),
  user:            process.env.PG_USER     || 'animaapp',
  password:        process.env.PG_PASSWORD,          // 必须通过环境变量注入
  database:        process.env.PG_DATABASE || 'librechat',
  ssl:             { rejectUnauthorized: true },
  max:             10,
  idleTimeoutMillis:  30_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 10_000,                         // 10 秒查询超时
});

db.on('error', (err) => {
  logger.error('DB pool error', { err: err.message });
});

// ─── 免费模型白名单（正则）────────────────────────────────────
// 匹配到这些模型的请求永远免费，不扣除任何配额
const FREE_MODEL_PATTERNS = [
  /^qwen/i,       // Qwen 系列（本地 Ollama）
  /^llama/i,      // LLaMA 系列
  /^mistral.*local/i,
  /^gemma/i,
  /^phi/i,
  /^deepseek/i,
  /^internlm/i,
];

/**
 * 判断模型是否为本地免费模型
 * @param {string} provider - API 提供商
 * @param {string} model - 模型名称
 * @returns {boolean}
 */
function isFreeModel(provider, model) {
  if (provider === 'ollama') return true;
  return FREE_MODEL_PATTERNS.some((re) => re.test(model));
}

// ─── Express 应用 ─────────────────────────────────────────────
const app = express();

// 安全响应头（helmet 默认配置已覆盖 OWASP Top-10 响应头要求）
app.use(helmet());
app.disable('x-powered-by');

// JSON body 解析（限制 1 MB 防止请求体爆炸）
app.use(express.json({ limit: '1mb' }));

// 全局限速：每 IP 每分钟最多 60 次
const globalLimiter = rateLimit({
  windowMs: 60_000,
  max:      60,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, msg: '请求过于频繁，请稍后再试' },
});
app.use(globalLimiter);

// 激活接口单独限速：每 IP 每 10 分钟最多 5 次（防暴力枚举卡密）
const activateLimiter = rateLimit({
  windowMs: 10 * 60_000,
  max:      5,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, msg: '激活尝试过于频繁，请 10 分钟后再试' },
});

// ─── 工具函数 ─────────────────────────────────────────────────

/**
 * 确保用户存在于 user_billing 表，不存在则插入默认免费版记录
 */
async function ensureUserBilling(client, userEmail) {
  await client.query(
    `INSERT INTO user_billing (user_email) VALUES ($1)
     ON CONFLICT (user_email) DO NOTHING`,
    [userEmail]
  );
}

// ─── 路由 ─────────────────────────────────────────────────────

/**
 * GET /health
 * 健康检查，同时探测数据库连通性
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
 * POST /activate
 * 卡密激活：验证卡密 → 更新用户订阅 → 标记卡密已使用
 *
 * Body: { cardKey: string, userEmail: string, plan: string }
 */
app.post('/activate', activateLimiter, async (req, res) => {
  const { cardKey, userEmail, plan } = req.body ?? {};

  if (!cardKey || !userEmail || !plan) {
    return res.status(400).json({ success: false, msg: '参数缺失：需要 cardKey、userEmail、plan' });
  }

  // 基础格式校验
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(userEmail)) {
    return res.status(400).json({ success: false, msg: '邮箱格式不正确' });
  }
  if (cardKey.length > 64 || !/^[A-Z0-9-]+$/i.test(cardKey)) {
    return res.status(400).json({ success: false, msg: '卡密格式不正确' });
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // 锁定卡密行，防止并发重复激活
    const cardRes = await client.query(
      `SELECT id, valid_days, credit_fen
         FROM subscription_cards
        WHERE key=$1 AND used=false AND plan=$2
        FOR UPDATE`,
      [cardKey, plan]
    );
    if (cardRes.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.json({ success: false, msg: '卡密无效、已使用或套餐不匹配' });
    }

    const card = cardRes.rows[0];
    const expiry = new Date(Date.now() + card.valid_days * 24 * 60 * 60 * 1000);

    // 确保用户存在
    await ensureUserBilling(client, userEmail);

    // 更新订阅
    await client.query(
      `UPDATE user_billing
          SET subscription_plan=$1,
              subscription_expiry=$2,
              balance_fen = balance_fen + $3
        WHERE user_email=$4`,
      [plan, expiry, card.credit_fen, userEmail]
    );

    // 标记卡密已使用
    await client.query(
      `UPDATE subscription_cards
          SET used=true, used_at=NOW(), used_by=$1
        WHERE id=$2`,
      [userEmail, card.id]
    );

    // 记录充值流水
    if (Number(card.credit_fen) > 0) {
      const balRes = await client.query(
        'SELECT balance_fen FROM user_billing WHERE user_email=$1',
        [userEmail]
      );
      await client.query(
        `INSERT INTO billing_transactions
             (user_email, type, amount_fen, balance_after_fen, description, ref_id)
           VALUES ($1, 'recharge', $2, $3, '卡密充值', $4)`,
        [userEmail, card.credit_fen, balRes.rows[0].balance_fen, cardKey]
      );
    }

    await client.query('COMMIT');

    logger.info('Card activated', { userEmail, plan, cardKey });

    res.json({
      success: true,
      msg: '激活成功',
      plan,
      expires: expiry.toLocaleDateString('zh-CN'),
      creditAdded: `¥${(Number(card.credit_fen) / 100).toFixed(2)}`,
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
 * GET /billing/quota/:email
 * 返回用户今日剩余免费调用次数及余额
 */
app.get('/billing/quota/:email', async (req, res) => {
  const { email } = req.params;

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return res.status(400).json({ success: false, msg: '邮箱格式不正确' });
  }

  try {
    const result = await db.query(
      'SELECT * FROM v_user_today_usage WHERE user_email=$1',
      [email]
    );

    if (result.rows.length === 0) {
      // 用户不存在，返回免费版默认值
      return res.json({
        success: true,
        plan: 'free',
        balance_fen: 0,
        today_paid_calls: 0,
        remaining_free_calls: 20,
        is_suspended: false,
      });
    }

    const row = result.rows[0];
    res.json({
      success: true,
      plan:                  row.subscription_plan,
      balance_fen:           row.balance_fen,
      today_paid_calls:      row.today_paid_calls,
      remaining_free_calls:  row.remaining_free_calls,
      is_suspended:          row.is_suspended,
    });
  } catch (err) {
    logger.error('Quota query error', { err: err.message, email });
    res.status(500).json({ success: false, msg: '服务器内部错误' });
  }
});

/**
 * POST /billing/record
 * 记录一次 API 调用并执行计费逻辑
 *
 * Body:
 * {
 *   userEmail:    string,
 *   apiProvider:  string,   // 'ollama' | 'anthropic' | 'mistral' | 'openai'
 *   modelName:    string,
 *   inputChars:   number,
 *   outputChars:  number
 * }
 *
 * 返回：
 * {
 *   success: boolean,
 *   charged_fen: number,    // 本次扣费（分）
 *   used_daily_free: boolean,
 *   remaining_free_calls: number,
 *   balance_fen: number
 * }
 */
app.post('/billing/record', async (req, res) => {
  const { userEmail, apiProvider, modelName, inputChars, outputChars } = req.body ?? {};

  if (!userEmail || !apiProvider || !modelName) {
    return res.status(400).json({ success: false, msg: '参数缺失' });
  }
  if (typeof inputChars !== 'number' || typeof outputChars !== 'number') {
    return res.status(400).json({ success: false, msg: 'inputChars/outputChars 必须为数字' });
  }

  const freeModel = isFreeModel(apiProvider, modelName);

  // 本地免费模型：只记录日志，不扣费，不消耗配额
  if (freeModel) {
    try {
      await db.query(
        `INSERT INTO api_usage
             (user_email, api_provider, model_name, is_free_model,
              input_chars, output_chars, used_daily_free, charged_fen, status)
           VALUES ($1,$2,$3,true,$4,$5,false,0,'ok')`,
        [userEmail, apiProvider, modelName, inputChars, outputChars]
      );
    } catch (err) {
      logger.error('Free usage insert error', { err: err.message });
    }
    return res.json({
      success: true,
      charged_fen: 0,
      used_daily_free: false,
      remaining_free_calls: null, // 不适用
      balance_fen: null,
    });
  }

  // 付费云端 API：需要检查配额和余额
  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // 确保用户存在
    await ensureUserBilling(client, userEmail);

    // 查询用户配额视图（带行锁保证原子性）
    const userRes = await client.query(
      `SELECT ub.subscription_plan, ub.balance_fen, ub.is_suspended,
              sp.daily_free_calls,
              sp.price_input_per_1k_chars,
              sp.price_output_per_1k_chars,
              COALESCE(dq.paid_calls,0) AS today_paid_calls
         FROM user_billing ub
         JOIN subscription_plans sp ON sp.name = ub.subscription_plan
         LEFT JOIN daily_quota dq
              ON dq.user_email = ub.user_email
             AND dq.quota_date = CURRENT_DATE
        WHERE ub.user_email = $1
        FOR UPDATE OF ub`,
      [userEmail]
    );

    const u = userRes.rows[0];

    if (u.is_suspended) {
      await client.query('ROLLBACK');
      return res.status(403).json({ success: false, msg: '账户已被暂停' });
    }

    const todayCalls    = Number(u.today_paid_calls);
    const freeCalls     = Number(u.daily_free_calls);
    const usedDailyFree = todayCalls < freeCalls;

    let chargedFen = 0;

    if (!usedDailyFree) {
      // 超出免费额度，按字数计费
      const priceIn  = Number(u.price_input_per_1k_chars);
      const priceOut = Number(u.price_output_per_1k_chars);
      chargedFen = (inputChars / 1000) * priceIn
                 + (outputChars / 1000) * priceOut;
      chargedFen = Math.ceil(chargedFen * 100) / 100; // 向上取整到分（保留两位小数）

      if (Number(u.balance_fen) < chargedFen) {
        await client.query('ROLLBACK');
        return res.status(402).json({
          success: false,
          msg: '余额不足，请充值后继续使用',
          balance_fen: Number(u.balance_fen),
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
    }

    // 更新每日配额计数（INSERT ON CONFLICT）
    await client.query(
      `INSERT INTO daily_quota (user_email, quota_date, paid_calls)
            VALUES ($1, CURRENT_DATE, 1)
       ON CONFLICT (user_email, quota_date)
       DO UPDATE SET paid_calls = daily_quota.paid_calls + 1`,
      [userEmail]
    );

    // 获取更新后余额
    const balRes = await client.query(
      'SELECT balance_fen FROM user_billing WHERE user_email=$1',
      [userEmail]
    );
    const newBalance = Number(balRes.rows[0].balance_fen);

    // 记录 API 使用日志
    const usageRes = await client.query(
      `INSERT INTO api_usage
           (user_email, api_provider, model_name, is_free_model,
            input_chars, output_chars, used_daily_free, charged_fen, status)
         VALUES ($1,$2,$3,false,$4,$5,$6,$7,'ok')
         RETURNING id`,
      [userEmail, apiProvider, modelName, inputChars, outputChars, usedDailyFree, chargedFen]
    );

    // 记录扣费流水（只在实际扣费时）
    if (chargedFen > 0) {
      await client.query(
        `INSERT INTO billing_transactions
             (user_email, type, amount_fen, balance_after_fen, description, ref_id)
           VALUES ($1,'charge',$2,$3,$4,$5)`,
        [
          userEmail,
          chargedFen,
          newBalance,
          `API调用: ${modelName} (输入${inputChars}字 输出${outputChars}字)`,
          String(usageRes.rows[0].id),
        ]
      );
    }

    await client.query('COMMIT');

    logger.info('Billing recorded', {
      userEmail,
      model: modelName,
      usedDailyFree,
      chargedFen,
      todayCalls: todayCalls + 1,
    });

    res.json({
      success: true,
      charged_fen:          chargedFen,
      used_daily_free:      usedDailyFree,
      remaining_free_calls: Math.max(0, freeCalls - todayCalls - 1),
      balance_fen:          newBalance,
    });
  } catch (err) {
    await client.query('ROLLBACK');
    logger.error('Billing record error', { err: err.message, userEmail });
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

// ─── 启动服务 ─────────────────────────────────────────────────
const PORT = parseInt(process.env.PORT || '3002', 10);
const HOST = process.env.HOST || '172.16.1.5';

const server = app.listen(PORT, HOST, () => {
  logger.info(`Webhook 服务已启动 http://${HOST}:${PORT}`);
});

// 优雅关闭
const shutdown = (signal) => {
  logger.info(`收到 ${signal}，正在优雅关闭...`);
  server.close(() => {
    db.end().then(() => {
      logger.info('数据库连接池已关闭');
      process.exit(0);
    });
  });
  // 强制超时
  setTimeout(() => process.exit(1), 10_000);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

module.exports = app; // 供测试使用
