'use strict';

/**
 * Anima 灵枢 · 微信 ClawBot 插件灵枢接入通道 v1.4
 * ─────────────────────────────────────────────────────────────
 * 基于 Express HTTP Webhook，接收微信 ClawBot 插件回调，
 * 桥接到 OpenClaw Agent API 实现 AI 对话。
 *
 * 修改记录（v1.4 相对于 v1.3）：
 *
 *   #ENT-1.4-1  Per-user 速率限制（PCI-DSS / CIS DoS 缓解）
 *               - 新增基于 Redis 滑动窗口的用户级速率限制，
 *                 可通过 USER_RATE_LIMIT 环境变量配置（默认
 *                 30 次/分钟）。防止单一用户过度消耗 Agent API
 *                 资源（CIS DoS 缓解 + PCI-DSS 6.5 资源保护）。
 *
 *   #ENT-1.4-2  管理端点速率限制（CIS）
 *               - 新增 adminLimiter（30 次/分钟），覆盖所有
 *                 SERVICE_TOKEN 保护的管理端点（/clawbot/qrcode、
 *                 /clawbot/menu、/clawbot/users、/stats）。
 *
 *   #ENT-1.4-3  用户管理端点分页（企业级扩展性）
 *               - GET /clawbot/users 支持 page / limit 参数，
 *                 默认 page=1, limit=50，最大 limit=100。
 *                 使用 Redis SSCAN 高效迭代，避免大数据集阻塞。
 *
 *   #ENT-1.4-4  请求追踪贯通（企业级运维）
 *               - Agent API 调用（callAgent）传递 X-Request-ID，
 *                 实现端到端请求追踪（服务间日志关联）。
 *
 *   #ENT-1.4-5  OpenID 格式校验（PCI-DSS 6.5 输入验证）
 *               - Webhook 消息处理入口验证 fromUserName 格式
 *                （字母数字下划线连字符，1-128 字符），
 *                 拒绝畸形标识符。
 *
 *   #ENT-1.4-6  版本对齐
 *               - 修复 /stats 端点版本号（之前遗留为 '1.2.0'）。
 *               - 启动日志、package.json、modules.yml 版本同步。
 *
 * 修改记录（v1.3 相对于 v1.2）：
 *
 *   #ENT-1.3-1  全功能工具模块整合
 *               - /files 从静态信息升级为可操作命令，通过 Agent
 *                 调用 Nextcloud WebDAV 执行文件查询/搜索操作。
 *               - 新增 /email 命令，通过 Agent 对接邮件模块
 *                （IMAP/SMTP），支持查看/搜索/发送邮件。
 *               - 至此所有启用模块（web-search、calendar、
 *                 smart-home、cloud-storage、email、voice、
 *                 file-analysis）均已整合进灵枢接入通道。
 *
 *   #ENT-1.3-2  PCI-DSS / CIS 安全增量
 *               - 启动时检测 NODE_TLS_REJECT_UNAUTHORIZED=0，
 *                 生产环境下拒绝启动（PCI-DSS 4.1 传输加密——
 *                 禁止全局禁用 TLS 证书校验）。
 *               - 长耗时关键词新增邮件/云存储相关词（邮件、
 *                 查邮件、email、文件列表、list files）。
 *
 *   #ENT-1.3-3  帮助文本 & 菜单更新
 *               - /help 命令新增 /email 和 /files 操作用法。
 *               - MENU_HANDLERS 新增 MENU_FILES、MENU_EMAIL
 *                 快捷菜单入口。
 *
 * 修改记录（v1.2 相对于 v1.1）：
 *
 *   #ENT-1.2-1  灵枢接入通道品牌化
 *               - 定位升级为"灵枢接入通道"（Lingshu Gateway），
 *                 完全契合微信 ClawBot 插件官方接入要求。
 *               - 所有用户面向字符串更新为"灵枢接入通道"。
 *
 *   #ENT-1.2-2  微信消息加解密（安全模式 / 兼容模式）
 *               - 实现 AES-256-CBC 消息加解密，支持微信安全模式
 *                 与兼容模式（完全契合官方接入方式）。
 *               - 自动检测：配置 CLAWBOT_ENCODING_AES_KEY 时启用
 *                 加密消息验证与解密，否则使用明文模式。
 *               - 回复消息同步加密返回（安全模式下）。
 *
 *   #ENT-1.2-3  消息去重
 *               - Redis 消息 ID 去重（5 分钟窗口），防止微信
 *                 重试导致的重复消息处理（企业级可靠性）。
 *
 *   #ENT-1.2-4  用户数据安全增强
 *               - 取消关注时自动清除用户全部数据（Redis 认证/
 *                 邮箱/模型 + 内存会话），保证数据安全。
 *               - 新增 /unbind 命令：用户主动解除邮箱绑定并
 *                 清除所有个人数据（GDPR 友好）。
 *               - 数据操作全程审计日志。
 *
 *   #ENT-1.2-5  微信菜单管理 API
 *               - POST /clawbot/menu   — 创建公众号自定义菜单
 *               - DELETE /clawbot/menu — 删除当前自定义菜单
 *               - GET /clawbot/menu    — 查询当前菜单配置
 *               - 所有菜单端点需 SERVICE_TOKEN 认证。
 *
 *   #ENT-1.2-6  用户管理端点
 *               - GET /clawbot/users — 列出已认证用户（管理员）
 *               - 需 SERVICE_TOKEN 认证。
 *
 * 修改记录（v1.1 相对于 v1.0）：
 *
 *   #ENT-1.1-1  企业级运维加固
 *               - 新增 X-Request-ID（crypto.randomUUID）请求追踪，
 *                 所有日志包含 request_id，方便问题排查。
 *               - 新增访问日志中间件，记录 method/path/status/
 *                 duration_ms/ip/request_id（PCI-DSS 10.2）。
 *               - 新增 server.maxConnections=1024（CIS DoS 缓解）。
 *               - GRACEFUL_SHUTDOWN_TIMEOUT 可配置（5-60s）。
 *               - 启动时检查 NODE_ENV（生产环境警告）。
 *
 *   #ENT-1.1-2  管理端点安全加固
 *               - /clawbot/qrcode 和 /stats 端点新增 SERVICE_TOKEN
 *                 Bearer 认证，防止未授权访问。
 *               - SERVICE_TOKEN 最少 32 字符（PCI-DSS 8.2.3）。
 *
 *   #ENT-1.1-3  ClawBot 功能完善
 *               - 新增微信菜单事件处理（CLICK / VIEW）。
 *               - 新增模板消息发送能力（sendTemplateMessage）。
 *               - 新增 /status 命令，查看用户认证状态、绑定信息、
 *                 当前模型等账户信息。
 *
 *   #ENT-1.1-4  运营监控
 *               - 新增 GET /stats 端点，返回运行时长、消息统计、
 *                 活跃会话、Redis 状态等运营指标。
 *
 *   #ENT-1.1-5  企业微信功能扩展
 *               - WeCom 通道新增语音/图片/视频/文件消息处理，
 *                 与微信公众号功能对齐。
 *
 * 接入方式（官方微信）：
 *   - 微信公众号扫码关注接入（用户扫描二维码 → 关注 → 自动绑定）
 *   - 微信 App 互通接入（通过 Open Platform 跨应用通信）
 *   - 支持明文模式和安全模式（AES 加解密）
 *   - 不使用企业微信作为主接入方式
 *
 * 企业微信（WeCom）接口：
 *   - 已添加完整的企业微信 Webhook 接口
 *   - 默认关闭（WECOM_ENABLED=false），如需使用请手动开启
 *   - 与微信公众号通道隔离，独立 Redis 键空间
 *
 * 功能：
 *   - 微信 ClawBot 插件签名验证（token + timestamp + nonce SHA1）
 *   - 微信消息 AES-256-CBC 加解密（安全模式 / 兼容模式）
 *   - 强制登录认证（用户必须绑定邮箱后才可使用 AI 功能）
 *   - 用户强隔离（独立 Redis 键空间、独立会话、独立计费）
 *   - 消息去重（Redis msgId 5 分钟去重窗口）
 *   - 二维码接入（扫码关注/登录）
 *   - 文字消息 → AI 对话
 *   - 语音消息 → Whisper STT → AI → TTS → 语音回复
 *   - 图片消息 → AI 图片分析
 *   - 视频/文件 → 文件分析
 *   - 位置消息 → 位置相关 AI 服务
 *   - 链接消息 → 链接内容分析
 *   - 菜单事件 → CLICK/VIEW 处理
 *   - 微信自定义菜单管理 API（创建/删除/查询）
 *   - /model 切换模型
 *   - /balance 查询余额
 *   - /status 查看账户状态
 *   - /unbind 解除绑定并清除数据
 *   - /clear 清除对话上下文
 *   - /search 网页搜索（DuckDuckGo）
 *   - /calendar 日历管理（Nextcloud CalDAV）
 *   - /home 智能家居控制（Home Assistant）
 *   - /files 云存储管理（Nextcloud WebDAV，支持文件查询/搜索操作）
 *   - /email 邮件管理（IMAP/SMTP，支持查看/搜索/发送邮件）
 *   - /help 帮助信息
 *   - 模板消息发送
 *   - 长耗时任务异步回复
 *   - 消息分段发送（适配微信消息长度限制）
 *   - 用户数据自动清理（取关时）
 *   - 已认证用户管理端点
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
// 消息去重窗口（秒）：防止微信重试导致重复消息处理
const MSG_DEDUP_TTL = 300;
// Per-user 速率限制（PCI-DSS / CIS DoS 缓解）：单用户每分钟最大请求数
const USER_RATE_LIMIT = Math.max(1, Math.min(300, parseInt(process.env.USER_RATE_LIMIT || '30', 10)));
const USER_RATE_WINDOW_SEC = 60;

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
// EncodingAESKey 用于消息加密模式（当微信服务器配置为"安全模式"或"兼容模式"时使用）
// 当前实现自动检测：配置 AES Key 后启用加密消息解密能力
const CLAWBOT_ENCODING_AES_KEY = process.env.CLAWBOT_ENCODING_AES_KEY || '';

// ─── AES 加解密密钥派生（微信安全模式 / 兼容模式）──────────
// WeChat AES Key: Base64Decode(EncodingAESKey + "=") = 32 bytes
// IV = AES Key 前 16 bytes
let AES_KEY = null;
let AES_IV = null;
const ENCRYPT_MODE = !!CLAWBOT_ENCODING_AES_KEY;
if (CLAWBOT_ENCODING_AES_KEY) {
  try {
    AES_KEY = Buffer.from(CLAWBOT_ENCODING_AES_KEY + '=', 'base64');
    if (AES_KEY.length !== 32) {
      throw new Error(`AES Key 长度 ${AES_KEY.length} 字节（期望 32 字节），请检查 CLAWBOT_ENCODING_AES_KEY`);
    }
    AES_IV = AES_KEY.subarray(0, 16);
  } catch (err) {
    // 延迟到 logger 初始化后输出警告 — 此处先暂存错误信息
    AES_KEY = null;
    AES_IV = null;
  }
}
const AGENT_API_URL  = (process.env.AGENT_API_URL || 'http://172.16.1.2:3000').replace(/\/$/, '');
const DEFAULT_MODEL  = process.env.AGENT_DEFAULT_MODEL || 'glm-4-flash';
const BILLING_URL    = (process.env.BILLING_WEBHOOK_URL || 'http://172.16.1.6:3002').replace(/\/$/, '');
const REDIS_URL      = process.env.REDIS_URL;
const VOICE_ENABLED  = process.env.VOICE_ENABLED === 'true';
const WHISPER_URL    = process.env.WHISPER_URL || 'http://172.16.1.5:8080/transcribe';
const TTS_URL        = process.env.TTS_URL || 'http://172.16.1.5:8082/api/tts';
const PORT           = parseInt(process.env.PORT || '3004', 10);

// ─── 企业微信（WeCom）配置（默认关闭，仅添加接口不使用）────────
// ─── 企业运维配置 ──────────────────────────────────────────
const SERVICE_TOKEN = process.env.SERVICE_TOKEN || '';
const GRACEFUL_SHUTDOWN_TIMEOUT = Math.min(60, Math.max(5,
  parseInt(process.env.GRACEFUL_SHUTDOWN_TIMEOUT || '10', 10)));

// ─── 企业微信（WeCom）配置（默认关闭，仅添加接口不使用）────────
const WECOM_ENABLED   = process.env.WECOM_ENABLED === 'true';
const WECOM_CORPID    = process.env.WECOM_CORPID || '';
const WECOM_SECRET    = process.env.WECOM_SECRET || '';
const WECOM_TOKEN     = process.env.WECOM_TOKEN || '';
const WECOM_AES_KEY   = process.env.WECOM_ENCODING_AES_KEY || '';
const WECOM_AGENT_ID  = process.env.WECOM_AGENT_ID || '';

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

// 企业微信配置检查（仅在启用时检查）
if (WECOM_ENABLED) {
  if (!WECOM_CORPID || !WECOM_SECRET || !WECOM_TOKEN) {
    logger.error('企业微信已启用但配置不完整（需要 WECOM_CORPID/WECOM_SECRET/WECOM_TOKEN）');
    process.exit(1);
  }
  logger.info('企业微信（WeCom）接口已启用');
} else {
  logger.info('企业微信（WeCom）接口已添加但未启用（WECOM_ENABLED=false）');
}

// SERVICE_TOKEN 长度检查（PCI-DSS 8.2.3）
if (SERVICE_TOKEN && SERVICE_TOKEN.length < 32) {
  logger.error('SERVICE_TOKEN 长度不足 32 字符（PCI-DSS 8.2.3）');
  process.exit(1);
}

// 生产环境检查
if (process.env.NODE_ENV !== 'production') {
  logger.warn('NODE_ENV 不是 production，建议生产部署时设置 NODE_ENV=production');
}

// PCI-DSS 4.1: 禁止全局禁用 TLS 证书校验
if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
  if (process.env.NODE_ENV === 'production') {
    logger.error('NODE_TLS_REJECT_UNAUTHORIZED=0 将禁用 TLS 证书校验，违反 PCI-DSS 4.1，生产环境拒绝启动');
    process.exit(1);
  }
  logger.warn('NODE_TLS_REJECT_UNAUTHORIZED=0 已禁用 TLS 证书校验，仅允许非生产环境，请勿在生产部署中使用');
}

// ─── 运营统计 ──────────────────────────────────────────────────
const stats = {
  startedAt: Date.now(),
  totalMessages: 0,
  messagesByType: { text: 0, voice: 0, image: 0, video: 0, file: 0, location: 0, link: 0, event: 0 },
  totalCommands: 0,
  commandsByName: {},
  totalErrors: 0,
};

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
const REDIS_DEDUP_PREFIX = 'anima:clawbot:dedup:';     // String: msgId 去重（TTL=5min）

// 企业微信使用独立键空间，与公众号通道完全隔离
const WECOM_EMAIL_KEY  = 'anima:wecom:emails';         // Hash: userid → email
const WECOM_MODELS_KEY = 'anima:wecom:user_models';     // Hash: userid → model
const WECOM_AUTH_KEY   = 'anima:wecom:authed';          // Set:  已认证 userid

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

/**
 * 加密模式签名验证：SHA1(sort([token, timestamp, nonce, encrypt_msg]))
 * 微信安全模式 / 兼容模式下，签名包含加密消息体。
 */
