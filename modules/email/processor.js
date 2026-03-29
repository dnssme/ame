'use strict';

/**
 * Anima 灵枢 · 邮件处理模块
 * IMAP 轮询收件 + AI 分析摘要 + SMTP 发件
 *
 * 修复记录：
 *   #FIX-E1  analyzeEmail HTTP 请求增加超时（bodyTimeout/headersTimeout: 30s）
 *            防止 Agent 挂起导致整个邮件检查周期阻塞
 *   #FIX-E2  analyzeEmail AbortController 总时限兜底（60s）
 *   #BUG-3   checkNewEmails() catch 块中错误地将 lastCheck 推进到
 *            checkStartTime，导致 IMAP 失败时 T1~T2 期间的邮件永久丢失。
 *            修复：失败时不更新 lastCheck，保留上次成功时间，
 *            下次运行重试时仍从正确时间点开始。
 *   #FIX-E3  IMAP logout cleanup 日志级别从 debug 提升为 warn
 *            原实现用 debug 级别，生产环境通常不显示 debug 日志，
 *            运维无法感知 logout 清理失败（可能暗示连接泄漏）。
 *   #FIX-E4  单封邮件处理失败不影响后续邮件，增加 per-email try/catch。
 *   #FIX-E5  邮件正文增加最大长度截断（MAX_BODY_LENGTH），防止超大邮件耗尽内存。
 *   #FIX-E6  过滤 HTML 邮件中的 script 标签，防范 XSS 风险。
 *   #FIX-E7  AI 分析结果增加长度截断，防止通知邮件过大。
 */

const http           = require('http');
const { ImapFlow }   = require('imapflow');
const nodemailer     = require('nodemailer');
const { simpleParser } = require('mailparser');
const { request }    = require('undici');
const winston        = require('winston');

// ─── 超时配置常量 ─────────────────────────────────────────────
const AGENT_REQUEST_TIMEOUT_MS = parseInt(process.env.AGENT_REQUEST_TIMEOUT_MS || '30000', 10);

// ─── 日志 ────────────────────────────────────────────────────
const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [new winston.transports.Console()],
});

// ─── 启动验证：必要环境变量 ──────────────────────────────────
const REQUIRED_ENV_VARS = ['IMAP_HOST', 'IMAP_USER', 'IMAP_PASSWORD', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD'];
const missingEnvVars = REQUIRED_ENV_VARS.filter(v => !process.env[v]);
if (missingEnvVars.length > 0) {
  logger.error(`缺少必要的环境变量，模块无法启动：${missingEnvVars.join(', ')}`);
  process.exit(1);
}

// ─── 配置 ────────────────────────────────────────────────────
const AGENT_API_URL = (process.env.AGENT_API_URL || 'http://172.16.1.2:3000').replace(/\/$/, '');
const DEFAULT_MODEL = process.env.AGENT_DEFAULT_MODEL || 'glm-4-flash';
const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL || '300', 10) * 1000;
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || process.env.SMTP_USER;
const MAX_EMAILS_PER_CHECK = parseInt(process.env.MAX_EMAILS_PER_CHECK || '20', 10);

// FIX-E5：邮件正文最大长度，超过截断（防止超大邮件耗尽内存）
const MAX_BODY_LENGTH = parseInt(process.env.MAX_BODY_LENGTH || '50000', 10);
// FIX-E7：AI 分析结果最大长度
const MAX_ANALYSIS_LENGTH = parseInt(process.env.MAX_ANALYSIS_LENGTH || '5000', 10);

// ─── IMAP 客户端 ─────────────────────────────────────────────
function createImapClient() {
  return new ImapFlow({
    host: process.env.IMAP_HOST,
    port: parseInt(process.env.IMAP_PORT || '993', 10),
    secure: process.env.IMAP_TLS !== 'false',
    auth: {
      user: process.env.IMAP_USER,
      pass: process.env.IMAP_PASSWORD,
    },
    logger: false,
  });
}

// ─── SMTP 发件 ───────────────────────────────────────────────
const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST,
  port: parseInt(process.env.SMTP_PORT || '465', 10),
  secure: process.env.SMTP_SECURE !== 'false',
  auth: {
    user: process.env.SMTP_USER,
    pass: process.env.SMTP_PASSWORD,
  },
});

/**
 * 清理字符串中的换行符和控制字符，防止邮件头注入。
 */
function sanitizeEmailField(str) {
  if (!str || typeof str !== 'string') return '';
  return str.replace(/[\r\n\x00-\x1f]/g, ' ').trim();
}

/**
 * FIX-E6：过滤 HTML 邮件中的危险标签（script/style/iframe/object/embed），
 * 防范 XSS 风险。虽然是内部使用，但通知邮件可能被邮件客户端渲染。
 */
function stripDangerousTags(text) {
  if (!text || typeof text !== 'string') return '';
  return text.replace(/<\s*\/?\s*(script|style|iframe|object|embed)[^>]*>/gi, '');
}

