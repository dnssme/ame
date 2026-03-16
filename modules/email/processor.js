'use strict';

/**
 * Anima 灵枢 · 邮件处理模块
 * IMAP 轮询收件 + AI 分析摘要 + SMTP 发件
 */

const http           = require('http');
const { ImapFlow }   = require('imapflow');
const nodemailer     = require('nodemailer');
const { simpleParser } = require('mailparser');
const { request }    = require('undici');
const winston        = require('winston');

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
const AGENT_API_URL = process.env.AGENT_API_URL || 'http://172.16.1.2:3000';
const DEFAULT_MODEL = process.env.AGENT_DEFAULT_MODEL || 'claude-haiku-4-5-20251001';
const CHECK_INTERVAL = parseInt(process.env.CHECK_INTERVAL || '300', 10) * 1000;
const NOTIFY_EMAIL = process.env.NOTIFY_EMAIL || process.env.SMTP_USER;

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

// ─── AI 分析 ─────────────────────────────────────────────────
async function analyzeEmail(subject, from, body) {
  const prompt = [
    '你是一个邮件助手。请对以下邮件进行分析：',
    '',
    `发件人：${from}`,
    `主题：${subject}`,
    `正文：`,
    body.substring(0, 3000), // 限制长度
    '',
    '请提供：1) 邮件摘要（50字以内）2) 重要程度（高/中/低）3) 建议回复要点',
  ].join('\n');

  try {
    const { body: respBody } = await request(`${AGENT_API_URL}/chat`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: [{ role: 'user', content: prompt }],
      }),
    });
    const data = await respBody.json();
    return data.reply || data.choices?.[0]?.message?.content || '分析失败';
  } catch (err) {
    logger.error('AI 分析失败', { err: err.message });
    return '分析服务暂不可用';
  }
}

// ─── 邮件检查 ────────────────────────────────────────────────
let lastCheck = new Date();

async function checkNewEmails() {
  const client = createImapClient();
  try {
    await client.connect();

    const lock = await client.getMailboxLock('INBOX');
    try {
      // 搜索上次检查后的新邮件
      const messages = client.fetch(
        { since: lastCheck },
        { source: true, envelope: true }
      );

      let count = 0;
      for await (const msg of messages) {
        const parsed = await simpleParser(msg.source);
        const subject = parsed.subject || '(无主题)';
        const from = parsed.from?.text || '(未知发件人)';
        const textBody = parsed.text || '';

        logger.info('新邮件', { subject, from });

        // AI 分析
        const analysis = await analyzeEmail(subject, from, textBody);
        logger.info('邮件分析完成', { subject, analysis: analysis.substring(0, 200) });

        // 将分析结果发送到通知邮箱
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

        count++;
      }

      if (count > 0) {
        logger.info(`共处理 ${count} 封新邮件`);
      }

      lastCheck = new Date();
    } finally {
      lock.release();
    }

    await client.logout();
  } catch (err) {
    logger.error('邮件检查失败', { err: err.message });
  }
}

// ─── 发送邮件 API ────────────────────────────────────────────
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

// 首次立即检查
checkNewEmails();

// 定时检查
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