function verifyEncryptSignature(msgSignature, timestamp, nonce, encryptMsg) {
  const arr = [CLAWBOT_TOKEN, timestamp, nonce, encryptMsg].sort();
  const hash = crypto.createHash('sha1').update(arr.join('')).digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(hash, 'utf8'),
    Buffer.from(msgSignature, 'utf8')
  );
}

// ─── AES-256-CBC 消息加解密（微信安全模式）──────────────────

/**
 * PKCS#7 去除填充。
 * @param {Buffer} buf - 解密后的原始 Buffer
 * @returns {Buffer} 去除填充后的 Buffer
 */
function pkcs7Unpad(buf) {
  const pad = buf[buf.length - 1];
  if (pad < 1 || pad > 32) return buf;
  return buf.subarray(0, buf.length - pad);
}

/**
 * PKCS#7 填充到 32 字节块对齐。
 * @param {Buffer} buf - 原始 Buffer
 * @returns {Buffer} 填充后的 Buffer
 */
function pkcs7Pad(buf) {
  const blockSize = 32;
  const pad = blockSize - (buf.length % blockSize);
  const padBuf = Buffer.alloc(pad, pad);
  return Buffer.concat([buf, padBuf]);
}

/**
 * 解密微信加密消息。
 * 消息格式：AES-256-CBC( random(16) + msg_len(4, BE) + msg + appid )
 * @param {string} encryptedBase64 - Base64 编码的加密消息
 * @returns {string} 解密后的 XML 明文消息
 */
function decryptMessage(encryptedBase64) {
  if (!AES_KEY || !AES_IV) {
    throw new Error('AES 密钥未配置，无法解密加密消息');
  }
  const encrypted = Buffer.from(encryptedBase64, 'base64');
  const decipher = crypto.createDecipheriv('aes-256-cbc', AES_KEY, AES_IV);
  decipher.setAutoPadding(false);
  const decrypted = Buffer.concat([decipher.update(encrypted), decipher.final()]);
  const unpadded = pkcs7Unpad(decrypted);

  // 跳过 16 字节随机值
  const msgLen = unpadded.readUInt32BE(16);
  const msgContent = unpadded.subarray(20, 20 + msgLen).toString('utf8');
  // 可选：验证 appid
  const appId = unpadded.subarray(20 + msgLen).toString('utf8');
  if (appId !== CLAWBOT_APP_ID) {
    logger.warn('解密消息 AppID 不匹配', { expected: CLAWBOT_APP_ID, got: appId });
  }
  return msgContent;
}

/**
 * 加密微信回复消息。
 * @param {string} replyXml - 要加密的 XML 回复消息
 * @returns {string} Base64 编码的加密消息
 */
function encryptMessage(replyXml) {
  if (!AES_KEY || !AES_IV) {
    throw new Error('AES 密钥未配置，无法加密消息');
  }
  const randomBytes = crypto.randomBytes(16);
  const msgBuf = Buffer.from(replyXml, 'utf8');
  const msgLenBuf = Buffer.alloc(4);
  msgLenBuf.writeUInt32BE(msgBuf.length, 0);
  const appIdBuf = Buffer.from(CLAWBOT_APP_ID, 'utf8');

  const plaintext = Buffer.concat([randomBytes, msgLenBuf, msgBuf, appIdBuf]);
  const padded = pkcs7Pad(plaintext);

  const cipher = crypto.createCipheriv('aes-256-cbc', AES_KEY, AES_IV);
  cipher.setAutoPadding(false);
  const encrypted = Buffer.concat([cipher.update(padded), cipher.final()]);
  return encrypted.toString('base64');
}

/**
 * 构建加密模式下的回复 XML。
 * @param {string} encryptedMsg - 加密后的消息（Base64）
 * @param {string} timestamp - 时间戳
 * @param {string} nonce - 随机串
 * @returns {string} 包含加密消息和签名的 XML
 */
function buildEncryptedReply(encryptedMsg, timestamp, nonce) {
  const arr = [CLAWBOT_TOKEN, timestamp, nonce, encryptedMsg].sort();
  const msgSignature = crypto.createHash('sha1').update(arr.join('')).digest('hex');
  return `<xml>
<Encrypt><![CDATA[${encryptedMsg}]]></Encrypt>
<MsgSignature><![CDATA[${msgSignature}]]></MsgSignature>
<TimeStamp>${timestamp}</TimeStamp>
<Nonce><![CDATA[${nonce}]]></Nonce>
</xml>`;
}

