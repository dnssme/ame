# 微信 ClawBot 插件灵枢接入通道 v3.2

## 概述

基于微信官方 ClawBot 插件 API，将 Anima 灵枢 AI 助手接入微信。
**使用官方微信接入方式**（扫码关注 / App 互通 / OAuth2.0 网页授权 / 官方插件商店），完全契合官方接入要求。

2026年3月22日，腾讯官方宣布在微信中推出"ClawBot"插件。本通道 v3.2 在全面对接官方 ClawBot 插件 API 的基础上，
实现了微信开放平台第三方平台组件授权、全局强制登录网关、增强租户隔离、Web 专属管理面板、CIS Controls v8 合规基线评估等企业级功能，
全面提升安全合规水平和用户体验。

用户通过微信 ClawBot 插件与 AI 对话，支持文字、语音、图片/文件、位置、链接等消息类型。
所有功能均需登录认证后使用，用户数据强隔离保证安全。符合企业级商业运维模式。
符合 PCI-DSS v4.0 和 CIS v8 安全标准。

> **企业微信接口**：已添加完整的企业微信（WeCom）Webhook 接口，但**默认不启用**。
> 如需使用企业微信，设置 `WECOM_ENABLED=true` 并配置相关参数。

## v3.2 新特性

- **微信开放平台第三方平台组件授权（ENT-3.2-1）**：采用官方第三方平台组件授权模型，新增 `POST /clawbot/component/verify_ticket`（接收微信平台 component_verify_ticket）和 `GET /clawbot/component/auth_callback`（授权回调）。替代自建 OAuth，对齐官方 OpenClaw 规范。
- **全局强制登录网关（ENT-3.2-2）**：新增 `requireAuthSession` 中间件，对所有用户端点强制登录（PCI-DSS 8.2 / CIS 5.1）。健康探针、Webhook、OAuth 等路径豁免。未认证请求返回 401 并附登录引导。
- **增强租户隔离（ENT-3.2-3）**：新增 `enforceRequestIsolation` 中间件，每次请求校验租户边界（HKDF 加密隔离 + 数据库 RLS）。跨租户访问尝试自动记录审计日志。
- **Web 专属管理面板（ENT-3.2-4）**：新增 `GET/PUT /clawbot/admin/api/wechat/config`（微信配置管理）、`GET /clawbot/admin/api/wechat/authorizers`（授权列表）、会话监控、权限撤销等端点。微信消息端管理命令全面封禁，降低攻击面。
- **CIS Controls v8 合规基线评估（ENT-3.2-5）**：新增 `GET /clawbot/compliance/cis`（合规状态查询）和 `POST /clawbot/compliance/cis/assess`（基线评估），覆盖 CIS 1.x/4.x/6.x/8.x/16.x 控制域，与 PCI-DSS v4.0 双框架覆盖。
- **增强统计指标（ENT-3.2-6）**：新增 componentVerifyTickets、authEnforcementBlocked、isolationViolations、cisAssessments 计数器。
- **数据库迁移 020**：新增 `clawbot_wechat_component_config`、`clawbot_wechat_authorizers`、`clawbot_auth_enforcement_log`、`clawbot_isolation_audit`、`clawbot_cis_controls` 五张表。

## v3.1 新特性（历史版本）

- **微信原生 OAuth 登录（ENT-3.1-1）**：新增 `/clawbot/auth/wechat-login` 和 `/clawbot/auth/wechat-callback` 端点，一键微信登录，零知识引导用户接入所有 ClawBot 功能。
- **插件生命周期回调（ENT-3.1-2）**：新增 `/clawbot/plugin/lifecycle` 端点，支持 install/uninstall/update/enable/disable 事件，对齐 2026-03-22 官方 ClawBot 规范。
- **统一集成中枢（ENT-3.1-3）**：新增 `/clawbot/portal/dispatch`（功能路由）和 `/clawbot/portal/integrations`（集成状态）端点，支持同步/异步调度模式。
- **行级安全策略执行（ENT-3.1-4）**：新增 `enforceRowLevelSecurity()` 中间件，PostgreSQL RLS 策略跟踪和跨租户行级访问校验（PCI-DSS 7.1）。
- **企业计费与计量（ENT-3.1-5）**：新增 `/clawbot/ops/billing`（计费概览）和 `/clawbot/ops/billing/export`（账单导出）端点。租户级功能使用量跟踪和费用聚合。
- **合规自动化（ENT-3.1-6）**：新增 `/clawbot/compliance/audit-trail`（审计轨迹）和 `/clawbot/compliance/scan`（合规扫描）端点。增强 PCI-DSS 3.5 密钥管理和 CIS 6.x 生命周期安全。
- **数据库迁移 019**：新增 `clawbot_wechat_login_sessions`、`clawbot_billing_records`、`clawbot_rls_policies`、`clawbot_plugin_lifecycle` 四张表。

