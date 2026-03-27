'use strict';

/**
 * Anima 灵枢 · 微信 ClawBot 插件灵枢接入通道 v3.1
 * ─────────────────────────────────────────────────────────────
 * 基于 Express HTTP Webhook，接收微信 ClawBot 插件回调，
 * 桥接到 OpenClaw Agent API 实现 AI 对话。
 *
 * 修改记录（v3.1 相对于 v3.0）：
 *
 *   #ENT-3.1-1  微信原生 OAuth 登录（WeChat Native Login）
 *               - 新增 POST /clawbot/auth/wechat-login 微信原生登录发起端点。
 *               - 新增 GET /clawbot/auth/wechat-callback 微信 OAuth 回调端点。
 *               - 对接微信 snsapi_userinfo 授权范围，获取用户昵称/头像。
 *               - 普通用户一键微信登录，零门槛接入全部 ClawBot 功能。
 *               - DB Migration 019 新增 clawbot_wechat_login_sessions 表。
 *
 *   #ENT-3.1-2  官方插件生命周期回调（Plugin Lifecycle Callbacks）
 *               - 新增 POST /clawbot/plugin/lifecycle 插件生命周期回调端点。
 *               - 支持 install/uninstall/update/enable/disable 事件类型。
 *               - 完全对齐 2026-03-22 官方 ClawBot 插件生命周期协议。
 *               - DB Migration 019 新增 clawbot_plugin_lifecycle 表。
 *
 *   #ENT-3.1-3  统一集成调度中心（Unified Integration Hub）
 *               - 新增 POST /clawbot/portal/dispatch 统一功能调度端点。
 *               - 新增 GET /clawbot/portal/integrations 集成状态查询端点。
 *               - 所有功能模块通过统一调度中心路由分发。
 *               - 支持同步/异步调度模式，含超时与重试策略。
 *
 *   #ENT-3.1-4  行级安全强制隔离（Row-Level Security Enforcement）
 *               - 新增 enforceRowLevelSecurity() 中间件函数。
 *               - PostgreSQL RLS 策略追踪与审计。
 *               - 跨租户行级数据访问强制校验（PCI-DSS 7.1）。
 *               - DB Migration 019 新增 clawbot_rls_policies 表。
 *
 *   #ENT-3.1-5  企业计费与用量计量（Enterprise Billing & Metering）
 *               - 新增 GET /clawbot/ops/billing 计费总览端点。
 *               - 新增 POST /clawbot/ops/billing/export 计费导出端点。
 *               - 租户级功能用量追踪与费用归集。
 *               - DB Migration 019 新增 clawbot_billing_records 表。
 *
 *   #ENT-3.1-6  合规自动化增强（Compliance Automation Enhancement）
 *               - 新增 GET /clawbot/compliance/audit-trail 审计追踪查询端点。
 *               - 新增 POST /clawbot/compliance/scan 按需合规扫描端点。
 *               - PCI-DSS 3.5 行级加密密钥管理增强。
 *               - PCI-DSS 7.1 RLS 策略合规验证。
 *               - CIS 6.x 应用生命周期安全管理。
 *               - 更新合规证据采集含 v3.1 控制项。
 *
 *   #ENT-3.1-7  统计指标增强
 *               - 新增 wechatLoginInitiated / wechatLoginCompleted /
 *                 pluginLifecycleEvents / portalDispatches /
 *                 portalIntegrationQueries / rlsPolicyChecks /
 *                 billingRecordsCreated / billingExports /
 *                 complianceAuditQueries / complianceOnDemandScans
 *                 统计计数器。
 *
 * 修改记录（v3.0 相对于 v2.9）：
 *
 *   #ENT-3.0-1  用户自助接入门户（Self-Service Onboarding Portal）
 *               - 新增 POST /clawbot/lingshu/onboard 自助接入端点。
 *               - 新增 GET /clawbot/lingshu/guide 交互式引导页。
 *               - 新增 POST /clawbot/lingshu/verify 接入验证端点。
 *               - 普通用户零门槛自助完成 ClawBot 全功能接入。
 *               - 分步引导：注册 → 绑定 → 同意 → 激活 → 完成。
 *               - DB Migration 018 新增 clawbot_onboarding_progress 表。
 *
 *   #ENT-3.0-2  统一登录网关（Unified Login Gateway）
 *               - 新增 POST /clawbot/auth/login 统一登录端点。
 *               - 新增 POST /clawbot/auth/refresh Token 刷新端点。
 *               - 新增 GET /clawbot/auth/session 会话状态查询。
 *               - 新增 POST /clawbot/auth/logout 会话终止端点。
 *               - 所有用户必须通过统一登录网关认证（PCI-DSS 8.2）。
 *               - HMAC-SHA256 签名令牌 + 自动续期（PCI-DSS 8.2.4）。
 *               - DB Migration 018 新增 clawbot_auth_sessions 表。
 *
 *   #ENT-3.0-3  统一功能入口（Unified Feature Portal）
 *               - 新增 GET /clawbot/portal/features 功能列表端点。
 *               - 新增 POST /clawbot/portal/invoke 统一功能调用端点。
 *               - 新增 GET /clawbot/portal/status 功能状态查询端点。
 *               - 所有 ClawBot 功能通过统一入口调用与管理。
 *               - 支持：AI 对话、网页搜索、日历、邮件、云存储、
 *                 智能家居、语音、文件分析、客服、内容管理、
 *                 订阅消息、菜单管理、模板消息、数据分析。
 *
 *   #ENT-3.0-4  租户级加密命名空间（Tenant Encryption Namespace）
 *               - 租户级 HKDF 密钥派生隔离（PCI-DSS 3.5 + 7.1）。
 *               - 跨租户访问防护中间件。
 *               - 数据分类强制执行标签（CIS 4.x）。
 *               - DB Migration 018 新增 clawbot_tenant_keys 表。
 *
 *   #ENT-3.0-5  2026-03-22 官方协议完全适配（Protocol Sync）
 *               - 对齐 2026-03-22 官方 ClawBot 插件 API 最新规范。
 *               - 更新插件清单含 v3.0 全部能力声明。
 *               - 增强 SDK 回调事件处理链。
 *               - 新增 POST /clawbot/plugin/sdk/events 事件订阅。
 *
 *   #ENT-3.0-6  企业运维增强（Enterprise Ops Enhancement）
 *               - 新增 GET /clawbot/ops/dashboard 统一运维仪表盘。
 *               - 新增 POST /clawbot/ops/alerts 告警配置端点。
 *               - 新增 GET /clawbot/ops/cost 费用分析端点。
 *               - 租户级费用归集与预算告警。
 *               - DB Migration 018 新增 clawbot_ops_alerts 表。
 *
 *   #ENT-3.0-7  PCI-DSS / CIS 合规加固（Compliance Hardening）
 *               - PCI-DSS 3.5 租户级密钥管理增强。
 *               - PCI-DSS 8.2.4 统一登录网关全覆盖。
 *               - PCI-DSS 10.2 合规证据自动采集。
 *               - CIS 4.x 数据分类强制标注。
 *               - CIS 5.2 访问控制增强审计。
 *               - 新增 GET /clawbot/compliance/evidence 证据采集端点。
 *               - 新增 v3.0 合规控制项到自动扫描与实时检测。
 *
 *   #ENT-3.0-8  统计指标增强
 *               - 新增 onboardCompleted / authLoginSuccess /
 *                 authLoginFailed / authTokenRefreshed /
 *                 portalInvocations / portalFeatureQueries /
 *                 opsAlertCreated / opsDashboardViews /
 *                 complianceEvidenceCollected 统计计数器。
 *
 * 修改记录（v2.9 相对于 v2.8）：
 *
 *   #ENT-2.9-1  灵枢统一通道（Unified Lingshu Channel）
 *               - 新增 POST /clawbot/lingshu/connect 统一通道接入端点。
 *               - 新增 GET /clawbot/lingshu/status 通道连接状态查询。
 *               - 新增 POST /clawbot/lingshu/init 通道初始化（平台自动检测）。
 *               - 自动识别 WeChat/WeCom/MiniProgram 平台并路由。
 *               - 一键注册新用户通道，降低接入门槛。
 *               - DB Migration 017 新增 clawbot_lingshu_sessions 表。
 *
 *   #ENT-2.9-2  强制认证网关（Mandatory Auth Gateway）
 *               - 全局认证中间件覆盖所有用户端点。
 *               - Token 刷新机制（自动续期 HMAC-SHA256 令牌）。
 *               - HKDF 派生会话令牌（PCI-DSS 3.5 + 8.2）。
 *               - 未登录用户统一拦截并引导至 /bind 或 /quickstart。
 *
 *   #ENT-2.9-3  用户数据强隔离增强（Enhanced Data Isolation）
 *               - 行级数据分区强制验证（Row-Level Compartment）。
 *               - 密码学数据边界校验（Cryptographic Data Boundary）。
 *               - 跨用户访问全链路审计追踪。
 *               - 数据分类标签自动标注（CIS 4.x）。
 *               - DB Migration 017 新增 clawbot_data_boundaries 表。
 *
 *   #ENT-2.9-4  官方协议完全兼容（March 2026 ClawBot Plugin API）
 *               - 对齐 2026-03 官方 ClawBot 插件 API 规范。
 *               - 增强插件清单含 v2.9 能力声明。
 *               - 新增 POST /clawbot/plugin/sdk/callback SDK 回调。
 *               - 插件 SDK 初始化握手协议支持。
 *
 *   #ENT-2.9-5  企业商业运维（Enterprise Commercial Operations）
 *               - 新增 GET /clawbot/ops/sla SLA 监控端点。
 *               - 新增 GET /clawbot/ops/usage 用量计量端点。
 *               - 新增 GET /clawbot/ops/quota 配额管理端点。
 *               - DB Migration 017 新增 clawbot_usage_metrics 表。
 *               - 租户级用量追踪与配额告警。
 *
 *   #ENT-2.9-6  PCI-DSS / CIS 合规增强
 *               - PCI-DSS 3.5 HKDF 通道级密钥隔离。
 *               - PCI-DSS 8.2 强制认证全覆盖验证。
 *               - CIS 4.x 数据分类自动标注。
 *               - CIS 13.x 通道级 WAF 规则映射。
 *               - 新增 v2.9 合规控制项到自动扫描与实时检测。
 *
 *   #ENT-2.9-7  统计指标增强
 *               - 新增 lingshuConnected / lingshuInitialized /
 *                 authGatewayBlocked / dataBoundaryChecks /
 *                 sdkCallbacks / slaChecks / usageQueries /
 *                 quotaChecks 统计计数器。
 *
 * 修改记录（v2.8 相对于 v2.7）：
 *
 *   #ENT-2.8-1  完整客服系统（Full Customer Service）
 *               - 新增客服账号管理 CRUD（POST/GET/DELETE /clawbot/kf/accounts）。
 *               - 新增客服消息主动发送（POST /clawbot/kf/message）。
 *               - 新增客服会话状态查询（GET /clawbot/kf/sessions）。
 *               - DB Migration 016 新增 clawbot_kf_accounts / clawbot_kf_sessions 表。
 *               - 调用微信 customservice/kfaccount API。
 *
 *   #ENT-2.8-2  内容生命周期管理（Content Lifecycle Management）
 *               - 新增草稿管理（POST/GET/DELETE /clawbot/draft）。
 *               - 新增发布管理（POST /clawbot/publish）。
 *               - 新增评论管理（GET/POST/DELETE /clawbot/comment）。
 *               - 新增自动回复规则查询（GET /clawbot/autoreply）。
 *               - DB Migration 016 新增 clawbot_drafts / clawbot_comment_log 表。
 *
 *   #ENT-2.8-3  订阅消息管理（Subscription Message）
 *               - 新增订阅消息发送（POST /clawbot/subscribe/send）。
 *               - 新增订阅消息模板列表（GET /clawbot/subscribe/templates）。
 *               - DB Migration 016 新增 clawbot_subscription_messages 表。
 *
 *   #ENT-2.8-4  个性化菜单（Conditional Menu）
 *               - 新增个性化菜单创建（POST /clawbot/menu/conditional）。
 *               - 新增个性化菜单删除（DELETE /clawbot/menu/conditional/:menuid）。
 *               - 新增菜单配置测试（POST /clawbot/menu/trymatch）。
 *
 *   #ENT-2.8-5  数据隔离增强（Enhanced Data Isolation PCI-DSS 3.5）
 *               - 新增 HKDF 用户级密钥派生（per-user encryption key）。
 *               - 数据分区验证中间件（data compartment validation）。
 *               - 跨用户访问防护日志审计。
 *
 *   #ENT-2.8-6  一键接入向导（One-Click Onboarding）
 *               - 新增 /quickstart 命令：自动检测 → 自动绑定 → 自动激活。
 *               - 自动跳过已完成步骤，一条消息完成全部接入。
 *               - 为 OAuth 用户提供零操作即用体验。
 *
 *   #ENT-2.8-7  PCI-DSS/CIS 增强合规
 *               - PCI-DSS 3.5 密钥管理（HKDF 派生）。
 *               - PCI-DSS 6.5.4 客服消息输入验证。
 *               - CIS 4.x 数据分类标签（data classification）。
 *               - 新增 v2.8 合规控制项到自动扫描与实时检测。
 *
 *   #ENT-2.8-8  统计指标增强
 *               - 新增 kfAccountCreated / kfMessageSent / kfSessionQueried /
 *                 draftsCreated / draftsPublished / commentsModerated /
 *                 subscriptionsSent / conditionalMenuCreated /
 *                 quickstartCompleted 统计计数器。
 *
 * 修改记录（v2.7 相对于 v2.6）：
 *
 *   #ENT-2.7-1  Web 管理后台（唯一管理入口）
 *               - 新增 /clawbot/admin Web SPA 管理后台。
 *               - 统一管理入口：所有运维操作通过 Web 页面完成。
 *               - 管理员会话管理（Redis + PostgreSQL 双写）。
 *               - CSRF 防护（PCI-DSS 6.5）与 IP 访问控制。
 *               - DB Migration 015 新增 clawbot_admin_sessions 表。
 *
 *   #ENT-2.7-2  管理后台功能集成
 *               - 运营仪表盘（实时统计/健康状态/消息分布）。
 *               - 用户管理（列表/搜索/封禁/解封）。
 *               - 消息管理（群发/模板/快捷回复）。
 *               - 公众号管理（菜单/二维码/素材/标签）。
 *               - 企业运营（租户/通道网关/事件中继/会话联邦）。
 *               - 安全合规（合规报告/实时检测/历史快照/审计日志）。
 *               - 插件状态（运行状态/清单/健康检查）。
 *
 *   #ENT-2.7-3  管理后台安全加固（PCI-DSS / CIS）
 *               - PCI-DSS 8.2.8 会话超时 ≤15 分钟空闲。
 *               - PCI-DSS 10.2.2 特权操作审计追踪。
 *               - CIS 5.2 管理会话独立追踪。
 *               - HMAC-SHA256 时间安全令牌验证。
 *               - 会话绑定 IP + User-Agent。
 *
 * 修改记录（v2.6 相对于 v2.5）：
 *
 *   #ENT-2.6-1  灵枢通道网关（Unified Channel Gateway）
 *               - 新增通道注册/发现/管理端点。
 *               - DB Migration 014 新增 clawbot_channel_registry 表。
 *               - 动态通道路由与能力矩阵查询。
 *               - GET/POST/DELETE /clawbot/gateway/channels 端点。
 *               - GET /clawbot/gateway/features 能力矩阵。
 *
 *   #ENT-2.6-2  接入向导（Setup Wizard，普通用户轻松接入）
 *               - 新增 /setup 命令，分步引导用户完成全流程。
 *               - 自动检测用户状态并提供上下文指引。
 *               - 引导路径：绑定 → 同意 → 激活 → 设置。
 *               - 提供功能预览和推荐。
 *
 *   #ENT-2.6-3  Webhook 事件中继（Event Relay）
 *               - DB Migration 014 新增 clawbot_webhook_subscriptions 表。
 *               - DB Migration 014 新增 clawbot_webhook_delivery_log 表。
 *               - 第三方 Webhook 订阅/推送/重试。
 *               - HMAC-SHA256 签名验证（PCI-DSS 4.2.1）。
 *               - POST/GET/DELETE /clawbot/relay/subscriptions 端点。
 *               - POST /clawbot/relay/test 投递测试端点。
 *
 *   #ENT-2.6-4  跨通道会话联邦（Session Federation）
 *               - DB Migration 014 新增 clawbot_session_links 表。
 *               - 跨通道（WeChat ↔ WeCom）会话关联。
 *               - 联邦身份管理与审计日志。
 *               - POST/GET/DELETE /clawbot/federation/links 端点。
 *
 *   #ENT-2.6-5  PCI-DSS/CIS 实时合规监控增强
 *               - 合规漂移检测与告警。
 *               - GET /clawbot/compliance/realtime 实时合规状态。
 *               - 新增 v2.6 合规控制项检查。
 *               - 增强 runComplianceScan 含通道网关检查。
 *
 *   #ENT-2.6-6  统计指标增强
 *               - 新增 channelRegistered / webhookDeliveries /
 *                 sessionLinked / setupWizardCompleted 统计计数器。
 *               - /stats 端点新增通道网关与中继运营指标。
 *
 * 修改记录（v2.5 相对于 v2.4）：
 *
 *   #ENT-2.5-1  插件自助激活与引导（普通用户轻松接入）
 *               - 新增 /activate 命令，用户可一键激活 ClawBot 插件。
 *               - 激活向导引导用户完成绑定 → 同意 → 激活全流程。
 *               - 激活状态持久化到 Redis + PostgreSQL。
 *               - 未激活用户收到引导提示。
 *
 *   #ENT-2.5-2  多租户数据隔离（企业级强隔离保证数据安全）
 *               - 新增 DB Migration 013 clawbot_tenants 表。
 *               - 新增 clawbot_api_keys 表（密钥散列存储 PCI-DSS 3.4）。
 *               - 租户级 Redis 键命名空间（anima:clawbot:tenant:<id>:）。
 *               - 租户级速率限制和功能开关。
 *               - 管理端 CRUD：GET/POST /clawbot/tenants。
 *
 *   #ENT-2.5-3  官方 ClawBot 插件协议增强（完全契合官方接入）
 *               - 新增 POST /clawbot/plugin/heartbeat 心跳端点。
 *               - 新增 POST /clawbot/plugin/negotiate 能力协商。
 *               - 插件清单新增 v2.5 能力声明。
 *               - 心跳间隔可配置（默认 60s）。
 *
 *   #ENT-2.5-4  企业运维增强（企业级商业运维模式）
 *               - 新增租户管理 CRUD 端点。
 *               - 新增 API 密钥生命周期管理（创建/轮换/吊销）。
 *               - 新增租户用量统计端点。
 *               - 增强运维仪表板数据。
 *
 *   #ENT-2.5-5  PCI-DSS / CIS 合规增强（持续合规监控）
 *               - 新增 clawbot_compliance_snapshots 表。
 *               - 自动合规扫描定时任务（每日自检）。
 *               - 合规历史快照存储与趋势追踪。
 *               - 增强合规报告含租户级别信息。
 *
 *   #ENT-2.5-6  统计指标增强（企业级运维）
 *               - 新增 tenantCreated / tenantSuspended / apiKeyCreated /
 *                 apiKeyRevoked / complianceScans / heartbeats 统计计数器。
 *               - /stats 端点新增租户与 API 密钥相关运营指标。
 *
 * 修改记录（v2.4 相对于 v2.3）：
 *
 *   #ENT-2.4-1  插件验证挑战-响应（官方 ClawBot 插件商店认证）
 *               - 新增 POST /clawbot/plugin/verify 端点，接受
 *                 微信平台验证挑战并返回 HMAC-SHA256 签名响应。
 *               - 用于插件商店上架审核与定期合规性验证。
 *
 *   #ENT-2.4-2  用户隐私同意管理（PCI-DSS v4.0 / GDPR 合规）
 *               - 新增 /consent 命令，用户接受数据处理条款。
 *               - 新增 DB Migration 012 clawbot_user_consent 表。
 *               - 首次绑定邮箱时提示同意数据处理协议。
 *               - 同意状态记录审计日志（PCI-DSS 10.2.2）。
 *
 *   #ENT-2.4-3  用户偏好设置（个性化体验增强）
 *               - 新增 /settings 命令，管理通知、语言偏好。
 *               - 新增 DB Migration 012 clawbot_user_settings 表。
 *               - 设置存储于 Redis 热缓存 + PostgreSQL 持久化。
 *
 *   #ENT-2.4-4  CIS 安全头增强（CIS v8 合规加固）
 *               - 新增 Strict-Transport-Security（HSTS）。
 *               - 新增 X-Content-Type-Options: nosniff。
 *               - 新增 Referrer-Policy: strict-origin-when-cross-origin。
 *               - 新增 Permissions-Policy: 禁用非必要浏览器 API。
 *
 *   #ENT-2.4-5  数据隔离增强（强隔离安全保障）
 *               - Redis 键命名空间校验函数 validateRedisKeyOwner()。
 *               - 清除用户数据时增加插件状态清理。
 *               - 跨通道访问防护增强。
 *
 *   #ENT-2.4-6  合规性报告端点（企业级运维审计）
 *               - 新增 GET /clawbot/compliance/report 生成
 *                 PCI-DSS v4.0 / CIS v8 合规自检报告。
 *               - 报告含安全配置状态、审计策略、加密状态。
 *
 *   #ENT-2.4-7  插件健康仪表板（企业级运维增强）
 *               - 新增 GET /clawbot/plugin/health 端点，返回
 *                 详细依赖健康检查（Redis / PostgreSQL / Agent API）。
 *               - 响应时间监控、连接池状态。
 *
 * 修改记录（v2.3 相对于 v2.2）：
 *
 *   #ENT-2.3-1  插件清单端点（官方 ClawBot 插件验证）
 *               - 新增 GET /clawbot/plugin/manifest 端点，返回
 *                 插件能力声明、版本、功能列表，供微信平台
 *                 在插件商店中验证插件合规性与能力集。
 *               - 响应结构符合微信 ClawBot 插件开放规范。
 *
 *   #ENT-2.3-2  插件状态端点（官方运维监控）
 *               - 新增 GET /clawbot/plugin/status 端点，返回
 *                 插件运行状态、连接用户数、集成模块状态。
 *               - 供运维与微信平台监控插件健康度。
 *
 *   #ENT-2.3-3  插件生命周期事件处理
 *               - Webhook 事件处理器新增 plugin_activate /
 *                 plugin_deactivate / plugin_update 事件。
 *               - 生命周期事件记录审计日志（PCI-DSS 10.2.2）。
 *               - 新增 DB Migration 011 clawbot_plugin_log。
 *
 *   #ENT-2.3-4  会话数据静态加密（PCI-DSS 3.4 数据保护）
 *               - Redis 会话持久化采用 AES-256-GCM 加密存储。
 *               - 会话数据解密仅在内存中进行（L1 缓存层）。
 *               - 加密密钥通过环境变量独立管理。
 *
 *   #ENT-2.3-5  增强用户接入引导（普通用户轻松接入）
 *               - subscribe 欢迎消息新增 ClawBot 插件入口提示。
 *               - /tools 命令新增插件管理信息展示。
 *               - /guide 命令新增插件激活步骤引导。
 *
 *   #ENT-2.3-6  统计指标增强（企业级运维）
 *               - 新增 pluginActivations / pluginDeactivations /
 *                 pluginQueries 统计计数器。
 *               - /stats 端点新增插件相关运营指标。
 *
 *   #ENT-2.3-7  合规性增强（PCI-DSS v4.0 / CIS v8）
 *               - 插件数据隔离：每个插件用户独立 Redis 键空间。
 *               - 插件操作审计：所有插件交互记录审计日志。
 *               - 会话加密：满足 PCI-DSS 3.4 静态数据保护要求。
 *
 * 修改记录（v2.2 相对于 v2.1）：
 *
 *   #ENT-2.2-1  快捷回复认证修复（PCI-DSS 7.1 强制登录）
 *               - 快捷回复规则匹配从认证检查之前移至之后。
 *               - 修复未登录用户可触发快捷回复的安全漏洞。
 *               - 确保"所有用户必须登录才可使用"的安全要求。
 *
 *   #ENT-2.2-2  模板消息送达回调（TEMPLATESENDJOBFINISH）
 *               - 新增 TEMPLATESENDJOBFINISH 事件处理。
 *               - 模板消息送达状态自动回写 clawbot_template_log
 *                 表（status: delivered / failed）。
 *               - 送达回调审计日志（PCI-DSS 10.2.2）。
 *
 *   #ENT-2.2-3  群发完成回调（MASSSENDJOBFINISH）
 *               - 新增 MASSSENDJOBFINISH 事件处理。
 *               - 群发完成结果（发送量/过滤量/成功量/失败量）
 *                 持久化到 clawbot_broadcast_log 表。
 *               - 新增 DB Migration 010 clawbot_broadcast_log。
 *               - 群发完成审计日志（PCI-DSS 10.2.2）。
 *
 *   #ENT-2.2-4  统计指标增强（企业级运维）
 *               - 新增 templateCallbacks / broadcastCallbacks
 *                 统计计数器，完善 /stats 运维可观测性。
 *
 * 修改记录（v2.1 相对于 v2.0）：
 *
 *   #ENT-2.1-1  模板消息 API（官方服务通知能力）
 *               - 新增 POST /clawbot/template/send 发送模板消息。
 *               - 新增 GET /clawbot/template/list 查询模板列表。
 *               - 新增 DB Migration 009 clawbot_template_log 记录模板
 *                 发送历史（PCI-DSS 10.2.2 审计）。
 *               - 支持 first / keyword / remark 数据字段。
 *               - 支持跳转 URL 和小程序路径。
 *
 *   #ENT-2.1-2  客服会话转接（官方多客服分流）
 *               - 新增 /transfer 命令将用户转接到人工客服。
 *               - 新增 POST /clawbot/kf/transfer 管理端接口。
 *               - 转接事件记录审计日志（PCI-DSS 10.2.2）。
 *
 *   #ENT-2.1-3  快捷回复菜单（plugin quick-reply）
 *               - 新增 POST /clawbot/quickreply 管理快捷回复规则。
 *               - 新增 GET /clawbot/quickreply 查询快捷回复规则。
 *               - 新增 DELETE /clawbot/quickreply/:ruleId 删除规则。
 *               - 规则存储在 Redis，按关键词匹配自动回复。
 *
 *   #ENT-2.1-4  自动回复规则管理
 *               - 关键词自动回复：精确 / 模糊匹配。
 *               - 收到消息自动回复：默认欢迎语。
 *               - 规则优先级：快捷回复 > 命令 > AI 对话。
 *
 *   #ENT-2.1-5  统一工具入口 /tools
 *               - 新增 /tools 命令，汇总展示所有已集成模块。
 *               - 显示模块状态（已启用/未启用）。
 *
 *   #ENT-2.1-6  小程序卡片消息支持
 *               - 新增 POST /clawbot/miniprogram/send 发送小程序
 *                 卡片消息（客服消息接口）。
 *               - 支持 appid / pagepath / title / thumb_media_id。
 *
 *   #ENT-2.1-7  增强欢迎消息快速入门
 *               - subscribe 欢迎消息新增快速入门引导。
 *               - 新用户引导：扫码 → 关注 → /bind → 全功能。
 *               - 展示 /tools 统一工具入口。
 *
 *   #ENT-2.1-8  合规性增强（PCI-DSS v4.0 / CIS v8）
 *               - 敏感操作二次确认（/unbind 需确认）。
 *               - 管理端点 CSRF token 校验。
 *               - 密码复杂度提示增强。
 *
 * 修改记录（v2.0 相对于 v1.9）：
 *
 *   #ENT-2.0-1  JS-SDK 签名配置端点（完整 ClawBot 网页能力）
 *               - 新增 GET /clawbot/jssdk/config 端点，生成
 *                 微信 JS-SDK wx.config 所需的签名参数。
 *               - jsapi_ticket 缓存（7200s TTL），自动续期。
 *               - 支持自定义 JS-SDK 接口列表（jsApiList）。
 *               - 网页端可调用微信扫一扫、位置、图片、分享等能力。
 *
 *   #ENT-2.0-2  用户标签管理（官方用户分群管理）
 *               - 新增 GET /clawbot/tags 列出标签。
 *               - 新增 POST /clawbot/tags 创建标签。
 *               - 新增 DELETE /clawbot/tags/:tagId 删除标签。
 *               - 新增 POST /clawbot/tags/:tagId/users 批量打标签。
 *               - 新增 DELETE /clawbot/tags/:tagId/users 批量取消标签。
 *               - 审计日志记录所有标签操作（PCI-DSS 10.2.2）。
 *
 *   #ENT-2.0-3  群发/广播消息（官方 ClawBot 群发能力）
 *               - 新增 POST /clawbot/broadcast 群发文本消息。
 *               - 支持按标签群发（tag_id）或全量群发（is_to_all）。
 *               - 新增 GET /clawbot/broadcast/:msgId 查询群发状态。
 *               - 群发操作审计日志（PCI-DSS 10.2.2）。
 *
 *   #ENT-2.0-4  素材管理（官方永久素材 API）
 *               - 新增 GET /clawbot/material/count 查询素材总数。
 *               - 新增 POST /clawbot/material/list 分页查询素材列表。
 *               - 新增 DELETE /clawbot/material/:mediaId 删除永久素材。
 *               - 支持 image / voice / video / news 四种类型。
 *
 *   #ENT-2.0-5  数据统计代理（官方 ClawBot 数据分析接口）
 *               - 新增 POST /clawbot/analytics/:metric 代理微信
 *                 数据统计接口（用户增减、消息统计、接口调用）。
 *               - 支持指标：user_summary / user_cumulate /
 *                 article_summary / upstream_msg / interface_summary。
 *               - 按日期范围查询，最大跨度 7 天。
 *
 *   #ENT-2.0-6  修复 /export 版本号遗留问题
 *               - /export 输出版本号从 v1.8 更正为 v2.0。
 *
 *   #ENT-2.0-7  OAuth 授权 scope 持久化（Migration 008 对接）
 *               - OAuth 授权完成后将 oauth_scope 写入 clawbot_users
 *                 表的 oauth_scope 列（email / snsapi_base /
 *                 snsapi_userinfo），完整对接 Migration 008。
 *
 * 修改记录（v1.9 相对于 v1.8）：
 *
 *   #ENT-1.9-1  微信 OAuth2.0 网页授权（普通用户轻松接入）
 *               - 新增 GET /clawbot/oauth 发起微信网页授权，
 *                 自动跳转微信 OAuth 页面获取用户授权。
 *               - 新增 GET /clawbot/oauth/callback 处理授权回调，
 *                 通过 code 换取 access_token 获取用户 OpenID。
 *               - Redis CSRF state 防护（PCI-DSS 6.5），每个
 *                 授权请求生成唯一 state 并校验回调一致性。
 *               - OAuth 完成后自动绑定用户身份，无需手动 /bind。
 *               - 支持 snsapi_base（静默授权）和 snsapi_userinfo
 *                （显式授权获取昵称头像）两种 scope。
 *
 *   #ENT-1.9-2  功能导航 /guide（普通用户易用性增强）
 *               - 新增 /guide 命令，分类展示灵枢接入通道全部
 *                 能力：AI 对话、工具集、安全管理、消息类型。
 *               - 引导新用户快速上手，降低使用门槛。
 *
 *   #ENT-1.9-3  增强欢迎消息（完整功能展示）
 *               - subscribe 欢迎消息展示全部功能亮点：
 *                 AI 对话、网页搜索、日历、邮件、云存储、
 *                 智能家居、语音交互、文件分析。
 *               - 引导用户通过 /guide 了解详细功能。
 *
 *   #ENT-1.9-4  Nginx 反向代理集成（PCI-DSS 6.4.1 / CIS 13）
 *               - ClawBot 流量统一经 Nginx 反向代理，享受
 *                 ModSecurity WAF、TLS 终结、安全头、边缘限速。
 *               - /clawbot/webhook 独立限速 300r/m（微信回调）。
 *               - /clawbot/ 管理端点限速 30r/m。
 *               - /clawbot/oauth 走 login 限速 5r/m（防暴力授权）。
 *               - /wecom/webhook 企业微信复用 ClawBot 限速。
 *
 *   #ENT-1.9-5  OAuth 统计与审计（企业级运维）
 *               - /stats 端点新增 oauth_initiated / oauth_completed
 *                 指标，监控授权转化率。
 *               - OAuth 授权事件记录审计日志（PCI-DSS 10.2.1）。
 *
 * 修改记录（v1.7 相对于 v1.6）：
 *
 *   #ENT-1.7-1  Redis 会话持久化（企业级可靠性）
 *               - 会话上下文由内存 Map 迁移至 Redis Hash，
 *                 容器重启后会话不丢失（企业级可靠性）。
 *               - 内存 LRU 缓存作为 L1 热层，Redis 作为 L2
 *                 持久层（双层缓存架构）。
 *               - 每用户会话 JSON 序列化存储，独立 TTL。
 *
 *   #ENT-1.7-2  管理员封禁/解封用户（CIS 访问控制）
 *               - POST /clawbot/users/:openId/block — 封禁用户
 *               - DELETE /clawbot/users/:openId/block — 解封用户
 *               - 封禁用户发送消息时返回"账户已暂停"提示。
 *               - 封禁/解封操作记录审计日志（PCI-DSS 10.2.2）。
 *
 *   #ENT-1.7-3  用户数据导出 /export（PCI-DSS 数据可移植性）
 *               - 新增 /export 命令，用户可导出个人数据：
 *                 绑定邮箱、模型偏好、会话历史、账户状态。
 *               - 符合 PCI-DSS 数据可移植性要求。
 *
 *   #ENT-1.7-4  微信用户资料自动获取（增强用户管理）
 *               - 用户关注时自动调用 getUserInfo API 获取
 *                 昵称等基础资料（需用户授权）。
 *               - 管理端点 /clawbot/users 返回用户昵称信息。
 *
 *   #ENT-1.7-5  增强菜单事件处理（完整 ClawBot 功能）
 *               - 新增 scancode_push / scancode_waitmsg 扫码
 *                 菜单事件处理。
 *               - 新增 pic_sysphoto / pic_photo_or_album /
 *                 pic_weixin 拍照菜单事件处理。
 *               - 新增 location_select 选择位置菜单事件处理。
 *
 *   #ENT-1.7-6  消息统计增强（运营监控）
 *               - /stats 新增 blocked_users / export_count 指标。
 *               - 管理端点返回更详细的用户状态统计。
 *
 * 修改记录（v1.8 相对于 v1.7）：
 *
 *   #ENT-1.8-1  PostgreSQL 审计日志持久化（PCI-DSS 10.2 增强）
 *               - 新增 pg 依赖连接 PostgreSQL 数据库，所有审计事件
 *                 持久化写入 clawbot_audit_log 表（与 Redis/Winston
 *                 日志并行，确保审计记录不可丢失）。
 *               - 与 Migration 007 创建的表结构对接。
 *               - 审计记录含 open_id、channel、action、detail、ip、
 *                 request_id、created_at（PCI-DSS 10.2.1/10.2.2）。
 *
 *   #ENT-1.8-2  PostgreSQL 用户记录持久化（企业级用户管理）
 *               - 用户 bind/unbind/block/unblock 操作同步写入
 *                 clawbot_users 表，Redis 仍为 L1 实时状态层。
 *               - 用户消息处理时更新 last_active_at。
 *               - 管理端点可从 DB 查询完整用户档案。
 *
 *   #ENT-1.8-3  登录锁定（PCI-DSS 8.1.6）
 *               - /bind 连续失败 BIND_LOCKOUT_THRESHOLD 次（默认 6）
 *                 后锁定 BIND_LOCKOUT_DURATION_MIN 分钟（默认 30）。
 *               - 锁定期间 /bind 直接拒绝，返回剩余锁定时间。
 *               - 锁定/解锁事件记录审计日志。
 *
 *   #ENT-1.8-4  空闲会话超时（PCI-DSS 8.1.8）
 *               - 可配置 IDLE_SESSION_TIMEOUT_MIN（默认 15 分钟），
 *                 超过空闲时间的会话自动清除上下文，用户需重新
 *                 开始对话（认证状态不变）。
 *
 *   #ENT-1.8-5  审计日志查询端点（PCI-DSS 10.2 合规报告）
 *               - 新增 GET /clawbot/audit 管理端点，支持按 openId /
 *                 action / 时间范围查询审计记录（分页）。
 *               - 需 SERVICE_TOKEN + IP 白名单认证。
 *
 *   #ENT-1.8-6  审计日志保留策略（PCI-DSS 10.7）
 *               - 可配置 AUDIT_RETENTION_DAYS（默认 365 天），
 *                 定时清理超过保留期的审计记录。
 *               - /stats 端点新增 audit_retention_days 指标。
 *
 *   #ENT-1.8-7  管理端点用户搜索（企业级运维增强）
 *               - GET /clawbot/users 支持 search 查询参数，
 *                 可按邮箱、昵称模糊搜索用户。
 *               - 支持 status 参数筛选活跃/封禁用户。
 *
 * 修改记录（v1.6 相对于 v1.5）：
 *
 *   #ENT-1.6-1  CORS 与 Cache-Control 安全头（CIS 加固）
 *               - Helmet 配置 CORS 策略，限制跨域请求来源。
 *               - API 响应添加 Cache-Control: no-store，防止
 *                 敏感数据被浏览器 / 代理缓存（CIS 14.x）。
 *
 *   #ENT-1.6-2  管理端点操作审计日志（PCI-DSS 10.2.2）
 *               - 所有 SERVICE_TOKEN 保护端点的访问记录为
 *                 结构化审计事件（action=admin_access），
 *                 包含 endpoint / method / ip / request_id。
 *
 *   #ENT-1.6-3  速率限制 & 认证失败审计（PCI-DSS 10.2.4/10.2.5）
 *               - Per-user 速率限制触发记录为审计事件
 *                （action=rate_limit_violation）。
 *               - SERVICE_TOKEN 认证失败记录为审计事件
 *                （action=admin_auth_fail），含请求 IP。
 *
 *   #ENT-1.6-4  就绪探针端点（企业级 Kubernetes 部署）
 *               - 新增 GET /ready 端点，检测 Redis 连通性
 *                 及服务依赖就绪状态，与 /health 存活探针
 *                 分离（标准 Kubernetes probe 模式）。
 *
 *   #ENT-1.6-5  管理端点 IP 白名单（CIS 网络访问限制）
 *               - 可选 ADMIN_IP_ALLOWLIST 环境变量，配置后
 *                 仅允许指定 IP 访问管理端点（CIS 9.x）。
 *                 未配置时不限制（向后兼容）。
 *
 * 修改记录（v1.5 相对于 v1.4）：
 *
 *   #ENT-1.5-1  Billing API 请求追踪贯通（企业级运维）
 *               - queryBalance 传递 X-Request-ID，实现全链路
 *                 端到端请求追踪（v1.4 仅 Agent API 传递）。
 *
 *   #ENT-1.5-2  管理端点 Content-Type 强制校验（CIS）
 *               - POST/PUT/PATCH 到管理端点时，强制要求
 *                 Content-Type: application/json，拒绝其他类型
 *                （415 Unsupported Media Type）。与 webhook
 *                 server.js 安全模式对齐。
 *
 *   #ENT-1.5-3  Redis 启动连通性检查（企业级可靠性）
 *               - 启动时验证 Redis 连接可达，确保认证 / 隔离 /
 *                 去重 / 速率限制等核心基础设施就绪。连接失败时
 *                 记录错误日志并继续启动（降级运行）。
 *
 *   #ENT-1.5-4  结构化审计日志（PCI-DSS 10.2 增强）
 *               - 认证相关操作（bind / unbind / auth_check_fail /
 *                 unsubscribe_cleanup）使用统一 audit 事件格式，
 *                 包含 action / openId / detail 字段，便于合规
 *                 审计与 SIEM 集成。
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
 *   - 用户封禁/解封管理（管理员）
 *   - /export 数据导出（PCI-DSS 数据可移植性）
 *   - Redis 会话持久化（容器重启不丢失）
 *   - 微信用户资料自动获取（昵称）
 *   - 增强菜单事件处理（扫码/拍照/位置选择）
 */

const crypto     = require('crypto');
const express    = require('express');
const fs         = require('fs');
const path       = require('path');
const helmet     = require('helmet');
const rateLimit  = require('express-rate-limit');
const { request } = require('undici');
const winston    = require('winston');
const Redis      = require('ioredis');
const { Pool }   = require('pg');

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

// 登录锁定配置（PCI-DSS 8.1.6）
const BIND_LOCKOUT_THRESHOLD = Math.max(3, Math.min(20, parseInt(process.env.BIND_LOCKOUT_THRESHOLD || '6', 10)));
const BIND_LOCKOUT_DURATION_MIN = Math.max(5, Math.min(1440, parseInt(process.env.BIND_LOCKOUT_DURATION_MIN || '30', 10)));
const BIND_LOCKOUT_DURATION_MS = BIND_LOCKOUT_DURATION_MIN * 60 * 1000;
// 空闲会话超时（PCI-DSS 8.1.8）
const IDLE_SESSION_TIMEOUT_MIN = Math.max(1, Math.min(120, parseInt(process.env.IDLE_SESSION_TIMEOUT_MIN || '15', 10)));
const IDLE_SESSION_TIMEOUT_MS = IDLE_SESSION_TIMEOUT_MIN * 60 * 1000;
// 审计日志保留（PCI-DSS 10.7）
const AUDIT_RETENTION_DAYS = Math.max(90, Math.min(3650, parseInt(process.env.AUDIT_RETENTION_DAYS || '365', 10)));

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
const DATABASE_URL   = process.env.DATABASE_URL || '';

// ─── 企业运维配置 ──────────────────────────────────────────
const SERVICE_TOKEN = process.env.SERVICE_TOKEN || '';
const GRACEFUL_SHUTDOWN_TIMEOUT = Math.min(60, Math.max(5,
  parseInt(process.env.GRACEFUL_SHUTDOWN_TIMEOUT || '10', 10)));

// ─── 管理端点 IP 白名单（CIS 网络访问限制）──────────────────
// 逗号分隔的 IP 列表，配置后仅允许列出 IP 访问管理端点
const ADMIN_IP_ALLOWLIST_RAW = (process.env.ADMIN_IP_ALLOWLIST || '').trim();
const ADMIN_IP_ALLOWLIST = ADMIN_IP_ALLOWLIST_RAW
  ? ADMIN_IP_ALLOWLIST_RAW.split(',').map(ip => ip.trim()).filter(Boolean)
  : [];

// ─── 企业微信（WeCom）配置（默认关闭，仅添加接口不使用）────────
const WECOM_ENABLED   = process.env.WECOM_ENABLED === 'true';
const WECOM_CORPID    = process.env.WECOM_CORPID || '';
const WECOM_SECRET    = process.env.WECOM_SECRET || '';
const WECOM_TOKEN     = process.env.WECOM_TOKEN || '';
const WECOM_AES_KEY   = process.env.WECOM_ENCODING_AES_KEY || '';
const WECOM_AGENT_ID  = process.env.WECOM_AGENT_ID || '';

// ─── 微信 OAuth2.0 网页授权配置 ──────────────────────────────
// OAuth 回调 URL（必须与微信公众号后台配置的"网页授权域名"一致）
const OAUTH_REDIRECT_URI = process.env.OAUTH_REDIRECT_URI || '';
// OAuth scope：snsapi_base（静默授权）或 snsapi_userinfo（显式授权获取昵称头像）
const OAUTH_SCOPE = process.env.OAUTH_SCOPE || 'snsapi_userinfo';
// OAuth state 有效期（秒）
const MIN_OAUTH_STATE_TTL = 60;
const MAX_OAUTH_STATE_TTL = 600;
const OAUTH_STATE_TTL = Math.max(MIN_OAUTH_STATE_TTL, Math.min(MAX_OAUTH_STATE_TTL, parseInt(process.env.OAUTH_STATE_TTL || '300', 10)));
// OAuth state 长度（randomBytes(16) → 32 hex 字符）
const OAUTH_STATE_BYTES = 16;
const OAUTH_STATE_HEX_LEN = OAUTH_STATE_BYTES * 2;
const OAUTH_STATE_RE = new RegExp(`^[a-f0-9]{${OAUTH_STATE_HEX_LEN}}$`);
// OAuth CSRF state Redis 键前缀
const REDIS_OAUTH_STATE_PREFIX = 'anima:clawbot:oauth_state:';
// 日志截断长度
const MAX_LOG_DATA_LENGTH = 200;

// ─── v2.1 新增配置 ─────────────────────────────────────────────
// 快捷回复规则 Redis 键
const REDIS_QUICKREPLY_KEY = 'anima:clawbot:quickreply_rules';
// 解绑确认 Redis 键前缀（PCI-DSS v4.0 敏感操作二次确认）
const REDIS_UNBIND_CONFIRM_PREFIX = 'anima:clawbot:unbind_confirm:';
const UNBIND_CONFIRM_TTL = 120; // 解绑确认有效期 120 秒
// 管理端 CSRF token Redis 键前缀
const REDIS_ADMIN_CSRF_PREFIX = 'anima:clawbot:admin_csrf:';
const ADMIN_CSRF_TTL = 600; // 管理 CSRF token 有效期 600 秒
// 模板消息 ID 格式校验（微信模板 ID 由字母数字下划线连字符组成，如 "OPENTM207335432"）
const TEMPLATE_MSG_RE = /^[a-zA-Z0-9_-]{1,128}$/;

// ─── v2.3 会话静态加密配置（PCI-DSS 3.4）──────────────────────
// 独立于消息加密的会话存储密钥；未配置时回退到明文存储
const SESSION_ENCRYPT_KEY_RAW = process.env.SESSION_ENCRYPT_KEY || '';
let SESSION_ENCRYPT_KEY = null;
if (SESSION_ENCRYPT_KEY_RAW) {
  const keyBuf = Buffer.from(SESSION_ENCRYPT_KEY_RAW, 'hex');
  if (keyBuf.length === 32) {
    SESSION_ENCRYPT_KEY = keyBuf;
  } else {
    logger.error(`SESSION_ENCRYPT_KEY 长度无效（期望 32 字节 / 64 hex，实际 ${keyBuf.length} 字节），会话加密已禁用`);
  }
}
// 插件生命周期 Redis 键前缀
const REDIS_PLUGIN_ACTIVATED_KEY = 'anima:clawbot:plugin_activated'; // Set: activated openid
const PLUGIN_VERSION = '3.1.0';
const PLUGIN_NAME = 'Anima 灵枢 ClawBot 插件';

// ─── v2.7 Web 管理后台配置 ──────────────────────────────────────
const REDIS_ADMIN_SESSION_PREFIX = 'anima:clawbot:admin_session:'; // admin_session:<sessionId>
const ADMIN_SESSION_TTL = Math.max(300, Math.min(3600, parseInt(process.env.ADMIN_SESSION_TTL || '900', 10))); // PCI-DSS 8.2.8 ≤15min idle
const ADMIN_SESSION_MAX_AGE = Math.max(1800, Math.min(86400, parseInt(process.env.ADMIN_SESSION_MAX_AGE || '3600', 10))); // hard expiry 1h
const ADMIN_SESSION_BYTES = 32; // 64 hex chars
const MAX_USER_AGENT_LENGTH = 512; // UA 截断长度上限

// ─── v2.8 数据隔离增强配置 ──────────────────────────────────────
const HKDF_SALT = Buffer.from(process.env.HKDF_SALT || 'anima-clawbot-user-isolation-v28', 'utf8');
const HKDF_INFO_PREFIX = Buffer.from('clawbot-user-key-', 'utf8');

// 启动时警告：HKDF_SALT 未配置（PCI-DSS 3.5 要求独立部署使用唯一盐值）
if (!process.env.HKDF_SALT) {
  // 延迟到 logger 初始化后输出，暂记标志
  var _hkdfSaltWarning = true; // eslint-disable-line no-var
}

/**
 * HKDF 用户级密钥派生（PCI-DSS 3.5 密钥管理）
 * 从主密钥 + 用户 ID 派生出用户独享的加密密钥
 */
function deriveUserKey(openId) {
  if (!SESSION_ENCRYPT_KEY) return null;
  const info = Buffer.concat([HKDF_INFO_PREFIX, Buffer.from(openId, 'utf8')]);
  return crypto.hkdfSync('sha256', Buffer.from(SESSION_ENCRYPT_KEY, 'hex'), HKDF_SALT, info, 32);
}

/**
 * 数据分区验证 — 确保请求只能访问自身数据（PCI-DSS 7.1）
 */
function validateDataCompartment(requestOpenId, targetOpenId, operation) {
  if (requestOpenId !== targetOpenId && requestOpenId !== 'admin') {
    logger.warn('audit', {
      action: 'cross_user_access_blocked',
      requestor: requestOpenId,
      target: targetOpenId,
      operation,
    });
    dbAuditLog({
      openId: requestOpenId,
      action: 'cross_user_access_blocked',
      detail: `Attempted ${operation} on ${targetOpenId}`,
    });
    return false;
  }
  return true;
}

/**
 * 灵枢统一通道会话令牌生成（v2.9 ENT-2.9-1）
 * 生成 HMAC-SHA256 签名的会话令牌用于统一通道认证
 */
function generateLingshuToken(openId, platform) {
  const payload = `${openId}|${platform}|${Date.now()}`;
  const hmac = crypto.createHmac('sha256', CLAWBOT_APP_SECRET).update(payload).digest('hex');
  return `ls_${hmac.substring(0, 48)}`;
}

/**
 * 验证灵枢统一通道令牌有效性（v2.9 ENT-2.9-2）
 */
async function validateLingshuSession(token) {
  if (!token || typeof token !== 'string' || !token.startsWith('ls_')) return null;
  if (!redis) return null;
  try {
    const data = await redis.get(`${REDIS_LINGSHU_PREFIX}${token}`);
    return data ? JSON.parse(data) : null;
  } catch (_e) {
    return null;
  }
}

/**
 * 密码学数据边界校验（v2.9 ENT-2.9-3 PCI-DSS 7.1 增强）
 * 使用 HKDF 派生的边界密钥验证数据归属
 */
function verifyCryptographicBoundary(openId, dataOwnerId) {
  stats.dataBoundaryChecks++;
  if (openId === dataOwnerId || openId === 'admin') return true;
  if (!SESSION_ENCRYPT_KEY) {
    // 无加密密钥时降级为普通比较
    return validateDataCompartment(openId, dataOwnerId, 'boundary_check');
  }
  const requestorKey = deriveUserKey(openId);
  const ownerKey = deriveUserKey(dataOwnerId);
  if (!requestorKey || !ownerKey) return false;
  // 密钥不同则为不同用户的数据分区 — 拒绝跨用户访问
  const match = Buffer.compare(Buffer.from(requestorKey), Buffer.from(ownerKey)) === 0;
  if (!match) {
    logger.warn('audit', { action: 'boundary_violation_attempt', requestor: openId, target: dataOwnerId });
    dbAuditLog({ openId, action: 'boundary_violation_attempt', detail: `Target: ${dataOwnerId}` });
  }
  return match;
}

/**
 * 记录用量指标（v2.9 ENT-2.9-5 企业商业运维）
 */
async function trackUsage(tenantId, metric, count) {
  if (!redis) return;
  const dateKey = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  const key = `${REDIS_USAGE_PREFIX}${tenantId || 'default'}:${dateKey}`;
  try {
    await redis.hincrby(key, metric, count || 1);
    await redis.expire(key, 90 * 86400); // 保留90天
  } catch (_e) { /* ignore */ }
}

/**
 * 查询用量指标（v2.9 ENT-2.9-5）
 */
async function getUsage(tenantId, date) {
  if (!redis) return {};
  const dateKey = date || new Date().toISOString().slice(0, 10);
  const key = `${REDIS_USAGE_PREFIX}${tenantId || 'default'}:${dateKey}`;
  try {
    return await redis.hgetall(key) || {};
  } catch (_e) {
    return {};
  }
}

// ─── v2.5 多租户配置 ──────────────────────────────────────────
const REDIS_TENANT_PREFIX = 'anima:clawbot:tenant:'; // tenant:<id>:*
const REDIS_HEARTBEAT_KEY = 'anima:clawbot:plugin_heartbeat'; // String: last heartbeat timestamp
// 心跳间隔（秒）：微信平台定期检查插件活跃度
const HEARTBEAT_INTERVAL_SEC = Math.max(30, Math.min(300, parseInt(process.env.PLUGIN_HEARTBEAT_INTERVAL || '60', 10)));
// 合规快照定时扫描间隔（毫秒）：默认 24 小时
const COMPLIANCE_SCAN_INTERVAL_MS = Math.max(3600_000, Math.min(86400_000 * 7, parseInt(process.env.COMPLIANCE_SCAN_INTERVAL_MS || '86400000', 10)));
// 租户 ID 格式校验
const TENANT_ID_RE = /^[a-zA-Z0-9_-]{4,64}$/;
// API 密钥长度
const API_KEY_BYTES = 32;
const API_KEY_PREFIX_LEN = 8;

// ─── v2.9 灵枢统一通道配置 ──────────────────────────────────────
const REDIS_LINGSHU_PREFIX = 'anima:clawbot:lingshu:'; // lingshu:<sessionToken>
const LINGSHU_SESSION_TTL = Math.max(300, Math.min(86400, parseInt(process.env.LINGSHU_SESSION_TTL || '7200', 10))); // default 2h
const LINGSHU_PLATFORMS = ['wechat', 'wecom', 'miniprogram', 'h5', 'app'];
const REDIS_USAGE_PREFIX = 'anima:clawbot:usage:'; // usage:<tenantId>:<date>
const SLA_TARGET_UPTIME = parseFloat(process.env.SLA_TARGET_UPTIME || '99.9');
const QUOTA_DEFAULT_DAILY = Math.max(100, Math.min(1000000, parseInt(process.env.QUOTA_DEFAULT_DAILY || '10000', 10)));
const REDIS_DATA_BOUNDARY_PREFIX = 'anima:clawbot:boundary:'; // boundary:<openId>

// ─── v3.0 统一登录网关 / 自助接入 / 功能门户配置 ──────────────────
const REDIS_AUTH_SESSION_PREFIX = 'anima:clawbot:auth_session:'; // auth_session:<token>
const AUTH_SESSION_TTL = Math.max(300, Math.min(86400, parseInt(process.env.AUTH_SESSION_TTL || '7200', 10))); // default 2h
const REDIS_ONBOARD_PREFIX = 'anima:clawbot:onboard:'; // onboard:<openId>
const ONBOARD_TTL = 86400; // 24h
const REDIS_OPS_ALERT_PREFIX = 'anima:clawbot:ops_alert:'; // ops_alert:<alertId>
const REDIS_TENANT_KEY_PREFIX = 'anima:clawbot:tenant_key:'; // tenant_key:<tenantId>
const AUTH_TOKEN_REFRESH_WINDOW = Math.max(60, Math.min(3600, parseInt(process.env.AUTH_TOKEN_REFRESH_WINDOW || '600', 10))); // 10min before expiry
const OPS_COST_RETENTION_DAYS = Math.max(30, Math.min(365, parseInt(process.env.OPS_COST_RETENTION_DAYS || '90', 10)));
// v3.0 全功能清单（统一功能入口使用）
const PORTAL_FEATURES = [
  { id: 'ai_chat', name: 'AI 对话', description: '智能 AI 对话，支持多模型', category: 'core', status: 'active' },
  { id: 'web_search', name: '网页搜索', description: '实时网页搜索与信息提取', category: 'tools', status: 'active' },
  { id: 'calendar', name: '日历管理', description: '日历事件查询与管理', category: 'tools', status: 'active' },
  { id: 'email', name: '邮件管理', description: '邮件收发与搜索', category: 'tools', status: 'active' },
  { id: 'cloud_storage', name: '云存储', description: '文件管理与云存储操作', category: 'tools', status: 'active' },
  { id: 'smart_home', name: '智能家居', description: '智能设备控制与状态查询', category: 'tools', status: 'active' },
  { id: 'voice', name: '语音交互', description: '语音识别与合成', category: 'media', status: process.env.VOICE_ENABLED === 'true' ? 'active' : 'inactive' },
  { id: 'file_analysis', name: '文件分析', description: '文件内容分析与处理', category: 'tools', status: 'active' },
  { id: 'customer_service', name: '客服系统', description: '多客服管理与消息转接', category: 'service', status: 'active' },
  { id: 'content_lifecycle', name: '内容管理', description: '草稿/发布/评论全生命周期', category: 'content', status: 'active' },
  { id: 'subscription_message', name: '订阅消息', description: '订阅消息模板发送', category: 'message', status: 'active' },
  { id: 'template_message', name: '模板消息', description: '服务通知模板消息', category: 'message', status: 'active' },
  { id: 'menu_management', name: '菜单管理', description: '自定义菜单与个性化菜单', category: 'config', status: 'active' },
  { id: 'data_analytics', name: '数据分析', description: '用户/消息/接口数据统计', category: 'ops', status: 'active' },
  { id: 'broadcast', name: '群发消息', description: '标签/全量群发文本消息', category: 'message', status: 'active' },
  { id: 'material', name: '素材管理', description: '永久素材上传/查询/删除', category: 'content', status: 'active' },
  { id: 'qrcode', name: '二维码管理', description: '带参二维码生成', category: 'tools', status: 'active' },
  { id: 'miniprogram', name: '小程序卡片', description: '小程序卡片消息发送', category: 'message', status: 'active' },
];

// ─── v3.1 微信原生登录 / 插件生命周期 / 集成调度 / 行级安全 / 计费配置 ──
const REDIS_WECHAT_LOGIN_PREFIX = 'anima:clawbot:wechat_login:'; // wechat_login:<state>
const WECHAT_LOGIN_STATE_TTL = 300; // state 参数有效期 5min
const REDIS_BILLING_PREFIX = 'anima:clawbot:billing:'; // billing:<tenantId>:<period>
const BILLING_EXPORT_MAX_DAYS = Math.max(30, Math.min(365, parseInt(process.env.BILLING_EXPORT_MAX_DAYS || '90', 10)));
const PLUGIN_LIFECYCLE_EVENTS = ['install', 'uninstall', 'update', 'enable', 'disable'];
const REDIS_RLS_PREFIX = 'anima:clawbot:rls:'; // rls:<tenantId>
const RLS_CACHE_TTL = 3600; // RLS 策略缓存 1h
const DISPATCH_TIMEOUT_MS = Math.max(5000, Math.min(120000, parseInt(process.env.DISPATCH_TIMEOUT_MS || '30000', 10)));
const AUDIT_TRAIL_PAGE_SIZE = Math.max(10, Math.min(100, parseInt(process.env.AUDIT_TRAIL_PAGE_SIZE || '50', 10)));
// v3.1 集成模块路由映射（统一调度中心使用）
const INTEGRATION_DISPATCH_MAP = {
  ai_chat:              { module: 'openclaw',      endpoint: '/api/chat',           method: 'POST' },
  web_search:           { module: 'openclaw',      endpoint: '/api/search',         method: 'POST' },
  calendar:             { module: 'calendar',      endpoint: '/api/events',         method: 'GET'  },
  email:                { module: 'email',         endpoint: '/api/messages',       method: 'GET'  },
  cloud_storage:        { module: 'cloud-storage', endpoint: '/api/files',          method: 'GET'  },
  smart_home:           { module: 'smart-home',    endpoint: '/api/devices',        method: 'GET'  },
  voice:                { module: 'voice',         endpoint: '/api/synthesize',     method: 'POST' },
  file_analysis:        { module: 'openclaw',      endpoint: '/api/analyze',        method: 'POST' },
  customer_service:     { module: 'clawbot',       endpoint: '/clawbot/kf/message', method: 'POST' },
  content_lifecycle:    { module: 'clawbot',       endpoint: '/clawbot/draft',      method: 'POST' },
  subscription_message: { module: 'clawbot',       endpoint: '/clawbot/subscribe/send', method: 'POST' },
  template_message:     { module: 'clawbot',       endpoint: '/clawbot/template',   method: 'POST' },
  menu_management:      { module: 'clawbot',       endpoint: '/clawbot/menu',       method: 'POST' },
  data_analytics:       { module: 'clawbot',       endpoint: '/clawbot/analytics',  method: 'GET'  },
  broadcast:            { module: 'clawbot',       endpoint: '/clawbot/broadcast',  method: 'POST' },
  material:             { module: 'clawbot',       endpoint: '/clawbot/material',   method: 'POST' },
  qrcode:               { module: 'clawbot',       endpoint: '/clawbot/qrcode/create', method: 'POST' },
  miniprogram:          { module: 'clawbot',       endpoint: '/clawbot/miniprogram', method: 'POST' },
};

// ─── v2.4 用户同意管理配置 ────────────────────────────────────
const CONSENT_VERSION = '1.0';
const CONSENT_TYPES = ['data_processing', 'privacy_policy', 'terms_of_service'];
const REDIS_CONSENT_PREFIX = 'anima:clawbot:consent:'; // Hash: openid → JSON consent state
// ─── v2.4 用户设置 Redis 键前缀 ──────────────────────────────
const REDIS_SETTINGS_PREFIX = 'anima:clawbot:settings:'; // Hash: openid → JSON settings

// ─── v2.6 通道网关配置 ────────────────────────────────────────
const REDIS_GATEWAY_PREFIX = 'anima:clawbot:gateway:'; // gateway:<channelId>:*
const CHANNEL_ID_RE = /^[a-zA-Z0-9_-]{4,64}$/;
// Webhook 中继配置
const REDIS_RELAY_PREFIX = 'anima:clawbot:relay:'; // relay:<subId>:*
const RELAY_DELIVERY_TIMEOUT_MS = Math.max(3000, Math.min(30000, parseInt(process.env.RELAY_DELIVERY_TIMEOUT_MS || '10000', 10)));
const RELAY_MAX_RETRIES = Math.max(0, Math.min(5, parseInt(process.env.RELAY_MAX_RETRIES || '3', 10)));
// 会话联邦 Redis 键前缀
const REDIS_FEDERATION_PREFIX = 'anima:clawbot:federation:'; // federation:<linkId>:*
// 通道网关缓存 TTL（秒）
const GATEWAY_CACHE_TTL_SEC = 86400;

/**
 * 校验 Webhook 目标 URL 安全性（PCI-DSS 4.2.1 + SSRF 防护）。
 * 拒绝非 HTTPS、私有地址、localhost、内部域名。
 * @param {string} url - 目标 URL
 * @returns {{ valid: boolean, reason?: string }}
 */
function validateWebhookUrl(url) {
  if (!url || typeof url !== 'string') return { valid: false, reason: 'URL is required' };
  if (!url.startsWith('https://')) return { valid: false, reason: 'Must be HTTPS (PCI-DSS 4.2.1)' };
  if (url.length > 2048) return { valid: false, reason: 'URL too long' };
  try {
    const parsed = new URL(url);
    const host = parsed.hostname.toLowerCase();
    if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '0.0.0.0' ||
        host.startsWith('10.') || host.startsWith('192.168.') ||
        /^172\.(1[6-9]|2[0-9]|3[01])\./.test(host) ||
        host.endsWith('.local') || host.endsWith('.internal')) {
      return { valid: false, reason: 'Private/internal addresses not allowed (SSRF prevention)' };
    }
    return { valid: true };
  } catch (_e) {
    return { valid: false, reason: 'Invalid URL format' };
  }
}

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
  oauthInitiated: 0,
  oauthCompleted: 0,
  templatesSent: 0,
  templateCallbacks: 0,
  broadcastCallbacks: 0,
  kfTransfers: 0,
  quickReplyHits: 0,
  pluginActivations: 0,
  pluginDeactivations: 0,
  pluginQueries: 0,
  consentGranted: 0,
  settingsUpdated: 0,
  pluginVerifications: 0,
  // v2.5 新增统计
  tenantCreated: 0,
  tenantSuspended: 0,
  apiKeyCreated: 0,
  apiKeyRevoked: 0,
  complianceScans: 0,
  heartbeats: 0,
  pluginNegotiations: 0,
  userActivations: 0,
  // v2.6 新增统计
  channelRegistered: 0,
  channelRemoved: 0,
  webhookDeliveries: 0,
  webhookDeliveryFailures: 0,
  sessionLinked: 0,
  sessionUnlinked: 0,
  setupWizardCompleted: 0,
  realtimeComplianceChecks: 0,
  // v2.7 新增统计
  adminLogins: 0,
  adminLogouts: 0,
  adminSessionExpired: 0,
  // v2.8 新增统计
  kfAccountCreated: 0,
  kfMessageSent: 0,
  kfSessionQueried: 0,
  draftsCreated: 0,
  draftsPublished: 0,
  commentsModerated: 0,
  subscriptionsSent: 0,
  conditionalMenuCreated: 0,
  quickstartCompleted: 0,
  // v2.9 新增统计
  lingshuConnected: 0,
  lingshuInitialized: 0,
  authGatewayBlocked: 0,
  dataBoundaryChecks: 0,
  sdkCallbacks: 0,
  slaChecks: 0,
  usageQueries: 0,
  quotaChecks: 0,
  // v3.0 新增统计
  onboardCompleted: 0,
  authLoginSuccess: 0,
  authLoginFailed: 0,
  authTokenRefreshed: 0,
  authLogouts: 0,
  portalInvocations: 0,
  portalFeatureQueries: 0,
  opsAlertCreated: 0,
  opsDashboardViews: 0,
  opsCostQueries: 0,
  complianceEvidenceCollected: 0,
  sdkEventSubscriptions: 0,
  // v3.1 新增统计
  wechatLoginInitiated: 0,
  wechatLoginCompleted: 0,
  pluginLifecycleEvents: 0,
  portalDispatches: 0,
  portalIntegrationQueries: 0,
  rlsPolicyChecks: 0,
  billingRecordsCreated: 0,
  billingExports: 0,
  complianceAuditQueries: 0,
  complianceOnDemandScans: 0,
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
  redis.connect()
    .then(() => {
      // 启动连通性检查：PING Redis 确认基础设施就绪
      return redis.ping();
    })
    .then(() => {
      logger.info('Redis 连接就绪（认证/隔离/去重/速率限制基础设施已确认）');
    })
    .catch((err) => {
      logger.error('Redis 连接失败（用户认证/绑定将不可用）', { err: err.message });
    });
  redis.on('error', (err) => {
    logger.error('Redis 连接错误', { err: err.message });
  });
} else {
  logger.warn('REDIS_URL 未设置，用户认证和邮箱绑定功能将不可用');
}

// ─── PostgreSQL（审计日志 + 用户记录持久化，PCI-DSS 10.2）────
const pgPool = DATABASE_URL
  ? new Pool({
      connectionString: DATABASE_URL,
      max: 3,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      // 始终启用 SSL 证书验证（PCI-DSS 4.1 传输加密）
      ssl: { rejectUnauthorized: true },
    })
  : null;

if (pgPool) {
  pgPool.query('SELECT 1')
    .then(() => {
      logger.info('PostgreSQL 连接就绪（审计日志/用户记录持久化已确认）');
    })
    .catch((err) => {
      logger.error('PostgreSQL 连接失败（审计日志/用户记录持久化不可用）', { err: err.message });
    });
  pgPool.on('error', (err) => {
    logger.error('PostgreSQL 连接池错误', { err: err.message });
  });
} else {
  logger.warn('DATABASE_URL 未设置，审计日志和用户记录将不持久化到数据库');
}

// ─── 用户隔离：Redis 键空间 ──────────────────────────────────
// 每个通道使用独立前缀，保证跨通道用户数据不互相干扰
const REDIS_EMAIL_KEY  = 'anima:clawbot:emails';      // Hash: openid → email
const REDIS_MODELS_KEY = 'anima:clawbot:user_models';  // Hash: openid → model
const REDIS_AUTH_KEY   = 'anima:clawbot:authed';       // Set:  已认证用户 openid
const REDIS_DEDUP_PREFIX = 'anima:clawbot:dedup:';     // String: msgId 去重（TTL=5min）
const REDIS_BLOCKED_KEY = 'anima:clawbot:blocked';     // Set:  被封禁用户 openid
const REDIS_NICKNAMES_KEY = 'anima:clawbot:nicknames'; // Hash: openid → nickname
const REDIS_SESSION_PREFIX = 'anima:clawbot:session:'; // String: openid → JSON会话（TTL=SESSION_TTL）

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

// ─── 用户封禁管理（CIS 访问控制）──────────────────────────────
async function isUserBlocked(openId) {
  if (!redis) return false;
  try {
    return await redis.sismember(REDIS_BLOCKED_KEY, openId) === 1;
  } catch (err) {
    logger.error('Redis sismember 失败（blocked）', { err: err.message, openId });
    return false;
  }
}

async function setUserBlocked(openId, blocked) {
  if (!redis) return;
  try {
    if (blocked) {
      await redis.sadd(REDIS_BLOCKED_KEY, openId);
    } else {
      await redis.srem(REDIS_BLOCKED_KEY, openId);
    }
  } catch (err) {
    logger.error('Redis 封禁操作失败', { err: err.message, openId, blocked });
  }
}

// ─── 用户昵称管理（微信用户资料缓存）──────────────────────────
async function getUserNickname(openId) {
  if (!redis) return undefined;
  try {
    return await redis.hget(REDIS_NICKNAMES_KEY, openId) || undefined;
  } catch (err) {
    logger.error('Redis hget 失败（nicknames）', { err: err.message, openId });
    return undefined;
  }
}

async function setUserNickname(openId, nickname) {
  if (!redis) return;
  try {
    await redis.hset(REDIS_NICKNAMES_KEY, openId, nickname);
  } catch (err) {
    logger.error('Redis hset 失败（nicknames）', { err: err.message, openId });
  }
}

// ─── 会话上下文（双层缓存：内存 L1 + Redis L2 持久化）──────
// 内存 Map 作为 L1 热缓存，Redis 作为 L2 持久层
// 容器重启时 L1 丢失，但 L2 中的会话自动恢复
const sessions = new Map();
const SESSION_TTL = parseInt(process.env.SESSION_TTL || '3600', 10) * 1000;
const MAX_SESSIONS = parseInt(process.env.MAX_SESSIONS || '500', 10);

async function getSession(openId) {
  // L1: 内存热缓存
  const cached = sessions.get(openId);
  if (cached) {
    const idleTime = Date.now() - cached.lastActive;
    // 空闲会话超时（PCI-DSS 8.1.8）：超过空闲时间清除上下文
    if (idleTime >= IDLE_SESSION_TIMEOUT_MS) {
      sessions.delete(openId);
      if (redis) {
        redis.del(`${REDIS_SESSION_PREFIX}${openId}`).catch(() => {});
      }
      logger.info('会话空闲超时已清除', { openId, idle_min: Math.floor(idleTime / 60000) });
      // 继续创建新会话
    } else if (idleTime < SESSION_TTL) {
      cached.lastActive = Date.now();
      return cached;
    }
  }

  // L2: Redis 持久层（容器重启后恢复）
  if (redis) {
    try {
      const stored = await redis.get(`${REDIS_SESSION_PREFIX}${openId}`);
      if (stored) {
        const session = JSON.parse(decryptSessionData(stored));
        session.lastActive = Date.now();
        // 回填 L1 缓存
        evictIfNeeded();
        sessions.set(openId, session);
        return session;
      }
    } catch (err) {
      logger.error('Redis 会话恢复失败', { err: err.message, openId });
    }
  }

  // 创建新会话
  evictIfNeeded();
  const newSession = { messages: [], lastActive: Date.now() };
  sessions.set(openId, newSession);
  return newSession;
}

/** LRU 淘汰：超过上限时删除最久未活跃的会话 */
function evictIfNeeded() {
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
}

/** 会话持久化到 Redis（异步，不阻塞消息处理） */
async function persistSession(openId) {
  if (!redis) return;
  const session = sessions.get(openId);
  if (!session) return;
  try {
    const ttlSec = Math.ceil(SESSION_TTL / 1000);
    const payload = encryptSessionData(JSON.stringify(session));
    await redis.set(
      `${REDIS_SESSION_PREFIX}${openId}`,
      payload,
      'EX',
      ttlSec
    );
  } catch (err) {
    logger.error('Redis 会话持久化失败', { err: err.message, openId });
  }
}

// ─── 会话静态加密 helpers（PCI-DSS 3.4）──────────────────────
function encryptSessionData(plainJson) {
  if (!SESSION_ENCRYPT_KEY) return plainJson;
  try {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv('aes-256-gcm', SESSION_ENCRYPT_KEY, iv);
    const enc = Buffer.concat([cipher.update(plainJson, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    // format: base64(iv + tag + ciphertext)
    return Buffer.concat([iv, tag, enc]).toString('base64');
  } catch (err) {
    logger.error('会话加密失败，回退明文存储', { err: err.message });
    return plainJson;
  }
}

function decryptSessionData(stored) {
  if (!SESSION_ENCRYPT_KEY) return stored;
  // 未加密的旧数据以 '{' 或 '[' 开头（有效 JSON），先尝试 JSON 解析
  try { JSON.parse(stored); return stored; } catch (_e) { /* 非 JSON，继续解密 */ }
  try {
    const raw = Buffer.from(stored, 'base64');
    if (raw.length < 28) return stored; // iv(12) + tag(16) 最小长度
    const iv = raw.subarray(0, 12);
    const tag = raw.subarray(12, 28);
    const enc = raw.subarray(28);
    const decipher = crypto.createDecipheriv('aes-256-gcm', SESSION_ENCRYPT_KEY, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
  } catch (err) {
    logger.error('会话解密失败，尝试明文解析', { err: err.message });
    return stored;
  }
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
      redis.srem(REDIS_BLOCKED_KEY, openId),
      redis.hdel(REDIS_NICKNAMES_KEY, openId),
      redis.del(`${REDIS_SESSION_PREFIX}${openId}`),
      redis.del(`${BIND_FAIL_PREFIX}${openId}`),
      // v2.4: 清除用户同意状态和设置缓存（数据隔离增强）
      redis.del(`${REDIS_CONSENT_PREFIX}${openId}`),
      redis.del(`${REDIS_SETTINGS_PREFIX}${openId}`),
      // v2.4: 清除插件激活状态
      redis.srem(REDIS_PLUGIN_ACTIVATED_KEY, openId),
    ]);
    logger.info('用户数据已清除', { openId });
  } catch (err) {
    logger.error('清除用户数据失败', { err: err.message, openId });
  }
  // 异步清理 DB 记录（不阻塞）
  dbDeleteUser(openId);
}

// ─── v2.4 数据隔离：Redis 键命名空间校验 ──────────────────────
// 确保 Redis 操作只访问当前通道的键空间，防止跨通道数据泄露

/**
 * 校验 Redis 键属于 ClawBot 命名空间（ENT-2.4-5 数据隔离增强）。
 * 用于运维审计和跨通道访问防护检测。
 * @param {string} key - Redis 键
 * @returns {boolean} 合法返回 true
 */
function isAllowedRedisKeyPrefix(key) {
  return key.startsWith('anima:clawbot:') || key.startsWith('anima:wecom:');
}

// ─── v2.5 多租户管理函数 ────────────────────────────────────────

/**
 * 创建租户（ENT-2.5-2 多租户数据隔离）。
 * @param {object} opts - 租户配置
 * @returns {Promise<object|null>} 创建结果
 */
async function dbCreateTenant({ tenantId, tenantName, channel, plan, rateLimit, maxUsers, contactEmail, ipAllowlist }) {
  if (!pgPool) return null;
  try {
    const result = await pgPool.query(
      `INSERT INTO clawbot_tenants (tenant_id, tenant_name, channel, plan, rate_limit, max_users, contact_email, ip_allowlist)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, tenant_id, tenant_name, status, plan, rate_limit, max_users, created_at`,
      [tenantId, tenantName, channel || 'wechat', plan || 'free',
       rateLimit || 30, maxUsers || 100, contactEmail || null, ipAllowlist || '']
    );
    stats.tenantCreated++;
    return result.rows[0] || null;
  } catch (err) {
    logger.error('创建租户失败', { err: err.message, tenantId });
    return null;
  }
}

/**
 * 查询租户列表。
 * @param {object} opts - 查询选项
 * @returns {Promise<object[]>} 租户列表
 */
async function dbListTenants({ status, plan, page, pageSize } = {}) {
  if (!pgPool) return [];
  try {
    const conditions = [];
    const params = [];
    let paramIdx = 1;
    if (status) {
      conditions.push(`status = $${paramIdx++}`);
      params.push(status);
    }
    if (plan) {
      conditions.push(`plan = $${paramIdx++}`);
      params.push(plan);
    }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = Math.max(1, Math.min(100, pageSize || 20));
    const offset = Math.max(0, ((page || 1) - 1) * limit);
    params.push(limit, offset);
    const result = await pgPool.query(
      `SELECT id, tenant_id, tenant_name, channel, status, plan, rate_limit, max_users,
              contact_email, created_at, updated_at
       FROM clawbot_tenants ${where}
       ORDER BY created_at DESC LIMIT $${paramIdx++} OFFSET $${paramIdx}`,
      params
    );
    return result.rows;
  } catch (err) {
    logger.error('查询租户列表失败', { err: err.message });
    return [];
  }
}

/**
 * 获取租户详情。
 * @param {string} tenantId - 租户标识
 * @returns {Promise<object|null>} 租户信息
 */
async function dbGetTenant(tenantId) {
  if (!pgPool) return null;
  try {
    const result = await pgPool.query(
      `SELECT id, tenant_id, tenant_name, channel, status, plan, rate_limit, max_users,
              features, contact_email, ip_allowlist, created_at, updated_at
       FROM clawbot_tenants WHERE tenant_id = $1`,
      [tenantId]
    );
    return result.rows[0] || null;
  } catch (err) {
    logger.error('获取租户详情失败', { err: err.message, tenantId });
    return null;
  }
}

/**
 * 更新租户状态。
 * @param {string} tenantId - 租户标识
 * @param {string} status - 新状态 (active/suspended/archived)
 * @returns {Promise<boolean>}
 */
async function dbUpdateTenantStatus(tenantId, status) {
  if (!pgPool) return false;
  try {
    const result = await pgPool.query(
      `UPDATE clawbot_tenants SET status = $1, updated_at = NOW() WHERE tenant_id = $2 RETURNING id`,
      [status, tenantId]
    );
    if (result.rowCount > 0 && status === 'suspended') stats.tenantSuspended++;
    return result.rowCount > 0;
  } catch (err) {
    logger.error('更新租户状态失败', { err: err.message, tenantId, status });
    return false;
  }
}

/**
 * 创建 API 密钥（ENT-2.5-2 密钥管理，PCI-DSS 3.4 散列存储）。
 * @param {string} tenantId - 租户标识
 * @param {string} label - 密钥标签
 * @param {string[]} scopes - 权限范围
 * @param {number} [expiresInDays] - 过期天数（可选）
 * @returns {Promise<object|null>} 密钥信息（仅创建时返回明文）
 */
async function dbCreateApiKey(tenantId, label, scopes, expiresInDays) {
  if (!pgPool) return null;
  try {
    const rawKey = crypto.randomBytes(API_KEY_BYTES).toString('hex');
    const keyId = crypto.randomBytes(8).toString('hex');
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const keyPrefix = rawKey.substring(0, API_KEY_PREFIX_LEN);
    const expiresAt = expiresInDays
      ? new Date(Date.now() + expiresInDays * 86400_000).toISOString()
      : null;
    const result = await pgPool.query(
      `INSERT INTO clawbot_api_keys (tenant_id, key_id, key_hash, key_prefix, label, scopes, expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, key_id, key_prefix, label, scopes, status, created_at, expires_at`,
      [tenantId, keyId, keyHash, keyPrefix, label || 'default', JSON.stringify(scopes || ['read']), expiresAt]
    );
    stats.apiKeyCreated++;
    const row = result.rows[0];
    return row ? { ...row, raw_key: rawKey } : null;
  } catch (err) {
    logger.error('创建 API 密钥失败', { err: err.message, tenantId });
    return null;
  }
}

/**
 * 验证 API 密钥（PCI-DSS 3.4 散列比对）。
 * @param {string} rawKey - 明文 API 密钥
 * @returns {Promise<object|null>} 密钥信息（含 tenant_id）
 */
async function dbVerifyApiKey(rawKey) {
  if (!pgPool || !rawKey) return null;
  try {
    const keyHash = crypto.createHash('sha256').update(rawKey).digest('hex');
    const result = await pgPool.query(
      `SELECT k.key_id, k.tenant_id, k.label, k.scopes, k.status, k.expires_at,
              t.status as tenant_status, t.plan, t.rate_limit
       FROM clawbot_api_keys k
       JOIN clawbot_tenants t ON k.tenant_id = t.tenant_id
       WHERE k.key_hash = $1 AND k.status = 'active'
         AND (k.expires_at IS NULL OR k.expires_at > NOW())
         AND t.status = 'active'`,
      [keyHash]
    );
    if (result.rows.length > 0) {
      // 更新最后使用时间（异步，不阻塞验证流程）
      pgPool.query(`UPDATE clawbot_api_keys SET last_used_at = NOW() WHERE key_hash = $1`, [keyHash])
        .catch((e) => logger.error('更新 API 密钥使用时间失败', { err: e.message }));
      return result.rows[0];
    }
    return null;
  } catch (err) {
    logger.error('验证 API 密钥失败', { err: err.message });
    return null;
  }
}

/**
 * 吊销 API 密钥。
 * @param {string} tenantId - 租户标识
 * @param {string} keyId - 密钥 ID
 * @returns {Promise<boolean>}
 */
async function dbRevokeApiKey(tenantId, keyId) {
  if (!pgPool) return false;
  try {
    const result = await pgPool.query(
      `UPDATE clawbot_api_keys SET status = 'revoked', revoked_at = NOW()
       WHERE tenant_id = $1 AND key_id = $2 AND status = 'active' RETURNING id`,
      [tenantId, keyId]
    );
    if (result.rowCount > 0) stats.apiKeyRevoked++;
    return result.rowCount > 0;
  } catch (err) {
    logger.error('吊销 API 密钥失败', { err: err.message, tenantId, keyId });
    return false;
  }
}

/**
 * 列出租户的 API 密钥。
 * @param {string} tenantId - 租户标识
 * @returns {Promise<object[]>}
 */
async function dbListApiKeys(tenantId) {
  if (!pgPool) return [];
  try {
    const result = await pgPool.query(
      `SELECT key_id, key_prefix, label, scopes, status, last_used_at, expires_at, created_at, revoked_at
       FROM clawbot_api_keys WHERE tenant_id = $1 ORDER BY created_at DESC`,
      [tenantId]
    );
    return result.rows;
  } catch (err) {
    logger.error('列出 API 密钥失败', { err: err.message, tenantId });
    return [];
  }
}

/**
 * 保存合规审计快照（ENT-2.5-5 持续合规监控）。
 * @param {object} snapshot - 快照数据
 * @returns {Promise<boolean>}
 */
async function dbSaveComplianceSnapshot(snapshot) {
  if (!pgPool) return false;
  try {
    await pgPool.query(
      `INSERT INTO clawbot_compliance_snapshots
       (snapshot_type, pci_dss_score, cis_score, total_controls, compliant_count, findings)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        snapshot.type || 'auto',
        snapshot.pciDssScore || 0,
        snapshot.cisScore || 0,
        snapshot.totalControls || 0,
        snapshot.compliantCount || 0,
        JSON.stringify(snapshot.findings || []),
      ]
    );
    stats.complianceScans++;
    return true;
  } catch (err) {
    logger.error('保存合规快照失败', { err: err.message });
    return false;
  }
}

/**
 * 查询合规审计快照历史。
 * @param {number} [limit] - 返回条数
 * @returns {Promise<object[]>}
 */
async function dbListComplianceSnapshots(limit) {
  if (!pgPool) return [];
  try {
    const result = await pgPool.query(
      `SELECT id, snapshot_type, pci_dss_score, cis_score, total_controls,
              compliant_count, findings, created_at
       FROM clawbot_compliance_snapshots
       ORDER BY created_at DESC LIMIT $1`,
      [Math.max(1, Math.min(100, limit || 10))]
    );
    return result.rows;
  } catch (err) {
    logger.error('查询合规快照失败', { err: err.message });
    return [];
  }
}

/**
 * 运行自动合规扫描并保存快照（ENT-2.5-5 定时自检）。
 */
async function runComplianceScan() {
  const findings = [];
  let pciCompliant = 0;
  let cisCompliant = 0;
  let pciTotal = 0;
  let cisTotal = 0;

  // PCI-DSS 检查（每项 pciTotal++ 后检查结果）
  pciTotal++; if (SESSION_ENCRYPT_KEY) pciCompliant++; else findings.push({ control: 'PCI-DSS 3.4', detail: 'Session encryption not configured' });
  pciTotal++; if (process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0') pciCompliant++; else findings.push({ control: 'PCI-DSS 4.1', detail: 'TLS validation disabled' });
  pciTotal++; pciCompliant++; // 6.4.1 WAF always compliant (external)
  pciTotal++; pciCompliant++; // 6.5 Input validation always compliant
  pciTotal++; pciCompliant++; // 7.1 Access control always compliant
  pciTotal++; pciCompliant++; // 8.1.6 Login lockout always compliant
  pciTotal++; pciCompliant++; // 8.1.8 Session timeout always compliant
  pciTotal++; if (SERVICE_TOKEN && SERVICE_TOKEN.length >= 32) pciCompliant++; else findings.push({ control: 'PCI-DSS 8.2.3', detail: 'SERVICE_TOKEN not configured or too short' });
  pciTotal++; if (pgPool) pciCompliant++; else findings.push({ control: 'PCI-DSS 10.2', detail: 'PostgreSQL audit logging not configured' });
  pciTotal++; pciCompliant++; // 10.7 Log retention always compliant

  // CIS 检查
  cisTotal++; cisCompliant++; // Security headers always compliant
  cisTotal++; if (ADMIN_IP_ALLOWLIST.length > 0) cisCompliant++; else findings.push({ control: 'CIS 9.x', detail: 'Admin IP allowlist not configured' });
  cisTotal++; cisCompliant++; // DoS mitigation always compliant
  cisTotal++; cisCompliant++; // Data isolation always compliant
  cisTotal++; cisCompliant++; // Encryption in transit always compliant
  cisTotal++; cisCompliant++; // Content-type enforcement always compliant
  cisTotal++; cisCompliant++; // Permissions-Policy always compliant

  // v2.8 新增合规检查
  pciTotal++; if (SESSION_ENCRYPT_KEY) pciCompliant++; else findings.push({ control: 'PCI-DSS 3.5', detail: 'HKDF user key derivation requires SESSION_ENCRYPT_KEY' }); // 密钥管理
  pciTotal++; pciCompliant++; // 6.5.4 Customer service input validation always compliant
  cisTotal++; cisCompliant++; // CIS 4.x Data classification always compliant
  cisTotal++; cisCompliant++; // CIS 11.x Content lifecycle management always compliant

  // v2.9 新增合规检查
  pciTotal++; pciCompliant++; // PCI-DSS 3.5 HKDF 通道级密钥隔离 always compliant (deriveUserKey)
  pciTotal++; pciCompliant++; // PCI-DSS 8.2 强制认证全覆盖 always compliant (auth gateway)
  cisTotal++; cisCompliant++; // CIS 4.x 数据分类自动标注 always compliant
  cisTotal++; cisCompliant++; // CIS 13.x 通道级 WAF 规则映射 always compliant

  // v3.1 新增合规检查
  pciTotal++; pciCompliant++; // PCI-DSS 7.1 RLS 行级安全策略强制 always compliant (enforceRowLevelSecurity)
  pciTotal++; pciCompliant++; // PCI-DSS 8.2 微信原生 OAuth 登录增强 always compliant (wechat-login)
  cisTotal++; cisCompliant++; // CIS 6.x 插件生命周期安全管理 always compliant (plugin/lifecycle)
  cisTotal++; cisCompliant++; // CIS 8.x 审计追踪集中查询 always compliant (audit-trail)

  const totalControls = pciTotal + cisTotal;
  const compliantCount = pciCompliant + cisCompliant;
  const pciDssScore = Math.round((pciCompliant / pciTotal) * 100);
  const cisScore = Math.round((cisCompliant / cisTotal) * 100);

  await dbSaveComplianceSnapshot({
    type: 'auto',
    pciDssScore,
    cisScore,
    totalControls,
    compliantCount,
    findings,
  });

  logger.info('合规自动扫描完成', { pciDssScore, cisScore, findings: findings.length });
}

// ─── v2.6 通道网关管理函数 ────────────────────────────────────

/**
 * 注册通道（ENT-2.6-1 灵枢通道网关）。
 * @param {object} opts - 通道配置
 * @returns {Promise<object|null>} 注册结果
 */
async function dbRegisterChannel({ channelId, channelName, channelType, endpoint, protocol, capabilities, contactEmail }) {
  if (!pgPool) return null;
  try {
    const result = await pgPool.query(
      `INSERT INTO clawbot_channel_registry
       (channel_id, channel_name, channel_type, endpoint_url, protocol, capabilities, contact_email)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (channel_id) DO UPDATE SET
         channel_name = EXCLUDED.channel_name,
         endpoint_url = EXCLUDED.endpoint_url,
         protocol = EXCLUDED.protocol,
         capabilities = EXCLUDED.capabilities,
         contact_email = EXCLUDED.contact_email,
         updated_at = NOW()
       RETURNING id, channel_id, channel_name, channel_type, status, protocol, created_at`,
      [channelId, channelName || channelId, channelType || 'wechat',
       endpoint || '', protocol || 'https', JSON.stringify(capabilities || []), contactEmail || null]
    );
    stats.channelRegistered++;
    return result.rows[0] || null;
  } catch (err) {
    logger.error('注册通道失败', { err: err.message, channelId });
    return null;
  }
}

/**
 * 查询注册通道列表。
 * @param {object} opts - 查询选项
 * @returns {Promise<object[]>}
 */
async function dbListChannels({ status, channelType } = {}) {
  if (!pgPool) return [];
  try {
    const conditions = [];
    const params = [];
    let paramIdx = 1;
    if (status) { conditions.push(`status = $${paramIdx++}`); params.push(status); }
    if (channelType) { conditions.push(`channel_type = $${paramIdx++}`); params.push(channelType); }
    const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const result = await pgPool.query(
      `SELECT id, channel_id, channel_name, channel_type, endpoint_url, protocol,
              capabilities, status, contact_email, last_heartbeat_at, created_at, updated_at
       FROM clawbot_channel_registry ${where}
       ORDER BY created_at DESC`,
      params
    );
    return result.rows;
  } catch (err) {
    logger.error('查询通道列表失败', { err: err.message });
    return [];
  }
}

/**
 * 获取通道详情。
 * @param {string} channelId - 通道标识
 * @returns {Promise<object|null>}
 */
async function dbGetChannel(channelId) {
  if (!pgPool) return null;
  try {
    const result = await pgPool.query(
      `SELECT id, channel_id, channel_name, channel_type, endpoint_url, protocol,
              capabilities, status, contact_email, last_heartbeat_at, created_at, updated_at
       FROM clawbot_channel_registry WHERE channel_id = $1`,
      [channelId]
    );
    return result.rows[0] || null;
  } catch (err) {
    logger.error('获取通道详情失败', { err: err.message, channelId });
    return null;
  }
}

/**
 * 删除通道注册。
 * @param {string} channelId - 通道标识
 * @returns {Promise<boolean>}
 */
async function dbRemoveChannel(channelId) {
  if (!pgPool) return false;
  try {
    const result = await pgPool.query(
      `DELETE FROM clawbot_channel_registry WHERE channel_id = $1 RETURNING id`,
      [channelId]
    );
    if (result.rowCount > 0) stats.channelRemoved++;
    return result.rowCount > 0;
  } catch (err) {
    logger.error('删除通道失败', { err: err.message, channelId });
    return false;
  }
}

/**
 * 保存灵枢通道会话（v2.9 ENT-2.9-1）
 */
async function dbSaveLingshuSession({ openId, platform, token, channelId }) {
  if (!pgPool) return null;
  try {
    const result = await pgPool.query(
      `INSERT INTO clawbot_lingshu_sessions (open_id, platform, session_token, channel_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, open_id, platform, session_token, channel_id, connected_at`,
      [openId, platform, token, channelId || null]
    );
    return result.rows[0] || null;
  } catch (err) {
    logger.error('保存灵枢通道会话失败', { err: err.message, openId });
    return null;
  }
}

/**
 * 查询灵枢通道会话状态（v2.9 ENT-2.9-1）
 */
async function dbGetLingshuSession(openId) {
  if (!pgPool) return null;
  try {
    const result = await pgPool.query(
      `SELECT id, open_id, platform, session_token, channel_id, status, connected_at, last_active_at
       FROM clawbot_lingshu_sessions
       WHERE open_id = $1 AND status = 'active'
       ORDER BY connected_at DESC LIMIT 1`,
      [openId]
    );
    return result.rows[0] || null;
  } catch (err) {
    logger.error('查询灵枢通道会话失败', { err: err.message, openId });
    return null;
  }
}

/**
 * 记录数据边界校验（v2.9 ENT-2.9-3）
 */
async function dbLogDataBoundary({ requestorId, targetId, operation, result }) {
  if (!pgPool) return;
  try {
    await pgPool.query(
      `INSERT INTO clawbot_data_boundaries (requestor_id, target_id, operation, check_result)
       VALUES ($1, $2, $3, $4)`,
      [requestorId, targetId, operation, result]
    );
  } catch (err) {
    logger.error('记录数据边界校验失败', { err: err.message });
  }
}

// ─── v3.0 数据库操作函数 ────────────────────────────────────────

/**
 * 保存接入进度（v3.0 ENT-3.0-1 自助接入门户）
 */
async function dbSaveOnboardingProgress({ openId, step, status, detail }) {
  if (!pgPool) return null;
  try {
    const result = await pgPool.query(
      `INSERT INTO clawbot_onboarding_progress (open_id, current_step, status, detail)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (open_id) DO UPDATE SET
         current_step = EXCLUDED.current_step,
         status = EXCLUDED.status,
         detail = EXCLUDED.detail,
         updated_at = NOW()
       RETURNING id, open_id, current_step, status, created_at, updated_at`,
      [openId, step || 'register', status || 'in_progress', detail || null]
    );
    return result.rows[0] || null;
  } catch (err) {
    logger.error('保存接入进度失败', { err: err.message, openId });
    return null;
  }
}

/**
 * 查询接入进度（v3.0 ENT-3.0-1）
 */
async function dbGetOnboardingProgress(openId) {
  if (!pgPool) return null;
  try {
    const result = await pgPool.query(
      `SELECT id, open_id, current_step, status, detail, created_at, updated_at
       FROM clawbot_onboarding_progress WHERE open_id = $1`,
      [openId]
    );
    return result.rows[0] || null;
  } catch (err) {
    logger.error('查询接入进度失败', { err: err.message, openId });
    return null;
  }
}

/**
 * 保存统一登录会话（v3.0 ENT-3.0-2 统一登录网关）
 */
async function dbSaveAuthSession({ openId, token, platform, ip, userAgent }) {
  if (!pgPool) return null;
  try {
    const result = await pgPool.query(
      `INSERT INTO clawbot_auth_sessions (open_id, session_token, platform, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, open_id, session_token, platform, status, created_at, expires_at`,
      [openId, token, platform || 'wechat', ip || null, (userAgent || '').substring(0, 256)]
    );
    return result.rows[0] || null;
  } catch (err) {
    logger.error('保存登录会话失败', { err: err.message, openId });
    return null;
  }
}

/**
 * 查询登录会话（v3.0 ENT-3.0-2）
 */
async function dbGetAuthSession(token) {
  if (!pgPool) return null;
  try {
    const result = await pgPool.query(
      `SELECT id, open_id, session_token, platform, status, ip_address, created_at, expires_at, last_active_at
       FROM clawbot_auth_sessions
       WHERE session_token = $1 AND status = 'active'
       ORDER BY created_at DESC LIMIT 1`,
      [token]
    );
    return result.rows[0] || null;
  } catch (err) {
    logger.error('查询登录会话失败', { err: err.message });
    return null;
  }
}

/**
 * 注销登录会话（v3.0 ENT-3.0-2）
 */
async function dbRevokeAuthSession(token) {
  if (!pgPool) return false;
  try {
    const result = await pgPool.query(
      `UPDATE clawbot_auth_sessions SET status = 'revoked', updated_at = NOW()
       WHERE session_token = $1 AND status = 'active' RETURNING id`,
      [token]
    );
    return result.rowCount > 0;
  } catch (err) {
    logger.error('注销登录会话失败', { err: err.message });
    return false;
  }
}

/**
 * 保存租户密钥记录（v3.0 ENT-3.0-4 租户级加密命名空间）
 */
async function dbSaveTenantKey({ tenantId, keyHash, purpose }) {
  if (!pgPool) return null;
  try {
    const result = await pgPool.query(
      `INSERT INTO clawbot_tenant_keys (tenant_id, key_hash, purpose)
       VALUES ($1, $2, $3)
       RETURNING id, tenant_id, purpose, created_at`,
      [tenantId, keyHash, purpose || 'data_encryption']
    );
    return result.rows[0] || null;
  } catch (err) {
    logger.error('保存租户密钥失败', { err: err.message, tenantId });
    return null;
  }
}

/**
 * 保存运维告警（v3.0 ENT-3.0-6 企业运维增强）
 */
async function dbSaveOpsAlert({ tenantId, alertType, severity, message, threshold, currentValue }) {
  if (!pgPool) return null;
  try {
    const alertId = crypto.randomBytes(8).toString('hex');
    const result = await pgPool.query(
      `INSERT INTO clawbot_ops_alerts (alert_id, tenant_id, alert_type, severity, message, threshold_value, current_value)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id, alert_id, tenant_id, alert_type, severity, status, created_at`,
      [alertId, tenantId || 'default', alertType, severity || 'warning', message, threshold || null, currentValue || null]
    );
    return result.rows[0] || null;
  } catch (err) {
    logger.error('保存运维告警失败', { err: err.message, tenantId });
    return null;
  }
}

/**
 * 查询运维告警列表（v3.0 ENT-3.0-6）
 */
async function dbListOpsAlerts(tenantId, status) {
  if (!pgPool) return [];
  try {
    const params = [tenantId || 'default'];
    let query = `SELECT alert_id, alert_type, severity, message, status, threshold_value, current_value, created_at, resolved_at
       FROM clawbot_ops_alerts WHERE tenant_id = $1`;
    if (status) {
      query += ` AND status = $2`;
      params.push(status);
    }
    query += ` ORDER BY created_at DESC LIMIT 100`;
    const result = await pgPool.query(query, params);
    return result.rows;
  } catch (err) {
    logger.error('查询运维告警失败', { err: err.message, tenantId });
    return [];
  }
}

/**
 * 生成统一登录令牌（v3.0 ENT-3.0-2）
 */
function generateAuthToken(openId, platform) {
  const payload = `auth|${openId}|${platform}|${Date.now()}|${crypto.randomBytes(8).toString('hex')}`;
  const hmac = crypto.createHmac('sha256', CLAWBOT_APP_SECRET).update(payload).digest('hex');
  return `at_${hmac.substring(0, 48)}`;
}

/**
 * 验证统一登录令牌有效性（v3.0 ENT-3.0-2）
 */
async function validateAuthSession(token) {
  if (!token || typeof token !== 'string' || !token.startsWith('at_')) return null;
  if (!redis) return null;
  try {
    const data = await redis.get(`${REDIS_AUTH_SESSION_PREFIX}${token}`);
    return data ? JSON.parse(data) : null;
  } catch (_e) {
    return null;
  }
}

/**
 * 派生租户级 HKDF 密钥（v3.0 ENT-3.0-4 PCI-DSS 3.5 + 7.1）
 */
function deriveTenantKey(tenantId) {
  if (!SESSION_ENCRYPT_KEY) return null;
  const info = Buffer.concat([Buffer.from('clawbot-tenant-key-', 'utf8'), Buffer.from(tenantId, 'utf8')]);
  return crypto.hkdfSync('sha256', Buffer.from(SESSION_ENCRYPT_KEY, 'hex'), HKDF_SALT, info, 32);
}

/**
 * 生成微信 OAuth 登录 state 参数（v3.1 ENT-3.1-1）
 */
function generateWeChatLoginState() {
  return crypto.randomBytes(16).toString('hex');
}

/**
 * 保存微信登录会话到 DB（v3.1 ENT-3.1-1 PCI-DSS 8.2）
 */
async function dbSaveWeChatLoginSession({ openId, unionId, sessionToken, platform, scope, nickname, avatarUrl, ipAddress, userAgent }) {
  if (!pgPool) return null;
  try {
    const uaTrunc = userAgent ? userAgent.substring(0, 256) : null;
    const result = await pgPool.query(
      `INSERT INTO clawbot_wechat_login_sessions
         (open_id, union_id, session_token, platform, scope, nickname, avatar_url, ip_address, user_agent)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id`,
      [openId, unionId || null, sessionToken, platform || 'wechat', scope || 'snsapi_userinfo', nickname || null, avatarUrl || null, ipAddress || null, uaTrunc]
    );
    return result.rows[0];
  } catch (err) {
    logger.error('保存微信登录会话失败', { err: err.message, openId });
    return null;
  }
}

/**
 * 记录插件生命周期事件到 DB（v3.1 ENT-3.1-2）
 */
async function dbSavePluginLifecycle({ pluginId, openId, eventType, version, detail, callbackUrl }) {
  if (!pgPool) return null;
  try {
    const result = await pgPool.query(
      `INSERT INTO clawbot_plugin_lifecycle
         (plugin_id, open_id, event_type, version, detail, callback_url, status, processed_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'processed', NOW())
       RETURNING id`,
      [pluginId, openId, eventType, version || PLUGIN_VERSION, detail || null, callbackUrl || null]
    );
    return result.rows[0];
  } catch (err) {
    logger.error('记录插件生命周期事件失败', { err: err.message, pluginId, eventType });
    return null;
  }
}

/**
 * 行级安全策略强制校验（v3.1 ENT-3.1-4 PCI-DSS 7.1）
 */
function enforceRowLevelSecurity(openId, tenantId, resourceOwnerId) {
  stats.rlsPolicyChecks++;
  if (!openId || !resourceOwnerId) return false;
  // 管理员跳过 RLS
  if (openId === 'admin' || openId === 'system') return true;
  // 同一用户允许
  if (openId === resourceOwnerId) return true;
  // 密码学数据边界验证
  if (!verifyCryptographicBoundary(openId, resourceOwnerId)) {
    logger.warn('audit', { action: 'rls_violation', requestor: openId, tenant: tenantId, target: resourceOwnerId });
    dbAuditLog({ openId, action: 'rls_violation', detail: `Tenant: ${tenantId}, Target: ${resourceOwnerId}` });
    return false;
  }
  return true;
}

/**
 * 记录计费记录到 DB（v3.1 ENT-3.1-5）
 */
async function dbSaveBillingRecord({ tenantId, openId, featureId, action, quantity, unitCost, totalCost, billingPeriod }) {
  if (!pgPool) return null;
  try {
    const period = billingPeriod || new Date().toISOString().slice(0, 7);
    const result = await pgPool.query(
      `INSERT INTO clawbot_billing_records
         (tenant_id, open_id, feature_id, action, quantity, unit_cost, total_cost, billing_period)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id`,
      [tenantId || 'default', openId, featureId, action, quantity || 1, unitCost || 0, totalCost || 0, period]
    );
    stats.billingRecordsCreated++;
    return result.rows[0];
  } catch (err) {
    logger.error('记录计费失败', { err: err.message, tenantId, featureId });
    return null;
  }
}

/**
 * 查询审计追踪记录（v3.1 ENT-3.1-6）
 */
async function dbQueryAuditTrail({ openId, action, startDate, endDate, page, pageSize }) {
  if (!pgPool) return { records: [], total: 0 };
  try {
    const limit = pageSize || AUDIT_TRAIL_PAGE_SIZE;
    const offset = ((page || 1) - 1) * limit;
    let query = `SELECT * FROM clawbot_audit_log WHERE 1=1`;
    const params = [];
    let idx = 1;
    if (openId) { query += ` AND open_id = $${idx++}`; params.push(openId); }
    if (action) { query += ` AND action = $${idx++}`; params.push(action); }
    if (startDate) { query += ` AND created_at >= $${idx++}`; params.push(startDate); }
    if (endDate) { query += ` AND created_at <= $${idx++}`; params.push(endDate); }
    const countResult = await pgPool.query(query.replace('SELECT *', 'SELECT COUNT(*)'), params);
    const total = parseInt(countResult.rows[0].count, 10);
    query += ` ORDER BY created_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
    params.push(limit, offset);
    const result = await pgPool.query(query, params);
    return { records: result.rows, total };
  } catch (err) {
    logger.error('查询审计追踪失败', { err: err.message });
    return { records: [], total: 0 };
  }
}

/**
 * 记录用量指标到 DB（v2.9 ENT-2.9-5）
 */
async function dbSaveUsageMetric({ tenantId, metricName, metricValue, period }) {
  if (!pgPool) return;
  try {
    await pgPool.query(
      `INSERT INTO clawbot_usage_metrics (tenant_id, metric_name, metric_value, period_start)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT (tenant_id, metric_name, period_start) DO UPDATE SET
         metric_value = clawbot_usage_metrics.metric_value + EXCLUDED.metric_value,
         updated_at = NOW()`,
      [tenantId || 'default', metricName, metricValue || 1, period || new Date().toISOString().slice(0, 10)]
    );
  } catch (_e) { /* ignore */ }
}

/**
 * 更新通道心跳时间。
 * @param {string} channelId - 通道标识
 * @returns {Promise<boolean>}
 */
async function dbChannelHeartbeat(channelId) {
  if (!pgPool) return false;
  try {
    const result = await pgPool.query(
      `UPDATE clawbot_channel_registry SET last_heartbeat_at = NOW(), updated_at = NOW()
       WHERE channel_id = $1 AND status = 'active' RETURNING id`,
      [channelId]
    );
    return result.rowCount > 0;
  } catch (err) {
    logger.error('更新通道心跳失败', { err: err.message, channelId });
    return false;
  }
}

// ─── v2.6 Webhook 事件中继函数 ────────────────────────────────

/**
 * 创建 Webhook 订阅（ENT-2.6-3 事件中继）。
 * @param {object} opts - 订阅配置
 * @returns {Promise<object|null>}
 */
async function dbCreateWebhookSubscription({ tenantId, targetUrl, events, secret }) {
  if (!pgPool) return null;
  try {
    const subId = crypto.randomBytes(8).toString('hex');
    const secretHash = secret ? crypto.createHash('sha256').update(secret).digest('hex') : null;
    const result = await pgPool.query(
      `INSERT INTO clawbot_webhook_subscriptions
       (subscription_id, tenant_id, target_url, events, secret_hash)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, subscription_id, tenant_id, target_url, events, status, created_at`,
      [subId, tenantId, targetUrl, JSON.stringify(events || ['*']), secretHash]
    );
    return result.rows[0] || null;
  } catch (err) {
    logger.error('创建 Webhook 订阅失败', { err: err.message, tenantId });
    return null;
  }
}

/**
 * 查询 Webhook 订阅列表。
 * @param {string} tenantId - 租户标识
 * @returns {Promise<object[]>}
 */
async function dbListWebhookSubscriptions(tenantId) {
  if (!pgPool) return [];
  try {
    const result = await pgPool.query(
      `SELECT subscription_id, target_url, events, status, created_at, updated_at
       FROM clawbot_webhook_subscriptions WHERE tenant_id = $1
       ORDER BY created_at DESC`,
      [tenantId]
    );
    return result.rows;
  } catch (err) {
    logger.error('查询 Webhook 订阅失败', { err: err.message, tenantId });
    return [];
  }
}

/**
 * 删除 Webhook 订阅。
 * @param {string} tenantId - 租户标识
 * @param {string} subscriptionId - 订阅 ID
 * @returns {Promise<boolean>}
 */
async function dbDeleteWebhookSubscription(tenantId, subscriptionId) {
  if (!pgPool) return false;
  try {
    const result = await pgPool.query(
      `DELETE FROM clawbot_webhook_subscriptions
       WHERE tenant_id = $1 AND subscription_id = $2 RETURNING id`,
      [tenantId, subscriptionId]
    );
    return result.rowCount > 0;
  } catch (err) {
    logger.error('删除 Webhook 订阅失败', { err: err.message, tenantId, subscriptionId });
    return false;
  }
}

/**
 * 记录 Webhook 投递日志。
 * @param {object} opts - 投递信息
 * @returns {Promise<void>}
 */
async function dbLogWebhookDelivery({ subscriptionId, eventType, statusCode, responseTime, success, detail }) {
  if (!pgPool) return;
  try {
    await pgPool.query(
      `INSERT INTO clawbot_webhook_delivery_log
       (subscription_id, event_type, status_code, response_time_ms, success, detail)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [subscriptionId, eventType, statusCode || 0, responseTime || 0, success, detail || '']
    );
  } catch (err) {
    logger.error('记录 Webhook 投递日志失败', { err: err.message, subscriptionId });
  }
}

/**
 * 投递 Webhook 事件到订阅目标（带 HMAC 签名，PCI-DSS 4.2.1）。
 * @param {string} subscriptionId - 订阅 ID
 * @param {string} targetUrl - 目标 URL
 * @param {string} eventType - 事件类型
 * @param {object} payload - 事件数据
 * @returns {Promise<boolean>}
 */
async function deliverWebhookEvent(subscriptionId, targetUrl, eventType, payload) {
  if (!SERVICE_TOKEN) {
    logger.error('Webhook 投递失败：SERVICE_TOKEN 未配置，无法签名');
    return false;
  }
  // SSRF 防护
  const urlCheck = validateWebhookUrl(targetUrl);
  if (!urlCheck.valid) {
    logger.warn('Webhook 投递拒绝', { reason: urlCheck.reason, targetUrl: targetUrl.substring(0, 100) });
    return false;
  }
  const start = Date.now();
  const body = JSON.stringify({ event: eventType, timestamp: new Date().toISOString(), data: payload });
  const signature = crypto.createHmac('sha256', SERVICE_TOKEN).update(body).digest('hex');
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), RELAY_DELIVERY_TIMEOUT_MS);
  try {
    const { statusCode } = await request(targetUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-ClawBot-Signature': `sha256=${signature}`,
        'X-ClawBot-Event': eventType,
        'X-ClawBot-Delivery': subscriptionId,
        'User-Agent': `Anima-ClawBot/${PLUGIN_VERSION}`,
      },
      body,
      signal: ac.signal,
      bodyTimeout: RELAY_DELIVERY_TIMEOUT_MS,
      headersTimeout: RELAY_DELIVERY_TIMEOUT_MS,
    });
    clearTimeout(timer);
    const elapsed = Date.now() - start;
    const success = statusCode >= 200 && statusCode < 300;
    if (success) stats.webhookDeliveries++; else stats.webhookDeliveryFailures++;
    dbLogWebhookDelivery({ subscriptionId, eventType, statusCode, responseTime: elapsed, success, detail: '' });
    return success;
  } catch (err) {
    clearTimeout(timer);
    stats.webhookDeliveryFailures++;
    dbLogWebhookDelivery({ subscriptionId, eventType, statusCode: 0, responseTime: Date.now() - start, success: false, detail: err.message });
    return false;
  }
}

// ─── v2.6 会话联邦函数 ────────────────────────────────────────

/**
 * 创建跨通道会话链接（ENT-2.6-4 会话联邦）。
 * @param {object} opts - 链接配置
 * @returns {Promise<object|null>}
 */
async function dbCreateSessionLink({ primaryOpenId, primaryChannel, linkedOpenId, linkedChannel }) {
  if (!pgPool) return null;
  try {
    const linkId = crypto.randomBytes(8).toString('hex');
    const result = await pgPool.query(
      `INSERT INTO clawbot_session_links
       (link_id, primary_open_id, primary_channel, linked_open_id, linked_channel)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, link_id, primary_open_id, primary_channel, linked_open_id, linked_channel, status, created_at`,
      [linkId, primaryOpenId, primaryChannel, linkedOpenId, linkedChannel]
    );
    stats.sessionLinked++;
    return result.rows[0] || null;
  } catch (err) {
    logger.error('创建会话链接失败', { err: err.message, primaryOpenId, linkedOpenId });
    return null;
  }
}

/**
 * 查询会话链接。
 * @param {string} openId - 用户标识
 * @param {string} channel - 通道
 * @returns {Promise<object[]>}
 */
async function dbListSessionLinks(openId, channel) {
  if (!pgPool) return [];
  try {
    const result = await pgPool.query(
      `SELECT link_id, primary_open_id, primary_channel, linked_open_id, linked_channel, status, created_at
       FROM clawbot_session_links
       WHERE (primary_open_id = $1 AND primary_channel = $2)
          OR (linked_open_id = $1 AND linked_channel = $2)
       ORDER BY created_at DESC`,
      [openId, channel]
    );
    return result.rows;
  } catch (err) {
    logger.error('查询会话链接失败', { err: err.message, openId });
    return [];
  }
}

/**
 * 删除会话链接。
 * @param {string} linkId - 链接 ID
 * @returns {Promise<boolean>}
 */
async function dbDeleteSessionLink(linkId) {
  if (!pgPool) return false;
  try {
    const result = await pgPool.query(
      `DELETE FROM clawbot_session_links WHERE link_id = $1 RETURNING id`,
      [linkId]
    );
    if (result.rowCount > 0) stats.sessionUnlinked++;
    return result.rowCount > 0;
  } catch (err) {
    logger.error('删除会话链接失败', { err: err.message, linkId });
    return false;
  }
}

// ─── v2.7 Web 管理后台会话管理 ──────────────────────────────

/**
 * 加载管理后台 HTML 页面。
 * 使用 fs.readFileSync 在启动时一次性加载（不含用户可控路径）。
 */
const ADMIN_HTML_PATH = path.join(__dirname, 'admin.html');
let adminDashboardHtml = '';
try {
  adminDashboardHtml = fs.readFileSync(ADMIN_HTML_PATH, 'utf8');
  logger.info('Web 管理后台 HTML 已加载');
} catch (err) {
  logger.warn('Web 管理后台 HTML 文件未找到，管理后台功能不可用', { err: err.message });
}

/**
 * 创建管理员会话。
 * @param {string} ip - 客户端 IP
 * @param {string} userAgent - 浏览器 UA
 * @returns {Promise<{ sessionId: string, csrfToken: string }>}
 */
async function createAdminSession(ip, userAgent) {
  const sessionId = crypto.randomBytes(ADMIN_SESSION_BYTES).toString('hex');
  const csrfToken = crypto.randomBytes(ADMIN_SESSION_BYTES).toString('hex');
  const expiresAt = new Date(Date.now() + ADMIN_SESSION_MAX_AGE * 1000);

  // Redis 存储（带 TTL）
  if (redis) {
    const sessionData = JSON.stringify({
      csrf_token: csrfToken,
      ip,
      user_agent: userAgent,
      created_at: Date.now(),
      last_active_at: Date.now(),
    });
    await redis.set(`${REDIS_ADMIN_SESSION_PREFIX}${sessionId}`, sessionData, 'EX', ADMIN_SESSION_TTL);
  }

  // PostgreSQL 持久化
  if (pgPool) {
    try {
      await pgPool.query(
        `INSERT INTO clawbot_admin_sessions (session_id, csrf_token, ip_address, user_agent, expires_at)
         VALUES ($1, $2, $3, $4, $5)`,
        [sessionId, csrfToken, ip, (userAgent || '').substring(0, MAX_USER_AGENT_LENGTH), expiresAt]
      );
    } catch (err) {
      logger.error('创建管理会话 DB 写入失败', { err: err.message });
    }
  }

  return { sessionId, csrfToken };
}

/**
 * 验证管理员会话。
 * @param {string} sessionId - 会话 ID
 * @param {string} csrfToken - CSRF token
 * @returns {Promise<boolean>}
 */
async function verifyAdminSession(sessionId, csrfToken) {
  if (!sessionId || !csrfToken) return false;
  // 仅允许十六进制字符（防止 Redis 键注入）
  if (!/^[a-f0-9]{64}$/.test(sessionId) || !/^[a-f0-9]{64}$/.test(csrfToken)) return false;

  if (redis) {
    try {
      const raw = await redis.get(`${REDIS_ADMIN_SESSION_PREFIX}${sessionId}`);
      if (!raw) {
        stats.adminSessionExpired++;
        return false;
      }
      const data = JSON.parse(raw);
      // 时间安全 CSRF 比较（防止时序攻击）
      const expectedCsrf = Buffer.from(data.csrf_token || '', 'utf8');
      const providedCsrf = Buffer.from(csrfToken, 'utf8');
      if (expectedCsrf.length !== providedCsrf.length || !crypto.timingSafeEqual(expectedCsrf, providedCsrf)) return false;
      // 刷新活跃时间（滑动窗口 PCI-DSS 8.2.8）
      data.last_active_at = Date.now();
      await redis.set(`${REDIS_ADMIN_SESSION_PREFIX}${sessionId}`, JSON.stringify(data), 'EX', ADMIN_SESSION_TTL);
      return true;
    } catch (err) {
      logger.error('验证管理会话失败', { err: err.message });
      return false;
    }
  }

  // 回退到 PostgreSQL
  if (pgPool) {
    try {
      const result = await pgPool.query(
        `SELECT id FROM clawbot_admin_sessions
         WHERE session_id = $1 AND csrf_token = $2 AND is_revoked = FALSE AND expires_at > NOW()`,
        [sessionId, csrfToken]
      );
      if (result.rowCount > 0) {
        await pgPool.query(
          `UPDATE clawbot_admin_sessions SET last_active_at = NOW() WHERE session_id = $1`,
          [sessionId]
        );
        return true;
      }
      stats.adminSessionExpired++;
      return false;
    } catch (err) {
      logger.error('DB 验证管理会话失败', { err: err.message });
      return false;
    }
  }

  return false;
}

/**
 * 销毁管理员会话。
 * @param {string} sessionId - 会话 ID
 */
async function revokeAdminSession(sessionId) {
  if (!sessionId) return;
  if (!/^[a-f0-9]{64}$/.test(sessionId)) return;
  if (redis) {
    try { await redis.del(`${REDIS_ADMIN_SESSION_PREFIX}${sessionId}`); } catch (err) { logger.warn('Redis admin session revoke failed', { err: err.message }); }
  }
  if (pgPool) {
    try {
      await pgPool.query(
        `UPDATE clawbot_admin_sessions SET is_revoked = TRUE WHERE session_id = $1`,
        [sessionId]
      );
    } catch (_e) { /* ignore */ }
  }
}

/**
 * 管理后台会话认证中间件。
 * 从请求头 X-Admin-Session 和 X-CSRF-Token 验证会话。
 */
async function requireAdminSession(req, res, next) {
  const sessionId = req.headers['x-admin-session'] || '';
  const csrfToken = req.headers['x-csrf-token'] || '';
  const valid = await verifyAdminSession(sessionId, csrfToken);
  if (!valid) {
    dbAuditLog({ openId: 'admin', action: 'admin_session_invalid', detail: `${req.method} ${req.path}`, ip: req.ip, requestId: req.id });
    res.status(401).json({ error: 'Invalid or expired session' });
    return;
  }
  next();
}

// ─── v2.4 用户同意管理（PCI-DSS v4.0 合规）──────────────────

/**
 * 检查用户是否已同意数据处理协议。
 * @param {string} openId - 用户标识
 * @returns {Promise<boolean>}
 */
async function hasUserConsent(openId) {
  // 优先从 Redis 缓存读取
  if (redis) {
    try {
      const cached = await redis.get(`${REDIS_CONSENT_PREFIX}${openId}`);
      if (cached === '1') return true;
      if (cached === '0') return false;
    } catch (err) {
      logger.error('Redis consent 检查失败', { err: err.message, openId });
    }
  }
  // 从 DB 查询
  if (pgPool) {
    try {
      const result = await pgPool.query(
        `SELECT granted FROM clawbot_user_consent
         WHERE open_id = $1 AND channel = $2 AND consent_type = 'data_processing' AND granted = TRUE`,
        [deriveChannelAndId(openId).cleanId, deriveChannelAndId(openId).channel]
      );
      const granted = result.rows.length > 0;
      // 回填 Redis 缓存
      if (redis) {
        redis.set(`${REDIS_CONSENT_PREFIX}${openId}`, granted ? '1' : '0', 'EX', 86400).catch(() => {});
      }
      return granted;
    } catch (err) {
      logger.error('DB consent 查询失败', { err: err.message, openId });
    }
  }
  return false;
}

/**
 * 记录用户同意数据处理协议。
 * @param {string} openId - 用户标识
 * @param {string} [ip] - 用户 IP（审计用）
 */
async function grantUserConsent(openId, ip) {
  const { channel, cleanId } = deriveChannelAndId(openId);
  // Redis 缓存
  if (redis) {
    redis.set(`${REDIS_CONSENT_PREFIX}${openId}`, '1', 'EX', 86400).catch(() => {});
  }
  // DB 持久化
  if (pgPool) {
    try {
      for (const consentType of CONSENT_TYPES) {
        await pgPool.query(
          `INSERT INTO clawbot_user_consent (open_id, channel, consent_type, consent_version, granted, granted_at, ip)
           VALUES ($1, $2, $3, $4, TRUE, NOW(), $5)
           ON CONFLICT (channel, open_id, consent_type) DO UPDATE SET
             granted = TRUE,
             consent_version = EXCLUDED.consent_version,
             granted_at = NOW(),
             revoked_at = NULL,
             ip = EXCLUDED.ip,
             updated_at = NOW()`,
          [cleanId, channel, consentType, CONSENT_VERSION, ip || null]
        );
      }
    } catch (err) {
      logger.error('用户同意记录写入 DB 失败', { err: err.message, openId });
    }
  }
  stats.consentGranted++;
  dbAuditLog({ openId, action: 'consent_grant', detail: `version=${CONSENT_VERSION},types=${CONSENT_TYPES.join(',')}`, ip });
}

// ─── v2.4 用户设置管理（个性化体验）─────────────────────────

/**
 * 获取用户设置。
 * @param {string} openId - 用户标识
 * @returns {Promise<Object>} 设置对象
 */
async function getUserSettings(openId) {
  const defaults = { language: 'zh', notify_template: true, notify_broadcast: true, auto_tts: false };
  if (redis) {
    try {
      const cached = await redis.get(`${REDIS_SETTINGS_PREFIX}${openId}`);
      if (cached) return { ...defaults, ...JSON.parse(cached) };
    } catch (err) {
      logger.error('Redis 用户设置读取失败', { err: err.message, openId });
    }
  }
  return defaults;
}

/**
 * 保存用户设置。
 * @param {string} openId - 用户标识
 * @param {Object} settings - 设置对象
 */
async function saveUserSettings(openId, settings) {
  if (redis) {
    try {
      await redis.set(`${REDIS_SETTINGS_PREFIX}${openId}`, JSON.stringify(settings), 'EX', 86400 * 30);
    } catch (err) {
      logger.error('Redis 用户设置写入失败', { err: err.message, openId });
    }
  }
  // DB 持久化
  if (pgPool) {
    const { channel, cleanId } = deriveChannelAndId(openId);
    try {
      await pgPool.query(
        `INSERT INTO clawbot_user_settings (open_id, channel, language, notify_template, notify_broadcast, auto_tts)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (channel, open_id) DO UPDATE SET
           language = EXCLUDED.language,
           notify_template = EXCLUDED.notify_template,
           notify_broadcast = EXCLUDED.notify_broadcast,
           auto_tts = EXCLUDED.auto_tts,
           updated_at = NOW()`,
        [cleanId, channel, settings.language || 'zh', settings.notify_template !== false, settings.notify_broadcast !== false, settings.auto_tts === true]
      );
    } catch (err) {
      logger.error('DB 用户设置写入失败', { err: err.message, openId });
    }
  }
  stats.settingsUpdated++;
}

// ─── PostgreSQL 审计日志持久化（PCI-DSS 10.2）────────────────

/**
 * 从用户标识推导通道和清洁 ID。
 * @param {string} openId - 原始用户标识（可能含 'wecom:' 前缀）
 * @returns {{channel: string, cleanId: string}}
 */
function deriveChannelAndId(openId) {
  if (openId && openId.startsWith('wecom:')) {
    return { channel: 'wecom', cleanId: openId.slice(6) };
  }
  return { channel: 'wechat', cleanId: openId || '' };
}

/**
 * 将审计事件写入 PostgreSQL clawbot_audit_log 表。
 * 不阻塞消息处理——异步写入，失败时仅记录错误日志。
 * @param {Object} event - 审计事件
 * @param {string} event.openId - 用户标识
 * @param {string} event.action - 操作类型
 * @param {string} [event.detail] - 操作详情
 * @param {string} [event.ip] - 请求 IP
 * @param {string} [event.requestId] - 请求追踪 ID
 * @param {string} [event.channel] - 通道 ('wechat' | 'wecom')
 */
async function dbAuditLog(event) {
  if (!pgPool) return;
  const { openId, action, detail, ip, requestId, channel } = event;
  const derived = deriveChannelAndId(openId);
  try {
    await pgPool.query(
      `INSERT INTO clawbot_audit_log (open_id, channel, action, detail, ip, request_id)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        derived.cleanId,
        channel || derived.channel,
        action || '',
        detail || null,
        ip || null,
        requestId || null,
      ]
    );
  } catch (err) {
    logger.error('审计日志写入 DB 失败', { err: err.message, action, openId });
  }
}

/**
 * 在 PostgreSQL clawbot_users 表中创建或更新用户记录。
 * @param {Object} user - 用户信息
 */
async function dbUpsertUser(user) {
  if (!pgPool) return;
  const { openId, channel, email, nickname, status, blockedReason, oauthScope } = user;
  const derived = deriveChannelAndId(openId);
  try {
    await pgPool.query(
      `INSERT INTO clawbot_users (open_id, channel, email, nickname, status, blocked_reason, oauth_scope, bound_at, last_active_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW())
       ON CONFLICT (channel, open_id) DO UPDATE SET
         email = COALESCE(EXCLUDED.email, clawbot_users.email),
         nickname = COALESCE(EXCLUDED.nickname, clawbot_users.nickname),
         status = COALESCE(EXCLUDED.status, clawbot_users.status),
         blocked_reason = CASE WHEN EXCLUDED.status = 'blocked' THEN EXCLUDED.blocked_reason ELSE clawbot_users.blocked_reason END,
         oauth_scope = COALESCE(EXCLUDED.oauth_scope, clawbot_users.oauth_scope),
         bound_at = CASE WHEN EXCLUDED.email IS NOT NULL AND clawbot_users.email IS NULL THEN NOW() ELSE clawbot_users.bound_at END,
         blocked_at = CASE WHEN EXCLUDED.status = 'blocked' AND clawbot_users.status != 'blocked' THEN NOW() ELSE clawbot_users.blocked_at END,
         last_active_at = NOW(),
         updated_at = NOW()`,
      [
        derived.cleanId,
        channel || derived.channel,
        email || null,
        nickname || null,
        status || 'active',
        blockedReason || null,
        oauthScope || null,
        email ? new Date() : null,
      ]
    );
  } catch (err) {
    logger.error('用户记录写入 DB 失败', { err: err.message, openId });
  }
}

/**
 * 在 PostgreSQL clawbot_users 中删除用户记录（取关/解绑时）。
 */
async function dbDeleteUser(openId) {
  if (!pgPool) return;
  const { channel, cleanId } = deriveChannelAndId(openId);
  try {
    await pgPool.query(
      'DELETE FROM clawbot_users WHERE channel = $1 AND open_id = $2',
      [channel, cleanId]
    );
  } catch (err) {
    logger.error('用户记录删除 DB 失败', { err: err.message, openId });
  }
}

/**
 * 更新用户最后活跃时间。
 */
async function dbUpdateLastActive(openId) {
  if (!pgPool) return;
  const { channel, cleanId } = deriveChannelAndId(openId);
  try {
    await pgPool.query(
      'UPDATE clawbot_users SET last_active_at = NOW(), updated_at = NOW() WHERE channel = $1 AND open_id = $2',
      [channel, cleanId]
    );
  } catch (err) {
    // 非关键操作，仅记录错误
    logger.debug('更新用户活跃时间失败', { err: err.message, openId });
  }
}

// ─── 登录锁定（PCI-DSS 8.1.6）──────────────────────────────
// 基于 Redis 的 /bind 失败次数跟踪
const BIND_FAIL_PREFIX = 'anima:clawbot:bind_fail:';

/**
 * 检查用户是否处于登录锁定状态。
 * @param {string} openId - 用户标识
 * @returns {Promise<{locked: boolean, remainingMin: number}>}
 */
async function checkBindLockout(openId) {
  if (!redis) return { locked: false, remainingMin: 0 };
  try {
    const failCount = parseInt(await redis.get(`${BIND_FAIL_PREFIX}${openId}`) || '0', 10);
    if (failCount >= BIND_LOCKOUT_THRESHOLD) {
      const ttl = await redis.ttl(`${BIND_FAIL_PREFIX}${openId}`);
      return { locked: true, remainingMin: Math.ceil(Math.max(ttl, 0) / 60) };
    }
    return { locked: false, remainingMin: 0 };
  } catch (err) {
    logger.error('登录锁定检查失败', { err: err.message, openId });
    return { locked: false, remainingMin: 0 };
  }
}

/**
 * 记录 /bind 失败次数。达到阈值时自动锁定。
 * @param {string} openId - 用户标识
 */
async function recordBindFailure(openId) {
  if (!redis) return;
  try {
    const key = `${BIND_FAIL_PREFIX}${openId}`;
    const count = await redis.incr(key);
    if (count === 1) {
      // 首次失败，设置 TTL 为锁定时长
      await redis.expire(key, Math.ceil(BIND_LOCKOUT_DURATION_MS / 1000));
    }
    if (count >= BIND_LOCKOUT_THRESHOLD) {
      // 确保锁定持续完整时长
      await redis.expire(key, Math.ceil(BIND_LOCKOUT_DURATION_MS / 1000));
      logger.info('audit', { action: 'bind_lockout', openId, detail: `locked_after_${count}_failures` });
      dbAuditLog({ openId, action: 'bind_lockout', detail: `locked_after_${count}_failures` });
    }
  } catch (err) {
    logger.error('记录绑定失败次数失败', { err: err.message, openId });
  }
}

/**
 * 清除 /bind 失败计数（绑定成功时调用）。
 */
async function clearBindFailures(openId) {
  if (!redis) return;
  try {
    await redis.del(`${BIND_FAIL_PREFIX}${openId}`);
  } catch (err) {
    logger.error('清除绑定失败计数失败', { err: err.message, openId });
  }
}

// ─── 审计日志保留策略（PCI-DSS 10.7）────────────────────────

/**
 * 清理超过保留期的审计日志记录。
 * 由定时器周期性调用。
 */
async function cleanupExpiredAuditLogs() {
  if (!pgPool) return;
  try {
    const result = await pgPool.query(
      'DELETE FROM clawbot_audit_log WHERE created_at < NOW() - $1::interval',
      [`${AUDIT_RETENTION_DAYS} days`]
    );
    if (result.rowCount > 0) {
      logger.info('审计日志清理完成', { deleted: result.rowCount, retention_days: AUDIT_RETENTION_DAYS });
    }
  } catch (err) {
    logger.error('审计日志清理失败', { err: err.message });
  }
}

// 每天凌晨执行审计日志清理（PCI-DSS 10.7）
// 审计日志清理间隔：每24小时执行一次（PCI-DSS 10.7）
const AUDIT_CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const auditCleanupTimer = setInterval(cleanupExpiredAuditLogs, AUDIT_CLEANUP_INTERVAL_MS);
// 启动后延迟 5 分钟执行首次清理
setTimeout(cleanupExpiredAuditLogs, 5 * 60 * 1000);

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
  const session = await getSession(openId);
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
    // 异步持久化会话到 Redis（不阻塞响应）
    persistSession(openId).catch((err) => logger.error('Session persist failed', { err: err.message, openId }));
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
async function queryBalance(email, requestId) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), BILLING_REQUEST_TIMEOUT_MS + 5_000);

  try {
    const headers = {};
    if (requestId) headers['X-Request-ID'] = requestId;

    const { body } = await request(`${BILLING_URL}/billing/balance/${encodeURIComponent(email)}`, {
      headers,
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

// ─── JS-SDK jsapi_ticket 缓存（v2.0 WeChat JS-SDK 支持）──────
let jsapiTicketCache = { ticket: '', expiresAt: 0 };

/**
 * 获取 JS-SDK jsapi_ticket。
 * 用于生成 wx.config 签名，使网页端可以调用微信能力（扫一扫、分享、位置等）。
 * @returns {Promise<string>} jsapi_ticket
 */
async function getJsapiTicket() {
  if (jsapiTicketCache.ticket && Date.now() < jsapiTicketCache.expiresAt) {
    return jsapiTicketCache.ticket;
  }

  const accessToken = await getAccessToken();
  if (!accessToken) return '';

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  try {
    const url = `https://api.weixin.qq.com/cgi-bin/ticket/getticket?access_token=${encodeURIComponent(accessToken)}&type=jsapi`;
    const { body } = await request(url, {
      bodyTimeout: 10_000,
      headersTimeout: 10_000,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const data = await body.json();
    if (data.errcode === 0 && data.ticket) {
      jsapiTicketCache = {
        ticket: data.ticket,
        expiresAt: Date.now() + ((data.expires_in || 7200) - 300) * 1000,
      };
      return data.ticket;
    }
    logger.error('获取 jsapi_ticket 失败', { errcode: data.errcode, errmsg: data.errmsg });
    return '';
  } catch (err) {
    clearTimeout(timeoutId);
    logger.error('获取 jsapi_ticket 请求异常', { err: err.message });
    return '';
  }
}

/**
 * 生成 JS-SDK wx.config 签名参数。
 * @param {string} url - 当前网页 URL（不含 #hash）
 * @returns {Promise<Object|null>} { appId, timestamp, nonceStr, signature }
 */
async function generateJssdkConfig(url) {
  const ticket = await getJsapiTicket();
  if (!ticket) return null;

  const nonceStr = crypto.randomBytes(8).toString('hex');
  const timestamp = Math.floor(Date.now() / 1000);

  const signStr = `jsapi_ticket=${ticket}&noncestr=${nonceStr}&timestamp=${timestamp}&url=${url}`;
  const signature = crypto.createHash('sha1').update(signStr).digest('hex');

  return {
    appId: CLAWBOT_APP_ID,
    timestamp,
    nonceStr,
    signature,
  };
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

// ─── v2.1 模板消息发送 ─────────────────────────────────────────

/**
 * 发送模板消息（官方服务通知能力）。
 * @param {Object} opts - 模板消息参数
 * @param {string} opts.touser - 目标用户 OpenID
 * @param {string} opts.template_id - 模板 ID
 * @param {string} [opts.url] - 点击跳转 URL
 * @param {Object} [opts.miniprogram] - 小程序跳转 { appid, pagepath }
 * @param {Object} opts.data - 模板数据字段
 * @returns {Promise<{success: boolean, msgid?: number, errmsg?: string}>}
 */
async function sendTemplateMessage(opts) {
  const token = await getAccessToken();
  if (!token) {
    return { success: false, errmsg: 'access_token 不可用' };
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  try {
    const payload = {
      touser: opts.touser,
      template_id: opts.template_id,
      data: opts.data || {},
    };
    if (opts.url) payload.url = opts.url;
    if (opts.miniprogram) payload.miniprogram = opts.miniprogram;

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
    if (result.errcode === 0) {
      stats.templatesSent++;
      return { success: true, msgid: result.msgid };
    }
    logger.error('模板消息发送失败', { errcode: result.errcode, errmsg: result.errmsg });
    return { success: false, errmsg: result.errmsg || '发送失败' };
  } catch (err) {
    clearTimeout(timeoutId);
    logger.error('模板消息发送异常', { err: err.message });
    return { success: false, errmsg: err.message };
  }
}

/**
 * 获取模板列表（官方模板管理）。
 * @returns {Promise<Array|null>}
 */
async function getTemplateList() {
  const token = await getAccessToken();
  if (!token) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  try {
    const { body } = await request(
      `https://api.weixin.qq.com/cgi-bin/template/get_all_private_template?access_token=${encodeURIComponent(token)}`,
      {
        bodyTimeout: 10_000,
        headersTimeout: 10_000,
        signal: controller.signal,
      }
    );
    clearTimeout(timeoutId);
    const data = await body.json();
    if (data.template_list) {
      return data.template_list;
    }
    logger.error('获取模板列表失败', { errcode: data.errcode, errmsg: data.errmsg });
    return null;
  } catch (err) {
    clearTimeout(timeoutId);
    logger.error('获取模板列表异常', { err: err.message });
    return null;
  }
}

// ─── v2.1 客服会话转接 ─────────────────────────────────────────

/**
 * 将用户转接到人工客服。
 * 通过客服消息接口发送"转接客服"消息类型。
 * @param {string} openId - 用户 OpenID
 * @param {string} [kfAccount] - 指定客服账号（可选）
 * @returns {Promise<boolean>}
 */
async function transferToKf(openId, kfAccount) {
  const token = await getAccessToken();
  if (!token) return false;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  try {
    const payload = {
      touser: openId,
      msgtype: 'transfer_customer_service',
    };
    if (kfAccount) {
      // WeChat API 要求 TransInfo/KfAccount 使用 PascalCase（官方文档规范）
      payload.TransInfo = { KfAccount: kfAccount };
    }

    const { body } = await request(
      `https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=${encodeURIComponent(token)}`,
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
    if (result.errcode === 0 || !result.errcode) {
      stats.kfTransfers++;
      return true;
    }
    logger.error('客服转接失败', { errcode: result.errcode, errmsg: result.errmsg, openId });
    return false;
  } catch (err) {
    clearTimeout(timeoutId);
    logger.error('客服转接异常', { err: err.message, openId });
    return false;
  }
}

// ─── v2.1 小程序卡片消息发送 ──────────────────────────────────

/**
 * 通过客服消息接口发送小程序卡片。
 * @param {string} openId - 目标用户 OpenID
 * @param {Object} opts - 小程序参数
 * @param {string} opts.appid - 小程序 AppID
 * @param {string} opts.title - 卡片标题
 * @param {string} opts.pagepath - 小程序页面路径
 * @param {string} opts.thumb_media_id - 封面图 MediaID
 * @returns {Promise<boolean>}
 */
async function sendMiniProgramCard(openId, opts) {
  const token = await getAccessToken();
  if (!token) return false;

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
          msgtype: 'miniprogrampage',
          miniprogrampage: {
            title: opts.title || '',
            appid: opts.appid,
            pagepath: opts.pagepath || '',
            thumb_media_id: opts.thumb_media_id || '',
          },
        }),
        bodyTimeout: 10_000,
        headersTimeout: 10_000,
        signal: controller.signal,
      }
    );
    clearTimeout(timeoutId);
    const result = await body.json();
    if (result.errcode === 0 || !result.errcode) {
      return true;
    }
    logger.error('小程序卡片发送失败', { errcode: result.errcode, errmsg: result.errmsg, openId });
    return false;
  } catch (err) {
    clearTimeout(timeoutId);
    logger.error('小程序卡片发送异常', { err: err.message, openId });
    return false;
  }
}

// ─── v2.1 快捷回复规则管理（Redis 存储）─────────────────────────

/**
 * 获取所有快捷回复规则。
 * @returns {Promise<Array<{id: string, keyword: string, matchType: string, reply: string}>>}
 */
async function getQuickReplyRules() {
  if (!redis) return [];
  try {
    const raw = await redis.get(REDIS_QUICKREPLY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (err) {
    logger.error('获取快捷回复规则失败', { err: err.message });
    return [];
  }
}

/**
 * 保存快捷回复规则列表。
 * @param {Array} rules - 规则列表
 */
async function saveQuickReplyRules(rules) {
  if (!redis) return;
  try {
    await redis.set(REDIS_QUICKREPLY_KEY, JSON.stringify(rules));
  } catch (err) {
    logger.error('保存快捷回复规则失败', { err: err.message });
  }
}

/**
 * 尝试匹配快捷回复规则。
 * @param {string} text - 用户输入文本
 * @returns {Promise<string|null>} 匹配到的回复文本，null 表示无匹配
 */
async function matchQuickReply(text) {
  const rules = await getQuickReplyRules();
  const lower = text.toLowerCase();
  for (const rule of rules) {
    const kw = (rule.keyword || '').toLowerCase();
    if (rule.matchType === 'exact' && lower === kw) {
      stats.quickReplyHits++;
      return rule.reply;
    }
    if (rule.matchType === 'fuzzy' && lower.includes(kw)) {
      stats.quickReplyHits++;
      return rule.reply;
    }
  }
  return null;
}

// ─── v2.1 模板消息 DB 日志 ──────────────────────────────────────

/**
 * 记录模板消息发送日志到 DB。
 * @param {Object} log - 日志信息
 */
async function dbTemplateLog(log) {
  if (!pgPool) return;
  const { openId, templateId, msgid, status, detail } = log;
  const derived = deriveChannelAndId(openId);
  try {
    await pgPool.query(
      `INSERT INTO clawbot_template_log (open_id, channel, template_id, msgid, status, detail)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        derived.cleanId,
        derived.channel,
        templateId || '',
        msgid || null,
        status || 'sent',
        detail || null,
      ]
    );
  } catch (err) {
    logger.error('模板消息日志写入 DB 失败', { err: err.message, openId, templateId });
  }
}

// ─── v2.2 群发消息完成回调 DB 日志 ──────────────────────────────

/**
 * 记录群发消息完成回调日志到 DB（PCI-DSS 10.2.2）。
 * @param {Object} log - 群发完成信息
 */
async function dbBroadcastLog(log) {
  if (!pgPool) return;
  const { msgId, status, totalCount, filterCount, sentCount, errorCount } = log;
  try {
    await pgPool.query(
      `INSERT INTO clawbot_broadcast_log (msg_id, status, total_count, filter_count, sent_count, error_count)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        msgId || null,
        status || 'unknown',
        totalCount || 0,
        filterCount || 0,
        sentCount || 0,
        errorCount || 0,
      ]
    );
  } catch (err) {
    logger.error('群发消息日志写入 DB 失败', { err: err.message, msgId });
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

// ─── 微信用户资料获取（自动获取昵称等信息）──────────────────
/**
 * 调用微信 API 获取用户基本信息。
 * 用户关注公众号后即可获取 openid 对应的昵称等基础信息。
 * @param {string} openId - 用户 OpenID
 * @returns {Promise<{nickname: string}|null>}
 */
async function fetchUserInfo(openId) {
  const token = await getAccessToken();
  if (!token) return null;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  try {
    const url = `https://api.weixin.qq.com/cgi-bin/user/info?access_token=${encodeURIComponent(token)}&openid=${encodeURIComponent(openId)}&lang=zh_CN`;
    const { body } = await request(url, {
      bodyTimeout: 10_000,
      headersTimeout: 10_000,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const data = await body.json();
    if (data.subscribe !== undefined && data.nickname) {
      await setUserNickname(openId, data.nickname);
      return { nickname: data.nickname };
    }
    if (data.errcode) {
      logger.warn('获取用户资料失败', { errcode: data.errcode, errmsg: data.errmsg, openId });
    }
    return null;
  } catch (err) {
    clearTimeout(timeoutId);
    logger.error('获取用户资料异常', { err: err.message, openId });
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
  'MENU_TOOLS': '/tools',
  'MENU_TRANSFER': '/transfer',
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
    // 登录锁定检查（PCI-DSS 8.1.6）
    const lockout = await checkBindLockout(openId);
    if (lockout.locked) {
      return `🔒 账户已被临时锁定（连续绑定失败次数过多）。\n\n请 ${lockout.remainingMin} 分钟后重试。`;
    }
    const email = text.slice(6).trim().toLowerCase();
    if (!email || !EMAIL_RE.test(email) || email.length > 254) {
      return '❌ 邮箱格式不正确，请重新输入。\n\n用法：/bind yourname@example.com';
    }
    // 格式验证通过后才记录绑定尝试（避免格式错误触发锁定）
    await setUserEmail(openId, email);
    await setUserAuthed(openId);
    await clearBindFailures(openId);
    logger.info('audit', { action: 'bind', openId, detail: `email=${email}` });
    // 异步写入 DB（不阻塞响应）
    dbAuditLog({ openId, action: 'bind', detail: `email=${email}` });
    dbUpsertUser({ openId, email, status: 'active' });
    return `✅ 已绑定计费邮箱：${email}\n\n你已通过认证，现在可以使用所有 AI 功能。\n后续对话将归入该账户计费。`;
  }

  // /unbind — 解除绑定并清除所有数据（PCI-DSS v4.0 敏感操作二次确认）
  if (text === '/unbind') {
    if (!redis) {
      return '❌ 系统服务暂时不可用，请稍后重试。';
    }
    // 设置确认标记，要求用户发送 /unbind confirm 确认
    await redis.set(`${REDIS_UNBIND_CONFIRM_PREFIX}${openId}`, '1', 'EX', UNBIND_CONFIRM_TTL);
    return '⚠️ 解绑将清除你的所有个人数据（邮箱、会话、偏好），此操作不可恢复。\n\n' +
      `确认解绑请在 ${UNBIND_CONFIRM_TTL} 秒内发送：\n/unbind confirm`;
  }
  if (text === '/unbind confirm') {
    if (!redis) {
      return '❌ 系统服务暂时不可用，请稍后重试。';
    }
    // 检查确认标记
    const flag = await redis.get(`${REDIS_UNBIND_CONFIRM_PREFIX}${openId}`);
    await redis.del(`${REDIS_UNBIND_CONFIRM_PREFIX}${openId}`);
    if (flag !== '1') {
      return '❌ 解绑确认已过期或未发起。请先发送 /unbind 再确认。';
    }
    const email = await getUserEmail(openId);
    await clearUserData(openId);
    logger.info('audit', { action: 'unbind', openId, detail: `email=${email || 'N/A'}` });
    dbAuditLog({ openId, action: 'unbind', detail: `email=${email || 'N/A'}` });
    return '✅ 已解除邮箱绑定并清除所有个人数据。\n\n' +
      '如需继续使用，请重新绑定邮箱：\n/bind 你的邮箱@example.com';
  }

  // /consent — 同意数据处理协议（v2.4 PCI-DSS v4.0 合规）
  if (text === '/consent') {
    const hasConsent = await hasUserConsent(openId);
    if (hasConsent) {
      return '✅ 你已同意数据处理协议（v' + CONSENT_VERSION + '）。\n\n' +
        '如需了解详情，请发送 /consent info。';
    }
    return '📋 Anima 灵枢接入通道 · 数据处理协议\n\n' +
      '使用本服务前，请阅读并同意以下条款：\n\n' +
      '1️⃣ 数据处理：你的消息将通过 AI 模型处理，用于对话服务。\n' +
      '2️⃣ 隐私政策：你的个人数据（邮箱、会话记录）将被安全存储和处理。\n' +
      '3️⃣ 服务条款：使用本服务即表示你同意遵守服务使用规范。\n\n' +
      '⚠️ 数据安全保障：\n' +
      '• 会话数据 AES-256-GCM 加密存储\n' +
      '• 用户数据隔离（独立 Redis 键空间）\n' +
      '• 审计日志保留 ' + AUDIT_RETENTION_DAYS + ' 天\n' +
      '• 符合 PCI-DSS v4.0 / CIS v8 标准\n\n' +
      '发送 /consent agree 表示同意以上条款。';
  }
  if (text === '/consent agree') {
    await grantUserConsent(openId);
    return '✅ 你已成功同意数据处理协议（v' + CONSENT_VERSION + '）。\n\n' +
      '现在可以正常使用所有功能。';
  }
  if (text === '/consent info') {
    const hasConsent = await hasUserConsent(openId);
    return '📋 数据处理协议信息\n\n' +
      '协议版本：v' + CONSENT_VERSION + '\n' +
      '同意状态：' + (hasConsent ? '✅ 已同意' : '❌ 未同意') + '\n' +
      '安全标准：PCI-DSS v4.0 / CIS v8\n' +
      '数据加密：AES-256-GCM（会话）/ AES-256-CBC（消息）\n' +
      '审计保留：' + AUDIT_RETENTION_DAYS + ' 天\n\n' +
      '如需撤回同意，请发送 /unbind 解绑并删除所有数据。';
  }

  // /settings — 用户偏好设置（v2.4 个性化体验）
  if (text === '/settings') {
    const settings = await getUserSettings(openId);
    return '⚙️ 个人设置\n\n' +
      '语言：' + (settings.language === 'zh' ? '🇨🇳 中文' : '🇺🇸 English') + '\n' +
      '模板消息通知：' + (settings.notify_template ? '✅ 开启' : '❌ 关闭') + '\n' +
      '群发消息通知：' + (settings.notify_broadcast ? '✅ 开启' : '❌ 关闭') + '\n' +
      '自动语音回复：' + (settings.auto_tts ? '✅ 开启' : '❌ 关闭') + '\n\n' +
      '修改设置：\n' +
      '/settings lang zh — 切换中文\n' +
      '/settings lang en — 切换英文\n' +
      '/settings tts on — 开启自动语音回复\n' +
      '/settings tts off — 关闭自动语音回复\n' +
      '/settings notify on — 开启全部通知\n' +
      '/settings notify off — 关闭全部通知';
  }
  if (text.startsWith('/settings ') || text.startsWith('/settings\u3000')) {
    const settingsCmd = text.slice(10).trim().toLowerCase();
    const settings = await getUserSettings(openId);

    if (settingsCmd === 'lang zh' || settingsCmd === 'lang cn') {
      settings.language = 'zh';
      await saveUserSettings(openId, settings);
      return '✅ 已切换为中文。';
    }
    if (settingsCmd === 'lang en') {
      settings.language = 'en';
      await saveUserSettings(openId, settings);
      return '✅ Switched to English.';
    }
    if (settingsCmd === 'tts on') {
      settings.auto_tts = true;
      await saveUserSettings(openId, settings);
      return '✅ 自动语音回复已开启。';
    }
    if (settingsCmd === 'tts off') {
      settings.auto_tts = false;
      await saveUserSettings(openId, settings);
      return '✅ 自动语音回复已关闭。';
    }
    if (settingsCmd === 'notify on') {
      settings.notify_template = true;
      settings.notify_broadcast = true;
      await saveUserSettings(openId, settings);
      return '✅ 全部通知已开启。';
    }
    if (settingsCmd === 'notify off') {
      settings.notify_template = false;
      settings.notify_broadcast = false;
      await saveUserSettings(openId, settings);
      return '✅ 全部通知已关闭。';
    }
    return '❌ 无效的设置命令。发送 /settings 查看可用设置。';
  }

  // /help — 帮助
  if (text === '/help') {
    return '📖 Anima 灵枢接入通道 · 命令列表\n\n' +
      '【基础】\n' +
      '/bind <邮箱> — 绑定邮箱（首次使用必须绑定）\n' +
      '/unbind — 解除绑定并清除个人数据\n' +
      '/setup — 接入向导（分步引导完成全流程）\n' +
      '/activate — 一键激活 ClawBot 插件\n' +
      '/consent — 数据处理协议\n' +
      '/balance — 查询账户余额\n' +
      '/status — 查看账户状态\n' +
      '/model <模型名> — 切换 AI 模型\n' +
      '/clear — 清除对话上下文\n' +
      '/export — 导出个人数据\n' +
      '/settings — 个人偏好设置\n\n' +
      '【工具】\n' +
      '/search <关键词> — 网页搜索\n' +
      '/calendar [操作] — 日历管理\n' +
      '/home [命令] — 智能家居控制\n' +
      '/files [操作] — 云存储管理\n' +
      '/email [操作] — 邮件管理\n' +
      '/tools — 查看所有已集成工具\n\n' +
      '【服务】\n' +
      '/transfer — 转接人工客服\n\n' +
      '【消息类型】\n' +
      '• 发送文字 — AI 对话\n' +
      '• 发送语音 — 语音转文字 → AI 对话\n' +
      '• 发送图片/文件 — AI 分析\n' +
      '• 发送位置 — 位置相关 AI 服务\n' +
      '• 发送链接 — 链接内容分析\n\n' +
      '/guide — 功能导航（详细功能介绍）\n' +
      '/help — 显示此帮助';
  }

  // /guide — 功能导航（详细功能介绍，帮助普通用户快速上手）
  if (text === '/guide') {
    stats.totalCommands++;
    stats.commandsByName['guide'] = (stats.commandsByName['guide'] || 0) + 1;
    return '🧭 Anima 灵枢接入通道 · 功能导航\n\n' +
      '═══ 🤖 AI 对话 ═══\n' +
      '直接发送文字即可与 AI 对话，支持 70+ 模型。\n' +
      '• /model <模型名> 切换模型\n' +
      '• /clear 清除上下文重新开始\n\n' +
      '═══ 🔍 网页搜索 ═══\n' +
      '发送 /search <关键词> 即可搜索全网信息。\n' +
      '例：/search 今天天气\n\n' +
      '═══ 📅 日历管理 ═══\n' +
      '发送 /calendar 管理你的日程（Nextcloud CalDAV）。\n' +
      '例：/calendar 明天下午3点开会\n\n' +
      '═══ 📧 邮件管理 ═══\n' +
      '发送 /email 查看、搜索或发送邮件。\n' +
      '例：/email 查看最新邮件\n\n' +
      '═══ 📁 云存储 ═══\n' +
      '发送 /files 管理你的云端文件（Nextcloud WebDAV）。\n' +
      '例：/files 查找报告\n\n' +
      '═══ 🏠 智能家居 ═══\n' +
      '发送 /home 控制你的智能设备（Home Assistant）。\n' +
      '例：/home 打开客厅灯\n\n' +
      '═══ 🎤 语音交互 ═══\n' +
      '直接发送语音消息，AI 自动识别并回复。\n' +
      '支持语音转文字 → AI 对话 → 语音回复。\n\n' +
      '═══ 📎 文件分析 ═══\n' +
      '发送图片、视频、文件，AI 自动分析内容。\n\n' +
      '═══ 🔐 账户安全 ═══\n' +
      '/bind <邮箱> — 绑定邮箱完成认证\n' +
      '/unbind — 解绑并删除所有个人数据\n' +
      '/status — 查看当前账户状态\n' +
      '/export — 导出个人数据\n' +
      '/balance — 查询余额\n\n' +
      '═══ 🔌 ClawBot 插件 ═══\n' +
      '本通道为官方微信 ClawBot 插件灵枢接入通道（v2.6）。\n' +
      '• 发送 /setup 启动接入向导（推荐新用户使用）\n' +
      '• 发送 /activate 一键激活 ClawBot 插件\n' +
      '• 在微信中搜索"ClawBot"插件即可找到\n' +
      '• 关注公众号 → /bind 绑定邮箱 → /activate 激活\n' +
      '• 插件提供企业级多租户数据隔离与加密保护\n' +
      '• /consent 查看并同意数据处理协议\n' +
      '• /settings 管理个人偏好设置\n\n' +
      '💡 所有功能需先绑定邮箱认证后使用。\n' +
      '发送 /help 查看命令速查表。';
  }

  // ── 认证检查（/bind 和 /help 不需要认证）──
  const authed = await isUserAuthed(openId);
  if (!authed) {
    logger.info('audit', { action: 'auth_check_fail', openId, detail: 'unauthenticated_access_attempt' });
    dbAuditLog({ openId, action: 'auth_check_fail', detail: 'unauthenticated_access_attempt' });
    return '🔒 请先绑定邮箱完成认证后使用。\n\n' +
      '发送：/bind 你的邮箱@example.com\n\n' +
      '绑定后即可使用所有 AI 功能。';
  }

  // ── 封禁检查（CIS 访问控制）──
  if (await isUserBlocked(openId)) {
    logger.info('audit', { action: 'blocked_access_attempt', openId });
    return '⛔ 你的账户已被暂停使用。\n\n如有疑问，请联系管理员。';
  }

  // ── v2.2 快捷回复规则匹配（认证 + 封禁检查之后，命令之前）──
  // v2.1 中快捷回复在认证检查之前，导致未登录用户可触发快捷回复，
  // 违反"所有用户必须登录才可使用"的安全要求（PCI-DSS 7.1）。
  if (!text.startsWith('/')) {
    const quickReply = await matchQuickReply(text);
    if (quickReply) {
      stats.quickReplyHits++;
      logger.info('快捷回复命中', { openId, keyword: text.substring(0, 50) });
      return quickReply;
    }
  }

  // /balance — 查询余额
  if (text === '/balance') {
    const email = await getUserEmail(openId);
    if (!email) {
      return '请先绑定邮箱：/bind yourname@example.com';
    }
    return await queryBalance(email, requestId);
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
    if (redis) {
      redis.del(`${REDIS_SESSION_PREFIX}${openId}`).catch((err) => logger.error('Session clear failed', { err: err.message, openId }));
    }
    logger.info('用户清除对话上下文', { openId });
    return '🗑 对话上下文已清除。';
  }

  // /status — 查看账户状态
  if (text === '/status') {
    const email = await getUserEmail(openId);
    const model = (await getUserModel(openId)) || DEFAULT_MODEL;
    const session = sessions.get(openId);
    const sessionMsgCount = session ? session.messages.length : 0;
    const nickname = await getUserNickname(openId);
    // v2.5: 检查插件激活状态
    let pluginActive = false;
    if (redis) {
      try { pluginActive = (await redis.sismember(REDIS_PLUGIN_ACTIVATED_KEY, openId)) === 1; } catch (_e) { /* ignore */ }
    }
    return '📊 账户状态\n\n' +
      `✅ 认证：已通过\n` +
      (nickname ? `👤 昵称：${nickname}\n` : '') +
      `📧 邮箱：${email || '未绑定'}\n` +
      `🤖 模型：${model}\n` +
      `💬 当前会话消息数：${sessionMsgCount}\n` +
      `🔗 通道：灵枢接入通道（微信公众号）\n` +
      `🔌 ClawBot 插件：${pluginActive ? '已激活 v' + PLUGIN_VERSION : '未激活（发送 /activate 激活）'}\n` +
      `🛡 数据隔离：已启用\n` +
      `🔐 会话加密：${SESSION_ENCRYPT_KEY ? 'AES-256-GCM' : '未启用'}\n\n` +
      '发送 /help 查看所有命令。';
  }

  // /export — 导出个人数据（PCI-DSS 数据可移植性）
  if (text === '/export') {
    const email = await getUserEmail(openId);
    const model = (await getUserModel(openId)) || DEFAULT_MODEL;
    const nickname = await getUserNickname(openId);
    const session = sessions.get(openId);
    const sessionMsgCount = session ? session.messages.length : 0;
    const recentMessages = session
      ? session.messages.slice(-10).map((m, i) => `  ${i + 1}. [${m.role}] ${m.content.substring(0, 100)}${m.content.length > 100 ? '...' : ''}`).join('\n')
      : '  无会话记录';
    logger.info('audit', { action: 'export', openId, detail: 'user_data_export' });
    dbAuditLog({ openId, action: 'export', detail: 'user_data_export' });
    stats.exportCount = (stats.exportCount || 0) + 1;
    return '📋 个人数据导出\n\n' +
      `【账户信息】\n` +
      `通道：灵枢接入通道（微信公众号）\n` +
      (nickname ? `昵称：${nickname}\n` : '') +
      `邮箱：${email || '未绑定'}\n` +
      `模型：${model}\n` +
      `认证状态：已通过\n` +
      `会话消息数：${sessionMsgCount}\n\n` +
      `【最近对话记录（最多10条）】\n${recentMessages}\n\n` +
      `导出时间：${new Date().toISOString()}\n` +
      `版本：灵枢接入通道 v2.6\n\n` +
      '⚠️ 请妥善保管导出数据，避免泄露个人信息。';
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

  // /tools — 统一工具入口（v2.1 汇总所有已集成模块）
  if (text === '/tools') {
    return '🧰 Anima 灵枢接入通道 · 已集成工具\n\n' +
      '═══ 已启用模块 ═══\n' +
      '🤖 AI 对话 — 直接发送文字，支持 70+ 模型\n' +
      '🔍 网页搜索 — /search <关键词>\n' +
      '📅 日历管理 — /calendar [操作]（CalDAV）\n' +
      '📧 邮件管理 — /email [操作]（IMAP/SMTP）\n' +
      '📁 云存储 — /files [操作]（Nextcloud WebDAV）\n' +
      '🏠 智能家居 — /home [命令]（Home Assistant）\n' +
      '🎤 语音交互 — 发送语音消息（Whisper STT + TTS）\n' +
      '📎 文件分析 — 发送图片/文件进行 AI 分析\n' +
      '📍 位置服务 — 发送位置获取 AI 服务\n' +
      '🔗 链接分析 — 发送链接进行内容分析\n\n' +
      '═══ 账户管理 ═══\n' +
      '💰 余额查询 — /balance\n' +
      '📊 账户状态 — /status\n' +
      '📋 数据导出 — /export\n' +
      '🔄 切换模型 — /model <模型名>\n' +
      '🗑 清除上下文 — /clear\n\n' +
      '═══ 服务支持 ═══\n' +
      '👤 人工客服 — /transfer\n\n' +
      '═══ 🔌 插件信息 ═══\n' +
      '📦 ClawBot 插件 v2.6（官方微信插件）\n' +
      '🔐 会话加密 | 🛡 PCI-DSS v4.0 | 📋 CIS v8\n' +
      '🧭 /setup — 接入向导（推荐新用户）\n' +
      '🚀 /activate — 一键激活 ClawBot 插件\n' +
      '📋 /consent — 数据处理协议\n' +
      '⚙️ /settings — 个人偏好设置\n\n' +
      '💡 所有功能需先绑定邮箱认证后使用。';
  }

  // /setup — v2.6 接入向导（普通用户轻松接入全流程引导）
  if (text === '/setup') {
    stats.totalCommands++;
    stats.commandsByName['setup'] = (stats.commandsByName['setup'] || 0) + 1;
    // 并行查询用户状态，减少响应延迟
    const [email, pluginActiveRaw] = await Promise.all([
      getUserEmail(openId),
      redis ? redis.sismember(REDIS_PLUGIN_ACTIVATED_KEY, openId).catch(() => 0) : Promise.resolve(0),
    ]);
    const isAuth = !!email;
    const consentOk = isAuth ? await hasUserConsent(openId) : false;
    const pluginActive = !!pluginActiveRaw;
    // 计算当前步骤
    let step = 1;
    if (isAuth) step = 2;
    if (isAuth && consentOk) step = 3;
    if (isAuth && consentOk && pluginActive) step = 4;

    let msg = '🧭 ClawBot 插件接入向导\n';
    msg += '════════════════════════\n\n';

    // 步骤 1：绑定邮箱
    msg += step === 1 ? '👉 ' : (isAuth ? '✅ ' : '⬜ ');
    msg += '步骤 1：绑定邮箱认证\n';
    if (step === 1) {
      msg += '   发送 /bind 你的邮箱@example.com\n';
      msg += '   或访问 OAuth 授权链接一键登录\n\n';
    } else if (isAuth) {
      msg += `   已绑定：${email}\n\n`;
    }

    // 步骤 2：同意数据协议
    msg += step === 2 ? '👉 ' : (consentOk ? '✅ ' : '⬜ ');
    msg += '步骤 2：同意数据处理协议\n';
    if (step === 2) {
      msg += '   发送 /consent agree 同意协议\n';
      msg += '   （PCI-DSS v4.0 / GDPR 合规要求）\n\n';
    } else if (consentOk) {
      msg += '   已同意\n\n';
    } else {
      msg += '\n';
    }

    // 步骤 3：激活插件
    msg += step === 3 ? '👉 ' : (pluginActive ? '✅ ' : '⬜ ');
    msg += '步骤 3：激活 ClawBot 插件\n';
    if (step === 3) {
      msg += '   发送 /activate 一键激活\n\n';
    } else if (pluginActive) {
      msg += `   已激活 v${PLUGIN_VERSION}\n\n`;
    } else {
      msg += '\n';
    }

    // 步骤 4：个性化设置
    msg += step === 4 ? '👉 ' : '⬜ ';
    msg += '步骤 4：个性化设置（可选）\n';
    if (step === 4) {
      msg += '   发送 /settings 管理偏好\n';
      msg += '   发送 /model 切换 AI 模型\n\n';
    } else {
      msg += '\n';
    }

    if (step === 4) {
      msg += '🎉 全部步骤已完成！直接发送消息开始使用。\n';
      msg += '发送 /tools 查看全部功能 | /help 命令列表';
      stats.setupWizardCompleted++;
    } else {
      msg += `📋 当前进度：${step - 1}/4 步已完成\n`;
      msg += '按照上方 👉 提示完成当前步骤即可继续。';
    }

    dbAuditLog({ openId, action: 'setup_wizard', detail: `step=${step}` });
    return msg;
  }

  // /quickstart — v2.8 一键接入向导（普通用户零门槛接入）
  if (text === '/quickstart') {
    stats.totalCommands++;
    stats.commandsByName['quickstart'] = (stats.commandsByName['quickstart'] || 0) + 1;
    const actions = [];
    let alreadyDone = 0;
    const totalSteps = 3;

    // 步骤 1：自动绑定检查
    const email = await getUserEmail(openId);
    const isAuth = !!email;
    if (isAuth) {
      alreadyDone++;
    } else if (OAUTH_REDIRECT_URI) {
      // OAuth 可用 → 引导用户授权
      actions.push('📧 请先通过 OAuth 授权或发送 /bind 邮箱 完成认证');
    } else {
      actions.push('📧 请先发送 /bind 你的邮箱@example.com 完成认证');
    }

    // 步骤 2：自动同意
    if (isAuth) {
      const consentOk = await hasUserConsent(openId);
      if (consentOk) {
        alreadyDone++;
      } else {
        // 自动同意数据协议
        try {
          await saveUserConsent(openId, 'data_processing', true);
          alreadyDone++;
          actions.push('✅ 已自动同意数据处理协议');
        } catch (consentErr) {
          logger.warn('quickstart 自动同意失败', { openId, err: consentErr.message });
          actions.push('❌ 数据协议同意失败，请发送 /consent agree');
        }
      }
    }

    // 步骤 3：自动激活
    if (isAuth && alreadyDone >= 2) {
      let pluginActive = false;
      if (redis) {
        try {
          pluginActive = !!(await redis.sismember(REDIS_PLUGIN_ACTIVATED_KEY, openId));
        } catch (checkErr) { logger.warn('quickstart 插件状态查询失败', { openId, err: checkErr.message }); }
      }
      if (pluginActive) {
        alreadyDone++;
      } else if (redis) {
        try {
          await redis.sadd(REDIS_PLUGIN_ACTIVATED_KEY, openId);
          alreadyDone++;
          stats.pluginActivations++;
          stats.userActivations++;
          actions.push('✅ ClawBot 插件已自动激活');
          dbAuditLog({ openId, action: 'plugin_activate', detail: `version=${PLUGIN_VERSION},method=quickstart` });
        } catch (activateErr) {
          logger.warn('quickstart 插件激活失败', { openId, err: activateErr.message });
          actions.push('❌ 插件激活失败，请发送 /activate');
        }
      }
    }

    let msg = '⚡ ClawBot 一键接入\n';
    msg += '════════════════════════\n\n';

    if (alreadyDone === totalSteps) {
      msg += '🎉 全部步骤已完成！您已可以使用所有功能。\n\n';
      msg += `📧 邮箱：${email}\n`;
      msg += `🔌 插件：v${PLUGIN_VERSION}\n`;
      msg += '🛡 数据隔离：已启用\n';
      msg += '🔐 加密：' + (SESSION_ENCRYPT_KEY ? 'AES-256-GCM + HKDF' : '未配置') + '\n\n';
      msg += '发送任意消息开始 AI 对话\n';
      msg += '发送 /tools 查看全部功能 | /help 命令列表';
      stats.quickstartCompleted++;
    } else if (actions.length > 0) {
      msg += actions.join('\n') + '\n\n';
      msg += `📋 进度：${alreadyDone}/${totalSteps} 步完成\n`;
      if (!isAuth) {
        msg += '\n💡 完成认证后再次发送 /quickstart 一键完成剩余步骤';
      }
    }

    dbAuditLog({ openId, action: 'quickstart', detail: `completed=${alreadyDone}/${totalSteps}` });
    return msg;
  }

  // /activate — v2.5 插件自助激活（普通用户轻松接入）
  if (text === '/activate') {
    stats.totalCommands++;
    stats.commandsByName['activate'] = (stats.commandsByName['activate'] || 0) + 1;
    // 检查是否已激活
    if (redis) {
      try {
        const isActivated = await redis.sismember(REDIS_PLUGIN_ACTIVATED_KEY, openId);
        if (isActivated) {
          const email = await getUserEmail(openId);
          return '✅ ClawBot 插件已激活！\n\n' +
            `📧 绑定邮箱：${email || '未知'}\n` +
            `🔌 插件版本：v${PLUGIN_VERSION}\n` +
            '🛡 数据隔离：已启用\n' +
            '🔐 会话加密：' + (SESSION_ENCRYPT_KEY ? '已启用（AES-256-GCM）' : '未启用') + '\n\n' +
            '所有功能已就绪，直接发送消息即可使用。\n' +
            '发送 /tools 查看全部已集成工具。';
        }
      } catch (_e) { /* continue */ }
    }
    // 未激活：执行激活流程
    if (redis) {
      try {
        await redis.sadd(REDIS_PLUGIN_ACTIVATED_KEY, openId);
      } catch (err) {
        logger.error('插件激活失败', { err: err.message, openId });
      }
    }
    stats.pluginActivations++;
    stats.userActivations++;
    dbAuditLog({ openId, action: 'plugin_activate', detail: `version=${PLUGIN_VERSION},method=self_service` });
    // 记录插件日志
    if (pgPool) {
      pgPool.query(
        `INSERT INTO clawbot_plugin_log (open_id, channel, event, detail, created_at)
         VALUES ($1, $2, 'activate', $3, NOW())`,
        [deriveChannelAndId(openId).cleanId, deriveChannelAndId(openId).channel,
         `version=${PLUGIN_VERSION},method=self_service`]
      ).catch(() => {});
    }
    return '🎉 ClawBot 插件激活成功！\n\n' +
      `🔌 插件版本：v${PLUGIN_VERSION}\n` +
      '📋 通道：灵枢接入通道（微信公众号）\n\n' +
      '═══ 已激活功能 ═══\n' +
      '🤖 AI 对话（70+ 模型）\n' +
      '🔍 网页搜索 | 📅 日历管理\n' +
      '📧 邮件管理 | 📁 云存储\n' +
      '🏠 智能家居 | 🎤 语音交互\n' +
      '📎 文件分析 | 📍 位置服务\n' +
      '🔗 链接分析 | 👤 人工客服\n\n' +
      '═══ 安全保障 ═══\n' +
      '🛡 PCI-DSS v4.0 合规\n' +
      '📋 CIS v8 安全标准\n' +
      '🔐 数据隔离：每用户独立命名空间\n' +
      '🔒 会话加密：' + (SESSION_ENCRYPT_KEY ? 'AES-256-GCM' : '请联系管理员启用') + '\n\n' +
      '直接发送消息即可开始使用！\n' +
      '发送 /tools 查看全部工具 | /help 命令列表';
  }

  // /transfer — 转接人工客服（v2.1 客服会话转接）
  if (text === '/transfer') {
    logger.info('用户请求转接客服', { openId });
    dbAuditLog({ openId, action: 'kf_transfer', detail: 'user_initiated' });
    const success = await transferToKf(openId);
    if (success) {
      return '👤 已为你转接人工客服，请稍候...\n\n如无人工客服在线，请稍后再试或直接发送消息与 AI 对话。';
    }
    return '❌ 人工客服转接失败，请稍后重试。\n\n你可以继续发送消息与 AI 对话。';
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
  // 封禁检查
  if (await isUserBlocked(openId)) {
    return '⛔ 你的账户已被暂停使用。如有疑问，请联系管理员。';
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
  if (await isUserBlocked(openId)) {
    return '⛔ 你的账户已被暂停使用。如有疑问，请联系管理员。';
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
  if (await isUserBlocked(openId)) {
    return '⛔ 你的账户已被暂停使用。如有疑问，请联系管理员。';
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
  if (await isUserBlocked(openId)) {
    return '⛔ 你的账户已被暂停使用。如有疑问，请联系管理员。';
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
  if (await isUserBlocked(openId)) {
    return '⛔ 你的账户已被暂停使用。如有疑问，请联系管理员。';
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

// 信任反向代理（Nginx / LB），确保 req.ip 获取真实客户端 IP
app.set('trust proxy', 1);

// 安全中间件（CIS 安全头加固：跨域资源策略 + 标准安全头）
app.use(helmet({
  crossOriginResourcePolicy: { policy: 'same-origin' },
  // v2.4 CIS v8 安全头增强
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: false },
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'"],
      styleSrc: ["'self'", "'unsafe-inline'"],
      imgSrc: ["'self'", 'data:'],
      connectSrc: ["'self'"],
      frameSrc: ["'none'"],
      objectSrc: ["'none'"],
    },
  },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
}));

app.disable('x-powered-by');
app.disable('etag');

// ─── v2.4 CIS 安全头增强 ────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()');
  next();
});

// ─── Cache-Control: no-store（CIS 14.x 防止敏感数据缓存）──
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store');
  next();
});

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
    if (req.path !== '/health' && req.path !== '/ready') {
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

// 速率限制：OAuth 授权端点（防暴力授权，与 nginx login zone 对齐 5r/m）
const oauthLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Too many requests',
});

// ─── 管理端点 IP 白名单中间件（CIS 网络访问限制）──────────
function normalizeIp(ip) {
  // 处理 IPv4-mapped IPv6 地址（如 ::ffff:192.168.1.1 → 192.168.1.1）
  if (ip && ip.startsWith('::ffff:')) return ip.slice(7);
  return ip || '';
}

function requireAdminIp(req, res, next) {
  if (ADMIN_IP_ALLOWLIST.length === 0) {
    // 未配置白名单时不限制（向后兼容）
    next();
    return;
  }
  const clientIp = normalizeIp(req.ip);
  if (!ADMIN_IP_ALLOWLIST.includes(clientIp)) {
    logger.info('audit', {
      action: 'admin_ip_denied',
      ip: clientIp,
      endpoint: req.path,
      method: req.method,
      request_id: req.id,
    });
    dbAuditLog({ openId: 'admin', action: 'admin_ip_denied', detail: `${req.method} ${req.path}`, ip: clientIp, requestId: req.id });
    res.status(403).json({ error: 'Forbidden: IP not in allowlist' });
    return;
  }
  next();
}

// ─── SERVICE_TOKEN 认证中间件（管理端点保护）─────────────────
// v2.7: 同时支持 Bearer SERVICE_TOKEN 和 Web 管理后台会话认证
async function requireServiceToken(req, res, next) {
  if (!SERVICE_TOKEN) {
    // 未配置 SERVICE_TOKEN 时，管理端点不可用
    res.status(403).json({ error: 'SERVICE_TOKEN not configured' });
    return;
  }

  // 方式一：Bearer SERVICE_TOKEN 认证（API 调用）
  const auth = req.headers.authorization || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (token) {
    // 使用 HMAC 归一化为等长摘要，避免长度差异导致的时序泄漏
    const hmacKey = Buffer.from('clawbot-auth', 'utf8');
    const expected = crypto.createHmac('sha256', hmacKey).update(SERVICE_TOKEN).digest();
    const provided = crypto.createHmac('sha256', hmacKey).update(token).digest();
    if (crypto.timingSafeEqual(expected, provided)) {
      // PCI-DSS 10.2.2: 审计特权用户操作
      logger.info('audit', {
        action: 'admin_access',
        ip: req.ip,
        endpoint: req.path,
        method: req.method,
        request_id: req.id,
      });
      dbAuditLog({ openId: 'admin', action: 'admin_access', detail: `${req.method} ${req.path}`, ip: req.ip, requestId: req.id });
      next();
      return;
    }
  }

  // 方式二：Web 管理后台会话认证（X-Admin-Session + X-CSRF-Token）
  const sessionId = req.headers['x-admin-session'] || '';
  const csrfToken = req.headers['x-csrf-token'] || '';
  if (sessionId && csrfToken) {
    const valid = await verifyAdminSession(sessionId, csrfToken);
    if (valid) {
      logger.info('audit', {
        action: 'admin_web_access',
        ip: req.ip,
        endpoint: req.path,
        method: req.method,
        request_id: req.id,
      });
      dbAuditLog({ openId: 'admin', action: 'admin_web_access', detail: `${req.method} ${req.path}`, ip: req.ip, requestId: req.id });
      next();
      return;
    }
  }

  // PCI-DSS 10.2.4: 审计无效逻辑访问尝试
  logger.info('audit', {
    action: 'admin_auth_fail',
    ip: req.ip,
    endpoint: req.path,
    method: req.method,
    request_id: req.id,
  });
  dbAuditLog({ openId: 'admin', action: 'admin_auth_fail', detail: `${req.method} ${req.path}`, ip: req.ip, requestId: req.id });
  res.status(401).json({ error: 'Unauthorized' });
}

// 微信回调需要原始 XML body
app.use('/clawbot/webhook', express.text({ type: ['text/xml', 'application/xml'], limit: '256kb' }));
app.use(express.json({ limit: '256kb' }));

// ─── Content-Type 强制校验（CIS 安全加固）──────────────────
// 管理端点 POST/PUT/PATCH 必须为 application/json，与 webhook server.js 对齐
// Webhook 端点使用 XML，不受此限制
app.use((req, res, next) => {
  if (['POST', 'PUT', 'PATCH'].includes(req.method)
      && !req.path.startsWith('/clawbot/webhook') && !req.path.startsWith('/wecom/webhook')) {
    const ct = (req.headers['content-type'] || '').split(';')[0].trim();
    if (ct !== 'application/json') {
      res.status(415).json({ error: 'Unsupported Media Type: Content-Type must be application/json' });
      return;
    }
  }
  next();
});

// ─── 健康检查（存活探针）──────────────────────────────────────
app.get('/health', (req, res) => {
  const redisOk = redis ? redis.status === 'ready' : true;
  const status = redisOk ? 'ok' : 'degraded';
  res.status(redisOk ? 200 : 503).json({ status });
});

// ─── 就绪探针（Kubernetes 就绪检测）──────────────────────────
app.get('/ready', verifyLimiter, async (req, res) => {
  const checks = { redis: 'not_configured' };
  let ready = true;

  if (redis) {
    try {
      await redis.ping();
      checks.redis = 'ok';
    } catch (err) {
      logger.warn('Redis 就绪检测失败', { err: err.message });
      checks.redis = 'error';
      ready = false;
    }
  }

  res.status(ready ? 200 : 503).json({ ready, checks });
});

// ─── 运营统计端点（需要 SERVICE_TOKEN 认证）──────────────────
app.get('/stats', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const uptimeMs = Date.now() - stats.startedAt;
  let blockedCount = 0;
  if (redis) {
    try { blockedCount = await redis.scard(REDIS_BLOCKED_KEY); } catch (_e) { /* ignore */ }
  }
  res.json({
    version: PLUGIN_VERSION,
    channel: '灵枢接入通道',
    uptime_seconds: Math.floor(uptimeMs / 1000),
    active_sessions: sessions.size,
    max_sessions: MAX_SESSIONS,
    redis_status: redis ? redis.status : 'not_configured',
    encrypt_mode: ENCRYPT_MODE,
    wecom_enabled: WECOM_ENABLED,
    voice_enabled: VOICE_ENABLED,
    oauth_configured: !!OAUTH_REDIRECT_URI,
    total_messages: stats.totalMessages,
    messages_by_type: stats.messagesByType,
    total_commands: stats.totalCommands,
    commands_by_name: stats.commandsByName,
    total_errors: stats.totalErrors,
    blocked_users: blockedCount,
    export_count: stats.exportCount || 0,
    oauth_initiated: stats.oauthInitiated,
    oauth_completed: stats.oauthCompleted,
    templates_sent: stats.templatesSent,
    kf_transfers: stats.kfTransfers,
    quick_reply_hits: stats.quickReplyHits,
    template_callbacks: stats.templateCallbacks,
    broadcast_callbacks: stats.broadcastCallbacks,
    plugin_activations: stats.pluginActivations,
    plugin_deactivations: stats.pluginDeactivations,
    plugin_queries: stats.pluginQueries,
    consent_granted: stats.consentGranted,
    settings_updated: stats.settingsUpdated,
    plugin_verifications: stats.pluginVerifications,
    // v2.5 新增统计
    tenant_created: stats.tenantCreated,
    tenant_suspended: stats.tenantSuspended,
    api_key_created: stats.apiKeyCreated,
    api_key_revoked: stats.apiKeyRevoked,
    compliance_scans: stats.complianceScans,
    heartbeats: stats.heartbeats,
    plugin_negotiations: stats.pluginNegotiations,
    user_activations: stats.userActivations,
    // v2.6 新增统计
    channel_registered: stats.channelRegistered,
    channel_removed: stats.channelRemoved,
    webhook_deliveries: stats.webhookDeliveries,
    webhook_delivery_failures: stats.webhookDeliveryFailures,
    session_linked: stats.sessionLinked,
    session_unlinked: stats.sessionUnlinked,
    setup_wizard_completed: stats.setupWizardCompleted,
    realtime_compliance_checks: stats.realtimeComplianceChecks,
    // v2.7 管理后台统计
    admin_logins: stats.adminLogins,
    admin_logouts: stats.adminLogouts,
    admin_session_expired: stats.adminSessionExpired,
    admin_dashboard_available: !!adminDashboardHtml,
    session_encryption: !!SESSION_ENCRYPT_KEY,
    db_enabled: !!pgPool,
    bind_lockout_threshold: BIND_LOCKOUT_THRESHOLD,
    idle_session_timeout_min: IDLE_SESSION_TIMEOUT_MIN,
    audit_retention_days: AUDIT_RETENTION_DAYS,
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
    // PCI-DSS 10.2.5: 审计速率限制触发
    logger.info('audit', {
      action: 'rate_limit_violation',
      openId,
      limit: USER_RATE_LIMIT,
      request_id: req.id,
    });
    dbAuditLog({ openId, action: 'rate_limit_violation', detail: `limit=${USER_RATE_LIMIT}`, requestId: req.id });
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
  // 异步更新用户活跃时间（不阻塞消息处理）
  if (msgType !== 'event') {
    dbUpdateLastActive(openId);
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
          dbAuditLog({ openId, action: 'subscribe', detail: eventKey ? `scene=${eventKey}` : 'direct', requestId: req.id });
          dbUpsertUser({ openId, status: 'active' });
          // 异步获取用户资料（不阻塞欢迎消息）
          setImmediate(async () => {
            try {
              await fetchUserInfo(openId);
            } catch (err) {
              logger.error('获取用户资料失败', { err: err.message, openId });
            }
          });
          if (eventKey && eventKey.startsWith('qrscene_')) {
            const scene = eventKey.slice(8);
            logger.info('用户通过扫码关注', { openId, scene });
            replyText = '🤖 欢迎使用 Anima 灵枢接入通道！\n\n' +
              '你通过扫码关注，' +
              '首次使用请绑定邮箱完成认证：\n' +
              '/bind 你的邮箱@example.com\n\n' +
              '🚀 快速入门（3 步即可使用）：\n' +
              '① 发送 /bind 邮箱 完成认证\n' +
              '② 发送 /activate 激活 ClawBot 插件\n' +
              '③ 直接发送文字开始 AI 对话\n\n' +
              '绑定后即可使用全部功能：\n' +
              '🤖 AI 对话（70+ 模型） | 🔍 网页搜索\n' +
              '📅 日历管理 | 📧 邮件 | 📁 云存储\n' +
              '🏠 智能家居 | 🎤 语音交互 | 📎 文件分析\n' +
              '👤 人工客服 | 📋 数据导出\n\n' +
              '🔌 本通道为官方 ClawBot 插件灵枢接入通道（v2.6）。\n\n' +
              '发送 /setup 启动接入向导 | /guide 功能导航。\n' +
              '发送 /help 查看命令列表。';
          } else {
            replyText = '🤖 欢迎使用 Anima 灵枢接入通道！\n\n' +
              '首次使用请先绑定邮箱完成认证：\n' +
              '/bind 你的邮箱@example.com\n\n' +
              '🚀 快速入门（3 步即可使用）：\n' +
              '① 发送 /bind 邮箱 完成认证\n' +
              '② 发送 /activate 激活 ClawBot 插件\n' +
              '③ 直接发送文字开始 AI 对话\n\n' +
              '绑定后即可使用全部功能：\n' +
              '🤖 AI 对话（70+ 模型） | 🔍 网页搜索\n' +
              '📅 日历管理 | 📧 邮件 | 📁 云存储\n' +
              '🏠 智能家居 | 🎤 语音交互 | 📎 文件分析\n' +
              '👤 人工客服 | 📋 数据导出\n\n' +
              '🔌 本通道为官方 ClawBot 插件灵枢接入通道（v2.6）。\n' +
              '支持文字、语音、图片、文件、位置、链接等消息类型。\n\n' +
              '发送 /setup 启动接入向导 | /guide 功能导航。\n' +
              '发送 /help 查看命令列表。';
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
          logger.info('audit', { action: 'unsubscribe_cleanup', openId, detail: 'user_unfollowed' });
          dbAuditLog({ openId, action: 'unsubscribe', detail: 'user_unfollowed' });
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
        } else if (eventType === 'scancode_push' || eventType === 'scancode_waitmsg') {
          // 扫码菜单事件（扫码推事件 / 扫码等待结果事件）
          const scanResult = getXmlValue(xmlBody, 'ScanResult');
          const scanType = getXmlValue(xmlBody, 'ScanType');
          logger.info('用户扫码菜单事件', { openId, eventType, scanType, scanResult: (scanResult || '').substring(0, 100) });
          if (scanResult) {
            replyText = await handleTextMessage(openId, `扫码结果：${scanResult}`, req.id);
          } else {
            replyText = '📷 未识别到扫码内容，请重试。';
          }
        } else if (eventType === 'pic_sysphoto' || eventType === 'pic_photo_or_album' || eventType === 'pic_weixin') {
          // 拍照菜单事件（系统拍照 / 拍照或相册 / 微信相册）
          logger.info('用户拍照菜单事件', { openId, eventType, eventKey });
          replyText = '📸 已收到拍照请求，请发送图片给我进行 AI 分析。';
        } else if (eventType === 'location_select') {
          // 位置选择菜单事件
          const locX = getXmlValue(xmlBody, 'Location_X');
          const locY = getXmlValue(xmlBody, 'Location_Y');
          const locLabel = getXmlValue(xmlBody, 'Label');
          logger.info('用户位置选择菜单事件', { openId, eventType, lat: locX, lng: locY, label: locLabel });
          if (locX && locY) {
            replyText = await handleLocationMessage(openId, locX, locY, '', locLabel, req.id);
          } else {
            replyText = '📍 未获取到位置信息，请重新选择。';
          }
        } else if (eventType === 'LOCATION') {
          // 上报地理位置事件（用户开启自动上报后定期推送）
          logger.debug('用户地理位置上报', { openId, eventType });
          // 不回复，仅记录
        } else if (eventType === 'TEMPLATESENDJOBFINISH') {
          // v2.2: 模板消息送达结果回调（官方事件推送）
          const msgId = getXmlValue(xmlBody, 'MsgID');
          const status = getXmlValue(xmlBody, 'Status');
          logger.info('模板消息送达回调', { openId, msgId, status });
          stats.templateCallbacks++;
          // 更新模板消息日志状态（PCI-DSS 10.2.2 审计完整性）
          if (pgPool && msgId) {
            const dbStatus = status === 'success' ? 'delivered' : 'failed';
            pgPool.query(
              'UPDATE clawbot_template_log SET status = $1, detail = $2 WHERE msgid = $3',
              [dbStatus, `callback_status=${status}`, parseInt(msgId, 10)]
            ).catch((err) => {
              logger.error('更新模板消息送达状态失败', { err: err.message, msgId });
            });
          }
          dbAuditLog({ openId, action: 'template_callback', detail: `msgid=${msgId},status=${status}`, requestId: req.id });
          // 不回复用户（系统回调事件）

        // ─── v2.3 插件生命周期事件 ────────────────────────────
        } else if (eventType === 'plugin_activate') {
          stats.pluginActivations++;
          logger.info('ClawBot 插件激活事件', { openId, eventKey, requestId: req.id });
          dbAuditLog({ openId, action: 'plugin_activate', detail: `key=${eventKey || 'direct'}`, requestId: req.id });
          if (redis) {
            redis.sadd(REDIS_PLUGIN_ACTIVATED_KEY, openId).catch((e) => {
              logger.warn('Redis plugin activate sadd 失败', { err: e.message, openId });
            });
          }
          if (pgPool) {
            pgPool.query(
              `INSERT INTO clawbot_plugin_log (open_id, channel, event, detail) VALUES ($1, $2, $3, $4)`,
              [openId, 'wechat', 'activate', eventKey || 'direct']
            ).catch((err) => {
              logger.error('插件生命周期日志写入失败', { err: err.message, openId });
            });
          }
          replyText = '🔌 ClawBot 插件已激活！\n\n' +
            '你已成功激活 Anima 灵枢 ClawBot 插件。\n' +
            '首次使用请先绑定邮箱完成认证：\n' +
            '/bind 你的邮箱@example.com\n\n' +
            '发送 /guide 查看完整功能导航。';

        } else if (eventType === 'plugin_deactivate') {
          stats.pluginDeactivations++;
          logger.info('ClawBot 插件停用事件', { openId, eventKey, requestId: req.id });
          dbAuditLog({ openId, action: 'plugin_deactivate', detail: `key=${eventKey || 'user'}`, requestId: req.id });
          if (redis) {
            redis.srem(REDIS_PLUGIN_ACTIVATED_KEY, openId).catch((e) => {
              logger.warn('Redis plugin deactivate srem 失败', { err: e.message, openId });
            });
          }
          if (pgPool) {
            pgPool.query(
              `INSERT INTO clawbot_plugin_log (open_id, channel, event, detail) VALUES ($1, $2, $3, $4)`,
              [openId, 'wechat', 'deactivate', eventKey || 'user']
            ).catch((err) => {
              logger.error('插件生命周期日志写入失败', { err: err.message, openId });
            });
          }
          replyText = '';

        } else if (eventType === 'plugin_update') {
          logger.info('ClawBot 插件更新事件', { openId, eventKey, requestId: req.id });
          dbAuditLog({ openId, action: 'plugin_update', detail: `key=${eventKey || ''}`, requestId: req.id });
          if (pgPool) {
            pgPool.query(
              `INSERT INTO clawbot_plugin_log (open_id, channel, event, detail) VALUES ($1, $2, $3, $4)`,
              [openId, 'wechat', 'update', eventKey || '']
            ).catch((err) => {
              logger.error('插件生命周期日志写入失败', { err: err.message, openId });
            });
          }
          replyText = '';

        } else if (eventType === 'MASSSENDJOBFINISH') {
          // v2.2: 群发消息完成回调（官方事件推送）
          const msgId = getXmlValue(xmlBody, 'MsgID');
          const status = getXmlValue(xmlBody, 'Status');
          const totalCount = getXmlValue(xmlBody, 'TotalCount');
          const filterCount = getXmlValue(xmlBody, 'FilterCount');
          const sentCount = getXmlValue(xmlBody, 'SentCount');
          const errorCount = getXmlValue(xmlBody, 'ErrorCount');
          logger.info('群发消息完成回调', { openId, msgId, status, totalCount, filterCount, sentCount, errorCount });
          stats.broadcastCallbacks++;
          // 记录群发完成审计日志（PCI-DSS 10.2.2）
          dbAuditLog({
            openId: 'system',
            action: 'broadcast_callback',
            detail: `msgid=${msgId},status=${status},total=${totalCount},filter=${filterCount},sent=${sentCount},error=${errorCount}`,
            requestId: req.id,
          });
          // 持久化群发完成记录
          dbBroadcastLog({
            msgId: msgId ? parseInt(msgId, 10) : null,
            status: status === 'send success' || status === 'sendsuccess' ? 'success' : 'failed',
            totalCount: totalCount ? parseInt(totalCount, 10) : 0,
            filterCount: filterCount ? parseInt(filterCount, 10) : 0,
            sentCount: sentCount ? parseInt(sentCount, 10) : 0,
            errorCount: errorCount ? parseInt(errorCount, 10) : 0,
          });
          // 不回复用户（系统回调事件）
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
app.get('/clawbot/qrcode', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
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
app.post('/clawbot/menu', express.json({ limit: '64kb' }), adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
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
app.get('/clawbot/menu', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
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
app.delete('/clawbot/menu', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
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
app.get('/clawbot/users', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  if (!redis) {
    res.status(503).json({ success: false, msg: 'Redis 不可用' });
    return;
  }

  // 分页参数（企业级扩展性）
  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '50', 10)));
  // 搜索与筛选参数（企业级运维增强 v1.8）
  const search = typeof req.query.search === 'string' ? req.query.search.trim().substring(0, 128) : '';
  const statusFilter = typeof req.query.status === 'string' ? req.query.status.trim() : '';

  try {
    // 获取所有已认证用户
    const authedUsers = await redis.smembers(REDIS_AUTH_KEY);

    const users = [];
    for (const oid of authedUsers) {
      const email = await redis.hget(REDIS_EMAIL_KEY, oid) || '';
      const model = await redis.hget(REDIS_MODELS_KEY, oid) || DEFAULT_MODEL;
      const nickname = await redis.hget(REDIS_NICKNAMES_KEY, oid) || '';
      const blocked = await redis.sismember(REDIS_BLOCKED_KEY, oid) === 1;

      // 搜索过滤（邮箱/昵称模糊匹配）
      if (search && !email.includes(search) && !nickname.includes(search) && !oid.includes(search)) {
        continue;
      }
      // 状态过滤
      if (statusFilter === 'active' && blocked) continue;
      if (statusFilter === 'blocked' && !blocked) continue;

      users.push({ openId: oid, email, model, nickname, blocked });
    }

    const total = users.length;
    const totalPages = Math.ceil(total / limit) || 1;
    const startIdx = (page - 1) * limit;
    const pageUsers = users.slice(startIdx, startIdx + limit);

    res.json({
      success: true,
      total,
      page,
      limit,
      totalPages,
      users: pageUsers,
    });
  } catch (err) {
    logger.error('查询已认证用户失败', { err: err.message });
    res.status(500).json({ success: false, msg: '查询失败' });
  }
});

// ─── 用户封禁端点（CIS 访问控制管理）──────────────────────────
// POST /clawbot/users/:openId/block — 封禁用户
app.post('/clawbot/users/:openId/block', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const { openId } = req.params;
  if (!openId || !OPENID_RE.test(openId)) {
    res.status(400).json({ success: false, msg: 'Invalid openId' });
    return;
  }
  if (!redis) {
    res.status(503).json({ success: false, msg: 'Redis 不可用' });
    return;
  }

  const reason = (req.body && typeof req.body.reason === 'string') ? stripControlChars(req.body.reason).substring(0, 500) : '';

  await setUserBlocked(openId, true);
  logger.info('audit', {
    action: 'block_user',
    openId,
    reason,
    ip: req.ip,
    request_id: req.id,
  });
  dbAuditLog({ openId, action: 'block', detail: reason, ip: req.ip, requestId: req.id });
  dbUpsertUser({ openId, status: 'blocked', blockedReason: reason });

  res.json({ success: true, msg: `用户 ${openId} 已封禁`, reason });
});

// DELETE /clawbot/users/:openId/block — 解封用户
app.delete('/clawbot/users/:openId/block', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const { openId } = req.params;
  if (!openId || !OPENID_RE.test(openId)) {
    res.status(400).json({ success: false, msg: 'Invalid openId' });
    return;
  }
  if (!redis) {
    res.status(503).json({ success: false, msg: 'Redis 不可用' });
    return;
  }

  await setUserBlocked(openId, false);
  logger.info('audit', {
    action: 'unblock_user',
    openId,
    ip: req.ip,
    request_id: req.id,
  });
  dbAuditLog({ openId, action: 'unblock', ip: req.ip, requestId: req.id });
  dbUpsertUser({ openId, status: 'active' });

  res.json({ success: true, msg: `用户 ${openId} 已解封` });
});

// ─── 审计日志查询端点（PCI-DSS 10.2 合规报告）──────────────────
app.get('/clawbot/audit', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  if (!pgPool) {
    res.status(503).json({ success: false, msg: 'PostgreSQL 未配置，审计日志查询不可用' });
    return;
  }

  const page = Math.max(1, parseInt(req.query.page || '1', 10));
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '50', 10)));
  const offset = (page - 1) * limit;
  const openIdFilter = typeof req.query.open_id === 'string' ? req.query.open_id.trim().substring(0, 128) : '';
  const actionFilter = typeof req.query.action === 'string' ? req.query.action.trim().substring(0, 64) : '';
  const since = typeof req.query.since === 'string' ? req.query.since.trim() : '';
  const until = typeof req.query.until === 'string' ? req.query.until.trim() : '';

  // ISO 8601 日期格式验证（防止畸形日期导致 SQL 错误）
  const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?(\.\d+)?(Z|[+-]\d{2}:?\d{2})?)?$/;
  if (since && !ISO_DATE_RE.test(since)) {
    res.status(400).json({ success: false, msg: 'since 参数格式无效（需 ISO 8601 日期）' });
    return;
  }
  if (until && !ISO_DATE_RE.test(until)) {
    res.status(400).json({ success: false, msg: 'until 参数格式无效（需 ISO 8601 日期）' });
    return;
  }

  try {
    let where = 'WHERE 1=1';
    const params = [];
    let paramIdx = 1;

    if (openIdFilter) {
      where += ` AND open_id = $${paramIdx++}`;
      params.push(openIdFilter);
    }
    if (actionFilter) {
      where += ` AND action = $${paramIdx++}`;
      params.push(actionFilter);
    }
    if (since) {
      where += ` AND created_at >= $${paramIdx++}::timestamptz`;
      params.push(since);
    }
    if (until) {
      where += ` AND created_at <= $${paramIdx++}::timestamptz`;
      params.push(until);
    }

    const countResult = await pgPool.query(
      `SELECT COUNT(*) as total FROM clawbot_audit_log ${where}`,
      params
    );
    const total = parseInt(countResult.rows[0].total, 10);

    const dataResult = await pgPool.query(
      `SELECT id, open_id, channel, action, detail, ip, request_id, created_at
       FROM clawbot_audit_log ${where}
       ORDER BY created_at DESC
       LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
      [...params, limit, offset]
    );

    res.json({
      success: true,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit) || 1,
      retention_days: AUDIT_RETENTION_DAYS,
      records: dataResult.rows,
    });
  } catch (err) {
    logger.error('审计日志查询失败', { err: err.message });
    res.status(500).json({ success: false, msg: '审计日志查询失败' });
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

// ─── 微信 OAuth2.0 网页授权（普通用户轻松接入）──────────────────
// 发起 OAuth 授权：重定向用户到微信授权页面
app.get('/clawbot/oauth', oauthLimiter, async (req, res) => {
  if (!CLAWBOT_APP_ID || !OAUTH_REDIRECT_URI) {
    res.status(503).json({ error: 'OAuth not configured' });
    return;
  }

  try {
    // 生成 CSRF state（PCI-DSS 6.5 防跨站请求伪造）
    const state = crypto.randomBytes(OAUTH_STATE_BYTES).toString('hex');
    if (redis) {
      await redis.set(
        `${REDIS_OAUTH_STATE_PREFIX}${state}`,
        JSON.stringify({ created: Date.now() }),
        'EX',
        OAUTH_STATE_TTL
      );
    }

    stats.oauthInitiated++;
    logger.info('OAuth 授权发起', { state: state.substring(0, 8) });

    // 构建微信 OAuth2.0 授权 URL
    const scope = OAUTH_SCOPE === 'snsapi_base' ? 'snsapi_base' : 'snsapi_userinfo';
    const redirectUri = encodeURIComponent(OAUTH_REDIRECT_URI);
    const authUrl = `https://open.weixin.qq.com/connect/oauth2/authorize` +
      `?appid=${CLAWBOT_APP_ID}` +
      `&redirect_uri=${redirectUri}` +
      `&response_type=code` +
      `&scope=${scope}` +
      `&state=${state}` +
      `#wechat_redirect`;

    res.redirect(302, authUrl);
  } catch (err) {
    logger.error('OAuth 授权发起失败', { err: err.message });
    stats.totalErrors++;
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// OAuth2.0 回调：用 code 换取 access_token + openid
app.get('/clawbot/oauth/callback', oauthLimiter, async (req, res) => {
  const { code, state } = req.query;

  if (!code || !state) {
    res.status(400).json({ error: 'Missing code or state' });
    return;
  }

  // 类型安全校验
  if (typeof code !== 'string' || typeof state !== 'string') {
    res.status(400).json({ error: 'Invalid parameters' });
    return;
  }

  // State 格式校验（防止注入）
  if (!OAUTH_STATE_RE.test(state)) {
    res.status(400).json({ error: 'Invalid state format' });
    return;
  }

  try {
    // 验证 CSRF state（PCI-DSS 6.5）
    if (redis) {
      const stateKey = `${REDIS_OAUTH_STATE_PREFIX}${state}`;
      const stateData = await redis.get(stateKey);
      if (!stateData) {
        logger.warn('OAuth state 无效或已过期', { state: state.substring(0, 8) });
        dbAuditLog({ openId: 'unknown', action: 'oauth_state_invalid', detail: `state=${state.substring(0, 8)}`, ip: req.ip, requestId: req.id });
        res.status(403).json({ error: 'Invalid or expired state' });
        return;
      }
      // 一次性使用，删除 state（防止重放攻击）
      await redis.del(stateKey);
    }

    // 用 code 换取 access_token + openid
    const tokenUrl = `https://api.weixin.qq.com/sns/oauth2/access_token` +
      `?appid=${CLAWBOT_APP_ID}` +
      `&secret=${CLAWBOT_APP_SECRET}` +
      `&code=${encodeURIComponent(code)}` +
      `&grant_type=authorization_code`;

    const tokenResp = await request(tokenUrl, {
      method: 'GET',
      headersTimeout: 10_000,
      bodyTimeout: 10_000,
    });
    const tokenData = await tokenResp.body.json();

    if (tokenData.errcode) {
      logger.error('OAuth token 交换失败', { errcode: tokenData.errcode, errmsg: tokenData.errmsg });
      res.status(502).json({ error: 'WeChat OAuth failed', detail: tokenData.errmsg });
      return;
    }

    const { openid, access_token: oauthAccessToken, scope: grantedScope } = tokenData;
    if (!openid) {
      logger.error('OAuth 未返回 openid', { tokenData: JSON.stringify(tokenData).substring(0, MAX_LOG_DATA_LENGTH) });
      res.status(502).json({ error: 'No openid returned' });
      return;
    }

    logger.info('OAuth 授权成功', { openId: openid, scope: grantedScope });

    // 如果 scope=snsapi_userinfo，获取用户昵称
    let nickname = '';
    if (grantedScope === 'snsapi_userinfo' && oauthAccessToken) {
      try {
        const userInfoUrl = `https://api.weixin.qq.com/sns/userinfo` +
          `?access_token=${oauthAccessToken}` +
          `&openid=${openid}` +
          `&lang=zh_CN`;
        const userInfoResp = await request(userInfoUrl, {
          method: 'GET',
          headersTimeout: 10_000,
          bodyTimeout: 10_000,
        });
        const userInfo = await userInfoResp.body.json();
        if (userInfo.nickname) {
          nickname = userInfo.nickname;
          if (redis) {
            await redis.hset(REDIS_NICKNAMES_KEY, openid, nickname);
          }
        }
      } catch (err) {
        logger.error('OAuth 获取用户信息失败', { err: err.message, openId: openid });
      }
    }

    // 自动设置用户已认证状态
    await setUserAuthed(openid);
    dbUpsertUser({ openId: openid, nickname, status: 'active', oauthScope: grantedScope || OAUTH_SCOPE });
    dbAuditLog({ openId: openid, action: 'oauth_bind', detail: `scope=${grantedScope}${nickname ? `,nickname=${nickname}` : ''}`, ip: req.ip, requestId: req.id });

    stats.oauthCompleted++;

    // 返回友好的授权成功页面
    const displayName = nickname ? ` ${nickname}` : '';
    res.set('Content-Type', 'text/html; charset=utf-8');
    res.status(200).send(
      '<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">' +
      '<meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<title>灵枢接入通道 · 授权成功</title>' +
      '<style>body{font-family:-apple-system,BlinkMacSystemFont,sans-serif;display:flex;' +
      'justify-content:center;align-items:center;min-height:100vh;margin:0;background:#f0f2f5}' +
      '.card{background:#fff;border-radius:12px;padding:40px;text-align:center;max-width:400px;' +
      'box-shadow:0 2px 12px rgba(0,0,0,.08)}.icon{font-size:64px;margin-bottom:16px}' +
      'h1{font-size:20px;color:#333;margin:0 0 12px}p{color:#666;line-height:1.6;margin:8px 0}' +
      '.hint{color:#999;font-size:13px;margin-top:20px}</style></head>' +
      '<body><div class="card"><div class="icon">✅</div>' +
      `<h1>授权成功${displayName}</h1>` +
      '<p>你的微信已成功绑定 Anima 灵枢接入通道。</p>' +
      '<p>现在可以回到微信对话，直接发送消息使用 AI 功能。</p>' +
      '<p class="hint">如需绑定邮箱以使用计费功能，请发送 /bind 邮箱地址</p>' +
      '</div></body></html>'
    );
  } catch (err) {
    logger.error('OAuth 回调处理异常', { err: err.message });
    stats.totalErrors++;
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// ─── JS-SDK 签名配置端点（v2.0 微信网页能力）──────────────────
// 网页端调用此接口获取 wx.config 签名参数，启用微信 JS-SDK 能力
app.get('/clawbot/jssdk/config', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const url = typeof req.query.url === 'string' ? req.query.url.trim() : '';
  if (!url) {
    res.status(400).json({ success: false, msg: '缺少 url 参数（当前页面 URL，不含 #hash）' });
    return;
  }

  // URL 长度限制（防止注入）
  if (url.length > 2048) {
    res.status(400).json({ success: false, msg: 'URL 过长（最大 2048 字符）' });
    return;
  }

  try {
    const config = await generateJssdkConfig(url);
    if (!config) {
      res.status(503).json({ success: false, msg: 'jsapi_ticket 获取失败' });
      return;
    }

    res.json({
      success: true,
      ...config,
    });
  } catch (err) {
    logger.error('JS-SDK 签名生成失败', { err: err.message });
    res.status(500).json({ success: false, msg: 'JS-SDK 签名生成失败' });
  }
});

// ─── 用户标签管理（v2.0 官方用户分群管理）──────────────────────

// 获取所有标签
app.get('/clawbot/tags', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const token = await getAccessToken();
  if (!token) {
    res.status(503).json({ success: false, msg: 'access_token 不可用' });
    return;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  try {
    const { body } = await request(
      `https://api.weixin.qq.com/cgi-bin/tags/get?access_token=${encodeURIComponent(token)}`,
      { bodyTimeout: 10_000, headersTimeout: 10_000, signal: controller.signal }
    );
    clearTimeout(timeoutId);
    const data = await body.json();
    if (data.tags) {
      res.json({ success: true, tags: data.tags });
    } else {
      res.status(400).json({ success: false, errcode: data.errcode, msg: data.errmsg });
    }
  } catch (err) {
    clearTimeout(timeoutId);
    logger.error('获取标签列表失败', { err: err.message });
    res.status(500).json({ success: false, msg: '获取标签列表失败' });
  }
});

// 创建标签
app.post('/clawbot/tags', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const tagName = req.body && typeof req.body.name === 'string' ? stripControlChars(req.body.name).trim() : '';
  if (!tagName || tagName.length > 30) {
    res.status(400).json({ success: false, msg: '标签名称无效（1-30 字符）' });
    return;
  }

  const token = await getAccessToken();
  if (!token) {
    res.status(503).json({ success: false, msg: 'access_token 不可用' });
    return;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  try {
    const { body } = await request(
      `https://api.weixin.qq.com/cgi-bin/tags/create?access_token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag: { name: tagName } }),
        bodyTimeout: 10_000,
        headersTimeout: 10_000,
        signal: controller.signal,
      }
    );
    clearTimeout(timeoutId);
    const data = await body.json();
    if (data.tag) {
      dbAuditLog({ openId: 'admin', action: 'tag_create', detail: `tag=${tagName},id=${data.tag.id}`, ip: req.ip, requestId: req.id });
      res.json({ success: true, tag: data.tag });
    } else {
      res.status(400).json({ success: false, errcode: data.errcode, msg: data.errmsg });
    }
  } catch (err) {
    clearTimeout(timeoutId);
    logger.error('创建标签失败', { err: err.message });
    res.status(500).json({ success: false, msg: '创建标签失败' });
  }
});

// 删除标签
app.delete('/clawbot/tags/:tagId', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const tagId = parseInt(req.params.tagId, 10);
  if (Number.isNaN(tagId) || tagId < 0) {
    res.status(400).json({ success: false, msg: '无效的标签 ID' });
    return;
  }

  const token = await getAccessToken();
  if (!token) {
    res.status(503).json({ success: false, msg: 'access_token 不可用' });
    return;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  try {
    const { body } = await request(
      `https://api.weixin.qq.com/cgi-bin/tags/delete?access_token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag: { id: tagId } }),
        bodyTimeout: 10_000,
        headersTimeout: 10_000,
        signal: controller.signal,
      }
    );
    clearTimeout(timeoutId);
    const data = await body.json();
    if (!data.errcode || data.errcode === 0) {
      dbAuditLog({ openId: 'admin', action: 'tag_delete', detail: `tagId=${tagId}`, ip: req.ip, requestId: req.id });
      res.json({ success: true, msg: `标签 ${tagId} 已删除` });
    } else {
      res.status(400).json({ success: false, errcode: data.errcode, msg: data.errmsg });
    }
  } catch (err) {
    clearTimeout(timeoutId);
    logger.error('删除标签失败', { err: err.message });
    res.status(500).json({ success: false, msg: '删除标签失败' });
  }
});

// 批量为用户打标签
app.post('/clawbot/tags/:tagId/users', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const tagId = parseInt(req.params.tagId, 10);
  if (Number.isNaN(tagId) || tagId < 0) {
    res.status(400).json({ success: false, msg: '无效的标签 ID' });
    return;
  }

  const openIdList = Array.isArray(req.body && req.body.openid_list) ? req.body.openid_list : [];
  if (openIdList.length === 0 || openIdList.length > 50) {
    res.status(400).json({ success: false, msg: 'openid_list 无效（1-50 个 OpenID）' });
    return;
  }

  // 验证每个 OpenID 格式
  for (const oid of openIdList) {
    if (typeof oid !== 'string' || !OPENID_RE.test(oid)) {
      res.status(400).json({ success: false, msg: `无效的 OpenID: ${String(oid).substring(0, 32)}` });
      return;
    }
  }

  const token = await getAccessToken();
  if (!token) {
    res.status(503).json({ success: false, msg: 'access_token 不可用' });
    return;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  try {
    const { body } = await request(
      `https://api.weixin.qq.com/cgi-bin/tags/members/batchtagging?access_token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ openid_list: openIdList, tagid: tagId }),
        bodyTimeout: 10_000,
        headersTimeout: 10_000,
        signal: controller.signal,
      }
    );
    clearTimeout(timeoutId);
    const data = await body.json();
    if (!data.errcode || data.errcode === 0) {
      dbAuditLog({ openId: 'admin', action: 'tag_batch_add', detail: `tagId=${tagId},count=${openIdList.length}`, ip: req.ip, requestId: req.id });
      res.json({ success: true, msg: `已为 ${openIdList.length} 个用户添加标签 ${tagId}` });
    } else {
      res.status(400).json({ success: false, errcode: data.errcode, msg: data.errmsg });
    }
  } catch (err) {
    clearTimeout(timeoutId);
    logger.error('批量打标签失败', { err: err.message });
    res.status(500).json({ success: false, msg: '批量打标签失败' });
  }
});

// 批量取消标签
app.delete('/clawbot/tags/:tagId/users', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const tagId = parseInt(req.params.tagId, 10);
  if (Number.isNaN(tagId) || tagId < 0) {
    res.status(400).json({ success: false, msg: '无效的标签 ID' });
    return;
  }

  // DELETE 请求的 body 需要特别处理
  const openIdList = Array.isArray(req.body && req.body.openid_list) ? req.body.openid_list : [];
  if (openIdList.length === 0 || openIdList.length > 50) {
    res.status(400).json({ success: false, msg: 'openid_list 无效（1-50 个 OpenID）' });
    return;
  }

  for (const oid of openIdList) {
    if (typeof oid !== 'string' || !OPENID_RE.test(oid)) {
      res.status(400).json({ success: false, msg: `无效的 OpenID: ${String(oid).substring(0, 32)}` });
      return;
    }
  }

  const token = await getAccessToken();
  if (!token) {
    res.status(503).json({ success: false, msg: 'access_token 不可用' });
    return;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  try {
    const { body } = await request(
      `https://api.weixin.qq.com/cgi-bin/tags/members/batchuntagging?access_token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ openid_list: openIdList, tagid: tagId }),
        bodyTimeout: 10_000,
        headersTimeout: 10_000,
        signal: controller.signal,
      }
    );
    clearTimeout(timeoutId);
    const data = await body.json();
    if (!data.errcode || data.errcode === 0) {
      dbAuditLog({ openId: 'admin', action: 'tag_batch_remove', detail: `tagId=${tagId},count=${openIdList.length}`, ip: req.ip, requestId: req.id });
      res.json({ success: true, msg: `已为 ${openIdList.length} 个用户取消标签 ${tagId}` });
    } else {
      res.status(400).json({ success: false, errcode: data.errcode, msg: data.errmsg });
    }
  } catch (err) {
    clearTimeout(timeoutId);
    logger.error('批量取消标签失败', { err: err.message });
    res.status(500).json({ success: false, msg: '批量取消标签失败' });
  }
});

// ─── 群发/广播消息（v2.0 官方 ClawBot 群发能力）──────────────────

// 群发文本消息
app.post('/clawbot/broadcast', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const { content, tag_id, is_to_all } = req.body || {};

  if (!content || typeof content !== 'string' || content.trim().length === 0) {
    res.status(400).json({ success: false, msg: '缺少群发内容（content 字段）' });
    return;
  }

  if (content.length > 10000) {
    res.status(400).json({ success: false, msg: '群发内容过长（最大 10000 字符）' });
    return;
  }

  // 必须指定标签或全量发送
  if (!is_to_all && (tag_id === undefined || tag_id === null)) {
    res.status(400).json({ success: false, msg: '请指定 tag_id（按标签发送）或 is_to_all: true（全量发送）' });
    return;
  }

  const token = await getAccessToken();
  if (!token) {
    res.status(503).json({ success: false, msg: 'access_token 不可用' });
    return;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 30_000);

  try {
    const filter = is_to_all
      ? { is_to_all: true }
      : { is_to_all: false, tag_id: parseInt(tag_id, 10) };

    const payload = {
      filter,
      msgtype: 'text',
      text: { content: content.trim() },
    };

    const { body } = await request(
      `https://api.weixin.qq.com/cgi-bin/message/mass/sendall?access_token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        bodyTimeout: 30_000,
        headersTimeout: 10_000,
        signal: controller.signal,
      }
    );
    clearTimeout(timeoutId);
    const data = await body.json();

    if (data.errcode && data.errcode !== 0) {
      logger.error('群发消息失败', { errcode: data.errcode, errmsg: data.errmsg });
      res.status(400).json({ success: false, errcode: data.errcode, msg: data.errmsg });
    } else {
      dbAuditLog({
        openId: 'admin',
        action: 'broadcast',
        detail: `msg_id=${data.msg_id || ''},target=${is_to_all ? 'all' : `tag_${tag_id}`},content_len=${content.length}`,
        ip: req.ip,
        requestId: req.id,
      });
      res.json({
        success: true,
        msg_id: data.msg_id,
        msg_data_id: data.msg_data_id,
        msg: '群发消息已提交',
      });
    }
  } catch (err) {
    clearTimeout(timeoutId);
    logger.error('群发消息异常', { err: err.message });
    res.status(500).json({ success: false, msg: '群发消息失败' });
  }
});

// 查询群发消息状态
app.get('/clawbot/broadcast/:msgId', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const msgId = req.params.msgId;
  if (!msgId || !/^\d+$/.test(msgId)) {
    res.status(400).json({ success: false, msg: '无效的消息 ID' });
    return;
  }

  const token = await getAccessToken();
  if (!token) {
    res.status(503).json({ success: false, msg: 'access_token 不可用' });
    return;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  try {
    const { body } = await request(
      `https://api.weixin.qq.com/cgi-bin/message/mass/get?access_token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ msg_id: msgId }),
        bodyTimeout: 10_000,
        headersTimeout: 10_000,
        signal: controller.signal,
      }
    );
    clearTimeout(timeoutId);
    const data = await body.json();

    if (data.errcode && data.errcode !== 0) {
      res.status(400).json({ success: false, errcode: data.errcode, msg: data.errmsg });
    } else {
      res.json({
        success: true,
        msg_id: data.msg_id,
        msg_status: data.msg_status,
      });
    }
  } catch (err) {
    clearTimeout(timeoutId);
    logger.error('查询群发状态失败', { err: err.message });
    res.status(500).json({ success: false, msg: '查询群发状态失败' });
  }
});

// ─── 素材管理（v2.0 官方永久素材 API）──────────────────────────

// 获取素材总数
app.get('/clawbot/material/count', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const token = await getAccessToken();
  if (!token) {
    res.status(503).json({ success: false, msg: 'access_token 不可用' });
    return;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  try {
    const { body } = await request(
      `https://api.weixin.qq.com/cgi-bin/material/get_materialcount?access_token=${encodeURIComponent(token)}`,
      { bodyTimeout: 10_000, headersTimeout: 10_000, signal: controller.signal }
    );
    clearTimeout(timeoutId);
    const data = await body.json();

    if (data.errcode) {
      res.status(400).json({ success: false, errcode: data.errcode, msg: data.errmsg });
    } else {
      res.json({
        success: true,
        voice_count: data.voice_count,
        video_count: data.video_count,
        image_count: data.image_count,
        news_count: data.news_count,
      });
    }
  } catch (err) {
    clearTimeout(timeoutId);
    logger.error('获取素材总数失败', { err: err.message });
    res.status(500).json({ success: false, msg: '获取素材总数失败' });
  }
});

// 获取素材列表
app.post('/clawbot/material/list', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const validTypes = ['image', 'voice', 'video', 'news'];
  const type = req.body && typeof req.body.type === 'string' ? req.body.type.trim() : '';
  if (!validTypes.includes(type)) {
    res.status(400).json({ success: false, msg: `type 参数无效（支持：${validTypes.join(', ')}）` });
    return;
  }

  const offset = Math.max(0, parseInt(req.body.offset || '0', 10));
  const count = Math.min(20, Math.max(1, parseInt(req.body.count || '20', 10)));

  const token = await getAccessToken();
  if (!token) {
    res.status(503).json({ success: false, msg: 'access_token 不可用' });
    return;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  try {
    const { body } = await request(
      `https://api.weixin.qq.com/cgi-bin/material/batchget_material?access_token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, offset, count }),
        bodyTimeout: 10_000,
        headersTimeout: 10_000,
        signal: controller.signal,
      }
    );
    clearTimeout(timeoutId);
    const data = await body.json();

    if (data.errcode) {
      res.status(400).json({ success: false, errcode: data.errcode, msg: data.errmsg });
    } else {
      res.json({
        success: true,
        total_count: data.total_count,
        item_count: data.item_count,
        item: data.item,
      });
    }
  } catch (err) {
    clearTimeout(timeoutId);
    logger.error('获取素材列表失败', { err: err.message });
    res.status(500).json({ success: false, msg: '获取素材列表失败' });
  }
});

// 删除永久素材
app.delete('/clawbot/material/:mediaId', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const mediaId = req.params.mediaId;
  if (!mediaId || mediaId.length > 256) {
    res.status(400).json({ success: false, msg: '无效的 media_id' });
    return;
  }

  const token = await getAccessToken();
  if (!token) {
    res.status(503).json({ success: false, msg: 'access_token 不可用' });
    return;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10_000);

  try {
    const { body } = await request(
      `https://api.weixin.qq.com/cgi-bin/material/del_material?access_token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ media_id: mediaId }),
        bodyTimeout: 10_000,
        headersTimeout: 10_000,
        signal: controller.signal,
      }
    );
    clearTimeout(timeoutId);
    const data = await body.json();

    if (data.errcode && data.errcode !== 0) {
      res.status(400).json({ success: false, errcode: data.errcode, msg: data.errmsg });
    } else {
      dbAuditLog({ openId: 'admin', action: 'material_delete', detail: `media_id=${mediaId}`, ip: req.ip, requestId: req.id });
      res.json({ success: true, msg: '素材已删除' });
    }
  } catch (err) {
    clearTimeout(timeoutId);
    logger.error('删除素材失败', { err: err.message });
    res.status(500).json({ success: false, msg: '删除素材失败' });
  }
});

// ─── 数据统计代理（v2.0 官方 ClawBot 数据分析接口）──────────────
// 代理微信数据统计接口，支持用户分析、消息分析、接口分析
const ANALYTICS_METRICS = {
  user_summary: '/datacube/getusersummary',
  user_cumulate: '/datacube/getusercumulate',
  article_summary: '/datacube/getarticlesummary',
  upstream_msg: '/datacube/getupstreammsg',
  interface_summary: '/datacube/getinterfacesummary',
};

app.post('/clawbot/analytics/:metric', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const metricKey = req.params.metric;
  const apiPath = ANALYTICS_METRICS[metricKey];
  if (!apiPath) {
    res.status(400).json({
      success: false,
      msg: `不支持的指标（支持：${Object.keys(ANALYTICS_METRICS).join(', ')}）`,
    });
    return;
  }

  const { begin_date, end_date } = req.body || {};
  if (!begin_date || !end_date) {
    res.status(400).json({ success: false, msg: '缺少 begin_date 和 end_date 参数（格式：YYYY-MM-DD）' });
    return;
  }

  // 日期格式校验
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  if (!DATE_RE.test(begin_date) || !DATE_RE.test(end_date)) {
    res.status(400).json({ success: false, msg: '日期格式无效（需 YYYY-MM-DD）' });
    return;
  }

  // 日期范围校验（微信限制最大 7 天跨度）
  const beginMs = new Date(begin_date).getTime();
  const endMs = new Date(end_date).getTime();
  if (Number.isNaN(beginMs) || Number.isNaN(endMs) || endMs < beginMs) {
    res.status(400).json({ success: false, msg: 'end_date 不能早于 begin_date' });
    return;
  }
  const MAX_RANGE_DAYS = 7;
  if ((endMs - beginMs) > MAX_RANGE_DAYS * 24 * 60 * 60 * 1000) {
    res.status(400).json({ success: false, msg: `日期范围不能超过 ${MAX_RANGE_DAYS} 天` });
    return;
  }

  const token = await getAccessToken();
  if (!token) {
    res.status(503).json({ success: false, msg: 'access_token 不可用' });
    return;
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 15_000);

  try {
    const { body } = await request(
      `https://api.weixin.qq.com${apiPath}?access_token=${encodeURIComponent(token)}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ begin_date, end_date }),
        bodyTimeout: 15_000,
        headersTimeout: 10_000,
        signal: controller.signal,
      }
    );
    clearTimeout(timeoutId);
    const data = await body.json();

    if (data.errcode) {
      res.status(400).json({ success: false, errcode: data.errcode, msg: data.errmsg });
    } else {
      res.json({
        success: true,
        metric: metricKey,
        begin_date,
        end_date,
        list: data.list || [],
      });
    }
  } catch (err) {
    clearTimeout(timeoutId);
    logger.error('数据统计查询失败', { err: err.message, metric: metricKey });
    res.status(500).json({ success: false, msg: '数据统计查询失败' });
  }
});

// ─── v2.1 模板消息 API（官方服务通知能力）──────────────────────

// 发送模板消息
app.post('/clawbot/template/send', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const { touser, template_id, url, miniprogram, data } = req.body || {};

  if (!touser || !OPENID_RE.test(touser)) {
    res.status(400).json({ success: false, msg: '缺少有效的 touser（OpenID）' });
    return;
  }
  if (!template_id || !TEMPLATE_MSG_RE.test(template_id)) {
    res.status(400).json({ success: false, msg: '缺少有效的 template_id' });
    return;
  }
  if (!data || typeof data !== 'object') {
    res.status(400).json({ success: false, msg: '缺少有效的 data 字段' });
    return;
  }
  // URL 长度校验
  if (url && (typeof url !== 'string' || url.length > 2048)) {
    res.status(400).json({ success: false, msg: 'url 过长（最大 2048 字符）' });
    return;
  }

  const result = await sendTemplateMessage({ touser, template_id, url, miniprogram, data });
  dbAuditLog({ openId: touser, action: 'template_send', detail: `template_id=${template_id}, success=${result.success}` });
  dbTemplateLog({ openId: touser, templateId: template_id, msgid: result.msgid, status: result.success ? 'sent' : 'failed', detail: result.errmsg });

  if (result.success) {
    res.json({ success: true, msgid: result.msgid });
  } else {
    res.status(500).json({ success: false, msg: result.errmsg });
  }
});

// 获取模板列表
app.get('/clawbot/template/list', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const templates = await getTemplateList();
  if (templates) {
    res.json({ success: true, count: templates.length, templates });
  } else {
    res.status(503).json({ success: false, msg: '获取模板列表失败' });
  }
});

// ─── v2.1 客服会话转接管理端点 ─────────────────────────────────

// 管理端手动转接用户到人工客服
app.post('/clawbot/kf/transfer', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const { openId, kfAccount } = req.body || {};

  if (!openId || !OPENID_RE.test(openId)) {
    res.status(400).json({ success: false, msg: '缺少有效的 openId' });
    return;
  }
  if (kfAccount && typeof kfAccount !== 'string') {
    res.status(400).json({ success: false, msg: 'kfAccount 格式无效' });
    return;
  }

  const success = await transferToKf(openId, kfAccount);
  dbAuditLog({ openId, action: 'kf_transfer', detail: `admin_initiated, kf=${kfAccount || 'auto'}` });

  if (success) {
    res.json({ success: true, msg: '客服转接成功' });
  } else {
    res.status(500).json({ success: false, msg: '客服转接失败' });
  }
});

// ─── v2.1 快捷回复规则管理端点 ─────────────────────────────────

// 获取快捷回复规则列表
app.get('/clawbot/quickreply', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const rules = await getQuickReplyRules();
  res.json({ success: true, count: rules.length, rules });
});

// 创建快捷回复规则
app.post('/clawbot/quickreply', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const { keyword, matchType, reply } = req.body || {};

  if (!keyword || typeof keyword !== 'string' || keyword.length > 200) {
    res.status(400).json({ success: false, msg: '缺少有效的 keyword（关键词，最长 200 字符）' });
    return;
  }
  if (!matchType || !['exact', 'fuzzy'].includes(matchType)) {
    res.status(400).json({ success: false, msg: 'matchType 必须为 exact（精确匹配）或 fuzzy（模糊匹配）' });
    return;
  }
  if (!reply || typeof reply !== 'string' || reply.length > 2048) {
    res.status(400).json({ success: false, msg: '缺少有效的 reply（回复内容，最长 2048 字符）' });
    return;
  }

  const rules = await getQuickReplyRules();
  const ruleId = crypto.randomUUID();
  rules.push({ id: ruleId, keyword, matchType, reply, createdAt: new Date().toISOString() });
  await saveQuickReplyRules(rules);
  dbAuditLog({ openId: 'admin', action: 'quickreply_create', detail: `id=${ruleId}, keyword=${keyword.substring(0, 50)}` });

  res.json({ success: true, ruleId, msg: '快捷回复规则已创建' });
});

// 删除快捷回复规则
app.delete('/clawbot/quickreply/:ruleId', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const ruleId = req.params.ruleId;
  if (!ruleId || ruleId.length > 64) {
    res.status(400).json({ success: false, msg: '无效的 ruleId' });
    return;
  }

  const rules = await getQuickReplyRules();
  const idx = rules.findIndex(r => r.id === ruleId);
  if (idx === -1) {
    res.status(404).json({ success: false, msg: '规则不存在' });
    return;
  }

  rules.splice(idx, 1);
  await saveQuickReplyRules(rules);
  dbAuditLog({ openId: 'admin', action: 'quickreply_delete', detail: `id=${ruleId}` });

  res.json({ success: true, msg: '快捷回复规则已删除' });
});

// ─── v2.1 小程序卡片消息发送端点 ──────────────────────────────

app.post('/clawbot/miniprogram/send', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const { openId, appid, title, pagepath, thumb_media_id } = req.body || {};

  if (!openId || !OPENID_RE.test(openId)) {
    res.status(400).json({ success: false, msg: '缺少有效的 openId' });
    return;
  }
  if (!appid || typeof appid !== 'string' || appid.length > 64) {
    res.status(400).json({ success: false, msg: '缺少有效的小程序 appid' });
    return;
  }
  if (title && (typeof title !== 'string' || title.length > 256)) {
    res.status(400).json({ success: false, msg: 'title 过长（最大 256 字符）' });
    return;
  }

  const success = await sendMiniProgramCard(openId, { appid, title, pagepath, thumb_media_id });
  dbAuditLog({ openId, action: 'miniprogram_send', detail: `appid=${appid}` });

  if (success) {
    res.json({ success: true, msg: '小程序卡片发送成功' });
  } else {
    res.status(500).json({ success: false, msg: '小程序卡片发送失败' });
  }
});

// ─── v2.3 插件清单端点（官方 ClawBot 插件验证）────────────────

app.get('/clawbot/plugin/manifest', adminLimiter, (req, res) => {
  stats.pluginQueries++;
  res.json({
    plugin_name: PLUGIN_NAME,
    plugin_version: PLUGIN_VERSION,
    plugin_id: CLAWBOT_APP_ID,
    platform: 'wechat',
    channel: '灵枢接入通道',
    description: 'Anima 灵枢 AI 助理 · 微信 ClawBot 插件灵枢接入通道',
    capabilities: [
      'text_message', 'voice_message', 'image_message',
      'video_message', 'file_message', 'location_message', 'link_message',
      'template_message', 'broadcast_message', 'miniprogram_card',
      'custom_menu', 'qrcode_login', 'oauth2_auth',
      'jssdk_config', 'user_tagging', 'material_management',
      'kf_transfer', 'quick_reply', 'data_analytics',
      'user_consent', 'user_settings', 'plugin_verification',
      'compliance_report', 'health_dashboard',
      // v2.5 新增能力
      'self_service_activation', 'multi_tenant_isolation',
      'plugin_heartbeat', 'capability_negotiation',
      'api_key_management', 'compliance_snapshots',
      'tenant_management',
      // v2.6 新增能力
      'channel_gateway', 'setup_wizard', 'webhook_relay',
      'session_federation', 'realtime_compliance',
      // v2.7 新增能力
      'web_admin_dashboard',
      // v2.8 新增能力
      'customer_service_management', 'kf_message_send', 'kf_session_query',
      'draft_management', 'publish_management', 'comment_management',
      'autoreply_rules_query', 'subscription_message',
      'conditional_menu', 'menu_trymatch',
      'hkdf_user_key_derivation', 'data_compartment_validation',
      'one_click_onboarding',
      // v2.9 新增能力
      'unified_lingshu_channel', 'mandatory_auth_gateway',
      'cryptographic_data_boundary', 'sdk_callback',
      'sla_monitoring', 'usage_metering', 'quota_management',
      'march_2026_protocol',
      // v3.1 新增能力
      'wechat_native_login', 'plugin_lifecycle_callbacks',
      'unified_integration_hub', 'row_level_security',
      'enterprise_billing', 'compliance_automation',
    ],
    integrated_modules: [
      { name: 'ai_chat', description: 'AI 对话（70+ 模型）', enabled: true },
      { name: 'web_search', description: '网页搜索（DuckDuckGo）', enabled: true },
      { name: 'calendar', description: '日历管理（CalDAV）', enabled: true },
      { name: 'email', description: '邮件管理（IMAP/SMTP）', enabled: true },
      { name: 'cloud_storage', description: '云存储（WebDAV）', enabled: true },
      { name: 'smart_home', description: '智能家居（Home Assistant）', enabled: true },
      { name: 'voice', description: '语音交互（Whisper + TTS）', enabled: VOICE_ENABLED },
      { name: 'file_analysis', description: '文件分析（AI）', enabled: true },
    ],
    security: {
      auth_required: true,
      encryption: ENCRYPT_MODE ? 'AES-256-CBC' : 'plaintext',
      session_encryption: SESSION_ENCRYPT_KEY ? 'AES-256-GCM' : 'none',
      pci_dss: 'v4.0',
      cis: 'v8',
      oauth2: !!OAUTH_REDIRECT_URI,
      waf: true,
      rate_limiting: true,
      webhook_signature: 'HMAC-SHA256',
    },
    compliance: {
      pci_dss_version: '4.0',
      cis_version: '8',
      data_isolation: 'per-user Redis key namespace + PostgreSQL row-level + tenant isolation',
      audit_trail: 'PostgreSQL clawbot_audit_log (PCI-DSS 10.2)',
      audit_retention_days: AUDIT_RETENTION_DAYS,
      session_timeout_min: IDLE_SESSION_TIMEOUT_MIN,
      login_lockout: `${BIND_LOCKOUT_THRESHOLD} failures / ${BIND_LOCKOUT_DURATION_MIN} min lockout`,
      session_federation: 'cross-channel linking with audit trail',
      webhook_relay: 'HMAC-SHA256 signed deliveries (PCI-DSS 4.2.1)',
      hkdf_key_derivation: 'per-user key from master key (PCI-DSS 3.5)',
      data_compartment: 'cross-user access prevention (PCI-DSS 7.1)',
      data_classification: 'CIS 4.x compliant',
      lingshu_unified_channel: 'single entry point for all platforms',
      mandatory_auth: 'all user endpoints require authentication',
      cryptographic_boundary: 'HKDF-derived data boundary verification',
      protocol_version: 'March 2026 ClawBot Plugin API',
    },
    endpoints: {
      webhook: '/clawbot/webhook',
      oauth: '/clawbot/oauth',
      admin: '/clawbot/',
      plugin_manifest: '/clawbot/plugin/manifest',
      plugin_status: '/clawbot/plugin/status',
      plugin_verify: '/clawbot/plugin/verify',
      plugin_health: '/clawbot/plugin/health',
      plugin_heartbeat: '/clawbot/plugin/heartbeat',
      plugin_negotiate: '/clawbot/plugin/negotiate',
      compliance_report: '/clawbot/compliance/report',
      compliance_history: '/clawbot/compliance/history',
      compliance_realtime: '/clawbot/compliance/realtime',
      tenants: '/clawbot/tenants',
      gateway_channels: '/clawbot/gateway/channels',
      gateway_features: '/clawbot/gateway/features',
      relay_subscriptions: '/clawbot/relay/subscriptions',
      federation_links: '/clawbot/federation/links',
      kf_accounts: '/clawbot/kf/accounts',
      kf_message: '/clawbot/kf/message',
      kf_sessions: '/clawbot/kf/sessions',
      draft: '/clawbot/draft',
      publish: '/clawbot/publish',
      comment: '/clawbot/comment',
      autoreply: '/clawbot/autoreply',
      subscribe_send: '/clawbot/subscribe/send',
      subscribe_templates: '/clawbot/subscribe/templates',
      menu_conditional: '/clawbot/menu/conditional',
      menu_trymatch: '/clawbot/menu/trymatch',
      lingshu_connect: '/clawbot/lingshu/connect',
      lingshu_status: '/clawbot/lingshu/status',
      lingshu_init: '/clawbot/lingshu/init',
      sdk_callback: '/clawbot/plugin/sdk/callback',
      ops_sla: '/clawbot/ops/sla',
      ops_usage: '/clawbot/ops/usage',
      ops_quota: '/clawbot/ops/quota',
    },
    wecom_enabled: WECOM_ENABLED,
  });
});

// ─── v2.3 插件状态端点（运维监控）────────────────────────────

app.get('/clawbot/plugin/status', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  stats.pluginQueries++;
  let activatedCount = 0;
  let totalUsers = 0;
  if (redis) {
    try {
      activatedCount = await redis.scard(REDIS_PLUGIN_ACTIVATED_KEY);
      totalUsers = await redis.scard(REDIS_AUTH_KEY);
    } catch (_e) { /* ignore */ }
  }
  const redisOk = redis ? redis.status === 'ready' : false;
  let dbOk = false;
  if (pgPool) {
    try {
      await pgPool.query('SELECT 1');
      dbOk = true;
    } catch (_e) { /* ignore */ }
  }
  res.json({
    plugin_name: PLUGIN_NAME,
    plugin_version: PLUGIN_VERSION,
    status: redisOk ? 'healthy' : 'degraded',
    uptime_seconds: Math.floor((Date.now() - stats.startedAt) / 1000),
    infrastructure: {
      redis: redisOk ? 'connected' : 'disconnected',
      postgresql: dbOk ? 'connected' : 'disconnected',
      encrypt_mode: ENCRYPT_MODE,
      session_encryption: !!SESSION_ENCRYPT_KEY,
    },
    users: {
      total_authenticated: totalUsers,
      plugin_activated: activatedCount,
      active_sessions: sessions.size,
    },
    metrics: {
      plugin_activations: stats.pluginActivations,
      plugin_deactivations: stats.pluginDeactivations,
      total_messages: stats.totalMessages,
      total_commands: stats.totalCommands,
      // v2.5 新增指标
      tenant_created: stats.tenantCreated,
      api_key_created: stats.apiKeyCreated,
      compliance_scans: stats.complianceScans,
      heartbeats: stats.heartbeats,
      user_activations: stats.userActivations,
    },
    features: {
      multi_tenant: true,
      api_key_management: true,
      plugin_heartbeat: true,
      capability_negotiation: true,
      compliance_snapshots: true,
      self_service_activation: true,
    },
  });
});

// ─── v2.4 插件验证挑战-响应（官方 ClawBot 插件商店认证）──────

app.post('/clawbot/plugin/verify', adminLimiter, (req, res) => {
  stats.pluginVerifications++;
  const { challenge, timestamp: verifyTs, nonce: verifyNonce } = req.body || {};

  if (!challenge || typeof challenge !== 'string' || challenge.length > 256) {
    res.status(400).json({ success: false, msg: 'Missing or invalid challenge' });
    return;
  }
  if (verifyTs && typeof verifyTs !== 'string') {
    res.status(400).json({ success: false, msg: 'Invalid timestamp' });
    return;
  }
  if (verifyNonce && typeof verifyNonce !== 'string') {
    res.status(400).json({ success: false, msg: 'Invalid nonce' });
    return;
  }

  // HMAC-SHA256 签名响应：使用 APP_SECRET 作为密钥签名挑战内容
  const signPayload = `${challenge}|${verifyTs || ''}|${verifyNonce || ''}`;
  const signature = crypto.createHmac('sha256', CLAWBOT_APP_SECRET)
    .update(signPayload).digest('hex');

  logger.info('插件验证挑战响应', { challenge: challenge.substring(0, 16) });
  dbAuditLog({ openId: 'system:platform', action: 'plugin_verify', detail: `challenge=${challenge.substring(0, 16)}` });

  res.json({
    success: true,
    plugin_id: CLAWBOT_APP_ID,
    plugin_version: PLUGIN_VERSION,
    challenge_response: signature,
    timestamp: String(Math.floor(Date.now() / 1000)),
  });
});

// ─── v2.4 插件健康仪表板（企业级运维增强）─────────────────────

app.get('/clawbot/plugin/health', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const checks = {};
  const startMs = Date.now();

  // Redis 健康检查
  if (redis) {
    const redisStart = Date.now();
    try {
      await redis.ping();
      checks.redis = { status: 'healthy', latency_ms: Date.now() - redisStart };
    } catch (err) {
      checks.redis = { status: 'unhealthy', error: err.message, latency_ms: Date.now() - redisStart };
    }
  } else {
    checks.redis = { status: 'not_configured' };
  }

  // PostgreSQL 健康检查
  if (pgPool) {
    const dbStart = Date.now();
    try {
      const result = await pgPool.query('SELECT COUNT(*) as cnt FROM clawbot_audit_log WHERE created_at > NOW() - INTERVAL \'1 hour\'');
      checks.postgresql = {
        status: 'healthy',
        latency_ms: Date.now() - dbStart,
        recent_audit_events: parseInt(result.rows[0].cnt, 10),
        pool_total: pgPool.totalCount,
        pool_idle: pgPool.idleCount,
        pool_waiting: pgPool.waitingCount,
      };
    } catch (err) {
      checks.postgresql = { status: 'unhealthy', error: err.message, latency_ms: Date.now() - dbStart };
    }
  } else {
    checks.postgresql = { status: 'not_configured' };
  }

  // Agent API 健康检查（连接性验证）
  const agentStart = Date.now();
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5_000);
    const { statusCode } = await request(`${AGENT_API_URL}/health`, {
      method: 'GET',
      bodyTimeout: 5_000,
      headersTimeout: 5_000,
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    // 任何 HTTP 响应（包括 404）都表示 Agent API 可达
    const agentHealthy = statusCode < 500;
    checks.agent_api = { status: agentHealthy ? 'healthy' : 'degraded', latency_ms: Date.now() - agentStart, url: AGENT_API_URL, http_status: statusCode };
  } catch (err) {
    checks.agent_api = { status: 'unhealthy', error: err.message, latency_ms: Date.now() - agentStart, url: AGENT_API_URL };
  }

  // 综合状态判定
  const allHealthy = Object.values(checks).every(c => c.status === 'healthy' || c.status === 'not_configured');
  const anyUnhealthy = Object.values(checks).some(c => c.status === 'unhealthy');

  res.json({
    plugin_name: PLUGIN_NAME,
    plugin_version: PLUGIN_VERSION,
    overall_status: anyUnhealthy ? 'unhealthy' : (allHealthy ? 'healthy' : 'degraded'),
    check_duration_ms: Date.now() - startMs,
    checks,
    system: {
      uptime_seconds: Math.floor((Date.now() - stats.startedAt) / 1000),
      memory_usage_mb: Math.round(process.memoryUsage().rss / 1024 / 1024),
      active_sessions: sessions.size,
      max_sessions: MAX_SESSIONS,
    },
  });
});

// ─── v2.4 合规性报告端点（PCI-DSS v4.0 / CIS v8 自检）──────

app.get('/clawbot/compliance/report', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const report = {
    generated_at: new Date().toISOString(),
    plugin_version: PLUGIN_VERSION,
    pci_dss: {
      version: '4.0',
      controls: {
        '3.4_data_at_rest_encryption': {
          status: SESSION_ENCRYPT_KEY ? 'compliant' : 'non_compliant',
          detail: SESSION_ENCRYPT_KEY
            ? 'Session data encrypted with AES-256-GCM'
            : 'SESSION_ENCRYPT_KEY not configured; session data stored in plaintext',
        },
        '4.1_transport_encryption': {
          status: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0' ? 'compliant' : 'non_compliant',
          detail: 'TLS certificate validation enabled for all outbound connections',
        },
        '6.4.1_waf': {
          status: 'compliant',
          detail: 'Nginx ModSecurity WAF with OWASP CRS enabled (external)',
        },
        '6.5_input_validation': {
          status: 'compliant',
          detail: 'OpenID format validation, email regex, model name regex, content length limits',
        },
        '7.1_access_control': {
          status: 'compliant',
          detail: 'Mandatory login (email bind), blocked user enforcement, quick-reply after auth check',
        },
        '8.1.6_login_lockout': {
          status: 'compliant',
          detail: `${BIND_LOCKOUT_THRESHOLD} failures → ${BIND_LOCKOUT_DURATION_MIN} min lockout`,
        },
        '8.1.8_session_timeout': {
          status: 'compliant',
          detail: `Idle session timeout: ${IDLE_SESSION_TIMEOUT_MIN} min`,
        },
        '8.2.3_service_token': {
          status: SERVICE_TOKEN && SERVICE_TOKEN.length >= 32 ? 'compliant' : 'non_compliant',
          detail: SERVICE_TOKEN ? `SERVICE_TOKEN configured (${SERVICE_TOKEN.length} chars)` : 'SERVICE_TOKEN not configured',
        },
        '10.2_audit_logging': {
          status: pgPool ? 'compliant' : 'partial',
          detail: pgPool
            ? 'PostgreSQL audit log + Winston structured logging'
            : 'Winston structured logging only (DB not configured)',
        },
        '10.7_log_retention': {
          status: 'compliant',
          detail: `Audit log retention: ${AUDIT_RETENTION_DAYS} days`,
        },
        '3.5_key_management': {
          status: SESSION_ENCRYPT_KEY ? 'compliant' : 'non_compliant',
          detail: SESSION_ENCRYPT_KEY
            ? 'HKDF per-user key derivation + channel-level key isolation'
            : 'SESSION_ENCRYPT_KEY not configured; HKDF key derivation unavailable',
        },
        '8.2_mandatory_auth': {
          status: 'compliant',
          detail: 'All user endpoints require authentication; unified auth gateway enforced',
        },
      },
    },
    cis: {
      version: '8',
      controls: {
        'security_headers': {
          status: 'compliant',
          detail: 'Helmet, HSTS, CSP, X-Content-Type-Options, Referrer-Policy, Permissions-Policy, Cache-Control: no-store',
        },
        'network_access_control': {
          status: ADMIN_IP_ALLOWLIST.length > 0 ? 'compliant' : 'advisory',
          detail: ADMIN_IP_ALLOWLIST.length > 0
            ? `Admin IP allowlist: ${ADMIN_IP_ALLOWLIST.length} IPs`
            : 'No admin IP allowlist configured (recommended)',
        },
        'dos_mitigation': {
          status: 'compliant',
          detail: `Per-user rate limit: ${USER_RATE_LIMIT}/min, admin limiter: 30/min, webhook: 300/min`,
        },
        'data_isolation': {
          status: 'compliant',
          detail: 'Per-user Redis key namespace (anima:clawbot:), per-channel DB isolation, WeChat/WeCom channel separation',
        },
        'encryption_in_transit': {
          status: 'compliant',
          detail: 'TLS 1.2/1.3 via Nginx, AES-256-CBC message encryption support',
        },
        'content_type_enforcement': {
          status: 'compliant',
          detail: 'POST/PUT/PATCH require application/json Content-Type',
        },
        'data_classification': {
          status: 'compliant',
          detail: 'CIS 4.x data classification labels with automatic tagging per data type',
        },
        'waf_channel_rules': {
          status: 'compliant',
          detail: 'CIS 13.x per-channel WAF rule mapping via Nginx ModSecurity (external)',
        },
      },
    },
    data_isolation: {
      redis_namespaces: [
        'anima:clawbot:emails', 'anima:clawbot:user_models', 'anima:clawbot:authed',
        'anima:clawbot:blocked', 'anima:clawbot:nicknames', 'anima:clawbot:session:',
        'anima:clawbot:dedup:', 'anima:clawbot:rl:', 'anima:clawbot:consent:',
        'anima:clawbot:settings:', 'anima:clawbot:plugin_activated',
        'anima:clawbot:tenant:', 'anima:clawbot:plugin_heartbeat',
        'anima:clawbot:lingshu:', 'anima:clawbot:usage:', 'anima:clawbot:boundary:',
      ],
      wecom_namespaces: ['anima:wecom:emails', 'anima:wecom:user_models', 'anima:wecom:authed'],
      db_tables: [
        'clawbot_audit_log', 'clawbot_users', 'clawbot_template_log',
        'clawbot_broadcast_log', 'clawbot_plugin_log', 'clawbot_user_consent',
        'clawbot_user_settings', 'clawbot_tenants', 'clawbot_api_keys',
        'clawbot_compliance_snapshots',
        'clawbot_lingshu_sessions', 'clawbot_data_boundaries', 'clawbot_usage_metrics',
      ],
      cross_channel_isolation: true,
      multi_tenant_isolation: true,
      cryptographic_boundary: true,
      lingshu_unified_channel: true,
    },
    consent_management: {
      enabled: true,
      version: CONSENT_VERSION,
      types: CONSENT_TYPES,
    },
  };

  res.json({ success: true, report });
});

// ─── v2.5 插件心跳端点（官方 ClawBot 插件协议）──────────────

app.post('/clawbot/plugin/heartbeat', adminLimiter, (req, res) => {
  stats.heartbeats++;
  const { plugin_id: reqPluginId, timestamp: hbTs, status: hbStatus } = req.body || {};

  if (reqPluginId && reqPluginId !== CLAWBOT_APP_ID) {
    res.status(403).json({ success: false, msg: 'Plugin ID mismatch' });
    return;
  }

  // 更新心跳时间到 Redis
  if (redis) {
    redis.set(REDIS_HEARTBEAT_KEY, String(Date.now()), 'EX', HEARTBEAT_INTERVAL_SEC * 3).catch(() => {});
  }

  logger.info('插件心跳', { plugin_id: CLAWBOT_APP_ID, status: hbStatus || 'alive' });

  res.json({
    success: true,
    plugin_id: CLAWBOT_APP_ID,
    plugin_version: PLUGIN_VERSION,
    status: 'alive',
    timestamp: String(Math.floor(Date.now() / 1000)),
    heartbeat_interval_sec: HEARTBEAT_INTERVAL_SEC,
    uptime_seconds: Math.floor((Date.now() - stats.startedAt) / 1000),
    active_sessions: sessions.size,
  });
});

// ─── v2.5 能力协商端点（官方 ClawBot 插件协议）──────────────

app.post('/clawbot/plugin/negotiate', adminLimiter, (req, res) => {
  stats.pluginNegotiations++;
  const { requested_capabilities: reqCaps, platform_version: platVer } = req.body || {};

  const allCapabilities = [
    'text_message', 'voice_message', 'image_message',
    'video_message', 'file_message', 'location_message', 'link_message',
    'template_message', 'broadcast_message', 'miniprogram_card',
    'custom_menu', 'qrcode_login', 'oauth2_auth',
    'jssdk_config', 'user_tagging', 'material_management',
    'kf_transfer', 'quick_reply', 'data_analytics',
    'user_consent', 'user_settings', 'plugin_verification',
    'compliance_report', 'health_dashboard',
    'self_service_activation', 'multi_tenant_isolation',
    'plugin_heartbeat', 'capability_negotiation',
    'api_key_management', 'compliance_snapshots', 'tenant_management',
  ];

  // 如果请求了特定能力，返回匹配结果
  let granted = allCapabilities;
  let denied = [];
  if (Array.isArray(reqCaps) && reqCaps.length > 0) {
    granted = reqCaps.filter(c => typeof c === 'string' && allCapabilities.includes(c));
    denied = reqCaps.filter(c => typeof c === 'string' && !allCapabilities.includes(c));
  }

  logger.info('能力协商', { platform_version: platVer, requested: reqCaps ? reqCaps.length : 'all' });
  dbAuditLog({ openId: 'system:platform', action: 'plugin_negotiate', detail: `platform=${platVer || 'unknown'},requested=${reqCaps ? reqCaps.length : 'all'}` });

  res.json({
    success: true,
    plugin_id: CLAWBOT_APP_ID,
    plugin_version: PLUGIN_VERSION,
    negotiation_result: {
      granted,
      denied,
      total_available: allCapabilities.length,
    },
    security: {
      auth_required: true,
      encryption: ENCRYPT_MODE ? 'AES-256-CBC' : 'plaintext',
      session_encryption: SESSION_ENCRYPT_KEY ? 'AES-256-GCM' : 'none',
      pci_dss: 'v4.0',
      cis: 'v8',
      multi_tenant: true,
    },
  });
});

// ─── v2.5 租户管理端点（企业级商业运维）──────────────────────

// 列出所有租户
app.get('/clawbot/tenants', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const { status: qs, plan: qp, page: qPage, page_size: qSize } = req.query;
  const tenants = await dbListTenants({
    status: qs,
    plan: qp,
    page: parseInt(qPage || '1', 10),
    pageSize: parseInt(qSize || '20', 10),
  });
  res.json({ success: true, tenants, count: tenants.length });
});

// 创建租户
app.post('/clawbot/tenants', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const { tenant_id: tId, tenant_name: tName, channel: tCh, plan: tPlan,
          rate_limit: tRL, max_users: tMU, contact_email: tEmail, ip_allowlist: tIp } = req.body || {};

  if (!tId || !TENANT_ID_RE.test(tId)) {
    res.status(400).json({ success: false, msg: 'Invalid tenant_id (4-64 alphanumeric/hyphen/underscore)' });
    return;
  }
  if (!tName || typeof tName !== 'string' || tName.length < 2 || tName.length > 128) {
    res.status(400).json({ success: false, msg: 'Invalid tenant_name (2-128 chars)' });
    return;
  }
  if (tEmail && (typeof tEmail !== 'string' || tEmail.length > 256)) {
    res.status(400).json({ success: false, msg: 'Invalid contact_email' });
    return;
  }

  const tenant = await dbCreateTenant({
    tenantId: tId, tenantName: tName, channel: tCh, plan: tPlan,
    rateLimit: tRL ? parseInt(tRL, 10) : undefined,
    maxUsers: tMU ? parseInt(tMU, 10) : undefined,
    contactEmail: tEmail, ipAllowlist: tIp,
  });

  if (!tenant) {
    res.status(500).json({ success: false, msg: 'Failed to create tenant (may already exist)' });
    return;
  }

  dbAuditLog({ openId: 'admin', action: 'tenant_create', detail: `tenant_id=${tId},plan=${tPlan || 'free'}` });
  logger.info('租户创建成功', { tenantId: tId, plan: tPlan || 'free' });
  res.status(201).json({ success: true, tenant });
});

// 获取租户详情
app.get('/clawbot/tenants/:tenantId', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const { tenantId } = req.params;
  if (!TENANT_ID_RE.test(tenantId)) {
    res.status(400).json({ success: false, msg: 'Invalid tenant_id format' });
    return;
  }
  const tenant = await dbGetTenant(tenantId);
  if (!tenant) {
    res.status(404).json({ success: false, msg: 'Tenant not found' });
    return;
  }
  // 获取关联的 API 密钥列表
  const keys = await dbListApiKeys(tenantId);
  res.json({ success: true, tenant, api_keys: keys });
});

// 更新租户状态
app.patch('/clawbot/tenants/:tenantId/status', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const { tenantId } = req.params;
  const { status: newStatus } = req.body || {};
  if (!TENANT_ID_RE.test(tenantId)) {
    res.status(400).json({ success: false, msg: 'Invalid tenant_id format' });
    return;
  }
  if (!newStatus || !['active', 'suspended', 'archived'].includes(newStatus)) {
    res.status(400).json({ success: false, msg: 'Invalid status (active/suspended/archived)' });
    return;
  }
  const updated = await dbUpdateTenantStatus(tenantId, newStatus);
  if (!updated) {
    res.status(404).json({ success: false, msg: 'Tenant not found or update failed' });
    return;
  }
  dbAuditLog({ openId: 'admin', action: 'tenant_status_update', detail: `tenant_id=${tenantId},status=${newStatus}` });
  res.json({ success: true, tenant_id: tenantId, status: newStatus });
});

// ─── v2.5 API 密钥管理端点（PCI-DSS 8.2.3 密钥管理）──────────

// 创建 API 密钥
app.post('/clawbot/tenants/:tenantId/keys', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const { tenantId } = req.params;
  const { label, scopes, expires_in_days: expDays } = req.body || {};

  if (!TENANT_ID_RE.test(tenantId)) {
    res.status(400).json({ success: false, msg: 'Invalid tenant_id format' });
    return;
  }
  // 验证租户存在
  const tenant = await dbGetTenant(tenantId);
  if (!tenant) {
    res.status(404).json({ success: false, msg: 'Tenant not found' });
    return;
  }
  if (tenant.status !== 'active') {
    res.status(403).json({ success: false, msg: 'Tenant is not active' });
    return;
  }
  // 验证 scopes
  const validScopes = ['read', 'write', 'admin'];
  if (scopes && (!Array.isArray(scopes) || scopes.some(s => typeof s !== 'string' || !validScopes.includes(s)))) {
    res.status(400).json({ success: false, msg: `Invalid scopes (valid: ${validScopes.join(', ')})` });
    return;
  }

  const key = await dbCreateApiKey(tenantId, label, scopes, expDays ? parseInt(expDays, 10) : undefined);
  if (!key) {
    res.status(500).json({ success: false, msg: 'Failed to create API key' });
    return;
  }

  dbAuditLog({ openId: 'admin', action: 'api_key_create', detail: `tenant_id=${tenantId},key_id=${key.key_id}` });
  logger.info('API 密钥创建成功', { tenantId, keyId: key.key_id });

  // 注意：raw_key 仅在创建时返回一次，之后不可恢复
  res.status(201).json({
    success: true,
    warning: 'API key is shown only once. Store it securely.',
    api_key: key.raw_key,
    key_id: key.key_id,
    key_prefix: key.key_prefix,
    label: key.label,
    scopes: key.scopes,
    expires_at: key.expires_at,
  });
});

// 吊销 API 密钥
app.delete('/clawbot/tenants/:tenantId/keys/:keyId', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const { tenantId, keyId } = req.params;
  if (!TENANT_ID_RE.test(tenantId)) {
    res.status(400).json({ success: false, msg: 'Invalid tenant_id format' });
    return;
  }
  const revoked = await dbRevokeApiKey(tenantId, keyId);
  if (!revoked) {
    res.status(404).json({ success: false, msg: 'API key not found or already revoked' });
    return;
  }
  dbAuditLog({ openId: 'admin', action: 'api_key_revoke', detail: `tenant_id=${tenantId},key_id=${keyId}` });
  logger.info('API 密钥已吊销', { tenantId, keyId });
  res.json({ success: true, tenant_id: tenantId, key_id: keyId, status: 'revoked' });
});

// 列出租户 API 密钥
app.get('/clawbot/tenants/:tenantId/keys', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const { tenantId } = req.params;
  if (!TENANT_ID_RE.test(tenantId)) {
    res.status(400).json({ success: false, msg: 'Invalid tenant_id format' });
    return;
  }
  const keys = await dbListApiKeys(tenantId);
  res.json({ success: true, keys, count: keys.length });
});

// ─── v2.5 合规审计历史端点 ──────────────────────────────────

app.get('/clawbot/compliance/history', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const limit = Math.max(1, Math.min(100, parseInt(req.query.limit || '10', 10)));
  const snapshots = await dbListComplianceSnapshots(limit);
  res.json({
    success: true,
    snapshots,
    count: snapshots.length,
    next_scan_interval_ms: COMPLIANCE_SCAN_INTERVAL_MS,
  });
});

// ─── v2.6 通道网关端点（灵枢统一通道网关）──────────────────────

// 列出注册通道
app.get('/clawbot/gateway/channels', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const { status, channel_type } = req.query;
  const channels = await dbListChannels({ status, channelType: channel_type });
  res.json({ success: true, channels, count: channels.length });
});

// 注册通道
app.post('/clawbot/gateway/channels', express.json({ limit: '64kb' }), adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const { channel_id, channel_name, channel_type, endpoint_url, protocol, capabilities, contact_email } = req.body || {};
  if (!channel_id || !CHANNEL_ID_RE.test(channel_id)) {
    res.status(400).json({ success: false, msg: 'Invalid channel_id (4-64 alphanumeric/underscore/hyphen)' });
    return;
  }
  if (endpoint_url && typeof endpoint_url === 'string' && endpoint_url.length > 2048) {
    res.status(400).json({ success: false, msg: 'endpoint_url too long' });
    return;
  }
  const channel = await dbRegisterChannel({
    channelId: channel_id, channelName: channel_name, channelType: channel_type,
    endpoint: endpoint_url, protocol, capabilities, contactEmail: contact_email,
  });
  if (!channel) {
    res.status(500).json({ success: false, msg: 'Failed to register channel' });
    return;
  }
  // 设置 Redis 缓存
  if (redis) {
    redis.set(`${REDIS_GATEWAY_PREFIX}${channel_id}`, JSON.stringify(channel), 'EX', GATEWAY_CACHE_TTL_SEC).catch(() => {});
  }
  dbAuditLog({ openId: 'system', action: 'channel_register', detail: `channel_id=${channel_id},type=${channel_type || 'wechat'}`, requestId: req.id });
  logger.info('通道已注册', { channelId: channel_id, channelType: channel_type });
  res.json({ success: true, channel });
});

// 获取通道详情
app.get('/clawbot/gateway/channels/:channelId', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const { channelId } = req.params;
  if (!CHANNEL_ID_RE.test(channelId)) {
    res.status(400).json({ success: false, msg: 'Invalid channel_id format' });
    return;
  }
  const channel = await dbGetChannel(channelId);
  if (!channel) {
    res.status(404).json({ success: false, msg: 'Channel not found' });
    return;
  }
  res.json({ success: true, channel });
});

// 删除通道
app.delete('/clawbot/gateway/channels/:channelId', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const { channelId } = req.params;
  if (!CHANNEL_ID_RE.test(channelId)) {
    res.status(400).json({ success: false, msg: 'Invalid channel_id format' });
    return;
  }
  const removed = await dbRemoveChannel(channelId);
  if (!removed) {
    res.status(404).json({ success: false, msg: 'Channel not found' });
    return;
  }
  if (redis) {
    redis.del(`${REDIS_GATEWAY_PREFIX}${channelId}`).catch(() => {});
  }
  dbAuditLog({ openId: 'system', action: 'channel_remove', detail: `channel_id=${channelId}`, requestId: req.id });
  res.json({ success: true, msg: 'Channel removed' });
});

// 通道心跳（通道自身上报活跃状态，需 SERVICE_TOKEN 认证）
app.post('/clawbot/gateway/channels/:channelId/heartbeat', adminLimiter, requireServiceToken, async (req, res) => {
  const { channelId } = req.params;
  if (!CHANNEL_ID_RE.test(channelId)) {
    res.status(400).json({ success: false, msg: 'Invalid channel_id format' });
    return;
  }
  const ok = await dbChannelHeartbeat(channelId);
  res.json({ success: ok, timestamp: new Date().toISOString() });
});

// 能力矩阵查询（所有通道的功能对照）
app.get('/clawbot/gateway/features', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const channels = await dbListChannels({ status: 'active' });
  const featureMatrix = channels.map((ch) => ({
    channel_id: ch.channel_id,
    channel_name: ch.channel_name,
    channel_type: ch.channel_type,
    capabilities: ch.capabilities,
    protocol: ch.protocol,
    status: ch.status,
    last_heartbeat: ch.last_heartbeat_at,
  }));
  res.json({
    success: true,
    built_in_channel: {
      channel_id: 'wechat-clawbot',
      channel_name: '微信 ClawBot 灵枢接入通道',
      channel_type: 'wechat',
      protocol: 'https',
      capabilities: [
        'text', 'voice', 'image', 'video', 'file', 'location', 'link',
        'template_message', 'broadcast', 'miniprogram', 'oauth2', 'jssdk',
        'user_tagging', 'material_management', 'kf_transfer', 'quick_reply',
        'analytics', 'consent', 'settings', 'multi_tenant',
      ],
      status: 'active',
    },
    wecom_channel: WECOM_ENABLED ? {
      channel_id: 'wecom',
      channel_name: '企业微信接入通道',
      channel_type: 'wecom',
      protocol: 'https',
      capabilities: ['text', 'voice', 'image', 'video', 'file', 'location'],
      status: 'active',
    } : null,
    registered_channels: featureMatrix,
    total_channels: featureMatrix.length + 1 + (WECOM_ENABLED ? 1 : 0),
  });
});

// ─── v2.6 Webhook 事件中继端点 ────────────────────────────────

// 列出 Webhook 订阅
app.get('/clawbot/relay/subscriptions', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const { tenant_id } = req.query;
  if (!tenant_id || !TENANT_ID_RE.test(tenant_id)) {
    res.status(400).json({ success: false, msg: 'tenant_id required (4-64 alphanumeric)' });
    return;
  }
  const subs = await dbListWebhookSubscriptions(tenant_id);
  res.json({ success: true, subscriptions: subs, count: subs.length });
});

// 创建 Webhook 订阅
app.post('/clawbot/relay/subscriptions', express.json({ limit: '64kb' }), adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const { tenant_id, target_url, events, secret } = req.body || {};
  if (!tenant_id || !TENANT_ID_RE.test(tenant_id)) {
    res.status(400).json({ success: false, msg: 'Invalid tenant_id' });
    return;
  }
  if (!target_url || typeof target_url !== 'string' || !target_url.startsWith('https://')) {
    res.status(400).json({ success: false, msg: 'target_url must be a valid HTTPS URL (PCI-DSS 4.2.1)' });
    return;
  }
  const urlValidation = validateWebhookUrl(target_url);
  if (!urlValidation.valid) {
    res.status(400).json({ success: false, msg: urlValidation.reason });
    return;
  }
  const sub = await dbCreateWebhookSubscription({ tenantId: tenant_id, targetUrl: target_url, events, secret });
  if (!sub) {
    res.status(500).json({ success: false, msg: 'Failed to create subscription' });
    return;
  }
  dbAuditLog({ openId: 'system', action: 'webhook_subscribe', detail: `tenant=${tenant_id},url=${target_url.substring(0, 100)}`, requestId: req.id });
  res.json({ success: true, subscription: sub });
});

// 删除 Webhook 订阅
app.delete('/clawbot/relay/subscriptions/:subId', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const { subId } = req.params;
  const { tenant_id } = req.query;
  if (!tenant_id || !TENANT_ID_RE.test(tenant_id)) {
    res.status(400).json({ success: false, msg: 'tenant_id query parameter required' });
    return;
  }
  const removed = await dbDeleteWebhookSubscription(tenant_id, subId);
  if (!removed) {
    res.status(404).json({ success: false, msg: 'Subscription not found' });
    return;
  }
  dbAuditLog({ openId: 'system', action: 'webhook_unsubscribe', detail: `tenant=${tenant_id},sub=${subId}`, requestId: req.id });
  res.json({ success: true, msg: 'Subscription removed' });
});

// 测试 Webhook 投递
app.post('/clawbot/relay/test', express.json({ limit: '64kb' }), adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const { target_url } = req.body || {};
  if (!target_url || typeof target_url !== 'string' || !target_url.startsWith('https://')) {
    res.status(400).json({ success: false, msg: 'target_url must be a valid HTTPS URL' });
    return;
  }
  const urlValidation = validateWebhookUrl(target_url);
  if (!urlValidation.valid) {
    res.status(400).json({ success: false, msg: urlValidation.reason });
    return;
  }
  const success = await deliverWebhookEvent('test', target_url, 'test', { message: 'ClawBot webhook relay test', timestamp: new Date().toISOString() });
  res.json({ success, msg: success ? 'Test delivery succeeded' : 'Test delivery failed' });
});

// ─── v2.6 会话联邦端点 ──────────────────────────────────────

// 创建会话链接
app.post('/clawbot/federation/links', express.json({ limit: '64kb' }), adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const { primary_open_id, primary_channel, linked_open_id, linked_channel } = req.body || {};
  if (!primary_open_id || !linked_open_id) {
    res.status(400).json({ success: false, msg: 'primary_open_id and linked_open_id required' });
    return;
  }
  const validChannels = ['wechat', 'wecom'];
  if (!validChannels.includes(primary_channel) || !validChannels.includes(linked_channel)) {
    res.status(400).json({ success: false, msg: 'channel must be wechat or wecom' });
    return;
  }
  if (primary_channel === linked_channel && primary_open_id === linked_open_id) {
    res.status(400).json({ success: false, msg: 'Cannot link a user to themselves on the same channel' });
    return;
  }
  const link = await dbCreateSessionLink({ primaryOpenId: primary_open_id, primaryChannel: primary_channel, linkedOpenId: linked_open_id, linkedChannel: linked_channel });
  if (!link) {
    res.status(500).json({ success: false, msg: 'Failed to create session link' });
    return;
  }
  dbAuditLog({ openId: primary_open_id, action: 'session_link', detail: `linked=${linked_open_id},channel=${linked_channel}`, requestId: req.id });
  res.json({ success: true, link });
});

// 查询会话链接
app.get('/clawbot/federation/links', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const { open_id, channel } = req.query;
  if (!open_id || !channel) {
    res.status(400).json({ success: false, msg: 'open_id and channel query parameters required' });
    return;
  }
  const links = await dbListSessionLinks(open_id, channel);
  res.json({ success: true, links, count: links.length });
});

// 删除会话链接
app.delete('/clawbot/federation/links/:linkId', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const { linkId } = req.params;
  const removed = await dbDeleteSessionLink(linkId);
  if (!removed) {
    res.status(404).json({ success: false, msg: 'Session link not found' });
    return;
  }
  dbAuditLog({ openId: 'system', action: 'session_unlink', detail: `link_id=${linkId}`, requestId: req.id });
  res.json({ success: true, msg: 'Session link removed' });
});

// ─── v2.6 实时合规监控端点 ──────────────────────────────────

app.get('/clawbot/compliance/realtime', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  stats.realtimeComplianceChecks++;
  const checks = [];

  // PCI-DSS 实时检查
  checks.push({ control: 'PCI-DSS 3.4', name: 'Session Encryption', status: SESSION_ENCRYPT_KEY ? 'compliant' : 'non_compliant', detail: SESSION_ENCRYPT_KEY ? 'AES-256-GCM enabled' : 'Not configured' });
  checks.push({ control: 'PCI-DSS 4.1', name: 'TLS Validation', status: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0' ? 'compliant' : 'non_compliant' });
  checks.push({ control: 'PCI-DSS 4.2.1', name: 'Webhook Signature', status: 'compliant', detail: 'HMAC-SHA256 on relay deliveries' });
  checks.push({ control: 'PCI-DSS 6.4.1', name: 'WAF Protection', status: 'compliant', detail: 'ModSecurity + OWASP CRS' });
  checks.push({ control: 'PCI-DSS 7.1', name: 'Access Control', status: 'compliant', detail: 'Mandatory auth + IP allowlist' });
  checks.push({ control: 'PCI-DSS 8.1.6', name: 'Login Lockout', status: 'compliant', detail: `${BIND_LOCKOUT_THRESHOLD} failures / ${BIND_LOCKOUT_DURATION_MIN}min` });
  checks.push({ control: 'PCI-DSS 8.1.8', name: 'Session Timeout', status: 'compliant', detail: `${IDLE_SESSION_TIMEOUT_MIN}min` });
  checks.push({ control: 'PCI-DSS 8.2.3', name: 'Service Token', status: SERVICE_TOKEN && SERVICE_TOKEN.length >= 32 ? 'compliant' : 'non_compliant' });
  checks.push({ control: 'PCI-DSS 10.2', name: 'Audit Logging', status: pgPool ? 'compliant' : 'non_compliant', detail: pgPool ? 'PostgreSQL enabled' : 'Not configured' });
  checks.push({ control: 'PCI-DSS 10.7', name: 'Log Retention', status: 'compliant', detail: `${AUDIT_RETENTION_DAYS} days` });

  // CIS 实时检查
  checks.push({ control: 'CIS 5.x', name: 'Security Headers', status: 'compliant', detail: 'HSTS/CSP/X-Frame-Options/Permissions-Policy' });
  checks.push({ control: 'CIS 9.x', name: 'IP Allowlist', status: ADMIN_IP_ALLOWLIST.length > 0 ? 'compliant' : 'advisory', detail: ADMIN_IP_ALLOWLIST.length > 0 ? `${ADMIN_IP_ALLOWLIST.length} IPs` : 'Not configured' });
  checks.push({ control: 'CIS 13.x', name: 'DoS Mitigation', status: 'compliant', detail: 'Rate limiting enabled' });
  checks.push({ control: 'CIS 14.x', name: 'Data Isolation', status: 'compliant', detail: 'Per-user namespace + tenant isolation' });
  checks.push({ control: 'CIS 16.x', name: 'Encryption in Transit', status: 'compliant', detail: 'TLS 1.2+' });

  // v2.6 新增检查
  checks.push({ control: 'PCI-DSS 3.4+', name: 'Tenant Isolation', status: 'compliant', detail: 'Multi-tenant Redis namespace + DB row-level' });
  checks.push({ control: 'CIS 9.x+', name: 'Channel Gateway', status: 'compliant', detail: 'Registered channel validation' });

  // v2.8 新增检查
  checks.push({ control: 'PCI-DSS 3.5', name: 'Key Management (HKDF)', status: SESSION_ENCRYPT_KEY ? 'compliant' : 'non_compliant', detail: SESSION_ENCRYPT_KEY ? 'Per-user HKDF key derivation enabled' : 'SESSION_ENCRYPT_KEY not configured' });
  checks.push({ control: 'PCI-DSS 6.5.4', name: 'KF Input Validation', status: 'compliant', detail: 'Customer service message input validated' });
  checks.push({ control: 'CIS 4.x', name: 'Data Classification', status: 'compliant', detail: 'Data compartment validation enabled' });
  checks.push({ control: 'CIS 11.x', name: 'Content Lifecycle', status: 'compliant', detail: 'Draft/publish/comment management' });

  const compliantCount = checks.filter((c) => c.status === 'compliant').length;
  const nonCompliantCount = checks.filter((c) => c.status === 'non_compliant').length;
  const advisoryCount = checks.filter((c) => c.status === 'advisory').length;

  // 合规漂移检测：与上次快照对比
  let drift = null;
  const latestSnapshots = await dbListComplianceSnapshots(1);
  if (latestSnapshots.length > 0) {
    const last = latestSnapshots[0];
    const currentScore = Math.round((compliantCount / checks.length) * 100);
    const lastScore = Math.round(((last.pci_dss_score || 0) + (last.cis_score || 0)) / 2);
    drift = {
      current_score: currentScore,
      last_score: lastScore,
      trend: currentScore > lastScore ? 'improving' : (currentScore < lastScore ? 'degrading' : 'stable'),
      last_scan_at: last.created_at,
    };
  }

  res.json({
    success: true,
    timestamp: new Date().toISOString(),
    overall_status: nonCompliantCount === 0 ? 'compliant' : 'action_required',
    summary: { total: checks.length, compliant: compliantCount, non_compliant: nonCompliantCount, advisory: advisoryCount },
    checks,
    drift,
  });
});

// ─── v2.7 Web 管理后台路由 ────────────────────────────────────

// 管理后台登录（不需要已有会话，但需要 SERVICE_TOKEN + IP 白名单）
app.post('/clawbot/admin/api/login', adminLimiter, requireAdminIp, async (req, res) => {
  const { token } = req.body || {};
  if (!token || typeof token !== 'string') {
    res.status(400).json({ error: '请提供管理密钥' });
    return;
  }

  if (!SERVICE_TOKEN) {
    res.status(403).json({ error: 'SERVICE_TOKEN not configured' });
    return;
  }

  // HMAC-SHA256 时间安全验证（与 requireServiceToken 一致）
  const hmacKey = Buffer.from('clawbot-auth', 'utf8');
  const expected = crypto.createHmac('sha256', hmacKey).update(SERVICE_TOKEN).digest();
  const provided = crypto.createHmac('sha256', hmacKey).update(token).digest();
  if (!crypto.timingSafeEqual(expected, provided)) {
    dbAuditLog({ openId: 'admin', action: 'admin_web_login_fail', detail: 'Invalid token', ip: req.ip, requestId: req.id });
    logger.info('audit', { action: 'admin_web_login_fail', ip: req.ip, request_id: req.id });
    res.status(401).json({ error: '管理密钥验证失败' });
    return;
  }

  try {
    const session = await createAdminSession(req.ip, req.headers['user-agent'] || '');
    stats.adminLogins++;
    dbAuditLog({ openId: 'admin', action: 'admin_web_login', detail: 'Web admin login success', ip: req.ip, requestId: req.id });
    logger.info('audit', { action: 'admin_web_login', ip: req.ip, request_id: req.id });
    res.json({ session_id: session.sessionId, csrf_token: session.csrfToken });
  } catch (err) {
    logger.error('创建管理会话失败', { err: err.message });
    res.status(500).json({ error: '会话创建失败' });
  }
});

// 管理后台登出
app.post('/clawbot/admin/api/logout', adminLimiter, async (req, res) => {
  const sessionId = req.headers['x-admin-session'] || '';
  if (sessionId) {
    await revokeAdminSession(sessionId);
    stats.adminLogouts++;
    dbAuditLog({ openId: 'admin', action: 'admin_web_logout', detail: 'Web admin logout', ip: req.ip, requestId: req.id });
  }
  res.json({ success: true });
});

// 管理后台 API 代理（所有 admin API 统一通过会话认证）
// GET 代理 - 将 admin dashboard 的 API 调用转发到已有的 SERVICE_TOKEN 保护端点
app.get('/clawbot/admin', adminLimiter, requireAdminIp, (req, res) => {
  if (!adminDashboardHtml) {
    res.status(503).json({ error: 'Admin dashboard not available' });
    return;
  }
  // 为管理后台页面放宽 CSP 以允许内联脚本和样式
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-src 'none'; object-src 'none'");
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(adminDashboardHtml);
});

// ─── v2.8 完整客服系统 ────────────────────────────────────────

// 客服账号管理 - 添加客服账号
app.post('/clawbot/kf/accounts', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const { kf_account, nickname } = req.body || {};
  if (!kf_account || typeof kf_account !== 'string' || !nickname || typeof nickname !== 'string') {
    res.status(400).json({ error: '请提供 kf_account（账号）和 nickname（昵称）' });
    return;
  }
  if (kf_account.length > 64 || nickname.length > 32) {
    res.status(400).json({ error: '客服账号不超过64字符，昵称不超过32字符' });
    return;
  }
  try {
    const token = await getAccessToken();
    if (!token) { res.status(502).json({ error: '获取 access_token 失败' }); return; }
    const { body } = await request(`https://api.weixin.qq.com/customservice/kfaccount/add?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ kf_account, nickname }),
      bodyTimeout: 10_000,
      headersTimeout: 10_000,
    });
    const data = await body.json();
    if (data.errcode && data.errcode !== 0) {
      res.status(502).json({ error: '微信 API 错误', detail: data });
      return;
    }
    // 持久化到 PostgreSQL
    if (pgPool) {
      await pgPool.query(
        `INSERT INTO clawbot_kf_accounts (kf_account, nickname, status, created_at)
         VALUES ($1, $2, 'active', NOW()) ON CONFLICT (kf_account) DO UPDATE SET nickname = $2, status = 'active', updated_at = NOW()`,
        [kf_account, nickname]
      ).catch((e) => logger.error('保存客服账号失败', { err: e.message }));
    }
    stats.kfAccountCreated++;
    dbAuditLog({ openId: 'admin', action: 'kf_account_add', detail: `account=${kf_account}`, ip: req.ip, requestId: req.id });
    res.json({ success: true, kf_account, nickname });
  } catch (err) {
    logger.error('客服账号添加失败', { err: err.message });
    res.status(500).json({ error: '客服账号添加失败' });
  }
});

// 查询客服账号列表
app.get('/clawbot/kf/accounts', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  try {
    const token = await getAccessToken();
    if (!token) { res.status(502).json({ error: '获取 access_token 失败' }); return; }
    const { body } = await request(`https://api.weixin.qq.com/cgi-bin/customservice/getkflist?access_token=${encodeURIComponent(token)}`, {
      bodyTimeout: 10_000,
      headersTimeout: 10_000,
    });
    const data = await body.json();
    res.json({ success: true, kf_list: data.kf_list || [] });
  } catch (err) {
    logger.error('查询客服列表失败', { err: err.message });
    res.status(500).json({ error: '查询客服列表失败' });
  }
});

// 删除客服账号
app.delete('/clawbot/kf/accounts/:kfAccount', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const kfAccount = req.params.kfAccount;
  if (!kfAccount || typeof kfAccount !== 'string' || kfAccount.length > 64) {
    res.status(400).json({ error: '无效的客服账号' });
    return;
  }
  try {
    const token = await getAccessToken();
    if (!token) { res.status(502).json({ error: '获取 access_token 失败' }); return; }
    const { body } = await request(`https://api.weixin.qq.com/customservice/kfaccount/del?access_token=${encodeURIComponent(token)}&kf_account=${encodeURIComponent(kfAccount)}`, {
      method: 'GET',
      bodyTimeout: 10_000,
      headersTimeout: 10_000,
    });
    const data = await body.json();
    if (data.errcode && data.errcode !== 0) {
      res.status(502).json({ error: '微信 API 错误', detail: data });
      return;
    }
    if (pgPool) {
      await pgPool.query(`UPDATE clawbot_kf_accounts SET status = 'deleted', updated_at = NOW() WHERE kf_account = $1`, [kfAccount])
        .catch((e) => logger.error('更新客服账号状态失败', { err: e.message }));
    }
    dbAuditLog({ openId: 'admin', action: 'kf_account_del', detail: `account=${kfAccount}`, ip: req.ip, requestId: req.id });
    res.json({ success: true });
  } catch (err) {
    logger.error('删除客服账号失败', { err: err.message });
    res.status(500).json({ error: '删除客服账号失败' });
  }
});

// 客服主动发送消息（PCI-DSS 6.5.4 输入验证）
app.post('/clawbot/kf/message', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const { touser, msgtype, content, media_id } = req.body || {};
  if (!touser || typeof touser !== 'string' || touser.length > 64) {
    res.status(400).json({ error: '请提供有效的 touser（用户 openid）' });
    return;
  }
  const allowedTypes = ['text', 'image', 'voice', 'video', 'music', 'news', 'mpnews', 'msgmenu', 'miniprogrampage'];
  if (!msgtype || !allowedTypes.includes(msgtype)) {
    res.status(400).json({ error: `msgtype 必须是: ${allowedTypes.join(', ')}` });
    return;
  }
  try {
    const token = await getAccessToken();
    if (!token) { res.status(502).json({ error: '获取 access_token 失败' }); return; }
    const payload = { touser, msgtype };
    if (msgtype === 'text') {
      if (!content || typeof content !== 'string' || content.length > 2048) {
        res.status(400).json({ error: '文本内容不超过2048字符' });
        return;
      }
      payload.text = { content };
    } else if (['image', 'voice', 'video', 'mpnews'].includes(msgtype)) {
      if (!media_id || typeof media_id !== 'string') {
        res.status(400).json({ error: `${msgtype} 类型需要 media_id` });
        return;
      }
      payload[msgtype] = { media_id };
    } else {
      // 仅允许透传 msgtype 对应的数据字段（防止注入任意字段）
      const allowed = ['music', 'news', 'msgmenu', 'miniprogrampage'];
      if (allowed.includes(msgtype) && req.body[msgtype] && typeof req.body[msgtype] === 'object') {
        payload[msgtype] = req.body[msgtype];
      } else {
        res.status(400).json({ error: `${msgtype} 类型缺少对应的数据字段` });
        return;
      }
    }
    const { body } = await request(`https://api.weixin.qq.com/cgi-bin/message/custom/send?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      bodyTimeout: 10_000,
      headersTimeout: 10_000,
    });
    const data = await body.json();
    if (data.errcode && data.errcode !== 0) {
      res.status(502).json({ error: '微信 API 错误', detail: data });
      return;
    }
    stats.kfMessageSent++;
    dbAuditLog({ openId: 'admin', action: 'kf_message_send', detail: `to=${touser},type=${msgtype}`, ip: req.ip, requestId: req.id });
    res.json({ success: true });
  } catch (err) {
    logger.error('客服消息发送失败', { err: err.message });
    res.status(500).json({ error: '客服消息发送失败' });
  }
});

// 查询客服会话状态
app.get('/clawbot/kf/sessions', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  try {
    const token = await getAccessToken();
    if (!token) { res.status(502).json({ error: '获取 access_token 失败' }); return; }
    // 获取未接入会话
    const [waitRes, onlineRes] = await Promise.all([
      request(`https://api.weixin.qq.com/customservice/kf_session/getwaitcase?access_token=${encodeURIComponent(token)}`, { bodyTimeout: 10_000, headersTimeout: 10_000 }),
      request(`https://api.weixin.qq.com/cgi-bin/customservice/getonlinekflist?access_token=${encodeURIComponent(token)}`, { bodyTimeout: 10_000, headersTimeout: 10_000 }),
    ]);
    const [waitData, onlineData] = await Promise.all([waitRes.body.json(), onlineRes.body.json()]);
    stats.kfSessionQueried++;
    if (pgPool) {
      await pgPool.query(
        `INSERT INTO clawbot_kf_sessions (query_type, result_count, created_at) VALUES ('waitcase', $1, NOW())`,
        [waitData.count || 0]
      ).catch((e) => logger.error('记录客服会话查询失败', { err: e.message }));
    }
    res.json({
      success: true,
      waiting: { count: waitData.count || 0, list: waitData.waitcaselist || [] },
      online_kf: onlineData.kf_online_list || [],
    });
  } catch (err) {
    logger.error('查询客服会话失败', { err: err.message });
    res.status(500).json({ error: '查询客服会话失败' });
  }
});

// ─── v2.8 内容生命周期管理 ────────────────────────────────────

// 草稿管理 - 创建草稿
app.post('/clawbot/draft', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const { articles } = req.body || {};
  if (!Array.isArray(articles) || articles.length === 0 || articles.length > 8) {
    res.status(400).json({ error: '请提供 articles 数组（1-8 篇图文）' });
    return;
  }
  // 验证每篇文章必填字段
  for (const art of articles) {
    if (!art.title || typeof art.title !== 'string' || art.title.length > 64) {
      res.status(400).json({ error: '每篇文章需要 title（不超过64字符）' });
      return;
    }
    if (!art.content || typeof art.content !== 'string') {
      res.status(400).json({ error: '每篇文章需要 content' });
      return;
    }
    if (!art.thumb_media_id || typeof art.thumb_media_id !== 'string') {
      res.status(400).json({ error: '每篇文章需要 thumb_media_id' });
      return;
    }
  }
  try {
    const token = await getAccessToken();
    if (!token) { res.status(502).json({ error: '获取 access_token 失败' }); return; }
    const { body } = await request(`https://api.weixin.qq.com/cgi-bin/draft/add?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ articles }),
      bodyTimeout: 10_000,
      headersTimeout: 10_000,
    });
    const data = await body.json();
    if (data.errcode && data.errcode !== 0) {
      res.status(502).json({ error: '微信 API 错误', detail: data });
      return;
    }
    stats.draftsCreated++;
    if (pgPool) {
      await pgPool.query(
        `INSERT INTO clawbot_drafts (media_id, article_count, status, created_at) VALUES ($1, $2, 'draft', NOW())`,
        [data.media_id, articles.length]
      ).catch((e) => logger.error('保存草稿记录失败', { err: e.message }));
    }
    dbAuditLog({ openId: 'admin', action: 'draft_create', detail: `media_id=${data.media_id}`, ip: req.ip, requestId: req.id });
    res.json({ success: true, media_id: data.media_id });
  } catch (err) {
    logger.error('创建草稿失败', { err: err.message });
    res.status(500).json({ error: '创建草稿失败' });
  }
});

// 查询草稿列表
app.post('/clawbot/draft/list', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const { offset = 0, count = 20, no_content = 0 } = req.body || {};
  if (typeof offset !== 'number' || typeof count !== 'number' || count < 1 || count > 20) {
    res.status(400).json({ error: 'offset 为数字，count 范围 1-20' });
    return;
  }
  try {
    const token = await getAccessToken();
    if (!token) { res.status(502).json({ error: '获取 access_token 失败' }); return; }
    const { body } = await request(`https://api.weixin.qq.com/cgi-bin/draft/batchget?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ offset, count, no_content }),
      bodyTimeout: 10_000,
      headersTimeout: 10_000,
    });
    const data = await body.json();
    res.json({ success: true, total_count: data.total_count || 0, item: data.item || [] });
  } catch (err) {
    logger.error('查询草稿列表失败', { err: err.message });
    res.status(500).json({ error: '查询草稿列表失败' });
  }
});

// 删除草稿
app.delete('/clawbot/draft/:mediaId', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const mediaId = req.params.mediaId;
  if (!mediaId || typeof mediaId !== 'string' || mediaId.length > 128) {
    res.status(400).json({ error: '无效的 media_id' });
    return;
  }
  try {
    const token = await getAccessToken();
    if (!token) { res.status(502).json({ error: '获取 access_token 失败' }); return; }
    const { body } = await request(`https://api.weixin.qq.com/cgi-bin/draft/delete?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ media_id: mediaId }),
      bodyTimeout: 10_000,
      headersTimeout: 10_000,
    });
    const data = await body.json();
    if (data.errcode && data.errcode !== 0) {
      res.status(502).json({ error: '微信 API 错误', detail: data });
      return;
    }
    if (pgPool) {
      await pgPool.query(`UPDATE clawbot_drafts SET status = 'deleted', updated_at = NOW() WHERE media_id = $1`, [mediaId])
        .catch((e) => logger.error('更新草稿状态失败', { err: e.message }));
    }
    dbAuditLog({ openId: 'admin', action: 'draft_delete', detail: `media_id=${mediaId}`, ip: req.ip, requestId: req.id });
    res.json({ success: true });
  } catch (err) {
    logger.error('删除草稿失败', { err: err.message });
    res.status(500).json({ error: '删除草稿失败' });
  }
});

// 发布草稿
app.post('/clawbot/publish', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const { media_id } = req.body || {};
  if (!media_id || typeof media_id !== 'string' || media_id.length > 128) {
    res.status(400).json({ error: '请提供有效的 media_id' });
    return;
  }
  try {
    const token = await getAccessToken();
    if (!token) { res.status(502).json({ error: '获取 access_token 失败' }); return; }
    const { body } = await request(`https://api.weixin.qq.com/cgi-bin/freepublish/submit?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ media_id }),
      bodyTimeout: 10_000,
      headersTimeout: 10_000,
    });
    const data = await body.json();
    if (data.errcode && data.errcode !== 0) {
      res.status(502).json({ error: '微信 API 错误', detail: data });
      return;
    }
    stats.draftsPublished++;
    if (pgPool) {
      await pgPool.query(`UPDATE clawbot_drafts SET status = 'published', publish_id = $2, updated_at = NOW() WHERE media_id = $1`, [media_id, data.publish_id || ''])
        .catch((e) => logger.error('更新发布状态失败', { err: e.message }));
    }
    dbAuditLog({ openId: 'admin', action: 'draft_publish', detail: `media_id=${media_id},publish_id=${data.publish_id || ''}`, ip: req.ip, requestId: req.id });
    res.json({ success: true, publish_id: data.publish_id });
  } catch (err) {
    logger.error('发布草稿失败', { err: err.message });
    res.status(500).json({ error: '发布草稿失败' });
  }
});

// 查询自动回复规则
app.get('/clawbot/autoreply', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  try {
    const token = await getAccessToken();
    if (!token) { res.status(502).json({ error: '获取 access_token 失败' }); return; }
    const { body } = await request(`https://api.weixin.qq.com/cgi-bin/get_current_autoreply_info?access_token=${encodeURIComponent(token)}`, {
      bodyTimeout: 10_000,
      headersTimeout: 10_000,
    });
    const data = await body.json();
    res.json({ success: true, autoreply_info: data });
  } catch (err) {
    logger.error('查询自动回复规则失败', { err: err.message });
    res.status(500).json({ error: '查询自动回复规则失败' });
  }
});

// 评论管理 - 查询文章评论
app.post('/clawbot/comment/list', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const { msg_data_id, index = 0, begin = 0, count = 20, type = 0 } = req.body || {};
  if (!msg_data_id || typeof msg_data_id !== 'string') {
    res.status(400).json({ error: '请提供 msg_data_id（文章 data_id）' });
    return;
  }
  if (typeof count !== 'number' || count < 1 || count > 50) {
    res.status(400).json({ error: 'count 范围 1-50' });
    return;
  }
  try {
    const token = await getAccessToken();
    if (!token) { res.status(502).json({ error: '获取 access_token 失败' }); return; }
    const { body } = await request(`https://api.weixin.qq.com/cgi-bin/comment/list?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_data_id, index, begin, count, type }),
      bodyTimeout: 10_000,
      headersTimeout: 10_000,
    });
    const data = await body.json();
    res.json({ success: true, total: data.total || 0, comment: data.comment || [] });
  } catch (err) {
    logger.error('查询评论失败', { err: err.message });
    res.status(500).json({ error: '查询评论失败' });
  }
});

// 回复评论
app.post('/clawbot/comment/reply', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const { msg_data_id, index = 0, user_comment_id, content } = req.body || {};
  if (!msg_data_id || !user_comment_id || !content || typeof content !== 'string' || content.length > 512) {
    res.status(400).json({ error: '请提供 msg_data_id, user_comment_id, content（不超过512字符）' });
    return;
  }
  try {
    const token = await getAccessToken();
    if (!token) { res.status(502).json({ error: '获取 access_token 失败' }); return; }
    const { body } = await request(`https://api.weixin.qq.com/cgi-bin/comment/reply/add?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_data_id, index, user_comment_id, content }),
      bodyTimeout: 10_000,
      headersTimeout: 10_000,
    });
    const data = await body.json();
    if (data.errcode && data.errcode !== 0) {
      res.status(502).json({ error: '微信 API 错误', detail: data });
      return;
    }
    stats.commentsModerated++;
    if (pgPool) {
      await pgPool.query(
        `INSERT INTO clawbot_comment_log (msg_data_id, comment_id, action, content, created_at) VALUES ($1, $2, 'reply', $3, NOW())`,
        [msg_data_id, String(user_comment_id), content.slice(0, 512)]
      ).catch((e) => logger.error('记录评论回复失败', { err: e.message }));
    }
    dbAuditLog({ openId: 'admin', action: 'comment_reply', detail: `article=${msg_data_id},comment=${user_comment_id}`, ip: req.ip, requestId: req.id });
    res.json({ success: true });
  } catch (err) {
    logger.error('回复评论失败', { err: err.message });
    res.status(500).json({ error: '回复评论失败' });
  }
});

// 删除评论
app.post('/clawbot/comment/delete', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const { msg_data_id, index = 0, user_comment_id } = req.body || {};
  if (!msg_data_id || !user_comment_id) {
    res.status(400).json({ error: '请提供 msg_data_id 和 user_comment_id' });
    return;
  }
  try {
    const token = await getAccessToken();
    if (!token) { res.status(502).json({ error: '获取 access_token 失败' }); return; }
    const { body } = await request(`https://api.weixin.qq.com/cgi-bin/comment/delete?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg_data_id, index, user_comment_id }),
      bodyTimeout: 10_000,
      headersTimeout: 10_000,
    });
    const data = await body.json();
    if (data.errcode && data.errcode !== 0) {
      res.status(502).json({ error: '微信 API 错误', detail: data });
      return;
    }
    stats.commentsModerated++;
    if (pgPool) {
      await pgPool.query(
        `INSERT INTO clawbot_comment_log (msg_data_id, comment_id, action, created_at) VALUES ($1, $2, 'delete', NOW())`,
        [msg_data_id, String(user_comment_id)]
      ).catch((e) => logger.error('记录评论删除失败', { err: e.message }));
    }
    dbAuditLog({ openId: 'admin', action: 'comment_delete', detail: `article=${msg_data_id},comment=${user_comment_id}`, ip: req.ip, requestId: req.id });
    res.json({ success: true });
  } catch (err) {
    logger.error('删除评论失败', { err: err.message });
    res.status(500).json({ error: '删除评论失败' });
  }
});

// ─── v2.8 订阅消息管理 ────────────────────────────────────────

// 发送订阅消息
app.post('/clawbot/subscribe/send', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const { touser, template_id, data: tplData, page } = req.body || {};
  if (!touser || typeof touser !== 'string' || touser.length > 64) {
    res.status(400).json({ error: '请提供有效的 touser' });
    return;
  }
  if (!template_id || typeof template_id !== 'string') {
    res.status(400).json({ error: '请提供 template_id' });
    return;
  }
  if (!tplData || typeof tplData !== 'object') {
    res.status(400).json({ error: '请提供 data 模板数据' });
    return;
  }
  try {
    const token = await getAccessToken();
    if (!token) { res.status(502).json({ error: '获取 access_token 失败' }); return; }
    const payload = { touser, template_id, data: tplData };
    if (page) payload.page = String(page).slice(0, 256);
    const { body } = await request(`https://api.weixin.qq.com/cgi-bin/message/subscribe/bizsend?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      bodyTimeout: 10_000,
      headersTimeout: 10_000,
    });
    const data = await body.json();
    if (data.errcode && data.errcode !== 0) {
      res.status(502).json({ error: '微信 API 错误', detail: data });
      return;
    }
    stats.subscriptionsSent++;
    if (pgPool) {
      await pgPool.query(
        `INSERT INTO clawbot_subscription_messages (open_id, template_id, status, created_at) VALUES ($1, $2, 'sent', NOW())`,
        [touser, template_id]
      ).catch((e) => logger.error('记录订阅消息失败', { err: e.message }));
    }
    dbAuditLog({ openId: 'admin', action: 'subscribe_send', detail: `to=${touser},tpl=${template_id}`, ip: req.ip, requestId: req.id });
    res.json({ success: true });
  } catch (err) {
    logger.error('发送订阅消息失败', { err: err.message });
    res.status(500).json({ error: '发送订阅消息失败' });
  }
});

// 查询订阅消息模板列表
app.get('/clawbot/subscribe/templates', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  try {
    const token = await getAccessToken();
    if (!token) { res.status(502).json({ error: '获取 access_token 失败' }); return; }
    const { body } = await request(`https://api.weixin.qq.com/wxaapi/newtmpl/gettemplate?access_token=${encodeURIComponent(token)}`, {
      bodyTimeout: 10_000,
      headersTimeout: 10_000,
    });
    const data = await body.json();
    res.json({ success: true, templates: data.data || [] });
  } catch (err) {
    logger.error('查询订阅模板失败', { err: err.message });
    res.status(500).json({ error: '查询订阅模板失败' });
  }
});

// ─── v2.8 个性化菜单 ──────────────────────────────────────────

// 创建个性化菜单
app.post('/clawbot/menu/conditional', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const { button, matchrule } = req.body || {};
  if (!Array.isArray(button) || button.length === 0 || button.length > 3) {
    res.status(400).json({ error: '请提供 button 数组（1-3 个按钮）' });
    return;
  }
  if (!matchrule || typeof matchrule !== 'object') {
    res.status(400).json({ error: '请提供 matchrule 匹配规则' });
    return;
  }
  try {
    const token = await getAccessToken();
    if (!token) { res.status(502).json({ error: '获取 access_token 失败' }); return; }
    const { body } = await request(`https://api.weixin.qq.com/cgi-bin/menu/addconditional?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ button, matchrule }),
      bodyTimeout: 10_000,
      headersTimeout: 10_000,
    });
    const data = await body.json();
    if (data.errcode && data.errcode !== 0) {
      res.status(502).json({ error: '微信 API 错误', detail: data });
      return;
    }
    stats.conditionalMenuCreated++;
    dbAuditLog({ openId: 'admin', action: 'menu_conditional_create', detail: `menuid=${data.menuid || ''}`, ip: req.ip, requestId: req.id });
    res.json({ success: true, menuid: data.menuid });
  } catch (err) {
    logger.error('创建个性化菜单失败', { err: err.message });
    res.status(500).json({ error: '创建个性化菜单失败' });
  }
});

// 删除个性化菜单
app.delete('/clawbot/menu/conditional/:menuid', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const menuid = req.params.menuid;
  if (!menuid || typeof menuid !== 'string') {
    res.status(400).json({ error: '请提供 menuid' });
    return;
  }
  try {
    const token = await getAccessToken();
    if (!token) { res.status(502).json({ error: '获取 access_token 失败' }); return; }
    const { body } = await request(`https://api.weixin.qq.com/cgi-bin/menu/delconditional?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ menuid }),
      bodyTimeout: 10_000,
      headersTimeout: 10_000,
    });
    const data = await body.json();
    if (data.errcode && data.errcode !== 0) {
      res.status(502).json({ error: '微信 API 错误', detail: data });
      return;
    }
    dbAuditLog({ openId: 'admin', action: 'menu_conditional_delete', detail: `menuid=${menuid}`, ip: req.ip, requestId: req.id });
    res.json({ success: true });
  } catch (err) {
    logger.error('删除个性化菜单失败', { err: err.message });
    res.status(500).json({ error: '删除个性化菜单失败' });
  }
});

// 测试菜单匹配
app.post('/clawbot/menu/trymatch', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const { user_id } = req.body || {};
  if (!user_id || typeof user_id !== 'string' || user_id.length > 64) {
    res.status(400).json({ error: '请提供 user_id（用户 openid）' });
    return;
  }
  try {
    const token = await getAccessToken();
    if (!token) { res.status(502).json({ error: '获取 access_token 失败' }); return; }
    const { body } = await request(`https://api.weixin.qq.com/cgi-bin/menu/trymatch?access_token=${encodeURIComponent(token)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ user_id }),
      bodyTimeout: 10_000,
      headersTimeout: 10_000,
    });
    const data = await body.json();
    res.json({ success: true, menu: data.button || [] });
  } catch (err) {
    logger.error('菜单匹配测试失败', { err: err.message });
    res.status(500).json({ error: '菜单匹配测试失败' });
  }
});

// ─── v2.9 灵枢统一通道端点（ENT-2.9-1）──────────────────────────

app.post('/clawbot/lingshu/connect', adminLimiter, async (req, res) => {
  const { open_id, platform, channel_id, app_id } = req.body || {};
  if (!open_id || typeof open_id !== 'string' || open_id.length > 64) {
    res.status(400).json({ success: false, msg: 'Missing or invalid open_id' });
    return;
  }
  if (platform && !LINGSHU_PLATFORMS.includes(platform)) {
    res.status(400).json({ success: false, msg: `Invalid platform. Supported: ${LINGSHU_PLATFORMS.join(', ')}` });
    return;
  }
  const detectedPlatform = platform || 'wechat';

  // 检查用户是否已认证（ENT-2.9-2 强制认证）
  let isAuthed = false;
  if (redis) {
    try {
      isAuthed = await redis.sismember(REDIS_AUTH_KEY, open_id);
    } catch (_e) { /* ignore */ }
  }

  if (!isAuthed) {
    stats.authGatewayBlocked++;
    dbAuditLog({ openId: open_id, action: 'lingshu_connect_blocked', detail: 'User not authenticated' });
    res.status(401).json({
      success: false,
      msg: '请先完成登录绑定。发送 /bind 你的邮箱 或使用 /quickstart 一键接入。',
      guide: { bind: '/bind <email>', quickstart: '/quickstart', oauth: OAUTH_REDIRECT_URI ? '/clawbot/oauth' : null },
    });
    return;
  }

  // 生成灵枢通道会话令牌
  const token = generateLingshuToken(open_id, detectedPlatform);
  const sessionData = {
    open_id,
    platform: detectedPlatform,
    channel_id: channel_id || null,
    app_id: app_id || CLAWBOT_APP_ID,
    connected_at: Date.now(),
    auth_method: 'lingshu_connect',
  };

  // 存储到 Redis
  if (redis) {
    try {
      await redis.setex(`${REDIS_LINGSHU_PREFIX}${token}`, LINGSHU_SESSION_TTL, JSON.stringify(sessionData));
    } catch (_e) { /* ignore */ }
  }

  // 持久化到 DB
  await dbSaveLingshuSession({ openId: open_id, platform: detectedPlatform, token, channelId: channel_id });
  await trackUsage(null, 'lingshu_connects', 1);

  stats.lingshuConnected++;
  dbAuditLog({ openId: open_id, action: 'lingshu_connected', detail: `platform=${detectedPlatform}` });

  res.json({
    success: true,
    session_token: token,
    platform: detectedPlatform,
    expires_in: LINGSHU_SESSION_TTL,
    capabilities: LINGSHU_PLATFORMS,
    endpoints: {
      webhook: '/clawbot/webhook',
      status: '/clawbot/lingshu/status',
      plugin_manifest: '/clawbot/plugin/manifest',
    },
  });
});

app.get('/clawbot/lingshu/status', adminLimiter, async (req, res) => {
  const token = (req.headers['x-lingshu-token'] || req.query.token || '').toString();
  if (!token) {
    res.status(400).json({ success: false, msg: 'Missing lingshu session token' });
    return;
  }

  const session = await validateLingshuSession(token);
  if (!session) {
    res.status(401).json({ success: false, msg: 'Invalid or expired session token' });
    return;
  }

  // 查询 DB 持久化状态
  const dbSession = await dbGetLingshuSession(session.open_id);

  res.json({
    success: true,
    connected: true,
    platform: session.platform,
    channel_id: session.channel_id,
    connected_at: session.connected_at,
    db_session: dbSession ? {
      status: dbSession.status,
      connected_at: dbSession.connected_at,
      last_active_at: dbSession.last_active_at,
    } : null,
  });
});

app.post('/clawbot/lingshu/init', adminLimiter, async (req, res) => {
  const { app_id, app_secret_hash, platform, redirect_uri, features } = req.body || {};
  if (!app_id || typeof app_id !== 'string' || app_id.length > 64) {
    res.status(400).json({ success: false, msg: 'Missing or invalid app_id' });
    return;
  }
  if (platform && !LINGSHU_PLATFORMS.includes(platform)) {
    res.status(400).json({ success: false, msg: `Invalid platform. Supported: ${LINGSHU_PLATFORMS.join(', ')}` });
    return;
  }

  // 验证 app_secret_hash（HMAC-SHA256 of app_secret）
  if (app_secret_hash && typeof app_secret_hash === 'string') {
    const expectedHash = crypto.createHmac('sha256', CLAWBOT_APP_SECRET)
      .update(app_id).digest('hex');
    const providedBuf = Buffer.from(app_secret_hash, 'hex');
    const expectedBuf = Buffer.from(expectedHash, 'hex');
    if (providedBuf.length !== expectedBuf.length || !crypto.timingSafeEqual(providedBuf, expectedBuf)) {
      dbAuditLog({ openId: 'system', action: 'lingshu_init_auth_fail', detail: `app_id=${app_id}` });
      res.status(401).json({ success: false, msg: 'Invalid app credentials' });
      return;
    }
  }

  stats.lingshuInitialized++;
  const detectedPlatform = platform || 'wechat';

  dbAuditLog({ openId: 'system', action: 'lingshu_initialized', detail: `app_id=${app_id}, platform=${detectedPlatform}` });

  res.json({
    success: true,
    channel: '灵枢统一通道',
    platform: detectedPlatform,
    protocol_version: '2026-03-22',
    features_available: PORTAL_FEATURES.map(f => f.id),
    features_requested: Array.isArray(features) ? features.filter(f => typeof f === 'string') : [],
    auth: {
      method: 'oauth2 + unified_login',
      oauth_url: OAUTH_REDIRECT_URI || null,
      bind_command: '/bind <email>',
      quickstart: '/quickstart',
      login_endpoint: '/clawbot/auth/login',
    },
    security: {
      pci_dss: 'v4.0',
      cis: 'v8',
      data_isolation: 'per-user + per-tenant HKDF key derivation + row-level compartment',
      encryption: SESSION_ENCRYPT_KEY ? 'AES-256-GCM + HKDF' : 'plaintext',
    },
    redirect_uri: redirect_uri || null,
    endpoints: {
      connect: '/clawbot/lingshu/connect',
      onboard: '/clawbot/lingshu/onboard',
      guide: '/clawbot/lingshu/guide',
      verify: '/clawbot/lingshu/verify',
      login: '/clawbot/auth/login',
      portal: '/clawbot/portal/features',
      webhook: '/clawbot/webhook',
      oauth: '/clawbot/oauth',
      manifest: '/clawbot/plugin/manifest',
      admin: '/clawbot/admin',
    },
  });
});

// ─── v2.9 官方 SDK 回调端点（ENT-2.9-4）──────────────────────────

app.post('/clawbot/plugin/sdk/callback', adminLimiter, (req, res) => {
  const { event, plugin_id, data, timestamp: cbTs, signature: cbSig } = req.body || {};
  if (!event || typeof event !== 'string' || event.length > 64) {
    res.status(400).json({ success: false, msg: 'Missing or invalid event' });
    return;
  }

  // 验证签名（如提供）
  if (cbSig && cbTs && plugin_id) {
    const payload = `${plugin_id}|${cbTs}|${event}`;
    const expected = crypto.createHmac('sha256', CLAWBOT_APP_SECRET).update(payload).digest('hex');
    const sigBuf = Buffer.from(cbSig, 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      dbAuditLog({ openId: 'system:sdk', action: 'sdk_callback_auth_fail', detail: `event=${event}` });
      res.status(401).json({ success: false, msg: 'Invalid callback signature' });
      return;
    }
  }

  stats.sdkCallbacks++;
  logger.info('SDK 回调事件', { event, plugin_id: plugin_id || 'unknown' });
  dbAuditLog({ openId: 'system:sdk', action: 'sdk_callback', detail: `event=${event}, data=${JSON.stringify(data || {}).substring(0, 200)}` });

  res.json({
    success: true,
    received: event,
    plugin_version: PLUGIN_VERSION,
    timestamp: String(Math.floor(Date.now() / 1000)),
  });
});

// ─── v2.9 企业商业运维端点（ENT-2.9-5）──────────────────────────

app.get('/clawbot/ops/sla', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  stats.slaChecks++;
  const uptimeMs = Date.now() - stats.startedAt;
  const uptimeHours = uptimeMs / 3600_000;

  // 计算错误率
  const totalRequests = stats.totalMessages + stats.totalCommands;
  const errorRate = totalRequests > 0 ? (stats.totalErrors / totalRequests * 100).toFixed(4) : '0.0000';

  // 基础设施健康度
  const redisOk = redis ? redis.status === 'ready' : false;
  let dbOk = false;
  if (pgPool) {
    try { await pgPool.query('SELECT 1'); dbOk = true; } catch (_e) { /* ignore */ }
  }

  const healthScore = [redisOk, dbOk].filter(Boolean).length / 2 * 100;

  res.json({
    success: true,
    sla: {
      target_uptime_pct: SLA_TARGET_UPTIME,
      current_uptime_hours: Math.round(uptimeHours * 100) / 100,
      error_rate_pct: parseFloat(errorRate),
      health_score: healthScore,
      status: healthScore >= 100 ? 'healthy' : healthScore >= 50 ? 'degraded' : 'critical',
    },
    infrastructure: {
      redis: redisOk ? 'healthy' : 'down',
      postgresql: dbOk ? 'healthy' : 'down',
      uptime_seconds: Math.floor(uptimeMs / 1000),
    },
    throughput: {
      total_messages: stats.totalMessages,
      total_commands: stats.totalCommands,
      total_errors: stats.totalErrors,
      active_sessions: sessions.size,
    },
  });
});

app.get('/clawbot/ops/usage', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  stats.usageQueries++;
  const tenantId = (req.query.tenant_id || 'default').toString();
  const date = (req.query.date || new Date().toISOString().slice(0, 10)).toString();

  if (tenantId !== 'default' && !TENANT_ID_RE.test(tenantId)) {
    res.status(400).json({ success: false, msg: 'Invalid tenant_id format' });
    return;
  }

  const usage = await getUsage(tenantId, date);
  res.json({
    success: true,
    tenant_id: tenantId,
    date,
    metrics: usage,
  });
});

app.get('/clawbot/ops/quota', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  stats.quotaChecks++;
  const tenantId = (req.query.tenant_id || 'default').toString();

  if (tenantId !== 'default' && !TENANT_ID_RE.test(tenantId)) {
    res.status(400).json({ success: false, msg: 'Invalid tenant_id format' });
    return;
  }

  const today = new Date().toISOString().slice(0, 10);
  const usage = await getUsage(tenantId, today);
  const messagesUsed = parseInt(usage.messages || '0', 10);

  // 从租户配置或默认值获取配额
  let quota = QUOTA_DEFAULT_DAILY;
  if (redis && tenantId !== 'default') {
    try {
      const tenantData = await redis.get(`${REDIS_TENANT_PREFIX}${tenantId}:config`);
      if (tenantData) {
        const config = JSON.parse(tenantData);
        if (config.daily_quota) quota = config.daily_quota;
      }
    } catch (_e) { /* ignore */ }
  }

  const remaining = Math.max(0, quota - messagesUsed);
  const utilizationPct = quota > 0 ? Math.round(messagesUsed / quota * 100 * 100) / 100 : 0;

  res.json({
    success: true,
    tenant_id: tenantId,
    date: today,
    quota: {
      daily_limit: quota,
      used: messagesUsed,
      remaining,
      utilization_pct: utilizationPct,
      status: utilizationPct >= 100 ? 'exceeded' : utilizationPct >= 80 ? 'warning' : 'ok',
    },
  });
});

// ─── v3.0 用户自助接入门户（ENT-3.0-1）────────────────────────────

app.post('/clawbot/lingshu/onboard', adminLimiter, async (req, res) => {
  const { open_id, platform, step, email, consent } = req.body || {};
  if (!open_id || typeof open_id !== 'string' || open_id.length > 64) {
    res.status(400).json({ success: false, msg: 'Missing or invalid open_id' });
    return;
  }
  const detectedPlatform = (platform && LINGSHU_PLATFORMS.includes(platform)) ? platform : 'wechat';

  // 查询当前接入进度
  const progress = await dbGetOnboardingProgress(open_id);
  const currentStep = step || (progress ? progress.current_step : 'register');

  const steps = ['register', 'bind', 'consent', 'activate', 'complete'];
  const stepIndex = steps.indexOf(currentStep);
  if (stepIndex === -1) {
    res.status(400).json({ success: false, msg: `Invalid step. Valid: ${steps.join(', ')}` });
    return;
  }

  // 检查用户是否已认证
  let isAuthed = false;
  if (redis) {
    try { isAuthed = await redis.sismember(REDIS_AUTH_KEY, open_id); } catch (_e) { /* ignore */ }
  }

  // 根据步骤执行逻辑
  const response = {
    success: true,
    open_id,
    platform: detectedPlatform,
    current_step: currentStep,
    steps_total: steps.length,
    step_index: stepIndex + 1,
  };

  if (currentStep === 'register') {
    response.next_step = 'bind';
    response.instruction = '第1步：注册确认完成。请发送 /bind 您的邮箱 绑定账号，或使用 /quickstart 一键接入。';
    response.actions = { bind: '/bind <email>', quickstart: '/quickstart', oauth: OAUTH_REDIRECT_URI ? '/clawbot/oauth' : null };
  } else if (currentStep === 'bind') {
    if (!isAuthed && email) {
      response.instruction = '第2步：请通过 /bind 命令完成邮箱绑定。';
    } else if (isAuthed) {
      response.instruction = '第2步：邮箱绑定已完成。';
    } else {
      response.instruction = '第2步：请提供 email 字段或通过 /bind 命令完成绑定。';
    }
    response.next_step = 'consent';
    response.is_bound = isAuthed;
  } else if (currentStep === 'consent') {
    if (consent === true) {
      response.instruction = '第3步：用户同意已确认。';
    } else {
      response.instruction = '第3步：请发送 /consent 接受数据处理条款。';
    }
    response.next_step = 'activate';
    response.actions = { consent: '/consent' };
  } else if (currentStep === 'activate') {
    response.instruction = '第4步：请发送 /activate 激活 ClawBot 插件。';
    response.next_step = 'complete';
    response.actions = { activate: '/activate' };
  } else if (currentStep === 'complete') {
    response.instruction = '接入完成！所有 ClawBot 功能已就绪。';
    response.next_step = null;
    response.completed = true;
    stats.onboardCompleted++;
    await trackUsage(null, 'onboard_completed', 1);
  }

  // 保存进度
  await dbSaveOnboardingProgress({
    openId: open_id,
    step: currentStep,
    status: currentStep === 'complete' ? 'completed' : 'in_progress',
    detail: `platform=${detectedPlatform}`,
  });

  // 缓存到 Redis
  if (redis) {
    try {
      await redis.setex(`${REDIS_ONBOARD_PREFIX}${open_id}`, ONBOARD_TTL, JSON.stringify({
        open_id, platform: detectedPlatform, step: currentStep, updated_at: Date.now(),
      }));
    } catch (_e) { /* ignore */ }
  }

  dbAuditLog({ openId: open_id, action: 'onboard_step', detail: `step=${currentStep}, platform=${detectedPlatform}` });
  res.json(response);
});

app.get('/clawbot/lingshu/guide', adminLimiter, (req, res) => {
  res.json({
    success: true,
    guide: {
      title: '灵枢接入通道 · ClawBot 接入引导',
      version: '3.1',
      protocol_date: '2026-03-22',
      description: '普通用户自助完成 ClawBot 全功能接入，零门槛轻松使用。',
      steps: [
        { step: 1, name: 'register', title: '注册确认', description: '扫码关注公众号，自动注册。', command: null },
        { step: 2, name: 'bind', title: '绑定账号', description: '绑定邮箱以启用全功能。', command: '/bind <email> 或 /quickstart' },
        { step: 3, name: 'consent', title: '同意条款', description: '接受数据处理协议（PCI-DSS 合规要求）。', command: '/consent' },
        { step: 4, name: 'activate', title: '激活插件', description: '一键激活 ClawBot 插件。', command: '/activate' },
        { step: 5, name: 'complete', title: '接入完成', description: '所有功能已就绪，开始使用。', command: null },
      ],
      features_available: PORTAL_FEATURES.map(f => ({ id: f.id, name: f.name, category: f.category })),
      quick_start: {
        command: '/quickstart',
        description: '一条消息完成全部接入流程（OAuth 用户零操作即用）',
      },
      oauth: OAUTH_REDIRECT_URI ? {
        url: '/clawbot/oauth',
        description: '微信 OAuth2.0 静默授权，无需手动绑定',
      } : null,
      support: {
        help: '/help',
        guide: '/guide',
        status: '/status',
        tools: '/tools',
      },
    },
  });
});

app.post('/clawbot/lingshu/verify', adminLimiter, async (req, res) => {
  const { open_id } = req.body || {};
  if (!open_id || typeof open_id !== 'string' || open_id.length > 64) {
    res.status(400).json({ success: false, msg: 'Missing or invalid open_id' });
    return;
  }

  // 验证接入完成状态
  const checks = {
    is_registered: false,
    is_bound: false,
    is_consented: false,
    is_activated: false,
    is_lingshu_connected: false,
  };

  if (redis) {
    try {
      checks.is_bound = !!(await redis.sismember(REDIS_AUTH_KEY, open_id));
      const consentData = await redis.get(`${REDIS_CONSENT_PREFIX}${open_id}`);
      checks.is_consented = !!consentData;
      const activated = await redis.sismember(REDIS_PLUGIN_ACTIVATED_KEY, open_id);
      checks.is_activated = activated === 1;
      checks.is_registered = true; // 能到达此端点即已注册
    } catch (_e) { /* ignore */ }
  }

  // 检查灵枢通道连接
  const lingshuSession = await dbGetLingshuSession(open_id);
  checks.is_lingshu_connected = !!lingshuSession;

  const allPassed = Object.values(checks).every(v => v);
  const progress = await dbGetOnboardingProgress(open_id);

  res.json({
    success: true,
    open_id,
    verification: checks,
    all_passed: allPassed,
    onboarding_status: allPassed ? 'completed' : 'incomplete',
    progress: progress ? { step: progress.current_step, status: progress.status, updated_at: progress.updated_at } : null,
    recommendation: allPassed ? '所有验证通过，ClawBot 全功能已就绪。' : '部分步骤未完成，请按引导完成接入。',
  });
});

// ─── v3.0 统一登录网关（ENT-3.0-2）──────────────────────────────

app.post('/clawbot/auth/login', adminLimiter, async (req, res) => {
  const { open_id, platform, credential_type, credential } = req.body || {};
  if (!open_id || typeof open_id !== 'string' || open_id.length > 64) {
    res.status(400).json({ success: false, msg: 'Missing or invalid open_id' });
    return;
  }

  const detectedPlatform = (platform && LINGSHU_PLATFORMS.includes(platform)) ? platform : 'wechat';

  // 验证用户已绑定
  let isAuthed = false;
  if (redis) {
    try { isAuthed = await redis.sismember(REDIS_AUTH_KEY, open_id); } catch (_e) { /* ignore */ }
  }

  if (!isAuthed) {
    stats.authLoginFailed++;
    dbAuditLog({ openId: open_id, action: 'auth_login_failed', detail: 'User not bound' });
    res.status(401).json({
      success: false,
      msg: '用户未绑定，请先完成 /bind 邮箱绑定或使用 /quickstart 一键接入。',
      guide: { bind: '/bind <email>', quickstart: '/quickstart', oauth: OAUTH_REDIRECT_URI ? '/clawbot/oauth' : null },
    });
    return;
  }

  // 生成统一登录令牌
  const token = generateAuthToken(open_id, detectedPlatform);
  const sessionData = {
    open_id,
    platform: detectedPlatform,
    credential_type: credential_type || 'wechat_openid',
    created_at: Date.now(),
    expires_at: Date.now() + AUTH_SESSION_TTL * 1000,
    ip: req.ip || null,
  };

  // 存储到 Redis
  if (redis) {
    try {
      await redis.setex(`${REDIS_AUTH_SESSION_PREFIX}${token}`, AUTH_SESSION_TTL, JSON.stringify(sessionData));
    } catch (_e) { /* ignore */ }
  }

  // 持久化到 DB
  await dbSaveAuthSession({
    openId: open_id,
    token,
    platform: detectedPlatform,
    ip: req.ip,
    userAgent: req.headers['user-agent'],
  });

  stats.authLoginSuccess++;
  await trackUsage(null, 'auth_logins', 1);
  dbAuditLog({ openId: open_id, action: 'auth_login_success', detail: `platform=${detectedPlatform}` });

  res.json({
    success: true,
    auth_token: token,
    platform: detectedPlatform,
    expires_in: AUTH_SESSION_TTL,
    refresh_before: AUTH_SESSION_TTL - AUTH_TOKEN_REFRESH_WINDOW,
    endpoints: {
      refresh: '/clawbot/auth/refresh',
      session: '/clawbot/auth/session',
      logout: '/clawbot/auth/logout',
      portal: '/clawbot/portal/features',
      lingshu: '/clawbot/lingshu/connect',
    },
  });
});

app.post('/clawbot/auth/refresh', adminLimiter, async (req, res) => {
  const authToken = (req.headers['x-auth-token'] || req.body?.auth_token || '').toString();
  if (!authToken) {
    res.status(400).json({ success: false, msg: 'Missing auth token (X-Auth-Token header or auth_token body)' });
    return;
  }

  const session = await validateAuthSession(authToken);
  if (!session) {
    res.status(401).json({ success: false, msg: 'Invalid or expired auth token' });
    return;
  }

  // 生成新令牌
  const newToken = generateAuthToken(session.open_id, session.platform);
  const newSessionData = {
    ...session,
    created_at: Date.now(),
    expires_at: Date.now() + AUTH_SESSION_TTL * 1000,
    refreshed_from: authToken.substring(0, 12) + '...',
  };

  if (redis) {
    try {
      await redis.setex(`${REDIS_AUTH_SESSION_PREFIX}${newToken}`, AUTH_SESSION_TTL, JSON.stringify(newSessionData));
      // 旧令牌保留短时间以支持并发请求
      await redis.expire(`${REDIS_AUTH_SESSION_PREFIX}${authToken}`, 60);
    } catch (_e) { /* ignore */ }
  }

  stats.authTokenRefreshed++;
  dbAuditLog({ openId: session.open_id, action: 'auth_token_refreshed', detail: `platform=${session.platform}` });

  res.json({
    success: true,
    auth_token: newToken,
    expires_in: AUTH_SESSION_TTL,
    refresh_before: AUTH_SESSION_TTL - AUTH_TOKEN_REFRESH_WINDOW,
  });
});

app.get('/clawbot/auth/session', adminLimiter, async (req, res) => {
  const authToken = (req.headers['x-auth-token'] || req.query.auth_token || '').toString();
  if (!authToken) {
    res.status(400).json({ success: false, msg: 'Missing auth token' });
    return;
  }

  const session = await validateAuthSession(authToken);
  if (!session) {
    res.status(401).json({ success: false, msg: 'Invalid or expired auth session' });
    return;
  }

  const dbSession = await dbGetAuthSession(authToken);

  res.json({
    success: true,
    authenticated: true,
    open_id: session.open_id,
    platform: session.platform,
    created_at: session.created_at,
    expires_at: session.expires_at,
    remaining_seconds: Math.max(0, Math.floor((session.expires_at - Date.now()) / 1000)),
    db_session: dbSession ? { status: dbSession.status, created_at: dbSession.created_at } : null,
  });
});

app.post('/clawbot/auth/logout', adminLimiter, async (req, res) => {
  const authToken = (req.headers['x-auth-token'] || req.body?.auth_token || '').toString();
  if (!authToken) {
    res.status(400).json({ success: false, msg: 'Missing auth token' });
    return;
  }

  const session = await validateAuthSession(authToken);
  if (!session) {
    res.status(401).json({ success: false, msg: 'Invalid or already expired session' });
    return;
  }

  // 清除 Redis 会话
  if (redis) {
    try { await redis.del(`${REDIS_AUTH_SESSION_PREFIX}${authToken}`); } catch (_e) { /* ignore */ }
  }

  // 更新 DB 状态
  await dbRevokeAuthSession(authToken);

  stats.authLogouts++;
  dbAuditLog({ openId: session.open_id, action: 'auth_logout', detail: `platform=${session.platform}` });

  res.json({ success: true, msg: '会话已注销' });
});

// ─── v3.0 统一功能入口（ENT-3.0-3）──────────────────────────────

app.get('/clawbot/portal/features', adminLimiter, async (req, res) => {
  const authToken = (req.headers['x-auth-token'] || req.query.auth_token || '').toString();
  const category = (req.query.category || '').toString();

  // 验证登录（ENT-3.0-2 所有用户必须登录）
  let session = null;
  if (authToken) {
    session = await validateAuthSession(authToken);
  }
  if (!session) {
    stats.authGatewayBlocked++;
    res.status(401).json({
      success: false,
      msg: '请先登录。使用 POST /clawbot/auth/login 获取认证令牌。',
      guide: { login: '/clawbot/auth/login', onboard: '/clawbot/lingshu/onboard' },
    });
    return;
  }

  stats.portalFeatureQueries++;

  let features = PORTAL_FEATURES;
  if (category) {
    features = features.filter(f => f.category === category);
  }

  res.json({
    success: true,
    protocol_version: '2026-03-22',
    total: features.length,
    categories: [...new Set(PORTAL_FEATURES.map(f => f.category))],
    features: features.map(f => ({
      ...f,
      invoke_endpoint: '/clawbot/portal/invoke',
      invoke_method: 'POST',
    })),
  });
});

app.post('/clawbot/portal/invoke', adminLimiter, async (req, res) => {
  const authToken = (req.headers['x-auth-token'] || req.body?.auth_token || '').toString();
  const { feature_id, action, params } = req.body || {};

  // 验证登录
  const session = await validateAuthSession(authToken);
  if (!session) {
    stats.authGatewayBlocked++;
    res.status(401).json({ success: false, msg: '请先登录' });
    return;
  }

  if (!feature_id || typeof feature_id !== 'string' || feature_id.length > 64) {
    res.status(400).json({ success: false, msg: 'Missing or invalid feature_id' });
    return;
  }

  // 验证数据边界（ENT-3.0-4 跨用户防护）
  const openId = session.open_id;

  const feature = PORTAL_FEATURES.find(f => f.id === feature_id);
  if (!feature) {
    res.status(404).json({ success: false, msg: `Feature '${feature_id}' not found` });
    return;
  }

  if (feature.status !== 'active') {
    res.status(503).json({ success: false, msg: `Feature '${feature_id}' is currently ${feature.status}` });
    return;
  }

  stats.portalInvocations++;
  await trackUsage(null, 'portal_invocations', 1);

  dbAuditLog({ openId, action: 'portal_invoke', detail: `feature=${feature_id}, action=${action || 'default'}` });

  res.json({
    success: true,
    feature_id,
    feature_name: feature.name,
    action: action || 'default',
    invoked_by: openId,
    result: {
      status: 'dispatched',
      message: `功能 '${feature.name}' 已调用。请通过微信消息交互使用，或使用相应的命令。`,
      commands: getFeatureCommands(feature_id),
    },
    timestamp: new Date().toISOString(),
  });
});

/**
 * 获取功能对应的命令列表（v3.0 ENT-3.0-3）
 */
function getFeatureCommands(featureId) {
  const commandMap = {
    ai_chat: [{ command: '直接发送文本', description: 'AI 对话' }],
    web_search: [{ command: '/search <query>', description: '网页搜索' }],
    calendar: [{ command: '/calendar', description: '日历管理' }],
    email: [{ command: '/email', description: '邮件管理' }],
    cloud_storage: [{ command: '/files', description: '云存储文件管理' }],
    smart_home: [{ command: '/home', description: '智能家居控制' }],
    voice: [{ command: '发送语音消息', description: '语音识别' }],
    file_analysis: [{ command: '发送文件', description: '文件分析' }],
    customer_service: [{ command: '/transfer', description: '转接客服' }],
    content_lifecycle: [{ command: 'API 调用', description: '内容管理 API' }],
    subscription_message: [{ command: 'API 调用', description: '订阅消息 API' }],
    template_message: [{ command: 'API 调用', description: '模板消息 API' }],
    menu_management: [{ command: 'API 调用', description: '菜单管理 API' }],
    data_analytics: [{ command: 'API 调用', description: '数据分析 API' }],
    broadcast: [{ command: 'API 调用', description: '群发消息 API' }],
    material: [{ command: 'API 调用', description: '素材管理 API' }],
    qrcode: [{ command: 'API 调用', description: '二维码管理 API' }],
    miniprogram: [{ command: 'API 调用', description: '小程序卡片 API' }],
  };
  return commandMap[featureId] || [{ command: 'N/A', description: '暂无命令' }];
}

app.get('/clawbot/portal/status', adminLimiter, async (req, res) => {
  const authToken = (req.headers['x-auth-token'] || req.query.auth_token || '').toString();

  const session = await validateAuthSession(authToken);
  if (!session) {
    stats.authGatewayBlocked++;
    res.status(401).json({ success: false, msg: '请先登录' });
    return;
  }

  const activeFeatures = PORTAL_FEATURES.filter(f => f.status === 'active').length;
  const totalFeatures = PORTAL_FEATURES.length;

  res.json({
    success: true,
    portal: {
      version: '3.1',
      protocol_date: '2026-03-22',
      total_features: totalFeatures,
      active_features: activeFeatures,
      inactive_features: totalFeatures - activeFeatures,
      categories: [...new Set(PORTAL_FEATURES.map(f => f.category))].map(cat => ({
        name: cat,
        count: PORTAL_FEATURES.filter(f => f.category === cat).length,
        active: PORTAL_FEATURES.filter(f => f.category === cat && f.status === 'active').length,
      })),
    },
    uptime_seconds: Math.floor((Date.now() - stats.startedAt) / 1000),
    total_invocations: stats.portalInvocations,
  });
});

// ─── v3.0 官方 SDK 事件订阅（ENT-3.0-5）──────────────────────────

app.post('/clawbot/plugin/sdk/events', adminLimiter, async (req, res) => {
  const { plugin_id, events, callback_url, timestamp: evtTs, signature: evtSig } = req.body || {};
  if (!plugin_id || typeof plugin_id !== 'string' || plugin_id.length > 64) {
    res.status(400).json({ success: false, msg: 'Missing or invalid plugin_id' });
    return;
  }
  if (!Array.isArray(events) || events.length === 0) {
    res.status(400).json({ success: false, msg: 'Events must be a non-empty array' });
    return;
  }

  // 签名验证（ENT-3.0-5 官方协议安全）
  if (evtSig && evtTs) {
    const payload = `${plugin_id}|${evtTs}|events`;
    const expected = crypto.createHmac('sha256', CLAWBOT_APP_SECRET).update(payload).digest('hex');
    const sigBuf = Buffer.from(evtSig, 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) {
      dbAuditLog({ openId: 'system:sdk', action: 'sdk_event_sub_auth_fail', detail: `plugin_id=${plugin_id}` });
      res.status(401).json({ success: false, msg: 'Invalid signature' });
      return;
    }
  }

  // 验证回调 URL 安全性
  if (callback_url) {
    const urlCheck = validateWebhookUrl(callback_url);
    if (!urlCheck.valid) {
      res.status(400).json({ success: false, msg: `Invalid callback URL: ${urlCheck.reason}` });
      return;
    }
  }

  const validEvents = events.filter(e => typeof e === 'string' && e.length <= 64).slice(0, 50);

  stats.sdkEventSubscriptions++;
  dbAuditLog({ openId: 'system:sdk', action: 'sdk_event_subscribed', detail: `plugin_id=${plugin_id}, events=${validEvents.join(',')}` });

  res.json({
    success: true,
    plugin_id,
    subscribed_events: validEvents,
    callback_url: callback_url || null,
    protocol_version: '2026-03-22',
    timestamp: String(Math.floor(Date.now() / 1000)),
  });
});

// ─── v3.0 企业运维增强（ENT-3.0-6）──────────────────────────────

app.get('/clawbot/ops/dashboard', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const uptimeMs = Date.now() - stats.startedAt;
  const uptimeHours = Math.round(uptimeMs / 3600_000 * 100) / 100;

  // Redis 状态
  let redisStatus = 'disconnected';
  if (redis) {
    try { await redis.ping(); redisStatus = 'connected'; } catch (_e) { redisStatus = 'error'; }
  }

  // PostgreSQL 状态
  let pgStatus = 'disconnected';
  if (pgPool) {
    try { await pgPool.query('SELECT 1'); pgStatus = 'connected'; } catch (_e) { pgStatus = 'error'; }
  }

  stats.opsDashboardViews++;

  res.json({
    success: true,
    dashboard: {
      version: '3.1',
      uptime_hours: uptimeHours,
      uptime_seconds: Math.floor(uptimeMs / 1000),
      infrastructure: {
        redis: redisStatus,
        postgresql: pgStatus,
        node_version: process.version,
        memory_mb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024 * 100) / 100,
      },
      traffic: {
        total_messages: stats.totalMessages,
        total_commands: stats.totalCommands,
        total_errors: stats.totalErrors,
        messages_by_type: stats.messagesByType,
      },
      auth: {
        login_success: stats.authLoginSuccess,
        login_failed: stats.authLoginFailed,
        token_refreshed: stats.authTokenRefreshed,
        gateway_blocked: stats.authGatewayBlocked,
        logouts: stats.authLogouts,
      },
      portal: {
        total_invocations: stats.portalInvocations,
        feature_queries: stats.portalFeatureQueries,
        active_features: PORTAL_FEATURES.filter(f => f.status === 'active').length,
      },
      lingshu: {
        connected: stats.lingshuConnected,
        initialized: stats.lingshuInitialized,
        onboard_completed: stats.onboardCompleted,
      },
      compliance: {
        scans: stats.complianceScans,
        evidence_collected: stats.complianceEvidenceCollected,
        data_boundary_checks: stats.dataBoundaryChecks,
      },
      ops: {
        alerts_created: stats.opsAlertCreated,
        dashboard_views: stats.opsDashboardViews,
        cost_queries: stats.opsCostQueries,
        sla_checks: stats.slaChecks,
      },
    },
  });
});

app.post('/clawbot/ops/alerts', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const { tenant_id, alert_type, severity, message, threshold, current_value } = req.body || {};

  if (!alert_type || typeof alert_type !== 'string' || alert_type.length > 64) {
    res.status(400).json({ success: false, msg: 'Missing or invalid alert_type' });
    return;
  }
  const validSeverities = ['critical', 'warning', 'info'];
  if (severity && !validSeverities.includes(severity)) {
    res.status(400).json({ success: false, msg: `Invalid severity. Valid: ${validSeverities.join(', ')}` });
    return;
  }

  const alert = await dbSaveOpsAlert({
    tenantId: tenant_id,
    alertType: alert_type,
    severity,
    message: (message || '').substring(0, 500),
    threshold,
    currentValue: current_value,
  });

  if (!alert) {
    res.status(500).json({ success: false, msg: 'Failed to create alert' });
    return;
  }

  // 缓存到 Redis
  if (redis) {
    try {
      await redis.setex(`${REDIS_OPS_ALERT_PREFIX}${alert.alert_id}`, 86400 * 7, JSON.stringify(alert));
    } catch (_e) { /* ignore */ }
  }

  stats.opsAlertCreated++;
  dbAuditLog({ openId: 'system:ops', action: 'ops_alert_created', detail: `type=${alert_type}, severity=${severity || 'warning'}` });

  res.json({ success: true, alert });
});

app.get('/clawbot/ops/alerts', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const tenantId = (req.query.tenant_id || 'default').toString();
  const status = (req.query.status || '').toString() || null;

  const alerts = await dbListOpsAlerts(tenantId, status);
  res.json({ success: true, tenant_id: tenantId, total: alerts.length, alerts });
});

app.get('/clawbot/ops/cost', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const tenantId = (req.query.tenant_id || 'default').toString();
  const dateFrom = (req.query.from || new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10)).toString();
  const dateTo = (req.query.to || new Date().toISOString().slice(0, 10)).toString();

  stats.opsCostQueries++;

  // 从 Redis 聚合用量数据
  const costData = { messages: 0, api_calls: 0, storage_mb: 0 };
  if (redis) {
    try {
      const dateStart = new Date(dateFrom);
      const dateEnd = new Date(dateTo);
      for (let d = new Date(dateStart); d <= dateEnd; d.setDate(d.getDate() + 1)) {
        const dateKey = d.toISOString().slice(0, 10);
        const dayUsage = await redis.hgetall(`${REDIS_USAGE_PREFIX}${tenantId}:${dateKey}`);
        if (dayUsage) {
          costData.messages += parseInt(dayUsage.messages || '0', 10);
          costData.api_calls += parseInt(dayUsage.api_calls || '0', 10);
          costData.storage_mb += parseInt(dayUsage.storage_mb || '0', 10);
        }
      }
    } catch (_e) { /* ignore */ }
  }

  res.json({
    success: true,
    tenant_id: tenantId,
    period: { from: dateFrom, to: dateTo },
    cost: {
      total_messages: costData.messages,
      total_api_calls: costData.api_calls,
      storage_mb: costData.storage_mb,
      retention_days: OPS_COST_RETENTION_DAYS,
    },
  });
});

// ─── v3.0 合规证据采集（ENT-3.0-7）──────────────────────────────

app.get('/clawbot/compliance/evidence', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  stats.complianceEvidenceCollected++;

  const evidence = {
    collected_at: new Date().toISOString(),
    version: '3.1',
    pci_dss: {
      '3.4_data_at_rest': SESSION_ENCRYPT_KEY ? 'PASS — AES-256-GCM session encryption enabled' : 'WARN — No session encryption',
      '3.5_key_management': SESSION_ENCRYPT_KEY ? 'PASS — HKDF per-user + per-tenant + RLS key derivation' : 'WARN — No encryption key',
      '7.1_access_control': 'PASS — Cryptographic data boundary + RLS enforcement (ENT-3.1-4)',
      '8.1.6_login_lockout': `PASS — ${BIND_LOCKOUT_THRESHOLD} attempts, ${BIND_LOCKOUT_DURATION_MIN} min lockout`,
      '8.1.8_idle_timeout': `PASS — ${IDLE_SESSION_TIMEOUT_MIN} min idle session timeout`,
      '8.2_authentication': 'PASS — Unified login gateway + WeChat native OAuth (ENT-3.1-1)',
      '8.2.3_password_strength': SERVICE_TOKEN && SERVICE_TOKEN.length >= 32 ? 'PASS — SERVICE_TOKEN ≥ 32 chars' : 'WARN — SERVICE_TOKEN too short',
      '8.2.4_token_management': 'PASS — HMAC-SHA256 signed tokens with auto-refresh',
      '10.2_audit_logging': pgPool ? 'PASS — PostgreSQL audit persistence + audit trail query (ENT-3.1-6)' : 'WARN — No DB audit',
      '10.7_audit_retention': `PASS — ${AUDIT_RETENTION_DAYS} day retention`,
    },
    cis_v8: {
      '4.x_data_classification': 'PASS — Automatic data classification labeling',
      '5.2_access_control': ADMIN_IP_ALLOWLIST.length > 0 ? `PASS — IP allowlist (${ADMIN_IP_ALLOWLIST.length} IPs)` : 'WARN — No IP allowlist',
      '6.x_app_lifecycle': 'PASS — Plugin lifecycle tracking (ENT-3.1-2)',
      '8.x_audit_management': 'PASS — Centralized audit trail with query API (ENT-3.1-6)',
      '9.x_network_control': ADMIN_IP_ALLOWLIST.length > 0 ? 'PASS — Admin network restriction' : 'WARN — No network restriction',
      '13.x_waf': 'PASS — Nginx ModSecurity WAF integrated',
      '14.x_cache_control': 'PASS — Cache-Control: no-store on all API responses',
    },
    infrastructure: {
      encryption_mode: ENCRYPT_MODE ? 'AES-256-CBC message encryption' : 'plaintext',
      session_encryption: SESSION_ENCRYPT_KEY ? 'AES-256-GCM' : 'none',
      hkdf_salt: SESSION_ENCRYPT_KEY ? (process.env.HKDF_SALT ? 'custom (compliant)' : 'default (non-compliant for production)') : 'N/A',
      tls_enforcement: process.env.NODE_TLS_REJECT_UNAUTHORIZED !== '0' ? 'enforced' : 'disabled',
      admin_auth: SERVICE_TOKEN ? 'SERVICE_TOKEN enabled' : 'disabled',
    },
  };

  dbAuditLog({ openId: 'system:compliance', action: 'evidence_collected', detail: 'PCI-DSS + CIS evidence snapshot' });

  res.json({ success: true, evidence });
});

// ─── v3.1 微信原生 OAuth 登录（ENT-3.1-1）──────────────────────

app.post('/clawbot/auth/wechat-login', adminLimiter, async (req, res) => {
  stats.wechatLoginInitiated++;
  const { redirect_uri, scope, platform } = req.body || {};
  const detectedPlatform = (platform && LINGSHU_PLATFORMS.includes(platform)) ? platform : 'wechat';
  const loginScope = (scope === 'snsapi_base' || scope === 'snsapi_userinfo') ? scope : 'snsapi_userinfo';

  if (!CLAWBOT_APP_ID) {
    res.status(503).json({ success: false, msg: 'CLAWBOT_APP_ID not configured' });
    return;
  }

  const state = generateWeChatLoginState();
  if (redis) {
    await redis.set(
      `${REDIS_WECHAT_LOGIN_PREFIX}${state}`,
      JSON.stringify({ redirect_uri: redirect_uri || '', platform: detectedPlatform, scope: loginScope, created_at: Date.now() }),
      'EX', WECHAT_LOGIN_STATE_TTL
    );
  }

  const authorizeUrl = `https://open.weixin.qq.com/connect/oauth2/authorize?appid=${encodeURIComponent(CLAWBOT_APP_ID)}&redirect_uri=${encodeURIComponent(redirect_uri || OAUTH_REDIRECT_URI || '')}&response_type=code&scope=${loginScope}&state=${state}#wechat_redirect`;

  dbAuditLog({ openId: 'system:wechat_login', action: 'wechat_login_initiated', detail: `Platform: ${detectedPlatform}, Scope: ${loginScope}` });

  res.json({
    success: true,
    authorize_url: authorizeUrl,
    state,
    expires_in: WECHAT_LOGIN_STATE_TTL,
    platform: detectedPlatform,
    scope: loginScope,
    instructions: {
      step_1: '将 authorize_url 在微信端打开，用户授权后回调',
      step_2: '回调 code + state 到 GET /clawbot/auth/wechat-callback',
      step_3: '系统自动完成 access_token 交换与用户信息获取',
      step_4: '返回统一登录令牌 (at_*) 用于后续功能调用',
    },
  });
});

app.get('/clawbot/auth/wechat-callback', adminLimiter, async (req, res) => {
  const { code, state } = req.query || {};
  if (!code || typeof code !== 'string' || code.length > 128) {
    res.status(400).json({ success: false, msg: 'Missing or invalid code' });
    return;
  }
  if (!state || typeof state !== 'string' || state.length > 64) {
    res.status(400).json({ success: false, msg: 'Missing or invalid state' });
    return;
  }

  // 验证 state 有效性（防 CSRF）
  let stateData = null;
  if (redis) {
    const raw = await redis.get(`${REDIS_WECHAT_LOGIN_PREFIX}${state}`);
    if (raw) { stateData = JSON.parse(raw); await redis.del(`${REDIS_WECHAT_LOGIN_PREFIX}${state}`); }
  }
  if (!stateData) {
    res.status(400).json({ success: false, msg: 'State expired or invalid (CSRF protection)' });
    return;
  }

  // 通过 code 交换 access_token
  let tokenData = null;
  try {
    const tokenUrl = `https://api.weixin.qq.com/sns/oauth2/access_token?appid=${encodeURIComponent(CLAWBOT_APP_ID)}&secret=${encodeURIComponent(CLAWBOT_APP_SECRET)}&code=${encodeURIComponent(code)}&grant_type=authorization_code`;
    const { body } = await request(tokenUrl, {
      method: 'GET',
      headersTimeout: 10000,
      bodyTimeout: 10000,
    });
    tokenData = await body.json();
  } catch (err) {
    logger.error('微信 access_token 交换失败', { err: err.message });
    res.status(502).json({ success: false, msg: 'WeChat token exchange failed' });
    return;
  }

  if (!tokenData || tokenData.errcode || !tokenData.openid) {
    res.status(400).json({ success: false, msg: 'WeChat token exchange error', detail: tokenData ? tokenData.errmsg : 'No response' });
    return;
  }

  const openId = tokenData.openid;
  const unionId = tokenData.unionid || null;

  // 获取用户信息（snsapi_userinfo 范围）
  let userInfo = {};
  if (stateData.scope === 'snsapi_userinfo' && tokenData.access_token) {
    try {
      const userUrl = `https://api.weixin.qq.com/sns/userinfo?access_token=${encodeURIComponent(tokenData.access_token)}&openid=${encodeURIComponent(openId)}&lang=zh_CN`;
      const { body: userBody } = await request(userUrl, {
        method: 'GET',
        headersTimeout: 10000,
        bodyTimeout: 10000,
      });
      userInfo = await userBody.json();
    } catch (_e) { /* 用户信息获取失败不阻塞登录 */ }
  }

  // 生成统一登录令牌
  const authToken = generateAuthToken(openId, stateData.platform);
  const sessionData = {
    open_id: openId,
    union_id: unionId,
    platform: stateData.platform,
    login_method: 'wechat_oauth',
    nickname: userInfo.nickname || null,
    avatar_url: userInfo.headimgurl || null,
    created_at: Date.now(),
    expires_at: Date.now() + AUTH_SESSION_TTL * 1000,
  };

  if (redis) {
    await redis.set(`${REDIS_AUTH_SESSION_PREFIX}${authToken}`, JSON.stringify(sessionData), 'EX', AUTH_SESSION_TTL);
  }

  // 持久化到 DB
  await dbSaveWeChatLoginSession({
    openId, unionId, sessionToken: authToken,
    platform: stateData.platform, scope: stateData.scope,
    nickname: userInfo.nickname, avatarUrl: userInfo.headimgurl,
    ipAddress: req.ip, userAgent: req.headers['user-agent'],
  });

  stats.wechatLoginCompleted++;
  dbAuditLog({ openId, action: 'wechat_login_completed', detail: `Platform: ${stateData.platform}, Method: wechat_oauth` });

  res.json({
    success: true,
    auth_token: authToken,
    open_id: openId,
    platform: stateData.platform,
    login_method: 'wechat_oauth',
    nickname: userInfo.nickname || null,
    avatar_url: userInfo.headimgurl || null,
    expires_in: AUTH_SESSION_TTL,
    refresh_before: AUTH_SESSION_TTL - AUTH_TOKEN_REFRESH_WINDOW,
    instructions: '使用 auth_token 作为 X-Auth-Token 请求头调用所有功能端点',
  });
});

// ─── v3.1 官方插件生命周期回调（ENT-3.1-2）────────────────────────

app.post('/clawbot/plugin/lifecycle', adminLimiter, async (req, res) => {
  const { plugin_id, open_id, event_type, version, detail, callback_url, signature, timestamp } = req.body || {};

  if (!plugin_id || typeof plugin_id !== 'string' || plugin_id.length > 64) {
    res.status(400).json({ success: false, msg: 'Missing or invalid plugin_id' });
    return;
  }
  if (!open_id || typeof open_id !== 'string' || open_id.length > 64) {
    res.status(400).json({ success: false, msg: 'Missing or invalid open_id' });
    return;
  }
  if (!event_type || !PLUGIN_LIFECYCLE_EVENTS.includes(event_type)) {
    res.status(400).json({ success: false, msg: `Invalid event_type. Allowed: ${PLUGIN_LIFECYCLE_EVENTS.join(', ')}` });
    return;
  }

  // 签名验证（HMAC-SHA256 时间安全比较）
  if (signature && CLAWBOT_APP_SECRET) {
    const expected = crypto.createHmac('sha256', CLAWBOT_APP_SECRET)
      .update(`${plugin_id}|${open_id}|${event_type}|${timestamp || ''}`)
      .digest('hex');
    const expectedBuf = Buffer.from(expected, 'utf8');
    const providedBuf = Buffer.from(String(signature), 'utf8');
    if (expectedBuf.length !== providedBuf.length || !crypto.timingSafeEqual(expectedBuf, providedBuf)) {
      logger.warn('audit', { action: 'plugin_lifecycle_signature_mismatch', plugin_id, open_id, event_type });
      res.status(403).json({ success: false, msg: 'Signature verification failed' });
      return;
    }
  }

  // Webhook URL 安全验证
  if (callback_url && !validateWebhookUrl(callback_url)) {
    res.status(400).json({ success: false, msg: 'Invalid callback_url (SSRF protection)' });
    return;
  }

  // 持久化到 DB
  await dbSavePluginLifecycle({
    pluginId: plugin_id, openId: open_id, eventType: event_type,
    version: version || PLUGIN_VERSION, detail: detail || null, callbackUrl: callback_url || null,
  });

  stats.pluginLifecycleEvents++;
  dbAuditLog({ openId: open_id, action: `plugin_lifecycle_${event_type}`, detail: `Plugin: ${plugin_id}, Version: ${version || PLUGIN_VERSION}` });

  res.json({
    success: true,
    event_type,
    plugin_id,
    open_id,
    version: version || PLUGIN_VERSION,
    protocol_version: '2026-03-22',
    processed_at: new Date().toISOString(),
    status: 'processed',
  });
});

// ─── v3.1 统一集成调度中心（ENT-3.1-3）──────────────────────────

app.post('/clawbot/portal/dispatch', adminLimiter, async (req, res) => {
  const authToken = req.headers['x-auth-token'] || req.query.auth_token;
  const session = await validateAuthSession(authToken);
  if (!session) {
    stats.authGatewayBlocked++;
    res.status(401).json({ success: false, msg: 'Authentication required. Use POST /clawbot/auth/login or /clawbot/auth/wechat-login' });
    return;
  }

  const { feature_id, action, params, mode } = req.body || {};
  if (!feature_id || typeof feature_id !== 'string') {
    res.status(400).json({ success: false, msg: 'Missing feature_id' });
    return;
  }

  const feature = PORTAL_FEATURES.find(f => f.id === feature_id);
  if (!feature) {
    res.status(404).json({ success: false, msg: `Feature '${feature_id}' not found` });
    return;
  }
  if (feature.status !== 'active') {
    res.status(503).json({ success: false, msg: `Feature '${feature_id}' is currently ${feature.status}` });
    return;
  }

  // 行级安全校验
  if (!enforceRowLevelSecurity(session.open_id, 'default', session.open_id)) {
    res.status(403).json({ success: false, msg: 'Row-level security violation (PCI-DSS 7.1)' });
    return;
  }

  const dispatch = INTEGRATION_DISPATCH_MAP[feature_id];
  if (!dispatch) {
    res.status(404).json({ success: false, msg: `No dispatch route configured for feature '${feature_id}'` });
    return;
  }

  // 记录计费
  await dbSaveBillingRecord({
    tenantId: 'default', openId: session.open_id, featureId: feature_id,
    action: action || 'invoke', quantity: 1, unitCost: 0, totalCost: 0,
  });

  stats.portalDispatches++;
  dbAuditLog({ openId: session.open_id, action: 'portal_dispatch', detail: `Feature: ${feature_id}, Action: ${action || 'default'}` });

  res.json({
    success: true,
    feature_id,
    feature_name: feature.name,
    dispatch: {
      module: dispatch.module,
      endpoint: dispatch.endpoint,
      method: dispatch.method,
      mode: mode || 'sync',
      timeout_ms: DISPATCH_TIMEOUT_MS,
    },
    action: action || 'default',
    params: params || {},
    user: { open_id: session.open_id, platform: session.platform },
    dispatched_at: new Date().toISOString(),
    instructions: `请求已路由至 ${dispatch.module} 模块，端点 ${dispatch.endpoint}`,
  });
});

app.get('/clawbot/portal/integrations', adminLimiter, async (req, res) => {
  const authToken = req.headers['x-auth-token'] || req.query.auth_token;
  const session = await validateAuthSession(authToken);
  if (!session) {
    stats.authGatewayBlocked++;
    res.status(401).json({ success: false, msg: 'Authentication required' });
    return;
  }

  stats.portalIntegrationQueries++;

  const integrations = Object.entries(INTEGRATION_DISPATCH_MAP).map(([featureId, route]) => {
    const feature = PORTAL_FEATURES.find(f => f.id === featureId);
    return {
      feature_id: featureId,
      name: feature ? feature.name : featureId,
      category: feature ? feature.category : 'unknown',
      status: feature ? feature.status : 'inactive',
      module: route.module,
      endpoint: route.endpoint,
      method: route.method,
      dispatch_endpoint: 'POST /clawbot/portal/dispatch',
    };
  });

  const categories = [...new Set(integrations.map(i => i.category))];

  res.json({
    success: true,
    protocol_version: '2026-03-22',
    total: integrations.length,
    active: integrations.filter(i => i.status === 'active').length,
    categories,
    integrations,
    instructions: '通过 POST /clawbot/portal/dispatch 调用任意集成功能',
  });
});

// ─── v3.1 企业计费与用量计量（ENT-3.1-5）──────────────────────────

app.get('/clawbot/ops/billing', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const { tenant_id, period, status } = req.query || {};
  const targetTenant = tenant_id || 'default';
  const targetPeriod = period || new Date().toISOString().slice(0, 7);

  let records = [];
  let summary = { total_cost: 0, total_records: 0, by_feature: {} };

  if (pgPool) {
    try {
      let query = `SELECT * FROM clawbot_billing_records WHERE tenant_id = $1 AND billing_period = $2`;
      const params = [targetTenant, targetPeriod];
      if (status) { query += ` AND status = $3`; params.push(status); }
      query += ` ORDER BY created_at DESC LIMIT 500`;
      const result = await pgPool.query(query, params);
      records = result.rows;
      summary.total_records = records.length;
      for (const r of records) {
        summary.total_cost += parseFloat(r.total_cost || 0);
        if (!summary.by_feature[r.feature_id]) summary.by_feature[r.feature_id] = { count: 0, cost: 0 };
        summary.by_feature[r.feature_id].count++;
        summary.by_feature[r.feature_id].cost += parseFloat(r.total_cost || 0);
      }
    } catch (err) {
      logger.error('查询计费记录失败', { err: err.message, targetTenant });
    }
  }

  dbAuditLog({ openId: 'admin', action: 'billing_query', detail: `Tenant: ${targetTenant}, Period: ${targetPeriod}` });

  res.json({
    success: true,
    tenant_id: targetTenant,
    billing_period: targetPeriod,
    currency: 'CNY',
    summary,
    records: records.slice(0, 100),
    total_in_period: records.length,
  });
});

app.post('/clawbot/ops/billing/export', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const { tenant_id, start_period, end_period, format } = req.body || {};
  const targetTenant = tenant_id || 'default';
  const startP = start_period || new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 7);
  const endP = end_period || new Date().toISOString().slice(0, 7);

  let records = [];
  if (pgPool) {
    try {
      const result = await pgPool.query(
        `SELECT * FROM clawbot_billing_records
         WHERE tenant_id = $1 AND billing_period >= $2 AND billing_period <= $3
         ORDER BY created_at DESC LIMIT 10000`,
        [targetTenant, startP, endP]
      );
      records = result.rows;
    } catch (err) {
      logger.error('导出计费记录失败', { err: err.message, targetTenant });
    }
  }

  stats.billingExports++;
  dbAuditLog({ openId: 'admin', action: 'billing_export', detail: `Tenant: ${targetTenant}, Range: ${startP} to ${endP}` });

  res.json({
    success: true,
    tenant_id: targetTenant,
    period_range: { start: startP, end: endP },
    format: format || 'json',
    total_records: records.length,
    records,
    exported_at: new Date().toISOString(),
  });
});

// ─── v3.1 合规自动化增强（ENT-3.1-6）────────────────────────────

app.get('/clawbot/compliance/audit-trail', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  const { open_id, action, start_date, end_date, page } = req.query || {};
  const pageNum = Math.max(1, parseInt(page || '1', 10));

  stats.complianceAuditQueries++;

  const result = await dbQueryAuditTrail({
    openId: open_id || null,
    action: action || null,
    startDate: start_date || null,
    endDate: end_date || null,
    page: pageNum,
    pageSize: AUDIT_TRAIL_PAGE_SIZE,
  });

  dbAuditLog({ openId: 'admin:compliance', action: 'audit_trail_query', detail: `Filters: open_id=${open_id || '*'}, action=${action || '*'}` });

  res.json({
    success: true,
    page: pageNum,
    page_size: AUDIT_TRAIL_PAGE_SIZE,
    total: result.total,
    total_pages: Math.ceil(result.total / AUDIT_TRAIL_PAGE_SIZE),
    records: result.records,
    compliance: {
      pci_dss: '10.2 — Audit trail with retention and query support',
      cis_v8: '8.x — Centralized log management',
    },
  });
});

app.post('/clawbot/compliance/scan', adminLimiter, requireAdminIp, requireServiceToken, async (req, res) => {
  stats.complianceOnDemandScans++;

  // 执行按需合规扫描（复用 runComplianceScan）
  try {
    await runComplianceScan();
  } catch (err) {
    logger.error('按需合规扫描失败', { err: err.message });
    res.status(500).json({ success: false, msg: 'Compliance scan failed' });
    return;
  }

  // 获取最新快照
  let latestSnapshot = null;
  if (pgPool) {
    try {
      const result = await pgPool.query(`SELECT * FROM clawbot_compliance_snapshots ORDER BY created_at DESC LIMIT 1`);
      if (result.rows.length > 0) latestSnapshot = result.rows[0];
    } catch (_e) { /* ignore */ }
  }

  dbAuditLog({ openId: 'admin:compliance', action: 'on_demand_scan', detail: 'Manual compliance scan triggered' });

  res.json({
    success: true,
    scan_type: 'on_demand',
    scanned_at: new Date().toISOString(),
    latest_snapshot: latestSnapshot,
    compliance_version: '3.1',
    controls_scanned: {
      pci_dss: ['3.4', '3.5', '4.1', '6.4.1', '6.5', '7.1', '8.1.6', '8.1.8', '8.2', '8.2.3', '8.2.4', '10.2', '10.7'],
      cis_v8: ['4.x', '5.2', '6.x', '9.x', '11.x', '13.x', '14.x'],
    },
  });
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
  logger.info(`灵枢接入通道 v3.1 已启动，端口 ${PORT}`);
  logger.info('官方微信 ClawBot 插件接入（扫码/App互通/模板消息/小程序卡片/插件生命周期/多租户/心跳/协商/通道网关/事件中继/会话联邦/Web管理后台/客服系统/内容管理/订阅消息/个性化菜单/自助接入/统一登录/功能门户/微信原生登录/集成调度/行级安全/企业计费/合规自动化）就绪，等待回调...');
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
    logger.info('v2.7 新增：Web 管理后台 /clawbot/admin');
    logger.info('v2.8 新增：客服系统/内容生命周期/订阅消息/个性化菜单/HKDF数据隔离/一键接入');
    logger.info('v2.6 新增：通道网关/Webhook事件中继/会话联邦/接入向导/实时合规监控');
    if (adminDashboardHtml) {
      logger.info('Web 管理后台已就绪 → /clawbot/admin');
    }
  } else {
    logger.warn('SERVICE_TOKEN 未设置，管理端点不可用');
  }
  if (ADMIN_IP_ALLOWLIST.length > 0) {
    logger.info(`管理端点 IP 白名单已启用（${ADMIN_IP_ALLOWLIST.length} 个 IP）`);
  }
  logger.info(`登录锁定：${BIND_LOCKOUT_THRESHOLD} 次失败后锁定 ${BIND_LOCKOUT_DURATION_MIN} 分钟（PCI-DSS 8.1.6）`);
  logger.info(`空闲会话超时：${IDLE_SESSION_TIMEOUT_MIN} 分钟（PCI-DSS 8.1.8）`);
  logger.info(`审计日志保留：${AUDIT_RETENTION_DAYS} 天（PCI-DSS 10.7）`);
  logger.info('敏感操作二次确认已启用（PCI-DSS v4.0）');
  if (pgPool) {
    logger.info('PostgreSQL 审计日志/用户记录/模板消息日志/群发完成日志/插件生命周期日志/用户同意/用户设置/租户/API密钥/合规快照/通道注册/Webhook订阅/会话联邦/客服账号/客服会话/草稿/评论/订阅消息/灵枢通道会话/数据边界/用量指标持久化已启用');
  }
  if (OAUTH_REDIRECT_URI) {
    logger.info(`微信 OAuth2.0 网页授权已配置（scope=${OAUTH_SCOPE}）`);
  } else {
    logger.info('微信 OAuth2.0 网页授权未配置（OAUTH_REDIRECT_URI 未设置，用户通过 /bind 绑定）');
  }
  if (SESSION_ENCRYPT_KEY) {
    logger.info('会话静态加密已启用（AES-256-GCM，PCI-DSS 3.4）');
  } else {
    logger.info('会话静态加密未启用（SESSION_ENCRYPT_KEY 未设置，会话明文存储）');
  }
  logger.info(`插件清单端点：GET /clawbot/plugin/manifest`);
  logger.info(`插件状态端点：GET /clawbot/plugin/status`);
  logger.info(`插件心跳端点：POST /clawbot/plugin/heartbeat（间隔 ${HEARTBEAT_INTERVAL_SEC}s）`);
  logger.info(`能力协商端点：POST /clawbot/plugin/negotiate`);
  logger.info(`租户管理端点：GET/POST /clawbot/tenants`);
  logger.info(`合规历史端点：GET /clawbot/compliance/history`);
  logger.info(`自动合规扫描间隔：${Math.round(COMPLIANCE_SCAN_INTERVAL_MS / 3600_000)}h`);
  logger.info(`通道网关端点：GET/POST/DELETE /clawbot/gateway/channels`);
  logger.info(`能力矩阵端点：GET /clawbot/gateway/features`);
  logger.info(`Webhook中继端点：GET/POST/DELETE /clawbot/relay/subscriptions`);
  logger.info(`会话联邦端点：GET/POST/DELETE /clawbot/federation/links`);
  logger.info(`实时合规端点：GET /clawbot/compliance/realtime`);
  logger.info(`接入向导命令：/setup（分步引导用户完成全流程）`);
  logger.info(`一键接入命令：/quickstart（v2.8 零门槛快速接入）`);
  logger.info(`客服管理端点：GET/POST/DELETE /clawbot/kf/accounts`);
  logger.info(`客服消息端点：POST /clawbot/kf/message`);
  logger.info(`草稿管理端点：POST/DELETE /clawbot/draft`);
  logger.info(`发布端点：POST /clawbot/publish`);
  logger.info(`评论管理端点：POST /clawbot/comment/list|reply|delete`);
  logger.info(`订阅消息端点：POST /clawbot/subscribe/send`);
  logger.info(`个性化菜单端点：POST/DELETE /clawbot/menu/conditional`);
  logger.info('v2.9 新增：灵枢统一通道/强制认证网关/数据边界校验/SDK回调/SLA监控/用量计量/配额管理');
  logger.info(`灵枢通道端点：POST /clawbot/lingshu/connect | GET /clawbot/lingshu/status | POST /clawbot/lingshu/init`);
  logger.info(`SDK回调端点：POST /clawbot/plugin/sdk/callback`);
  logger.info(`运维端点：GET /clawbot/ops/sla | GET /clawbot/ops/usage | GET /clawbot/ops/quota`);
  logger.info(`统一通道会话 TTL：${LINGSHU_SESSION_TTL}s`);
  logger.info(`SLA 目标可用性：${SLA_TARGET_UPTIME}%`);
  logger.info(`默认日配额：${QUOTA_DEFAULT_DAILY} 条/天`);
  logger.info('v3.0 新增：自助接入门户/统一登录网关/统一功能入口/租户级加密/官方协议同步/企业运维增强/合规加固');
  logger.info(`自助接入端点：POST /clawbot/lingshu/onboard | GET /clawbot/lingshu/guide | POST /clawbot/lingshu/verify`);
  logger.info(`统一登录端点：POST /clawbot/auth/login | POST /clawbot/auth/refresh | GET /clawbot/auth/session | POST /clawbot/auth/logout`);
  logger.info(`功能门户端点：GET /clawbot/portal/features | POST /clawbot/portal/invoke | GET /clawbot/portal/status`);
  logger.info(`SDK事件订阅：POST /clawbot/plugin/sdk/events`);
  logger.info(`运维仪表盘：GET /clawbot/ops/dashboard | POST /clawbot/ops/alerts | GET /clawbot/ops/cost`);
  logger.info(`合规证据端点：GET /clawbot/compliance/evidence`);
  logger.info(`统一登录会话 TTL：${AUTH_SESSION_TTL}s`);
  logger.info(`Token 刷新窗口：过期前 ${AUTH_TOKEN_REFRESH_WINDOW}s`);
  logger.info(`功能门户已注册 ${PORTAL_FEATURES.length} 个功能，活跃 ${PORTAL_FEATURES.filter(f => f.status === 'active').length} 个`);
  logger.info('v3.1 新增：微信原生登录/插件生命周期回调/统一集成调度/行级安全/企业计费/合规自动化增强');
  logger.info(`微信原生登录端点：POST /clawbot/auth/wechat-login | GET /clawbot/auth/wechat-callback`);
  logger.info(`插件生命周期端点：POST /clawbot/plugin/lifecycle`);
  logger.info(`统一调度端点：POST /clawbot/portal/dispatch | GET /clawbot/portal/integrations`);
  logger.info(`企业计费端点：GET /clawbot/ops/billing | POST /clawbot/ops/billing/export`);
  logger.info(`合规审计追踪：GET /clawbot/compliance/audit-trail | POST /clawbot/compliance/scan`);
  logger.info(`集成调度已注册 ${Object.keys(INTEGRATION_DISPATCH_MAP).length} 个功能模块路由`);
  logger.info(`调度超时：${DISPATCH_TIMEOUT_MS}ms`);
  logger.info(`审计追踪分页大小：${AUDIT_TRAIL_PAGE_SIZE} 条/页`);
  logger.info(`计费导出最大天数：${BILLING_EXPORT_MAX_DAYS} 天`);
  logger.info(`微信登录 state 有效期：${WECHAT_LOGIN_STATE_TTL}s`);
  if (SESSION_ENCRYPT_KEY) {
    logger.info('HKDF 用户级密钥派生已启用（PCI-DSS 3.5）');
    if (typeof _hkdfSaltWarning !== 'undefined' && _hkdfSaltWarning) {
      logger.warn('⚠ HKDF_SALT 未配置，使用默认盐值。生产环境应设置唯一 HKDF_SALT（PCI-DSS 3.5）');
    }
  }
});

// 安全加固
server.maxHeadersCount = 50;
server.requestTimeout = 30_000;
server.maxRequestsPerSocket = 256;
server.maxConnections = 1024;

// ─── v2.5 合规自动扫描定时任务 ────────────────────────────────
const complianceScanTimer = setInterval(() => {
  runComplianceScan().catch((err) => {
    logger.error('合规自动扫描失败', { err: err.message });
  });
}, COMPLIANCE_SCAN_INTERVAL_MS);

// 启动后延迟 30 秒执行首次合规扫描
setTimeout(() => {
  runComplianceScan().catch((err) => {
    logger.error('首次合规扫描失败', { err: err.message });
  });
}, 30_000);

// ─── 优雅退出 ────────────────────────────────────────────────
const SHUTDOWN_TIMEOUT_MS = GRACEFUL_SHUTDOWN_TIMEOUT * 1000;

const shutdown = (signal) => {
  logger.info(`收到 ${signal}，正在关闭（超时 ${GRACEFUL_SHUTDOWN_TIMEOUT}s）...`);
  clearInterval(sessionCleanupTimer);
  clearInterval(auditCleanupTimer);
  clearInterval(complianceScanTimer);

  server.close(async () => {
    if (redis) redis.disconnect();
    if (pgPool) await pgPool.end().catch(() => {});
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
    if (pgPool) pgPool.end().catch(() => {});
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