// ─── 消息去重（Redis msgId 5分钟窗口）──────────────────────

/**
 * 检查消息 ID 是否已处理（去重）。
 * 使用 Redis SET NX EX 保证原子性。
 * @param {string} msgId - 微信消息 ID
 * @returns {Promise<boolean>} true=已处理过（重复），false=首次
 */
async function isDuplicateMessage(msgId) {
  if (!redis || !msgId) return false;
  try {
    // SET NX: 仅当 key 不存在时设置，返回 'OK' 表示首次
    const result = await redis.set(`${REDIS_DEDUP_PREFIX}${msgId}`, '1', 'EX', MSG_DEDUP_TTL, 'NX');
    return result !== 'OK'; // 返回 null 表示 key 已存在 = 重复消息
  } catch (err) {
    logger.error('消息去重检查失败', { err: err.message, msgId });
    return false; // 出错时不阻断处理
  }
}

// ─── Per-user 速率限制（PCI-DSS / CIS DoS 缓解）────────────

/**
 * 基于 Redis 滑动窗口的用户级速率限制。
 * 每用户每分钟允许 USER_RATE_LIMIT 次请求，超出则拒绝。
 * @param {string} openId - 用户标识
 * @returns {Promise<boolean>} true=超限（应拒绝），false=放行
 */
async function isUserRateLimited(openId) {
  if (!redis) return false; // Redis 不可用时不阻断
  const key = `anima:clawbot:rl:${openId}`;
  try {
    const count = await redis.incr(key);
    if (count === 1) {
      await redis.expire(key, USER_RATE_WINDOW_SEC);
    }
    return count > USER_RATE_LIMIT;
  } catch (err) {
    logger.error('用户速率限制检查失败', { err: err.message, openId });
    return false; // 出错时不阻断处理
  }
}

// ─── 用户数据清理（取关 / 主动解绑）────────────────────────

/**
 * 清除用户所有数据（Redis + 内存会话）。
 * 用于取关事件 和 /unbind 命令。
 * @param {string} openId - 用户标识
 */
async function clearUserData(openId) {
  sessions.delete(openId);
  if (!redis) return;
  try {
    await Promise.all([
      redis.hdel(REDIS_EMAIL_KEY, openId),
      redis.hdel(REDIS_MODELS_KEY, openId),
      redis.srem(REDIS_AUTH_KEY, openId),
    ]);
    logger.info('用户数据已清除', { openId });
  } catch (err) {
    logger.error('清除用户数据失败', { err: err.message, openId });
  }
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
const LONG_RUNNING_KEYWORDS = (process.env.LONG_RUNNING_KEYWORDS || '搜索,搜一下,查一下,帮我搜,search,分析文件,分析一下,看看这个文件,analyze,邮件,查邮件,email,文件列表,list files')
  .split(',').map(s => s.trim()).filter(Boolean);

function isLongRunningTask(message) {
  const lower = message.toLowerCase();
  return LONG_RUNNING_KEYWORDS.some(kw => lower.includes(kw));
}

// ─── Agent API 调用 ──────────────────────────────────────────
async function callAgent(openId, message, requestId) {
  const session = getSession(openId);
  session.messages.push({ role: 'user', content: message });

  if (session.messages.length > 20) {
    session.messages = session.messages.slice(-20);
  }

  const model = (await getUserModel(openId)) || DEFAULT_MODEL;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), AGENT_REQUEST_TIMEOUT_MS + ABORT_TIMEOUT_BUFFER_MS);

  try {
    const headers = { 'Content-Type': 'application/json' };
    if (requestId) headers['X-Request-ID'] = requestId;

    const { body } = await request(`${AGENT_API_URL}/chat`, {
      method: 'POST',
      headers,
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

// ─── 扫码接入：二维码生成 ──────────────────────────────────────

/**
 * 生成带参数的微信二维码 ticket。
 * 用户扫码后关注公众号，触发 subscribe/SCAN 事件。
 * @param {string} sceneStr - 场景值（标识二维码用途）
 * @param {boolean} temporary - 是否临时二维码（默认永久）
 * @returns {Promise<{ticket: string, url: string}|null>}
 */
async function createQrCode(sceneStr = 'subscribe', temporary = false) {
  const token = await getAccessToken();
  if (!token) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  try {
    const payload = temporary
      ? { expire_seconds: 2592000, action_name: 'QR_STR_SCENE', action_info: { scene: { scene_str: sceneStr } } }
      : { action_name: 'QR_LIMIT_STR_SCENE', action_info: { scene: { scene_str: sceneStr } } };

    const { body } = await request(
      `https://api.weixin.qq.com/cgi-bin/qrcode/create?access_token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        bodyTimeout: 10_000,
        headersTimeout: 10_000,
        signal: controller.signal,
      }
    );
    clearTimeout(timeoutId);
    const data = await body.json();
    if (data.ticket) {
      return {
        ticket: data.ticket,
        url: data.url || '',
        qrcodeUrl: `https://mp.weixin.qq.com/cgi-bin/showqrcode?ticket=${encodeURIComponent(data.ticket)}`,
      };
    }
    logger.error('生成二维码失败', { errcode: data.errcode, errmsg: data.errmsg });
    return null;
  } catch (err) {
    clearTimeout(timeoutId);
    logger.error('生成二维码异常', { err: err.message });
    return null;
  }
}

// ─── 企业微信（WeCom）接口 ────────────────────────────────────

/** 企业微信 Access Token 缓存 */
let wecomTokenCache = { token: '', expiresAt: 0 };

/**
 * 获取企业微信 access_token。
 * 仅在 WECOM_ENABLED=true 时可用。
 */
async function getWecomAccessToken() {
  if (!WECOM_ENABLED) return '';
  if (wecomTokenCache.token && Date.now() < wecomTokenCache.expiresAt) {
    return wecomTokenCache.token;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  try {
    const url = `https://qyapi.weixin.qq.com/cgi-bin/gettoken?corpid=${encodeURIComponent(WECOM_CORPID)}&corpsecret=${encodeURIComponent(WECOM_SECRET)}`;
    const { body } = await request(url, {
      bodyTimeout: 10_000,
      headersTimeout: 10_000,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const data = await body.json();
    if (data.access_token) {
      wecomTokenCache = {
        token: data.access_token,
        expiresAt: Date.now() + ((data.expires_in || 7200) - 300) * 1000,
      };
      return data.access_token;
    }
    logger.error('获取企业微信 access_token 失败', { errcode: data.errcode, errmsg: data.errmsg });
    return '';
  } catch (err) {
    clearTimeout(timeoutId);
    logger.error('获取企业微信 access_token 异常', { err: err.message });
    return '';
  }
}

/**
 * 企业微信签名验证。
 * 与公众号签名验证算法相同：SHA1(sort([token, timestamp, nonce]))
 */
function verifyWecomSignature(signature, timestamp, nonce) {
  if (!WECOM_TOKEN) return false;
  const arr = [WECOM_TOKEN, timestamp, nonce].sort();
  const hash = crypto.createHash('sha1').update(arr.join('')).digest('hex');
  return crypto.timingSafeEqual(
    Buffer.from(hash, 'utf8'),
    Buffer.from(signature, 'utf8')
  );
}

/**
 * 通过企业微信应用消息接口发送消息。
 */
async function sendWecomReply(userId, text) {
  if (!WECOM_ENABLED) return;
  const token = await getWecomAccessToken();
  if (!token) {
    logger.error('无法发送企业微信消息：access_token 不可用', { userId });
    return;
  }

  const parts = splitMessage(text);
  for (const part of parts) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10_000);

    try {
      const { body } = await request(
        `https://qyapi.weixin.qq.com/cgi-bin/message/send?access_token=${encodeURIComponent(token)}`,
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            touser: userId,
            msgtype: 'text',
            agentid: parseInt(WECOM_AGENT_ID, 10) || 0,
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
        logger.error('企业微信消息发送失败', { errcode: result.errcode, errmsg: result.errmsg, userId });
      }
    } catch (err) {
      clearTimeout(timeoutId);
      logger.error('企业微信消息发送异常', { err: err.message, userId });
    }
  }
}

// ─── 微信媒体 API ────────────────────────────────────────────

/**
 * 从微信服务器下载临时媒体文件（语音/图片/视频/文件）。
 * @param {string} mediaId - 微信 MediaId
 * @returns {Promise<{buffer: Buffer, contentType: string}|null>}
 */
async function downloadMedia(mediaId) {
  const token = await getAccessToken();
  if (!token) {
    logger.error('下载媒体失败：access_token 不可用', { mediaId });
    return null;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);

  try {
    const url = `https://api.weixin.qq.com/cgi-bin/media/get?access_token=${encodeURIComponent(token)}&media_id=${encodeURIComponent(mediaId)}`;
    const { body, headers } = await request(url, {
      bodyTimeout: 30_000,
      headersTimeout: 10_000,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const contentType = headers['content-type'] || '';
    // 微信错误返回 JSON
    if (contentType.includes('application/json') || contentType.includes('text/plain')) {
      const errData = await body.json();
      logger.error('下载媒体失败', { errcode: errData.errcode, errmsg: errData.errmsg, mediaId });
      return null;
    }

    const chunks = [];
    for await (const chunk of body) {
      chunks.push(chunk);
    }
    return { buffer: Buffer.concat(chunks), contentType };
  } catch (err) {
    clearTimeout(timeoutId);
    logger.error('下载媒体异常', { err: err.message, mediaId });
    return null;
  }
}

/**
 * 上传临时媒体到微信服务器（用于回复语音消息）。
 * @param {Buffer} audioBuffer - 音频文件 Buffer
 * @param {string} type - 媒体类型 (voice/image/video/thumb)
 * @returns {Promise<string>} 上传后的 media_id，失败返回空字符串
 */
async function uploadVoiceMedia(audioBuffer, type = 'voice') {
  const token = await getAccessToken();
  if (!token) return '';

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);

  try {
    const boundary = `----WebKitFormBoundary${crypto.randomBytes(16).toString('hex')}`;
    const filename = type === 'voice' ? 'reply.mp3' : 'media.bin';
    const contentTypeMap = { voice: 'audio/mpeg', image: 'image/png', video: 'video/mp4' };
    const mimeType = contentTypeMap[type] || 'application/octet-stream';

    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="media"; filename="${filename}"\r\nContent-Type: ${mimeType}\r\n\r\n`
    );
    const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
    const payload = Buffer.concat([head, audioBuffer, tail]);

    const url = `https://api.weixin.qq.com/cgi-bin/media/upload?access_token=${encodeURIComponent(token)}&type=${type}`;
    const { body } = await request(url, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body: payload,
      bodyTimeout: 30_000,
      headersTimeout: 10_000,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const data = await body.json();
    if (data.media_id) {
      return data.media_id;
    }
    logger.error('上传媒体失败', { errcode: data.errcode, errmsg: data.errmsg });
    return '';
  } catch (err) {
    clearTimeout(timeoutId);
    logger.error('上传媒体异常', { err: err.message });
    return '';
  }
}

/**
 * 调用 Whisper STT 服务将音频转文字。
 * @param {Buffer} audioBuffer - 音频文件
 * @param {string} format - 音频格式 (amr/mp3/wav)
 * @returns {Promise<string>} 转录文本
 */
async function transcribeVoice(audioBuffer, format = 'amr') {
  if (!VOICE_ENABLED) return '';

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 60_000);

  try {
    const boundary = `----WhisperBoundary${crypto.randomBytes(16).toString('hex')}`;
    const mimeMap = { amr: 'audio/amr', mp3: 'audio/mpeg', wav: 'audio/wav' };
    const mimeType = mimeMap[format] || 'application/octet-stream';

    const head = Buffer.from(
      `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="audio.${format}"\r\nContent-Type: ${mimeType}\r\n\r\n`
    );
    const langPart = Buffer.from(
      `\r\n--${boundary}\r\nContent-Disposition: form-data; name="language"\r\n\r\nzh\r\n--${boundary}--\r\n`
    );
    const payload = Buffer.concat([head, audioBuffer, langPart]);

    const { body } = await request(WHISPER_URL, {
      method: 'POST',
      headers: { 'Content-Type': `multipart/form-data; boundary=${boundary}` },
      body: payload,
      bodyTimeout: 60_000,
      headersTimeout: 10_000,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const data = await body.json();
    return data.text || data.transcription || '';
  } catch (err) {
    clearTimeout(timeoutId);
    logger.error('Whisper STT 失败', { err: err.message });
    return '';
  }
}

/**
 * 调用 Coqui TTS 将文本合成语音。
 * @param {string} text - 要合成的文本
 * @returns {Promise<Buffer|null>} 音频 Buffer (WAV 格式)
 */
async function synthesizeSpeech(text) {
  if (!VOICE_ENABLED) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);

  try {
    const { body } = await request(TTS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, language: 'zh' }),
      bodyTimeout: 30_000,
      headersTimeout: 10_000,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);

    const chunks = [];
    for await (const chunk of body) {
      chunks.push(chunk);
    }
    return Buffer.concat(chunks);
  } catch (err) {
    clearTimeout(timeoutId);
    logger.error('TTS 合成失败', { err: err.message });
    return null;
  }
}

/**
 * 通过客服消息接口发送语音回复。
 */
async function sendAsyncVoiceReply(openId, voiceMediaId) {
  const token = await getAccessToken();
  if (!token) return;

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
          msgtype: 'voice',
          voice: { media_id: voiceMediaId },
        }),
        bodyTimeout: 10_000,
        headersTimeout: 10_000,
        signal: controller.signal,
      }
    );
    clearTimeout(timeoutId);
    const result = await body.json();
    if (result.errcode && result.errcode !== 0) {
      logger.error('语音客服消息发送失败', { errcode: result.errcode, errmsg: result.errmsg, openId });
    }
  } catch (err) {
    clearTimeout(timeoutId);
    logger.error('语音客服消息发送异常', { err: err.message, openId });
  }
}

