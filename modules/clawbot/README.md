# 微信 ClawBot 插件灵枢接入通道 v2.4

## 概述

基于微信官方 ClawBot 插件 API，将 Anima 灵枢 AI 助手接入微信。
**使用官方微信接入方式**（扫码关注 / App 互通 / OAuth2.0 网页授权 / 官方插件商店），完全契合官方接入要求。

2026年3月22日，腾讯官方宣布在微信中推出"ClawBot"插件。本通道 v2.4 在 v2.3 全面对接官方 ClawBot 插件 API 的基础上，
新增插件验证挑战-响应、用户隐私同意管理、个性化偏好设置、合规性报告、健康仪表板等企业级功能，
全面提升安全合规水平和用户体验。

用户通过微信 ClawBot 插件与 AI 对话，支持文字、语音、图片/文件、位置、链接等消息类型。
所有功能均需登录认证后使用，用户数据强隔离保证安全。符合企业级商业运维模式。
符合 PCI-DSS v4.0 和 CIS v8 安全标准。

> **企业微信接口**：已添加完整的企业微信（WeCom）Webhook 接口，但**默认不启用**。
> 如需使用企业微信，设置 `WECOM_ENABLED=true` 并配置相关参数。

## v2.4 新特性

- **插件验证挑战-响应（ENT-2.4-1）**：新增 `POST /clawbot/plugin/verify` 端点，接受微信平台验证挑战并返回 HMAC-SHA256 签名响应。用于插件商店上架审核与定期合规性验证。
- **用户隐私同意管理（ENT-2.4-2）**：新增 `/consent` 命令和 `/consent agree` 命令，用户可查看并同意数据处理协议。同意记录持久化到新增 `clawbot_user_consent` 表（PCI-DSS v4.0 / GDPR 合规）。支持 `data_processing`、`privacy_policy`、`terms_of_service` 三种同意类型。
- **用户偏好设置（ENT-2.4-3）**：新增 `/settings` 命令管理个人偏好（语言切换、通知开关、自动语音回复）。设置持久化到新增 `clawbot_user_settings` 表，Redis 热缓存加速读取。
- **CIS v8 安全头增强（ENT-2.4-4）**：新增 `Strict-Transport-Security`（HSTS）、`Content-Security-Policy`（CSP）、`X-Content-Type-Options: nosniff`、`Referrer-Policy: strict-origin-when-cross-origin`、`Permissions-Policy`（禁用 camera/microphone/geolocation/payment）安全头。
- **数据隔离增强（ENT-2.4-5）**：新增 Redis 键命名空间校验函数。清除用户数据时增加同意状态、设置缓存、插件激活状态的清理。跨通道访问防护增强。
- **合规性报告端点（ENT-2.4-6）**：新增 `GET /clawbot/compliance/report` 生成 PCI-DSS v4.0 / CIS v8 合规自检报告。报告含安全配置状态、审计策略、加密状态、数据隔离信息、用户同意管理状态。
- **插件健康仪表板（ENT-2.4-7）**：新增 `GET /clawbot/plugin/health` 端点，返回 Redis / PostgreSQL / Agent API 详细依赖健康检查（含响应延迟）、连接池状态、内存使用、系统运行时间。
- **统计指标增强**：`/stats` 端点新增 `consentGranted`（同意授权次数）、`settingsUpdated`（设置更新次数）、`pluginVerifications`（插件验证次数）计数器。
- **数据库迁移 012**：新增 `clawbot_user_consent` 表记录用户隐私同意状态，新增 `clawbot_user_settings` 表存储用户个性化偏好。

## v2.3 新特性（历史版本）