## v3.0 新特性（历史版本）

- **自助引导门户（ENT-3.0-1）**：新增 `/clawbot/lingshu/onboard` 端点，零知识用户引导五步流程：注册 → 绑定 → 同意 → 激活 → 完成。
- **统一登录网关（ENT-3.0-2）**：新增 `/clawbot/auth/login`、`/auth/refresh`、`/auth/session`、`/auth/logout` 端点。HMAC-SHA256 签名令牌自动续期（PCI-DSS 8.2.4）。
- **统一功能门户（ENT-3.0-3）**：新增 `/clawbot/portal/features`、`/portal/invoke`、`/portal/status` 端点，所有功能（AI、搜索、日历、邮件、云存储、智能家居、语音等）集中管理。
- **租户加密命名空间（ENT-3.0-4）**：租户级 HKDF 密钥派生隔离。跨租户访问中间件。数据分类标签执行（CIS 4.x）。
- **合规增强（ENT-3.0-7）**：租户级密钥管理（PCI-DSS 3.5）、统一登录覆盖（8.2.4）、自动合规证据收集（10.2）。新增 `/clawbot/compliance/evidence` 端点。
- **数据库迁移 018**：新增 ClawBot v3.0 相关表。

## v2.9 新特性（历史版本）

- **统一灵枢通道（ENT-2.9-1）**：新增 `/clawbot/lingshu/connect`、`/status`、`/init` 端点，自动检测微信/企业微信/小程序平台并路由。
- **强制认证网关（ENT-2.9-2）**：全局认证中间件，HKDF 派生会话令牌自动刷新（PCI-DSS 3.5 + 8.2）。
- **增强数据隔离（ENT-2.9-3）**：行级隔间校验、加密数据边界检查、跨用户访问审计轨迹、自动数据分类标签（CIS 4.x）。
- **企业运营（ENT-2.9-5）**：新增 `/clawbot/ops/sla`、`/ops/usage`、`/ops/quota` 端点，SLA 监控、使用量计量、配额管理。
- **数据库迁移 017**：新增 ClawBot v2.9 相关表。

## v2.8 新特性（历史版本）

- **完整客服系统（ENT-2.8-1）**：客服账号管理 CRUD 端点，主动消息发送，会话状态查询。集成微信 customservice/kfaccount API。
- **内容生命周期管理（ENT-2.8-2）**：草稿、发布、评论管理。自动回复规则查询。新增 `/clawbot/draft`、`/publish`、`/comment` 端点。
- **订阅消息管理（ENT-2.8-3）**：新增 `/clawbot/subscribe/send` 和 `/subscribe/templates` 端点。
- **个性化菜单（ENT-2.8-4）**：新增 `/clawbot/menu/conditional` 端点，支持条件菜单和菜单配置测试。
- **一键引导（ENT-2.8-6）**：新增 `/quickstart` 命令，自动检测 → 自动绑定 → 自动激活。
- **数据库迁移 016**：新增 ClawBot v2.8 相关表。

## v2.7 新特性（历史版本）

- **Web 管理后台（ENT-2.7-1）**：新增 `/clawbot/admin` 单页应用，统一管理界面。Redis + PostgreSQL 双写会话管理。CSRF 保护和 IP 访问控制。
- **管理仪表板集成（ENT-2.7-2）**：实时统计、用户管理（列表/搜索/封禁）、消息管理（群发/模板/快捷回复）、公众号管理、企业运营、合规审计、插件状态。
- **管理端安全加固（ENT-2.7-3）**：会话超时 ≤15 min（PCI-DSS 8.2.8）。特权操作审计（10.2.2）。HMAC-SHA256 时序安全令牌。IP + User-Agent 会话绑定。
- **数据库迁移 015**：新增 `clawbot_admin_sessions` 表。

## v2.6 新特性（历史版本）

- **统一通道网关（ENT-2.6-1）**：新增通道注册/发现/管理端点，动态通道路由和能力矩阵查询。
- **引导向导（ENT-2.6-2）**：新增 `/setup` 命令，分步引导用户完成绑定 → 同意 → 激活 → 配置。
- **Webhook 事件中继（ENT-2.6-3）**：第三方 Webhook 订阅/推送/重试。HMAC-SHA256 签名验证（PCI-DSS 4.2.1）。
- **跨通道会话联邦（ENT-2.6-4）**：微信 ↔ 企业微信会话关联。联邦身份管理与审计日志。
- **数据库迁移 014**：新增 `clawbot_gateway` 相关表。

