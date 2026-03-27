# 微信 ClawBot 插件灵枢接入通道 v1.6

## 概述

基于微信官方 ClawBot 插件 API，将 Anima 灵枢 AI 助手接入微信。
**使用官方微信接入方式**（扫码关注 / App 互通），完全契合官方接入要求。

用户通过微信 ClawBot 插件与 AI 对话，支持文字、语音、图片/文件、位置、链接等消息类型。
所有功能均需登录认证后使用，用户数据强隔离保证安全。符合企业级商业运维模式。
符合 PCI-DSS 和 CIS 安全标准。

> **企业微信接口**：已添加完整的企业微信（WeCom）Webhook 接口，但**默认不启用**。
> 如需使用企业微信，设置 `WECOM_ENABLED=true` 并配置相关参数。

## v1.6 新特性

- **CORS & Cache-Control 安全头**：Helmet 配置 CORS 策略，API 响应添加 Cache-Control: no-store 防止敏感数据缓存（CIS 14.x 安全加固）
- **管理操作审计日志**：所有 SERVICE_TOKEN 保护端点的访问记录为结构化审计事件 action=admin_access（PCI-DSS 10.2.2 特权用户操作审计）
- **速率限制 & 认证失败审计**：Per-user 速率限制触发和 SERVICE_TOKEN 认证失败记录为审计事件（PCI-DSS 10.2.4/10.2.5）
- **就绪探针端点**：新增 GET /ready 检测 Redis 连通性及服务依赖就绪状态，与 /health 存活探针分离（企业级 Kubernetes 部署）
- **管理端点 IP 白名单**：可选 ADMIN_IP_ALLOWLIST 环境变量，配置后仅允许指定 IP 访问管理端点（CIS 9.x 网络访问限制）

## v1.5 新特性

- **Billing API 请求追踪贯通**：queryBalance 传递 X-Request-ID，实现全链路端到端请求追踪（企业级运维）
- **Content-Type 强制校验**：管理端点 POST/PUT/PATCH 强制 application/json，拒绝其他类型（CIS 安全加固）
- **Redis 启动连通性检查**：启动时 PING Redis 验证连接，确保认证/隔离基础设施就绪（企业级可靠性）
- **结构化审计日志**：认证操作（bind/unbind/auth_check_fail/unsubscribe_cleanup）使用统一 audit 事件格式（PCI-DSS 10.2 增强）

## v1.4 新特性

- **Per-user 速率限制**：基于 Redis 滑动窗口的用户级速率限制（默认 30 次/分钟），防止单一用户 DoS（PCI-DSS / CIS）
- **管理端点速率限制**：所有 SERVICE_TOKEN 保护的管理端点统一限速 30 次/分钟（CIS）
- **用户管理端点分页**：GET /clawbot/users 支持 page / limit 参数，适应大规模用户（企业级扩展性）
- **请求追踪贯通**：Agent API 调用传递 X-Request-ID，实现端到端请求追踪（企业级运维）
- **OpenID 格式校验**：Webhook 消息处理入口验证用户标识格式（PCI-DSS 6.5 输入验证）
- **版本对齐**：修复 /stats 端点版本号

## 接入方式

| 方式 | 说明 | 状态 |
|------|------|------|
| **微信公众号扫码** | 用户扫描二维码关注公众号，即可使用 AI | ✅ 默认启用 |
| **微信 App 互通** | 通过 Open Platform 跨应用通信 | ✅ 默认启用 |
| **安全模式** | AES-256-CBC 消息加解密（配置 EncodingAESKey 自动启用） | ✅ 已支持 |
| 企业微信（WeCom） | 企业微信应用消息接口 | ⬜ 已添加，默认不启用 |

## 功能

### ClawBot 核心功能
- 文字消息 → AI 对话（支持 70+ 模型）
- 语音消息 → Whisper STT → AI → TTS → 语音回复
- 图片消息 → AI 图片分析
- 视频/文件 → 文件分析
- 位置消息 → 位置相关 AI 服务
- 链接消息 → 链接内容分析
- 菜单事件 → CLICK / VIEW 处理
- 自定义菜单管理 API（创建/查询/删除）
- 模板消息发送（结构化通知）
- 消息分段发送（适配微信 2000 字符上限）
- 长耗时任务异步回复（通过客服消息接口）
- 消息去重（Redis msgId 5 分钟去重窗口）

### 扫码接入
- 二维码生成端点（`GET /clawbot/qrcode`）
- 扫码关注事件处理（subscribe + qrscene_）
- 已关注用户扫码事件处理（SCAN）
- 支持永久/临时二维码