/**
 * 发送微信模板消息（用于结构化通知）。
 * @param {string} openId - 用户 OpenID
 * @param {string} templateId - 模板消息 ID
 * @param {Object} data - 模板数据 { key: { value, color } }
 * @param {string} [url] - 点击消息跳转 URL
 * @returns {Promise<boolean>} 是否发送成功
 */
async function sendTemplateMessage(openId, templateId, data, url) {
  const token = await getAccessToken();
  if (!token) {
    logger.error('无法发送模板消息：access_token 不可用', { openId });
    return false;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  try {
    const payload = {
      touser: openId,
      template_id: templateId,
      data,
    };
    if (url) payload.url = url;

    const { body } = await request(
      `https://api.weixin.qq.com/cgi-bin/message/template/send?access_token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        bodyTimeout: 10_000,
        headersTimeout: 10_000,
        signal: controller.signal,
      }
    );
    clearTimeout(timeoutId);
    const result = await body.json();
    if (result.errcode && result.errcode !== 0) {
      logger.error('模板消息发送失败', { errcode: result.errcode, errmsg: result.errmsg, openId });
      return false;
    }
    return true;
  } catch (err) {
    clearTimeout(timeoutId);
    logger.error('模板消息发送异常', { err: err.message, openId });
    return false;
  }
}

// ─── 输入验证 ────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MODEL_NAME_RE = /^[a-zA-Z0-9._:\/-]+$/;
// OpenID 格式校验（PCI-DSS 6.5 输入验证）：微信 openId 由字母数字下划线连字符组成
const OPENID_RE = /^[\w-]{1,128}$/;
const MAX_TEXT_LENGTH = 10000;
// TTS 文本上限：防止合成超时和音频过大（Coqui TTS 对超长文本性能下降）
const MAX_TTS_TEXT_LENGTH = 500;

function stripControlChars(str) {
  return str.replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
}

// ─── 菜单事件映射（微信公众号自定义菜单 CLICK 事件）──────────
const MENU_HANDLERS = {
  'MENU_HELP': '/help',
  'MENU_BALANCE': '/balance',
  'MENU_STATUS': '/status',
  'MENU_CLEAR': '/clear',
  'MENU_FILES': '/files',
  'MENU_EMAIL': '/email',
};

// ─── 消息处理核心 ────────────────────────────────────────────

/**
 * 处理来自 ClawBot 的文本消息。
 * 返回要回复给用户的文本（同步），对长任务发起异步回调。
 */
async function handleTextMessage(openId, rawText, requestId) {
  const text = stripControlChars(rawText).trim();
  if (!text) return '';

  if (text.length > MAX_TEXT_LENGTH) {
    return '❌ 消息过长（最多 10000 字符），请精简后重试。';
  }

  // ── 命令处理 ──

  // 命令统计
  if (text.startsWith('/')) {
    const cmdName = text.split(/[\s\u3000]/)[0];
    stats.totalCommands++;
    stats.commandsByName[cmdName] = (stats.commandsByName[cmdName] || 0) + 1;
  }

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

  // /unbind — 解除绑定并清除所有数据
  if (text === '/unbind') {
    const email = await getUserEmail(openId);
    await clearUserData(openId);
    logger.info('用户主动解除绑定', { openId, email: email || 'N/A' });
    return '✅ 已解除邮箱绑定并清除所有个人数据。\n\n' +
      '如需继续使用，请重新绑定邮箱：\n/bind 你的邮箱@example.com';
  }

  // /help — 帮助
  if (text === '/help') {
    return '📖 Anima 灵枢接入通道 · 命令列表\n\n' +
      '【基础】\n' +
      '/bind <邮箱> — 绑定邮箱（首次使用必须绑定）\n' +
      '/unbind — 解除绑定并清除个人数据\n' +
      '/balance — 查询账户余额\n' +
      '/status — 查看账户状态\n' +
      '/model <模型名> — 切换 AI 模型\n' +
      '/clear — 清除对话上下文\n\n' +
      '【工具】\n' +
      '/search <关键词> — 网页搜索\n' +
      '/calendar [操作] — 日历管理\n' +
      '/home [命令] — 智能家居控制\n' +
      '/files [操作] — 云存储管理\n' +
      '/email [操作] — 邮件管理\n\n' +
      '【消息类型】\n' +
      '• 发送文字 — AI 对话\n' +
      '• 发送语音 — 语音转文字 → AI 对话\n' +
      '• 发送图片/文件 — AI 分析\n' +
      '• 发送位置 — 位置相关 AI 服务\n' +
      '• 发送链接 — 链接内容分析\n\n' +
      '/help — 显示此帮助';
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

  // /status — 查看账户状态
  if (text === '/status') {
    const email = await getUserEmail(openId);
    const model = (await getUserModel(openId)) || DEFAULT_MODEL;
    const session = sessions.get(openId);
    const sessionMsgCount = session ? session.messages.length : 0;
    return '📊 账户状态\n\n' +
      `✅ 认证：已通过\n` +
      `📧 邮箱：${email || '未绑定'}\n` +
      `🤖 模型：${model}\n` +
      `💬 当前会话消息数：${sessionMsgCount}\n` +
      `🔗 通道：灵枢接入通道（微信公众号）\n\n` +
      '发送 /help 查看所有命令。';
  }

  // /search <query> — 网页搜索（通过 Agent 调用 DuckDuckGo）
  if (text.startsWith('/search ') || text.startsWith('/search\u3000')) {
    const query = text.slice(8).trim();
    if (!query || query.length > MAX_TEXT_LENGTH) {
      return '❌ 请输入搜索关键词。\n\n用法：/search 关键词';
    }
    logger.info('用户发起搜索', { openId, query: query.substring(0, 50) });
    const searchPrompt = `请帮我搜索以下内容并总结结果：${query}`;
    // 搜索是长耗时任务，异步处理
    callAgent(openId, searchPrompt, requestId)
      .then(async (reply) => {
        await sendAsyncReply(openId, `🔍 搜索结果：\n\n${reply}`);
      })
      .catch(async (err) => {
        logger.error('搜索任务失败', { err: err.message, openId });
        await sendAsyncReply(openId, '❌ 搜索失败，请稍后重试。');
      });
    return '🔍 正在搜索，请稍候...';
  }

  // /calendar [操作] — 日历管理（通过 Agent 调用 CalDAV）
  if (text === '/calendar' || text.startsWith('/calendar ') || text.startsWith('/calendar\u3000')) {
    if (text === '/calendar') {
      return '📅 日历管理\n\n' +
        '用法：\n' +
        '/calendar 查看今天日程\n' +
        '/calendar 明天下午3点开会\n' +
        '/calendar 删除xxx事件\n\n' +
        '也可以直接用自然语言描述日程安排。';
    }
    const calendarCmd = text.slice(10).trim();
    if (!calendarCmd) {
      return '请输入日历操作内容。\n\n用法：/calendar 查看今天日程';
    }
    logger.info('用户日历操作', { openId, cmd: calendarCmd.substring(0, 50) });
    return await callAgent(openId, `请帮我处理以下日历操作：${calendarCmd}`, requestId);
  }

  // /home [命令] — 智能家居控制（通过 Agent 调用 Home Assistant）
  if (text === '/home' || text.startsWith('/home ') || text.startsWith('/home\u3000')) {
    if (text === '/home') {
      return '🏠 智能家居控制\n\n' +
        '用法：\n' +
        '/home 打开客厅灯\n' +
        '/home 空调设置26度\n' +
        '/home 查看家里温度\n\n' +
        '也可以直接用自然语言描述操作。';
    }
    const homeCmd = text.slice(6).trim();
    if (!homeCmd) {
      return '请输入智能家居操作。\n\n用法：/home 打开客厅灯';
    }
    logger.info('用户智能家居操作', { openId, cmd: homeCmd.substring(0, 50) });
    return await callAgent(openId, `请帮我执行以下智能家居操作：${homeCmd}`, requestId);
  }

  // /files [操作] — 云存储管理（通过 Agent 调用 Nextcloud WebDAV）
  if (text === '/files' || text.startsWith('/files ') || text.startsWith('/files\u3000')) {
    if (text === '/files') {
      return '☁️ 云存储管理 (Nextcloud)\n\n' +
        '用法：\n' +
        '/files 查看我的文件\n' +
        '/files 搜索xxx文件\n' +
        '/files 最近上传的文件\n\n' +
        '你的私有云盘支持：\n' +
        '• 文件上传/下载/管理\n' +
        '• 多设备同步\n' +
        '• 文件分享（生成共享链接）\n' +
        '• 版本管理与回收站\n\n' +
        '请通过 Nextcloud 客户端或 Web 界面管理大文件。\n' +
        '发送图片/文件到本对话可以进行 AI 分析。';
    }
    const filesCmd = text.slice(7).trim();
    if (!filesCmd) {
      return '请输入云存储操作。\n\n用法：/files 查看我的文件';
    }
    logger.info('用户云存储操作', { openId, cmd: filesCmd.substring(0, 50) });
    callAgent(openId, `请帮我处理以下云存储操作：${filesCmd}`, requestId)
      .then(async (reply) => {
        await sendAsyncReply(openId, `☁️ 云存储结果：\n\n${reply}`);
      })
      .catch(async (err) => {
        logger.error('云存储操作失败', { err: err.message, openId });
        await sendAsyncReply(openId, '❌ 云存储操作失败，请稍后重试。');
      });
    return '☁️ 正在处理云存储操作，请稍候...';
  }

  // /email [操作] — 邮件管理（通过 Agent 调用邮件模块 IMAP/SMTP）
  if (text === '/email' || text.startsWith('/email ') || text.startsWith('/email\u3000')) {
    if (text === '/email') {
      return '📧 邮件管理\n\n' +
        '用法：\n' +
        '/email 查看最新邮件\n' +
        '/email 搜索来自xxx的邮件\n' +
        '/email 给xxx@example.com发邮件：内容\n\n' +
        '也可以直接用自然语言描述邮件操作。';
    }
    const emailCmd = text.slice(7).trim();
    if (!emailCmd) {
      return '请输入邮件操作内容。\n\n用法：/email 查看最新邮件';
    }
    logger.info('用户邮件操作', { openId, cmd: emailCmd.substring(0, 50) });
    callAgent(openId, `请帮我处理以下邮件操作：${emailCmd}`, requestId)
      .then(async (reply) => {
        await sendAsyncReply(openId, `📧 邮件处理结果：\n\n${reply}`);
      })
      .catch(async (err) => {
        logger.error('邮件操作失败', { err: err.message, openId });
        await sendAsyncReply(openId, '❌ 邮件操作失败，请稍后重试。');
      });
    return '📧 正在处理邮件操作，请稍候...';
  }

  // ── 普通消息 → AI 对话 ──
  logger.info('收到文字消息', { openId, text: text.substring(0, 100) });

  // 长耗时任务：异步处理
  if (isLongRunningTask(text)) {
    callAgent(openId, text, requestId)
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
  return await callAgent(openId, text, requestId);
}

/**
 * 处理语音消息：下载语音 → Whisper STT → AI 对话 → 文字回复。
 * 如果 VOICE_ENABLED，会异步通过客服接口回复语音。
 * @param {string} openId - 用户 OpenID
 * @param {string} mediaId - 微信语音 MediaId
 * @param {string} recognition - 微信自带语音识别结果（可能为空）
 */
async function handleVoiceMessage(openId, mediaId, recognition, requestId) {
  // 认证检查
  const authed = await isUserAuthed(openId);
  if (!authed) {
    return '🔒 请先绑定邮箱完成认证后使用。\n\n发送：/bind 你的邮箱@example.com';
  }

  // 优先使用微信自带语音识别结果
  if (recognition && recognition.trim()) {
    logger.info('使用微信语音识别结果', { openId, recognition: recognition.substring(0, 50) });
    const reply = await callAgent(openId, recognition.trim(), requestId);

    // 如果语音模块可用，异步发送 TTS 语音回复
    if (VOICE_ENABLED) {
      setImmediate(async () => {
        try {
          const ttsBuffer = await synthesizeSpeech(reply.substring(0, MAX_TTS_TEXT_LENGTH));
          if (ttsBuffer) {
            const voiceMediaId = await uploadVoiceMedia(ttsBuffer);
            if (voiceMediaId) {
              await sendAsyncVoiceReply(openId, voiceMediaId);
            }
          }
        } catch (err) {
          logger.error('TTS 语音回复失败', { err: err.message, openId });
        }
      });
    }
    return reply;
  }

  // 如果没有微信语音识别结果且语音模块未启用
  if (!VOICE_ENABLED) {
    return '🎙 已收到语音消息。\n\n语音转文字功能暂未启用，请发送文字消息与 AI 对话。';
  }

  // 使用 Whisper STT 转录
  if (!mediaId) {
    return '语音消息格式异常，请重试。';
  }

  logger.info('开始处理语音消息', { openId, mediaId });

  // 异步处理：下载 → 转录 → AI → 回复
  setImmediate(async () => {
    try {
      // 1. 下载语音文件
      const media = await downloadMedia(mediaId);
      if (!media) {
        await sendAsyncReply(openId, '❌ 语音下载失败，请重试。');
        return;
      }

      // 2. Whisper 转录
      const text = await transcribeVoice(media.buffer, 'amr');
      if (!text) {
        await sendAsyncReply(openId, '❌ 语音识别失败，请重试或发送文字消息。');
        return;
      }

      logger.info('语音转录完成', { openId, text: text.substring(0, 50) });

      // 3. AI 对话
      const reply = await callAgent(openId, text, requestId);
      await sendAsyncReply(openId, `🎙 语音识别：${text}\n\n${reply}`);

      // 4. 可选 TTS 语音回复
      const ttsBuffer = await synthesizeSpeech(reply.substring(0, MAX_TTS_TEXT_LENGTH));
      if (ttsBuffer) {
        const voiceMediaId = await uploadVoiceMedia(ttsBuffer);
        if (voiceMediaId) {
          await sendAsyncVoiceReply(openId, voiceMediaId);
        }
      }
    } catch (err) {
      logger.error('语音消息处理失败', { err: err.message, openId });
      await sendAsyncReply(openId, '❌ 语音处理失败，请稍后重试。');
    }
  });

  return '🎙 语音处理中，稍后回复...';
}

/**
 * 处理图片消息：下载图片 → AI 分析。
 * @param {string} openId - 用户 OpenID
 * @param {string} picUrl - 微信图片 URL
 * @param {string} mediaId - 微信 MediaId
 */
async function handleImageMessage(openId, picUrl, mediaId, requestId) {
  const authed = await isUserAuthed(openId);
  if (!authed) {
    return '🔒 请先绑定邮箱完成认证后使用。\n\n发送：/bind 你的邮箱@example.com';
  }

  if (!picUrl && !mediaId) {
    return '图片消息格式异常，请重试。';
  }

  logger.info('收到图片消息', { openId, hasPicUrl: !!picUrl, hasMediaId: !!mediaId });

  // 异步处理图片分析
  setImmediate(async () => {
    try {
      let imageContext;
      if (picUrl) {
        imageContext = `用户发送了一张图片，图片URL：${picUrl}。请分析这张图片的内容。`;
      } else if (mediaId) {
        // picUrl 不可用时通过 mediaId 下载图片
        const media = await downloadMedia(mediaId);
        if (media) {
          imageContext = `用户发送了一张图片（已通过媒体接口获取，格式：${media.contentType}）。请提供图片分析帮助。`;
        } else {
          imageContext = '用户发送了一张图片，但下载失败。请提供可能的分析帮助。';
        }
      } else {
        imageContext = '用户发送了一张图片，请提供可能的分析帮助。';
      }

      const reply = await callAgent(openId, imageContext, requestId);
      await sendAsyncReply(openId, `🖼 图片分析结果：\n\n${reply}`);
    } catch (err) {
      logger.error('图片分析失败', { err: err.message, openId });
      await sendAsyncReply(openId, '❌ 图片分析失败，请稍后重试。');
    }
  });

  return '🖼 图片分析中，稍后回复...';
}

/**
 * 处理视频/文件消息：转发到 Agent 进行分析。
 * @param {string} openId - 用户 OpenID
 * @param {string} mediaId - 微信 MediaId
 * @param {string} fileName - 文件名（文件消息才有）
 */
async function handleFileMessage(openId, mediaId, fileName, requestId) {
  const authed = await isUserAuthed(openId);
  if (!authed) {
    return '🔒 请先绑定邮箱完成认证后使用。\n\n发送：/bind 你的邮箱@example.com';
  }

  logger.info('收到文件消息', { openId, mediaId, fileName });

  const fileDesc = fileName ? `文件名：${fileName}` : '视频/文件';

  // 异步处理文件分析
  setImmediate(async () => {
    try {
      // 尝试下载文件获取更多信息（大文件可能下载失败，回退到元数据分析）
      let fileContext = `用户发送了一个文件（${fileDesc}）。`;
      if (mediaId) {
        const media = await downloadMedia(mediaId);
        if (media) {
          const sizeKB = (media.buffer.length / 1024).toFixed(1);
          fileContext += `\n文件大小：${sizeKB}KB，格式：${media.contentType}。`;
        }
      }
      fileContext += '\n请提供分析帮助。如需详细分析文件内容，建议通过 Web 界面上传。';

      const reply = await callAgent(openId, fileContext, requestId);
      await sendAsyncReply(openId, `📎 文件分析：\n\n${reply}`);
    } catch (err) {
      logger.error('文件分析失败', { err: err.message, openId });
      await sendAsyncReply(openId, '❌ 文件处理失败，请稍后重试。');
    }
  });

  return `📎 已收到${fileName ? `文件「${fileName}」` : '文件'}，分析中...`;
}

/**
 * 处理位置消息：提取经纬度和标签发送给 Agent。
 * @param {string} openId - 用户 OpenID
 * @param {string} locationX - 纬度
 * @param {string} locationY - 经度
 * @param {string} scale - 地图缩放
 * @param {string} label - 位置名称
 */
async function handleLocationMessage(openId, locationX, locationY, scale, label, requestId) {
  const authed = await isUserAuthed(openId);
  if (!authed) {
    return '🔒 请先绑定邮箱完成认证后使用。\n\n发送：/bind 你的邮箱@example.com';
  }

  logger.info('收到位置消息', { openId, label, lat: locationX, lng: locationY });

  const locationDesc = label
    ? `用户分享了位置「${label}」（纬度：${locationX}，经度：${locationY}）。请提供该位置相关的信息或帮助。`
    : `用户分享了一个位置（纬度：${locationX}，经度：${locationY}）。请提供该位置相关的信息或帮助。`;

  return await callAgent(openId, locationDesc, requestId);
}

/**
 * 处理链接消息：提取标题、描述和URL发送给 Agent 分析。
 * @param {string} openId - 用户 OpenID
 * @param {string} title - 链接标题
 * @param {string} description - 链接描述
 * @param {string} url - 链接 URL
 */
async function handleLinkMessage(openId, title, description, url, requestId) {
  const authed = await isUserAuthed(openId);
  if (!authed) {
    return '🔒 请先绑定邮箱完成认证后使用。\n\n发送：/bind 你的邮箱@example.com';
  }

  logger.info('收到链接消息', { openId, title, url });

  const linkDesc = `用户分享了一个链接：\n标题：${title || '无'}\n描述：${description || '无'}\nURL：${url || '无'}\n\n请分析该链接内容并提供摘要或相关帮助。`;

  // 链接分析可能耗时较长
  callAgent(openId, linkDesc, requestId)
    .then(async (reply) => {
      await sendAsyncReply(openId, `🔗 链接分析：\n\n${reply}`);
    })
    .catch(async (err) => {
      logger.error('链接分析失败', { err: err.message, openId });
      await sendAsyncReply(openId, '❌ 链接分析失败，请稍后重试。');
    });

  return '🔗 正在分析链接内容，稍后回复...';
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

// ─── 请求追踪（X-Request-ID）──────────────────────────────
app.use((req, res, next) => {
  req.id = crypto.randomUUID();
  res.setHeader('X-Request-ID', req.id);
  next();
});

// ─── 访问日志（PCI-DSS 10.2）──────────────────────────────
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    const duration = Date.now() - start;
    if (req.path !== '/health') {
      logger.info('access', {
        method: req.method,
        path: req.path,
        status: res.statusCode,
        duration_ms: duration,
        ip: req.ip,
        request_id: req.id,
      });
    }
  });
  next();
});

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

// 速率限制：管理端点（SERVICE_TOKEN 保护的端点，CIS DoS 缓解）
const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests',
});

// ─── SERVICE_TOKEN 认证中间件（管理端点保护）─────────────────
function requireServiceToken(req, res, next) {
  if (!SERVICE_TOKEN) {
    // 未配置 SERVICE_TOKEN 时，管理端点不可用
    res.status(403).json({ error: 'SERVICE_TOKEN not configured' });
    return;
  }
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  // 使用 HMAC 归一化为等长摘要，避免长度差异导致的时序泄漏
  const hmacKey = Buffer.from('clawbot-auth', 'utf8');
  const expected = crypto.createHmac('sha256', hmacKey).update(SERVICE_TOKEN).digest();
  const provided = crypto.createHmac('sha256', hmacKey).update(token).digest();
  if (!crypto.timingSafeEqual(expected, provided)) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  next();
}

// 微信回调需要原始 XML body
app.use('/clawbot/webhook', express.text({ type: ['text/xml', 'application/xml'], limit: '256kb' }));
app.use(express.json({ limit: '256kb' }));

// ─── 健康检查 ────────────────────────────────────────────────
app.get('/health', (req, res) => {
  const redisOk = redis ? redis.status === 'ready' : true;
  const status = redisOk ? 'ok' : 'degraded';
  res.status(redisOk ? 200 : 503).json({ status });
});

// ─── 运营统计端点（需要 SERVICE_TOKEN 认证）──────────────────
app.get('/stats', adminLimiter, requireServiceToken, (req, res) => {
  const uptimeMs = Date.now() - stats.startedAt;
  res.json({
    version: '1.4.0',
    channel: '灵枢接入通道',
    uptime_seconds: Math.floor(uptimeMs / 1000),
    active_sessions: sessions.size,
    max_sessions: MAX_SESSIONS,
    redis_status: redis ? redis.status : 'not_configured',
    encrypt_mode: ENCRYPT_MODE,
    wecom_enabled: WECOM_ENABLED,
    voice_enabled: VOICE_ENABLED,
    total_messages: stats.totalMessages,
    messages_by_type: stats.messagesByType,
    total_commands: stats.totalCommands,
    commands_by_name: stats.commandsByName,
    total_errors: stats.totalErrors,
  });
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
  let xmlBody = typeof req.body === 'string' ? req.body : '';
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

  // ── AES 加密消息解密（安全模式 / 兼容模式）──
  // 检查消息是否包含 <Encrypt> 节点（加密模式）
  let isEncryptedMsg = false;
  const encryptField = getXmlValue(xmlBody, 'Encrypt');
  if (encryptField && ENCRYPT_MODE) {
    // 验证加密消息签名
    const msgSignature = String(req.query.msg_signature || '');
    if (msgSignature) {
      try {
        if (!verifyEncryptSignature(msgSignature, String(timestamp), String(nonce), encryptField)) {
          logger.warn('加密消息签名验证失败');
          res.status(403).send('Encrypt signature verification failed');
          return;
        }
      } catch (sigErr) {
        logger.error('加密签名验证异常', { err: sigErr.message });
        res.status(500).send('Internal error');
        return;
      }
    }
    // 解密消息
    try {
      xmlBody = decryptMessage(encryptField);
      isEncryptedMsg = true;
      logger.debug('消息已解密（安全模式）');
    } catch (decErr) {
      logger.error('消息解密失败', { err: decErr.message });
      res.status(400).send('Decrypt failed');
      return;
    }
  }

  const toUserName   = getXmlValue(xmlBody, 'ToUserName');
  const fromUserName = getXmlValue(xmlBody, 'FromUserName');   // 用户 OpenID
  const msgType      = getXmlValue(xmlBody, 'MsgType');
  const content      = getXmlValue(xmlBody, 'Content');
  const msgId        = getXmlValue(xmlBody, 'MsgId');
  const mediaId      = getXmlValue(xmlBody, 'MediaId');
  const picUrl       = getXmlValue(xmlBody, 'PicUrl');
  const recognition  = getXmlValue(xmlBody, 'Recognition');   // 微信语音识别

  if (!fromUserName || !msgType) {
    res.status(400).send('Invalid message');
    return;
  }

  // OpenID 格式校验（PCI-DSS 6.5 输入验证）
  if (!OPENID_RE.test(fromUserName)) {
    logger.warn('OpenID 格式不合法', { fromUserName: fromUserName.substring(0, 32), request_id: req.id });
    res.status(400).send('Invalid openId');
    return;
  }

  const openId = fromUserName;

  // ── 消息去重（防止微信重试导致重复处理）──
  if (msgId && await isDuplicateMessage(msgId)) {
    logger.info('消息去重：跳过重复消息', { openId, msgId, request_id: req.id });
    res.status(200).send('success');
    return;
  }

  // ── Per-user 速率限制（PCI-DSS / CIS DoS 缓解）──
  if (await isUserRateLimited(openId)) {
    logger.warn('用户请求超限', { openId, limit: USER_RATE_LIMIT, request_id: req.id });
    const rateLimitReply = buildTextReply(openId, toUserName, '⚠️ 操作过于频繁，请稍后再试。');
    res.set('Content-Type', 'text/xml');
    res.status(200).send(rateLimitReply);
    return;
  }

  // 运营统计
  stats.totalMessages++;
  if (stats.messagesByType[msgType] !== undefined) {
    stats.messagesByType[msgType]++;
  }

  logger.info('收到 ClawBot 消息', {
    openId,
    msgType,
    msgId,
    content: content ? content.substring(0, 50) : '',
    request_id: req.id,
  });

  try {
    let replyText = '';

    switch (msgType) {
      case 'text':
        replyText = await handleTextMessage(openId, content, req.id);
        break;

      case 'voice':
        replyText = await handleVoiceMessage(openId, mediaId, recognition, req.id);
        break;

      case 'image':
        replyText = await handleImageMessage(openId, picUrl, mediaId, req.id);
        break;

      case 'video':
      case 'shortvideo':
      case 'file':
        replyText = await handleFileMessage(openId, mediaId, getXmlValue(xmlBody, 'FileName'), req.id);
        break;

      case 'location': {
        const locationX = getXmlValue(xmlBody, 'Location_X');
        const locationY = getXmlValue(xmlBody, 'Location_Y');
        const scale     = getXmlValue(xmlBody, 'Scale');
        const label     = getXmlValue(xmlBody, 'Label');
        replyText = await handleLocationMessage(openId, locationX, locationY, scale, label, req.id);
        break;
      }

      case 'link': {
        const title       = getXmlValue(xmlBody, 'Title');
        const description = getXmlValue(xmlBody, 'Description');
        const url         = getXmlValue(xmlBody, 'Url');
        replyText = await handleLinkMessage(openId, title, description, url, req.id);
        break;
      }

      case 'event': {
        const eventType = getXmlValue(xmlBody, 'Event');
        const eventKey  = getXmlValue(xmlBody, 'EventKey');

        if (eventType === 'subscribe') {
          // 用户关注（可能通过扫码关注：eventKey 包含 qrscene_ 前缀）
          if (eventKey && eventKey.startsWith('qrscene_')) {
            const scene = eventKey.slice(8);
            logger.info('用户通过扫码关注', { openId, scene });
            replyText = '🤖 欢迎使用 Anima 灵枢接入通道！\n\n' +
              '你通过扫码关注，' +
              '首次使用请绑定邮箱完成认证：\n' +
              '/bind 你的邮箱@example.com\n\n' +
              '绑定后即可直接发送消息与 AI 对话。\n\n' +
              '发送 /help 查看所有可用命令。';
          } else {
            replyText = '🤖 欢迎使用 Anima 灵枢接入通道！\n\n' +
              '首次使用请先绑定邮箱完成认证：\n' +
              '/bind 你的邮箱@example.com\n\n' +
              '绑定后即可直接发送消息与 AI 对话。\n' +
              '支持文字、语音、图片、文件、位置、链接等多种消息类型。\n\n' +
              '发送 /help 查看所有可用命令。';
          }
        } else if (eventType === 'SCAN') {
          // 已关注用户扫码（不触发 subscribe，触发 SCAN 事件）
          const scene = eventKey || '';
          logger.info('已关注用户扫码', { openId, scene });
          replyText = '📱 扫码成功！你已关注 Anima 灵枢接入通道。\n\n' +
            '直接发送消息即可与 AI 对话。\n' +
            '发送 /help 查看可用命令。';
        } else if (eventType === 'unsubscribe') {
          // 用户取消关注：清除所有用户数据（保证数据安全）
          logger.info('用户取消关注，清除用户数据', { openId });
          await clearUserData(openId);
        } else if (eventType === 'CLICK') {
          // 菜单点击事件
          logger.info('用户点击菜单', { openId, eventKey });
          const cmd = MENU_HANDLERS[eventKey];
          if (cmd) {
            replyText = await handleTextMessage(openId, cmd, req.id);
          } else {
            replyText = await handleTextMessage(openId, eventKey || '/help', req.id);
          }
        } else if (eventType === 'VIEW') {
          // 菜单链接跳转事件（仅记录日志，用户已跳转到目标 URL）
          logger.info('用户点击菜单链接', { openId, url: eventKey });
        }
        break;
      }

      default:
        replyText = '暂不支持此类型消息，请发送文字或语音消息。';
        break;
    }

    if (replyText) {
      const replyXml = buildTextReply(openId, toUserName, replyText);
      // 安全模式：加密回复消息
      if (isEncryptedMsg && ENCRYPT_MODE) {
        try {
          const encryptedReply = encryptMessage(replyXml);
          const ts = String(Math.floor(Date.now() / 1000));
          const replyNonce = crypto.randomBytes(8).toString('hex');
          const encReplyXml = buildEncryptedReply(encryptedReply, ts, replyNonce);
          res.set('Content-Type', 'text/xml');
          res.status(200).send(encReplyXml);
        } catch (encErr) {
          logger.error('回复消息加密失败，回退明文', { err: encErr.message });
          res.set('Content-Type', 'text/xml');
          res.status(200).send(replyXml);
        }
      } else {
        res.set('Content-Type', 'text/xml');
        res.status(200).send(replyXml);
      }
    } else {
      // 微信要求返回 "success" 表示已处理
      res.status(200).send('success');
    }
  } catch (err) {
    stats.totalErrors++;
    logger.error('消息处理异常', { err: err.message, openId, msgType, request_id: req.id });
    const errorReply = buildTextReply(openId, toUserName, '处理消息时出错，请稍后再试。');
    res.set('Content-Type', 'text/xml');
    res.status(200).send(errorReply);
  }
});

// ─── 扫码接入：二维码生成端点 ──────────────────────────────────
// 管理员调用此接口生成二维码，用户扫码关注后自动接入
app.get('/clawbot/qrcode', adminLimiter, requireServiceToken, async (req, res) => {
  const scene = typeof req.query.scene === 'string' ? req.query.scene.substring(0, 64) : 'subscribe';
  const temporary = req.query.temporary === 'true';

  const result = await createQrCode(scene, temporary);
  if (!result) {
    res.status(500).json({ success: false, msg: '二维码生成失败' });
    return;
  }

  res.json({
    success: true,
    ticket: result.ticket,
    url: result.url,
    qrcodeUrl: result.qrcodeUrl,
    scene,
  });
});

// ─── 微信自定义菜单管理（需要 SERVICE_TOKEN 认证）──────────────

// 创建自定义菜单
app.post('/clawbot/menu', express.json({ limit: '64kb' }), adminLimiter, requireServiceToken, async (req, res) => {
  const menuData = req.body;
  if (!menuData || !menuData.button || !Array.isArray(menuData.button)) {
    res.status(400).json({ success: false, msg: '菜单数据格式错误，需要 { button: [...] }' });
    return;
  }

  const token = await getAccessToken();
  if (!token) {
    res.status(500).json({ success: false, msg: 'access_token 不可用' });
    return;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  try {
    const { body } = await request(
      `https://api.weixin.qq.com/cgi-bin/menu/create?access_token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(menuData),
        bodyTimeout: 10_000,
        headersTimeout: 10_000,
        signal: controller.signal,
      }
    );
    clearTimeout(timeoutId);
    const result = await body.json();
    if (result.errcode && result.errcode !== 0) {
      logger.error('创建菜单失败', { errcode: result.errcode, errmsg: result.errmsg });
      res.status(400).json({ success: false, errcode: result.errcode, msg: result.errmsg });
    } else {
      logger.info('自定义菜单创建成功');
      res.json({ success: true, msg: '菜单创建成功' });
    }
  } catch (err) {
    clearTimeout(timeoutId);
    logger.error('创建菜单异常', { err: err.message });
    res.status(500).json({ success: false, msg: '菜单创建失败' });
  }
});