## v2.5 新特性（历史版本）

- **插件自助激活（ENT-2.5-1）**：新增 `/activate` 命令，一键激活。绑定 → 同意 → 激活引导流程。激活状态持久化到 Redis + PostgreSQL。
- **多租户数据隔离（ENT-2.5-2）**：新增 `clawbot_tenants` 和 `clawbot_api_keys` 表。租户级 Redis 命名空间。按租户限速和功能开关。API 密钥哈希存储（PCI-DSS 3.4）。
- **插件协议增强（ENT-2.5-3）**：新增 `/clawbot/plugin/heartbeat` 和 `/plugin/negotiate` 端点。插件清单更新 v2.5 能力声明。
- **数据库迁移 013**：新增 `clawbot_tenants` 和 `clawbot_api_keys` 表。

## v2.4 新特性（历史版本）

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
| `/clawbot/plugin/heartbeat` | POST | 插件心跳（v2.5+） | SERVICE_TOKEN |
| `/clawbot/plugin/negotiate` | POST | 插件能力协商（v2.5+） | SERVICE_TOKEN |
| `/clawbot/plugin/lifecycle` | POST | 插件生命周期回调（v3.1+） | SERVICE_TOKEN |
| `/clawbot/plugin/sdk/callback` | POST | SDK 事件回调（v2.9+） | SERVICE_TOKEN |
| `/clawbot/compliance/report` | GET | PCI-DSS / CIS 合规性自检报告 | SERVICE_TOKEN + IP白名单 |
| `/clawbot/compliance/cis` | GET | CIS Controls v8 合规状态（v3.2+） | SERVICE_TOKEN + IP白名单 |
| `/clawbot/compliance/cis/assess` | POST | CIS 合规基线评估（v3.2+） | SERVICE_TOKEN + IP白名单 |
| `/clawbot/compliance/evidence` | GET | 合规证据收集（v3.0+） | SERVICE_TOKEN + IP白名单 |
| `/clawbot/compliance/audit-trail` | GET | 审计轨迹查询（v3.1+） | SERVICE_TOKEN + IP白名单 |
| `/clawbot/compliance/scan` | POST | 合规扫描（v3.1+） | SERVICE_TOKEN + IP白名单 |
| `/clawbot/auth/wechat-login` | POST | 微信原生 OAuth 登录（v3.1+） | ❌ |
| `/clawbot/auth/wechat-callback` | GET | 微信 OAuth 回调（v3.1+） | ❌ |
| `/clawbot/auth/login` | POST | 统一登录（v3.0+） | ❌ |
| `/clawbot/auth/refresh` | POST | 令牌刷新（v3.0+） | Session |
| `/clawbot/auth/session` | GET | 会话状态查询（v3.0+） | Session |
| `/clawbot/auth/logout` | POST | 登出（v3.0+） | Session |
| `/clawbot/portal/dispatch` | POST | 统一功能路由（v3.1+） | Session |
| `/clawbot/portal/integrations` | GET | 集成状态查询（v3.1+） | SERVICE_TOKEN |
| `/clawbot/portal/features` | GET | 功能门户列表（v3.0+） | Session |
| `/clawbot/portal/invoke` | POST | 功能调用（v3.0+） | Session |
| `/clawbot/portal/status` | GET | 门户状态（v3.0+） | SERVICE_TOKEN |
| `/clawbot/lingshu/onboard` | POST | 自助引导门户（v3.0+） | ❌ |
| `/clawbot/lingshu/connect` | POST | 统一灵枢通道连接（v2.9+） | ❌ |
| `/clawbot/ops/billing` | GET | 企业计费概览（v3.1+） | SERVICE_TOKEN + IP白名单 |
| `/clawbot/ops/billing/export` | POST | 账单导出（v3.1+） | SERVICE_TOKEN + IP白名单 |
| `/clawbot/ops/dashboard` | GET | 运营仪表板（v3.0+） | SERVICE_TOKEN + IP白名单 |
| `/clawbot/component/verify_ticket` | POST | 微信组件验证票据（v3.2+） | 微信平台 |
| `/clawbot/component/auth_callback` | GET | 微信组件授权回调（v3.2+） | ❌ |
| `/clawbot/admin` | GET | Web 管理后台首页（v2.7+） | Admin Session |
| `/clawbot/admin/api/wechat/config` | GET/PUT | 微信配置管理（v3.2+） | Admin Session |
| `/clawbot/admin/api/wechat/authorizers` | GET | 授权列表查询（v3.2+） | Admin Session |
| `/clawbot/admin/api/settings` | GET | 超级管理员设置（v3.2+） | Admin Session |
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