### 安全与认证
- 微信签名验证（token + timestamp + nonce SHA1，timing-safe）
- **AES-256-CBC 消息加解密**（安全模式 / 兼容模式，完全契合官方接入）
- **强制登录认证**：用户必须绑定邮箱后才可使用 AI 功能
- **用户强隔离**：独立 Redis 键空间、独立会话、独立计费
- **Per-user 速率限制**：基于 Redis 滑动窗口的用户级限速（默认 30 次/分钟，PCI-DSS / CIS）
- **消息去重**：Redis msgId 去重防止重复消息处理
- **取关数据清理**：用户取消关注时自动清除所有个人数据
- **OpenID 格式校验**：拒绝畸形用户标识（PCI-DSS 6.5 输入验证）
- **Content-Type 强制校验**：管理端点 POST/PUT/PATCH 强制 application/json（CIS）
- **CORS & Cache-Control 安全头**：Helmet CORS 策略 + Cache-Control: no-store（CIS 14.x）
- **结构化审计日志**：认证/管理/速率限制操作统一 audit 事件格式（PCI-DSS 10.2）
- **管理端点 IP 白名单**：可选 ADMIN_IP_ALLOWLIST 限制管理端点访问来源（CIS 9.x）
- 管理端点 SERVICE_TOKEN Bearer 认证保护
- 管理端点速率限制（30/min，CIS）
- 速率限制（验证端点 10/min，消息端点 300/min）
- X-Request-ID 请求追踪（日志关联 + Agent API + Billing API 全链路贯通）
- Redis 启动连通性检查（确认基础设施就绪）
- 访问日志中间件（PCI-DSS 10.2）
- 输入验证与控制字符过滤
- 生产环境 NODE_TLS_REJECT_UNAUTHORIZED=0 拒绝启动（PCI-DSS 4.1）

### 整合功能（基础命令）
- /bind <邮箱> — 绑定计费邮箱（必须，首次使用前完成认证）
- /unbind — 解除邮箱绑定并清除个人数据
- /balance — 查询账户余额
- /status — 查看账户状态（认证、邮箱、模型、会话信息）
- /model <模型名> — 切换 AI 模型
- /clear — 清除对话上下文
- /help — 查看帮助

### 整合功能（工具集成）
- /search <关键词> — 网页搜索（通过 Agent 调用 DuckDuckGo）
- /calendar [操作] — 日历管理（通过 Agent 调用 Nextcloud CalDAV）
- /home [命令] — 智能家居控制（通过 Agent 调用 Home Assistant）
- /files [操作] — 云存储管理（通过 Agent 调用 Nextcloud WebDAV，支持文件查询/搜索）
- /email [操作] — 邮件管理（通过 Agent 调用 IMAP/SMTP，支持查看/搜索/发送邮件）

## 部署节点

VPS-B (172.16.1.2) 或独立容器

## 快速部署

```bash
cd modules/clawbot
cp .env.example .env
vim .env  # 填写 ClawBot Token、AppID、AppSecret 等
docker compose up -d
```

## 获取 ClawBot 配置