- **官方 ClawBot 插件清单端点**：新增 `GET /clawbot/plugin/manifest` 端点，返回插件能力声明、版本、已集成功能模块列表、安全合规信息，供微信平台在插件商店中验证插件合规性与能力集。响应结构符合微信 ClawBot 插件开放规范。
- **插件状态端点**：新增 `GET /clawbot/plugin/status` 端点（需 SERVICE_TOKEN 认证），返回插件运行状态、基础设施连接状态、已认证用户数、插件激活用户数、运营指标，供运维与微信平台监控插件健康度。
- **插件生命周期事件处理**：Webhook 事件处理器新增 `plugin_activate`、`plugin_deactivate`、`plugin_update` 三种事件类型。插件激活/停用自动记录审计日志（PCI-DSS 10.2.2）并持久化到新增 `clawbot_plugin_log` 表。
- **会话静态加密（PCI-DSS 3.4）**：Redis 会话持久化采用 AES-256-GCM 加密存储。通过环境变量 `SESSION_ENCRYPT_KEY` 配置 32 字节密钥。会话数据解密仅在内存中进行（L1 缓存层）。向后兼容未加密的旧数据。
- **增强用户接入引导**：subscribe 欢迎消息新增 ClawBot 插件入口提示。`/tools` 命令新增插件管理信息展示。`/guide` 命令新增插件激活步骤引导。
- **统计指标增强**：`/stats` 端点新增 `pluginActivations`（插件激活次数）、`pluginDeactivations`（插件停用次数）、`pluginQueries`（插件查询次数）、`session_encryption`（会话加密状态）计数器。
- **数据库迁移 011**：新增 `clawbot_plugin_log` 表记录插件生命周期事件（activate/deactivate/update）。

## v2.2 新特性（历史版本）

- **快捷回复认证修复（PCI-DSS 7.1）**：快捷回复规则匹配从认证检查之前移至之后，修复未登录用户可触发快捷回复的安全漏洞。确保「所有用户必须登录才可使用」的安全要求（PCI-DSS 7.1 访问控制）。
- **模板消息送达回调（TEMPLATESENDJOBFINISH）**：新增 TEMPLATESENDJOBFINISH 事件处理，微信推送模板消息送达/失败结果时，自动回写 `clawbot_template_log` 表的 `status` 字段（delivered/failed），实现模板消息全生命周期追踪（PCI-DSS 10.2.2）。
- **群发完成回调（MASSSENDJOBFINISH）**：新增 MASSSENDJOBFINISH 事件处理，群发消息完成后自动接收微信推送的发送量/过滤量/成功量/失败量，持久化到新增 `clawbot_broadcast_log` 表。群发完成审计日志记录（PCI-DSS 10.2.2）。
- **数据库迁移 010**：新增 `clawbot_broadcast_log` 表记录群发消息完成回调结果。
- **统计指标增强**：`/stats` 端点新增 `templateCallbacks`（模板送达回调次数）和 `broadcastCallbacks`（群发完成回调次数）计数器，完善企业级运维可观测性。

## v2.1 新特性（历史版本）

- **模板消息 API**：新增 `POST /clawbot/template/send` 发送模板消息（服务通知），支持 first/keyword/remark 数据字段、跳转 URL 和小程序路径。新增 `GET /clawbot/template/list` 查询模板列表。发送记录持久化到 `clawbot_template_log` 表（PCI-DSS 10.2.2）。
- **客服会话转接**：新增 `/transfer` 用户命令和 `POST /clawbot/kf/transfer` 管理端点，支持将用户转接到人工客服。转接事件审计记录（PCI-DSS 10.2.2）。
- **快捷回复规则管理**：新增 `GET/POST/DELETE /clawbot/quickreply` 端点，支持创建精确匹配/模糊匹配的自动回复规则。规则存储在 Redis，优先级高于 AI 对话（命令除外）。
- **小程序卡片消息**：新增 `POST /clawbot/miniprogram/send` 端点，通过客服消息接口发送小程序卡片（appid/pagepath/title/thumb_media_id）。
- **统一工具入口 /tools**：新增 `/tools` 命令，汇总展示所有已集成模块的状态和用法，帮助用户快速发现可用功能。
- **增强欢迎消息快速入门**：subscribe 欢迎消息新增「🚀 快速入门」三步引导（① 绑定 → ② 对话 → ③ 查看工具），降低新用户使用门槛。
- **敏感操作二次确认**：`/unbind` 命令改为两步确认流程（PCI-DSS v4.0），用户需在指定时间内发送 `/unbind confirm` 确认解绑。
- **数据库迁移 009**：新增 `clawbot_template_log` 表记录模板消息发送历史。

## v2.0 新特性（历史版本）