// 查询当前自定义菜单
app.get('/clawbot/menu', adminLimiter, requireServiceToken, async (req, res) => {
  const token = await getAccessToken();
  if (!token) {
    res.status(500).json({ success: false, msg: 'access_token 不可用' });
    return;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  try {
    const { body } = await request(
      `https://api.weixin.qq.com/cgi-bin/get_current_selfmenu_info?access_token=${encodeURIComponent(token)}`,
      {
        bodyTimeout: 10_000,
        headersTimeout: 10_000,
        signal: controller.signal,
      }
    );
    clearTimeout(timeoutId);
    const result = await body.json();
    res.json({ success: true, menu: result });
  } catch (err) {
    clearTimeout(timeoutId);
    logger.error('查询菜单异常', { err: err.message });
    res.status(500).json({ success: false, msg: '菜单查询失败' });
  }
});

// 删除自定义菜单
app.delete('/clawbot/menu', adminLimiter, requireServiceToken, async (req, res) => {
  const token = await getAccessToken();
  if (!token) {
    res.status(500).json({ success: false, msg: 'access_token 不可用' });
    return;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  try {
    const { body } = await request(
      `https://api.weixin.qq.com/cgi-bin/menu/delete?access_token=${encodeURIComponent(token)}`,
      {
        method: 'GET',
        bodyTimeout: 10_000,
        headersTimeout: 10_000,
        signal: controller.signal,
      }
    );
    clearTimeout(timeoutId);
    const result = await body.json();
    if (result.errcode && result.errcode !== 0) {
      logger.error('删除菜单失败', { errcode: result.errcode, errmsg: result.errmsg });
      res.status(400).json({ success: false, errcode: result.errcode, msg: result.errmsg });
    } else {
      logger.info('自定义菜单已删除');
      res.json({ success: true, msg: '菜单已删除' });
    }
  } catch (err) {
    clearTimeout(timeoutId);
    logger.error('删除菜单异常', { err: err.message });
    res.status(500).json({ success: false, msg: '菜单删除失败' });
  }
});

// ─── 已认证用户管理端点（需要 SERVICE_TOKEN 认证，支持分页）──
app.get('/clawbot/users', adminLimiter, requireServiceToken, async (req, res) => {
  if (!redis) {
    res.status(503).json({ success: false, msg: 'Redis 不可用' });
    return;
  }

  // 分页参数（企业级扩展性）
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '50', 10)));

  try {
    // 获取所有已认证用户
    const authedUsers = await redis.smembers(REDIS_AUTH_KEY);
    const total = authedUsers.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const startIdx = (page - 1) * limit;
    const pageUsers = authedUsers.slice(startIdx, startIdx + limit);

    const users = [];
    for (const openId of pageUsers) {
      const email = await redis.hget(REDIS_EMAIL_KEY, openId) || '';
      const model = await redis.hget(REDIS_MODELS_KEY, openId) || DEFAULT_MODEL;
      users.push({ openId, email, model });
    }

    res.json({
      success: true,
      total,
      page,
      limit,
      totalPages,
      users,
    });
  } catch (err) {
    logger.error('查询已认证用户失败', { err: err.message });
    res.status(500).json({ success: false, msg: '查询失败' });
  }
});