1. 登录 [微信公众平台](https://mp.weixin.qq.com/)
2. 在「设置与开发 → 基本配置」中获取 AppID 和 AppSecret
3. 在「设置与开发 → 基本配置 → 服务器配置」中：
   - 设置服务器 URL 为 `https://your-domain/clawbot/webhook`
   - 设置 Token（自定义，与 .env 中 CLAWBOT_TOKEN 一致）
   - 设置 EncodingAESKey（可自动生成）
   - 选择消息加解密方式：明文模式 或 安全模式（配置 CLAWBOT_ENCODING_AES_KEY 后自动支持）
4. 将以上信息填入 `.env` 文件

## 架构

```
┌─────────────────────────────────────────────────────────────┐
│                  官方微信接入（默认启用）                       │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  微信用户 ─── 扫码关注 ──→ 公众号                             │
│     │                        │                              │
│     └── App 互通 ────────────┘                               │
│                              ↓                              │
│              微信服务器 → HTTP Webhook /clawbot/webhook       │
│                              ↓                              │
│                    签名验证 + 认证检查                         │
│                              ↓                              │
│                    消息类型路由                                │
│                    ├── 文字 → Agent API → AI 推理             │
│                    ├── 语音 → Whisper STT → Agent API → TTS  │
│                    ├── 图片 → Agent API → 图片分析            │
│                    ├── 文件 → Agent API → 文件分析            │
│                    ├── 位置 → Agent API → 位置服务            │
│                    ├── 链接 → Agent API → 链接分析            │
│                    └── 事件 → 扫码/关注/取关处理              │
│                              ↓                              │
│                        Webhook 计费                          │
└─────────────────────────────────────────────────────────────┘

┌─────────────────────────────────────────────────────────────┐
│          企业微信接口（已添加，默认不启用）                      │
├─────────────────────────────────────────────────────────────┤
│                                                             │
│  企业微信用户 → 企业微信服务器 → /wecom/webhook               │
│                                    ↓                        │
│                          WeCom 签名验证                      │
│                                    ↓                        │
│                          复用核心处理逻辑                      │
│                          （独立 Redis 键空间）                │
└─────────────────────────────────────────────────────────────┘
```

## 用户使用流程

### 官方微信接入（扫码）
1. 管理员调用 `GET /clawbot/qrcode` 生成接入二维码
2. 用户在微信中扫描二维码关注公众号
3. 首次使用发送 `/bind 邮箱@example.com` 完成认证
4. 认证后直接发送消息即可与 AI 对话
5. 支持发送文字、语音、图片、文件、位置、链接

### 企业微信接入（如启用）
1. 在 `.env` 中设置 `WECOM_ENABLED=true` 并填写企业微信配置
2. 在企业微信管理后台配置应用回调 URL 为 `https://your-domain/wecom/webhook`
3. 企业微信用户向应用发送消息即可使用

## API 端点

| 端点 | 方法 | 说明 | 认证 |
|------|------|------|------|
| `/health` | GET | 存活探针（Liveness） | ❌ |
| `/ready` | GET | 就绪探针（Readiness，含 Redis 连通性检查） | ❌ |
| `/clawbot/webhook` | GET | 微信 URL 验证 | 微信签名 |
| `/clawbot/webhook` | POST | 微信消息接收（支持加密/明文） | 微信签名 |
| `/clawbot/qrcode` | GET | 生成接入二维码 | SERVICE_TOKEN + IP白名单 |
| `/clawbot/menu` | POST | 创建公众号自定义菜单 | SERVICE_TOKEN + IP白名单 |
| `/clawbot/menu` | GET | 查询当前菜单配置 | SERVICE_TOKEN + IP白名单 |
| `/clawbot/menu` | DELETE | 删除当前自定义菜单 | SERVICE_TOKEN + IP白名单 |
| `/clawbot/users` | GET | 列出已认证用户 | SERVICE_TOKEN + IP白名单 |
| `/stats` | GET | 运营统计（消息数、会话数等） | SERVICE_TOKEN + IP白名单 |
| `/wecom/webhook` | GET | 企业微信 URL 验证（需启用） | WeCom签名 |
| `/wecom/webhook` | POST | 企业微信消息接收（需启用） | WeCom签名 |

## 支持的消息类型

| 消息类型 | 处理方式 | 认证要求 |
|---------|---------|---------|
| 文字 | 直接 AI 对话 | ✅ |
| 语音 | Whisper STT → AI（可选 TTS 回复） | ✅ |
| 图片 | AI 图片分析 | ✅ |
| 视频/文件 | AI 文件分析 | ✅ |
| 位置 | 位置相关 AI 服务 | ✅ |
| 链接 | 链接内容分析 | ✅ |
| 菜单点击 (CLICK) | 触发对应命令 | ✅ |
| 菜单链接 (VIEW) | 记录日志 | ❌ |
| 扫码关注 | 欢迎消息 + 场景识别 | ❌ |
| 已关注扫码 | 扫码确认消息 | ❌ |
| 取关事件 | 清除用户数据 + 记录日志 | ❌ |

## 用户隔离

每个通道使用独立的 Redis 键空间，微信公众号和企业微信完全隔离：

### 微信公众号（ClawBot）

| Redis Key | 类型 | 说明 |
|-----------|------|------|
| `anima:clawbot:emails` | Hash | openid → email 绑定映射 |
| `anima:clawbot:user_models` | Hash | openid → 当前模型选择 |
| `anima:clawbot:authed` | Set | 已认证用户 openid 集合 |
| `anima:clawbot:dedup:{msgId}` | String | 消息去重（TTL=5min） |

### 企业微信（WeCom）

| Redis Key | 类型 | 说明 |
|-----------|------|------|
| `anima:wecom:emails` | Hash | userid → email 绑定映射 |
| `anima:wecom:user_models` | Hash | userid → 当前模型选择 |
| `anima:wecom:authed` | Set | 已认证用户 userid 集合 |

会话上下文使用内存 LRU 缓存（每用户独立），超时自动清理。

## 依赖

- OpenClaw Agent（核心模块，AI 推理 + 工具调用）
- Redis（会话缓存 + 用户认证 + 邮箱绑定）
- Webhook 计费服务（余额查询/计费）
- Whisper STT（可选，语音转文字）
- Coqui TTS（可选，文字转语音）

## 端口

- `3004` — ClawBot Webhook 服务 + 健康检查