- **JS-SDK 签名配置端点**：新增 `GET /clawbot/jssdk/config` 端点，生成微信 JS-SDK wx.config 所需的签名参数（appId、timestamp、nonceStr、signature），网页端可调用微信扫一扫、位置、图片预览、分享等全部 JS-SDK 能力。jsapi_ticket 自动缓存续期。
- **用户标签管理**：新增 `GET/POST/DELETE /clawbot/tags` 及 `POST/DELETE /clawbot/tags/:tagId/users` 端点，支持创建/删除标签、批量打标签/取消标签。所有标签操作记录审计日志（PCI-DSS 10.2.2）。
- **群发/广播消息**：新增 `POST /clawbot/broadcast` 群发文本消息，支持按标签群发（tag_id）或全量群发（is_to_all）。新增 `GET /clawbot/broadcast/:msgId` 查询群发状态。群发操作审计记录。
- **永久素材管理**：新增 `GET /clawbot/material/count` 查询素材总数、`POST /clawbot/material/list` 分页查询素材列表、`DELETE /clawbot/material/:mediaId` 删除永久素材。支持 image/voice/video/news 四种类型。
- **数据统计分析代理**：新增 `POST /clawbot/analytics/:metric` 代理微信数据统计接口，支持 user_summary（用户增减）、user_cumulate（累计用户）、article_summary（图文统计）、upstream_msg（消息统计）、interface_summary（接口统计）五种指标，按日期范围查询（最大 7 天）。
- **OAuth scope 持久化修复**：OAuth 授权完成后将 `oauth_scope` 写入 `clawbot_users` 表的 `oauth_scope` 列，完整对接 Migration 008。
- **版本号修复**：`/export` 数据导出版本号从 v1.8 更正为 v2.0。

## v1.9 新特性（历史版本）

- **微信 OAuth2.0 网页授权**：`/clawbot/oauth` 和 `/clawbot/oauth/callback` 端点，用户通过微信网页授权一键绑定身份。支持 `snsapi_base` 和 `snsapi_userinfo` 两种 scope。Redis CSRF state 防护（PCI-DSS 6.5）
- **功能导航 /guide**：分类展示灵枢接入通道全部能力，引导新用户快速上手
- **增强欢迎消息**：subscribe 欢迎消息展示全部功能亮点
- **Nginx 反向代理集成**：ModSecurity WAF、TLS 终结、安全头、边缘限速（PCI-DSS 6.4.1 / CIS 13）
- **OAuth 统计与审计**：`/stats` 端点新增 `oauth_initiated` / `oauth_completed` 指标
- **数据库迁移 008**：`clawbot_users` 新增 `oauth_scope` 列

## v1.8 新特性（历史版本）

- **PostgreSQL 审计日志持久化**：所有审计事件持久化写入 clawbot_audit_log 表（与 Redis/Winston 日志并行），确保审计记录不可丢失（PCI-DSS 10.2 增强）
- **PostgreSQL 用户记录持久化**：用户 bind/unbind/block/unblock 操作同步写入 clawbot_users 表，Redis 仍为 L1 实时状态层（企业级用户管理）
- **登录锁定**：/bind 连续失败达到阈值（默认 6 次）后锁定指定时长（默认 30 分钟），防止暴力绑定（PCI-DSS 8.1.6）
- **空闲会话超时**：可配置空闲会话超时（默认 15 分钟），超过空闲时间的会话自动清除上下文（PCI-DSS 8.1.8）
- **审计日志查询端点**：新增 GET /clawbot/audit 管理端点，支持按 openId/action/时间范围查询审计记录，分页返回（PCI-DSS 10.2 合规报告）
- **审计日志保留策略**：可配置保留天数（默认 365 天），定时自动清理超过保留期的审计记录（PCI-DSS 10.7）
- **管理端点用户搜索**：GET /clawbot/users 支持 search 查询参数按邮箱/昵称模糊搜索，支持 status 参数筛选活跃/封禁用户（企业级运维增强）

## v1.7 新特性（历史版本）

- **Redis 会话持久化**：会话上下文由内存迁移至 Redis 双层缓存（L1 内存 + L2 Redis），容器重启后会话不丢失（企业级可靠性）
- **管理员封禁/解封用户**：POST/DELETE `/clawbot/users/:openId/block` 端点，管理员可封禁/解封用户（CIS 访问控制），封禁操作记录审计日志
- **用户数据导出 /export**：新增 `/export` 命令，用户可导出绑定邮箱、模型偏好、会话历史等个人数据（PCI-DSS 数据可移植性）
- **微信用户资料自动获取**：用户关注时自动调用 getUserInfo API 获取昵称等基础资料，管理端点返回用户昵称
- **增强菜单事件处理**：新增 scancode_push/scancode_waitmsg 扫码事件、pic_sysphoto/pic_photo_or_album/pic_weixin 拍照事件、location_select 位置选择事件、LOCATION 地理位置上报事件
- **运营统计增强**：/stats 新增 blocked_users 封禁用户数和 export_count 数据导出次数指标
- **数据库持久化迁移**：新增 007_add_clawbot_users.sql 迁移，创建 clawbot_users 和 clawbot_audit_log 表用于持久化用户记录和审计日志（PCI-DSS 10.2.1）