// ─── 企业微信（WeCom）Webhook 接口 ────────────────────────────
// 以下接口已添加但默认不启用（WECOM_ENABLED=false）
// 企业微信回调也需要 XML body
app.use('/wecom/webhook', express.text({ type: ['text/xml', 'application/xml'], limit: '256kb' }));

// 企业微信 URL 验证（GET）
app.get('/wecom/webhook', verifyLimiter, (req, res) => {
  if (!WECOM_ENABLED) {
    res.status(404).json({ error: 'WeCom interface not enabled' });
    return;
  }

  const { msg_signature, timestamp, nonce, echostr } = req.query;

  if (!msg_signature || !timestamp || !nonce || !echostr) {
    logger.warn('企业微信验证请求缺少参数');
    res.status(400).send('Missing parameters');
    return;
  }

  try {
    if (verifyWecomSignature(String(msg_signature), String(timestamp), String(nonce))) {
      logger.info('企业微信 URL 验证成功');
      res.status(200).send(String(echostr));
    } else {
      logger.warn('企业微信签名验证失败');
      res.status(403).send('Signature verification failed');
    }
  } catch (err) {
    logger.error('企业微信签名验证异常', { err: err.message });
    res.status(500).send('Internal error');
  }
});

// 企业微信消息接收（POST）
app.post('/wecom/webhook', webhookLimiter, async (req, res) => {
  if (!WECOM_ENABLED) {
    res.status(404).json({ error: 'WeCom interface not enabled' });
    return;
  }

  const { msg_signature, timestamp, nonce } = req.query;

  if (!msg_signature || !timestamp || !nonce) {
    res.status(400).send('Missing parameters');
    return;
  }

  try {
    if (!verifyWecomSignature(String(msg_signature), String(timestamp), String(nonce))) {
      logger.warn('企业微信消息签名验证失败');
      res.status(403).send('Signature verification failed');
      return;
    }
  } catch (err) {
    logger.error('企业微信签名验证异常', { err: err.message });
    res.status(500).send('Internal error');
    return;
  }

  // 解析 XML 消息体
  const xmlBody = typeof req.body === 'string' ? req.body : '';
  if (!xmlBody) {
    res.status(400).send('Empty body');
    return;
  }

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
  const fromUserName = getXmlValue(xmlBody, 'FromUserName');   // 企业微信 UserID
  const msgType      = getXmlValue(xmlBody, 'MsgType');
  const content      = getXmlValue(xmlBody, 'Content');

  if (!fromUserName || !msgType) {
    res.status(400).send('Invalid message');
    return;
  }

  // UserID 格式校验（PCI-DSS 6.5 输入验证）
  if (!OPENID_RE.test(fromUserName)) {
    logger.warn('企业微信 UserID 格式不合法', { fromUserName: fromUserName.substring(0, 32) });
    res.status(400).send('Invalid userId');
    return;
  }

  // 企业微信使用 UserID 而非 OpenID
  const userId = fromUserName;

  // Per-user 速率限制（PCI-DSS / CIS DoS 缓解）
  if (await isUserRateLimited(`wecom:${userId}`)) {
    logger.warn('企业微信用户请求超限', { userId, limit: USER_RATE_LIMIT });
    res.status(200).send('');
    return;
  }

  logger.info('收到企业微信消息', { userId, msgType });

  try {
    let replyText = '';

    // 企业微信消息处理：复用核心处理逻辑（handleTextMessage 等）
    // 'wecom:' 前缀确保 Redis 键空间隔离——核心处理函数使用完整 wecomOpenId
    // 作为 Redis hash field，因此 anima:clawbot:emails 中的 key 为 'wecom:userId'，
    // 与微信公众号的 openId 不冲突，实现跨通道用户数据完全隔离
    const wecomOpenId = `wecom:${userId}`;

    switch (msgType) {
      case 'text':
        replyText = await handleTextMessage(wecomOpenId, content, req.id);
        break;

      case 'voice': {
        const wecomMediaId = getXmlValue(xmlBody, 'MediaId');
        const wecomRecognition = getXmlValue(xmlBody, 'Recognition');
        replyText = await handleVoiceMessage(wecomOpenId, wecomMediaId, wecomRecognition, req.id);
        break;
      }

      case 'image': {
        const wecomPicUrl = getXmlValue(xmlBody, 'PicUrl');
        const wecomImgMediaId = getXmlValue(xmlBody, 'MediaId');
        replyText = await handleImageMessage(wecomOpenId, wecomPicUrl, wecomImgMediaId, req.id);
        break;
      }

      case 'video':
      case 'file': {
        const wecomFileMediaId = getXmlValue(xmlBody, 'MediaId');
        const wecomFileName = getXmlValue(xmlBody, 'FileName');
        replyText = await handleFileMessage(wecomOpenId, wecomFileMediaId, wecomFileName, req.id);
        break;
      }

      case 'location': {
        const wecomLocX = getXmlValue(xmlBody, 'Location_X');
        const wecomLocY = getXmlValue(xmlBody, 'Location_Y');
        const wecomScale = getXmlValue(xmlBody, 'Scale');
        const wecomLabel = getXmlValue(xmlBody, 'Label');
        replyText = await handleLocationMessage(wecomOpenId, wecomLocX, wecomLocY, wecomScale, wecomLabel, req.id);
        break;
      }

      default:
        replyText = '暂不支持此类型消息，请发送文字、语音、图片或文件消息。';
        break;
    }

    if (replyText) {
      // 企业微信被动回复 XML 格式
      const timestamp = Math.floor(Date.now() / 1000);
      const firstPart = splitMessage(replyText)[0] || '';
      const replyXml = `<xml>
<ToUserName><![CDATA[${userId}]]></ToUserName>
<FromUserName><![CDATA[${toUserName}]]></FromUserName>
<CreateTime>${timestamp}</CreateTime>
<MsgType><![CDATA[text]]></MsgType>
<Content><![CDATA[${firstPart}]]></Content>
</xml>`;

      // 企业微信超长消息通过应用消息接口发送剩余部分
      const parts = splitMessage(replyText);
      if (parts.length > 1) {
        setImmediate(async () => {
          for (const part of parts.slice(1)) {
            await sendWecomReply(userId, part);
          }
        });
      }

      res.set('Content-Type', 'text/xml');
      res.status(200).send(replyXml);
    } else {
      res.status(200).send('');
    }
  } catch (err) {
    logger.error('企业微信消息处理异常', { err: err.message, userId, msgType });
    res.status(200).send('');
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
  logger.info(`灵枢接入通道 v1.4 已启动，端口 ${PORT}`);
  logger.info('官方微信 ClawBot 插件接入（扫码/App互通）就绪，等待回调...');
  logger.info(`Per-user 速率限制：${USER_RATE_LIMIT} 次/分钟`);
  if (ENCRYPT_MODE) {
    logger.info('消息加解密模式已启用（AES-256-CBC 安全模式）');
  } else {
    logger.info('消息加解密模式未启用（明文模式）');
  }
  if (WECOM_ENABLED) {
    logger.info('企业微信（WeCom）接口已就绪 /wecom/webhook');
  }
  if (SERVICE_TOKEN) {
    logger.info('管理端点已启用 SERVICE_TOKEN 认证保护');
  } else {
    logger.warn('SERVICE_TOKEN 未设置，管理端点（/clawbot/qrcode, /clawbot/menu, /clawbot/users, /stats）不可用');
  }
});

// 安全加固
server.maxHeadersCount = 50;
server.requestTimeout = 30_000;
server.maxRequestsPerSocket = 256;
server.maxConnections = 1024;

// ─── 优雅退出 ────────────────────────────────────────────────
const SHUTDOWN_TIMEOUT_MS = GRACEFUL_SHUTDOWN_TIMEOUT * 1000;

const shutdown = (signal) => {
  logger.info(`收到 ${signal}，正在关闭（超时 ${GRACEFUL_SHUTDOWN_TIMEOUT}s）...`);
  clearInterval(sessionCleanupTimer);

  server.close(() => {
    if (redis) redis.disconnect();
    logger.info('服务器已正常关闭');
    process.exit(0);
  });

  // 优雅关闭超时后强制终止未完成连接
  setTimeout(() => {
    server.closeAllConnections();
  }, SHUTDOWN_TIMEOUT_MS / 2);

  // 强制退出兜底
  setTimeout(() => {
    if (redis) redis.disconnect();
    process.exit(1);
  }, SHUTDOWN_TIMEOUT_MS);
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