// ─── AI 分析 ─────────────────────────────────────────────────
async function analyzeEmail(subject, from, body) {
  const prompt = [
    '你是一个邮件助手。请对以下邮件进行分析：',
    '',
    `发件人：${from}`,
    `主题：${subject}`,
    `正文：`,
    body.substring(0, 3000),
    '',
    '请提供：1) 邮件摘要（50字以内）2) 重要程度（高/中/低）3) 建议回复要点',
  ].join('\n');

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AGENT_REQUEST_TIMEOUT_MS + 30_000);

  try {
    const { body: respBody } = await request(`${AGENT_API_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: [{ role: 'user', content: prompt }],
      }),
      bodyTimeout: AGENT_REQUEST_TIMEOUT_MS,
      headersTimeout: AGENT_REQUEST_TIMEOUT_MS,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const data = await respBody.json();
    return data.reply || data.choices?.[0]?.message?.content || '分析失败';
  } catch (err) {
    clearTimeout(timeoutId);
    if (err.name === 'AbortError') {
      logger.error('AI 分析请求超时', { timeoutMs: AGENT_REQUEST_TIMEOUT_MS + 30_000 });
      return 'AI 分析超时，请稍后重试';
    }
    logger.error('AI 分析失败', { err: err.message });
    return '分析服务暂不可用';
  }
}

// ─── 邮件检查 ────────────────────────────────────────────────
let lastCheck = new Date();

async function checkNewEmails() {
  const client = createImapClient();
  const checkStartTime = new Date();

  try {
    await client.connect();

    const lock = await client.getMailboxLock('INBOX');
    try {
      const messages = client.fetch(
        { since: lastCheck },
        { source: true, envelope: true }
      );

      let count = 0;
      for await (const msg of messages) {
        // FIX-E4：per-email try/catch，单封邮件失败不影响后续邮件
        try {
          const parsed = await simpleParser(msg.source);
          const subject = sanitizeEmailField(parsed.subject || '(无主题)');
          const from = sanitizeEmailField(parsed.from?.text || '(未知发件人)');
          // FIX-E5：截断超大邮件正文，防止耗尽内存
          // FIX-E6：过滤 HTML 危险标签
          let textBody = parsed.text || '';
          textBody = stripDangerousTags(textBody);
          if (textBody.length > MAX_BODY_LENGTH) {
            textBody = textBody.substring(0, MAX_BODY_LENGTH);
            logger.warn('邮件正文超长已截断', { subject, from, originalLength: (parsed.text || '').length });
          }

          const messageId = parsed.messageId || msg.uid || '(unknown)';
          logger.info('新邮件', { subject, from, messageId });

          let analysis = await analyzeEmail(subject, from, textBody);
          // FIX-E7：截断过长的 AI 分析结果
          if (analysis.length > MAX_ANALYSIS_LENGTH) {
            analysis = analysis.substring(0, MAX_ANALYSIS_LENGTH) + '\n\n[分析结果已截断]';
          }
          logger.info('邮件分析完成', { subject, messageId });

          if (NOTIFY_EMAIL) {
            await sendEmail(
              NOTIFY_EMAIL,
              `[Anima 邮件摘要] ${subject}`,
              [
                `发件人：${from}`,
                `主题：${subject}`,
                '',
                '── AI 分析结果 ──',
                analysis,
              ].join('\n')
            );
          } else {
            logger.warn('NOTIFY_EMAIL 未配置，分析结果仅写入日志');
          }
        } catch (emailErr) {
          // FIX-E4：记录失败详情（含邮件 UID），继续处理下一封
          logger.error('单封邮件处理失败', {
            err: emailErr.message,
            uid: msg.uid || '(unknown)',
          });
        }

        count++;
        if (count >= MAX_EMAILS_PER_CHECK) {
          logger.info(`已达到单次检查上限（${MAX_EMAILS_PER_CHECK} 封），剩余邮件下次处理`);
          break;
        }
      }

      if (count > 0) {
        logger.info(`共处理 ${count} 封新邮件`);
      }

      // 成功完成后才更新 lastCheck，以本次检查开始时间为准
      lastCheck = checkStartTime;
    } finally {
      lock.release();
    }

    await client.logout();
  } catch (err) {
    logger.error('邮件检查失败', { err: err.message });
    // BUG-3 修复：失败时不更新 lastCheck
    // 原代码在此处执行 lastCheck = checkStartTime，将 lastCheck 推进到本次
    // 失败检查的开始时间，导致上次成功到本次失败之间的邮件（T1~T2）永久丢失。
    // 修复：保持 lastCheck 不变，下次运行仍从上次成功时间重试，不遗漏邮件。
    try {
      await client.logout();
    } catch (logoutErr) {
      // FIX-E3：从 debug 提升为 warn，运维可感知潜在的连接泄漏
      logger.warn('IMAP logout cleanup failed（可能存在连接泄漏）', { err: logoutErr.message });
    }
  }
}

// ─── 发送邮件 ────────────────────────────────────────────────
async function sendEmail(to, subject, text) {
  try {
    const info = await transporter.sendMail({
      from: process.env.SMTP_FROM || process.env.SMTP_USER,
      to,
      subject,
      text,
    });
    logger.info('邮件已发送', { to, subject, messageId: info.messageId });
    return { success: true, messageId: info.messageId };
  } catch (err) {
    logger.error('邮件发送失败', { err: err.message, to });
    return { success: false, error: err.message };
  }
}

// ─── 定时轮询 ────────────────────────────────────────────────
logger.info(`邮件处理模块启动，检查间隔 ${CHECK_INTERVAL / 1000}s`);

checkNewEmails().catch((err) => logger.error('初始邮件检查失败', { err: err.message }));

const timer = setInterval(checkNewEmails, CHECK_INTERVAL);

// ─── 健康检查 ────────────────────────────────────────────────
const healthServer = http.createServer((req, res) => {
  if (req.url !== '/health' || req.method !== 'GET') {
    res.writeHead(404, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: 'Not Found' }));
    return;
  }
  res.writeHead(200, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify({ status: 'ok', lastCheck: lastCheck.toISOString() }));
});

healthServer.listen(3004, () => {
  logger.info('健康检查服务已启动 :3004');
});

// ─── 优雅退出 ────────────────────────────────────────────────
const shutdown = (signal) => {
  logger.info(`收到 ${signal}，正在关闭...`);
  clearInterval(timer);
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

module.exports = { sendEmail };