## v1.6 新特性（历史版本）

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
| **OAuth2.0 网页授权** | 用户点击链接一键授权绑定，无需手动 /bind（配置 OAUTH_REDIRECT_URI 启用） | ✅ 已支持 |
| **安全模式** | AES-256-CBC 消息加解密（配置 EncodingAESKey 自动启用） | ✅ 已支持 |
| 企业微信（WeCom） | 企业微信应用消息接口 | ⬜ 已添加，默认不启用 |

## 功能

### ClawBot 核心功能
- 文字消息 → AI 对话（支持 90+ 模型）
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
- **PostgreSQL 审计日志持久化**：所有审计事件持久化写入 clawbot_audit_log 表，不可丢失（PCI-DSS 10.2 增强）
- **PostgreSQL 用户记录持久化**：用户绑定/解绑/封禁同步写入 clawbot_users 表（企业级用户管理）
- **登录锁定**：/bind 连续失败达到阈值后锁定（默认 6 次失败锁定 30 分钟，PCI-DSS 8.1.6）
- **空闲会话超时**：可配置空闲会话超时（默认 15 分钟，PCI-DSS 8.1.8）
- **审计日志查询端点**：GET /clawbot/audit 支持合规审计报告查询（PCI-DSS 10.2）
- **审计日志保留策略**：可配置保留天数（默认 365 天，PCI-DSS 10.7）
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
- /status — 查看账户状态（认证、邮箱、模型、昵称、会话信息）
- /model <模型名> — 切换 AI 模型
- /clear — 清除对话上下文
- /export — 导出个人数据（PCI-DSS 数据可移植性）
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
| `/clawbot/oauth` | GET | 微信 OAuth2.0 授权发起 | ❌ |
| `/clawbot/oauth/callback` | GET | 微信 OAuth2.0 授权回调 | ❌ |
| `/clawbot/qrcode` | GET | 生成接入二维码 | SERVICE_TOKEN + IP白名单 |
| `/clawbot/menu` | POST | 创建公众号自定义菜单 | SERVICE_TOKEN + IP白名单 |
| `/clawbot/menu` | GET | 查询当前菜单配置 | SERVICE_TOKEN + IP白名单 |
| `/clawbot/menu` | DELETE | 删除当前自定义菜单 | SERVICE_TOKEN + IP白名单 |
| `/clawbot/users` | GET | 列出已认证用户（含昵称、封禁状态） | SERVICE_TOKEN + IP白名单 |
| `/clawbot/users/:openId/block` | POST | 封禁用户 | SERVICE_TOKEN + IP白名单 |
| `/clawbot/users/:openId/block` | DELETE | 解封用户 | SERVICE_TOKEN + IP白名单 |
| `/clawbot/audit` | GET | 查询审计日志（按 openId/action/时间范围，分页） | SERVICE_TOKEN + IP白名单 |
| `/clawbot/jssdk/config` | GET | 生成 JS-SDK wx.config 签名参数 | SERVICE_TOKEN + IP白名单 |
| `/clawbot/tags` | GET | 列出所有用户标签 | SERVICE_TOKEN + IP白名单 |
| `/clawbot/tags` | POST | 创建用户标签 | SERVICE_TOKEN + IP白名单 |
| `/clawbot/tags/:tagId` | DELETE | 删除用户标签 | SERVICE_TOKEN + IP白名单 |
| `/clawbot/tags/:tagId/users` | POST | 批量为用户打标签 | SERVICE_TOKEN + IP白名单 |
| `/clawbot/tags/:tagId/users` | DELETE | 批量取消用户标签 | SERVICE_TOKEN + IP白名单 |
| `/clawbot/broadcast` | POST | 群发文本消息（按标签或全量） | SERVICE_TOKEN + IP白名单 |
| `/clawbot/broadcast/:msgId` | GET | 查询群发消息状态 | SERVICE_TOKEN + IP白名单 |
| `/clawbot/material/count` | GET | 查询永久素材总数 | SERVICE_TOKEN + IP白名单 |
| `/clawbot/material/list` | POST | 分页查询永久素材列表 | SERVICE_TOKEN + IP白名单 |
| `/clawbot/material/:mediaId` | DELETE | 删除永久素材 | SERVICE_TOKEN + IP白名单 |
| `/clawbot/analytics/:metric` | POST | 微信数据统计分析（用户/消息/接口） | SERVICE_TOKEN + IP白名单 |
| `/clawbot/template/send` | POST | 发送模板消息（服务通知） | SERVICE_TOKEN + IP白名单 |
| `/clawbot/template/list` | GET | 查询模板列表 | SERVICE_TOKEN + IP白名单 |
| `/clawbot/kf/transfer` | POST | 管理端手动转接用户到人工客服 | SERVICE_TOKEN + IP白名单 |
| `/clawbot/quickreply` | GET | 查询快捷回复规则列表 | SERVICE_TOKEN + IP白名单 |
| `/clawbot/quickreply` | POST | 创建快捷回复规则（精确/模糊匹配） | SERVICE_TOKEN + IP白名单 |
| `/clawbot/quickreply/:ruleId` | DELETE | 删除快捷回复规则 | SERVICE_TOKEN + IP白名单 |
| `/clawbot/miniprogram/send` | POST | 发送小程序卡片消息 | SERVICE_TOKEN + IP白名单 |
| `/clawbot/plugin/manifest` | GET | 插件清单（能力声明 + 安全合规信息） | ❌ |
| `/clawbot/plugin/status` | GET | 插件运行状态（用户数、基础设施） | SERVICE_TOKEN + IP白名单 |
| `/clawbot/plugin/verify` | POST | 插件验证挑战-响应（商店认证） | ❌ |
| `/clawbot/plugin/health` | GET | 插件健康仪表板（依赖检查 + 延迟监控） | SERVICE_TOKEN + IP白名单 |
| `/clawbot/compliance/report` | GET | PCI-DSS / CIS 合规性自检报告 | SERVICE_TOKEN + IP白名单 |
| `/stats` | GET | 运营统计（消息数、会话数、封禁数等） | SERVICE_TOKEN + IP白名单 |
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
| `anima:clawbot:blocked` | Set | 被封禁用户 openid 集合 |
| `anima:clawbot:nicknames` | Hash | openid → 用户昵称 |
| `anima:clawbot:session:{openId}` | String | JSON 会话数据（TTL=SESSION_TTL） |
| `anima:clawbot:bind_fail:{openId}` | String | /bind 失败次数（登录锁定，TTL=锁定时长） |
| `anima:clawbot:quickreply_rules` | String | 快捷回复规则列表（JSON） |
| `anima:clawbot:unbind_confirm:{openId}` | String | 解绑确认标记（TTL=120s） |
| `anima:clawbot:admin_csrf:{token}` | String | 管理端 CSRF token |
| `anima:clawbot:consent:{openId}` | String | 用户同意状态缓存（TTL=24h） |
| `anima:clawbot:settings:{openId}` | String | 用户设置缓存（JSON, TTL=30d） |
| `anima:clawbot:plugin_activated` | Set | 已激活插件的用户 openid 集合 |

### 企业微信（WeCom）

| Redis Key | 类型 | 说明 |
|-----------|------|------|
| `anima:wecom:emails` | Hash | userid → email 绑定映射 |
| `anima:wecom:user_models` | Hash | userid → 当前模型选择 |
| `anima:wecom:authed` | Set | 已认证用户 userid 集合 |

会话上下文使用双层缓存架构（L1 内存 LRU + L2 Redis 持久层），容器重启后自动恢复，超时自动清理。

## 依赖

- OpenClaw Agent（核心模块，AI 推理 + 工具调用）
- Redis（会话缓存 + 用户认证 + 邮箱绑定 + 登录锁定）
- PostgreSQL（审计日志持久化 + 用户记录持久化，可选但强烈推荐）
- Webhook 计费服务（余额查询/计费）
- Whisper STT（可选，语音转文字）
- Coqui TTS（可选，文字转语音）

## 端口

- `3004` — ClawBot Webhook 服务 + 健康检查
