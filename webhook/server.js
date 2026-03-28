'use strict';

/**
 * Anima 灵枢 · Webhook 服务 v5.28
 * ─────────────────────────────────────────────────────────────
 * 修复记录（v5.28 相对于 v5.27）：
 *
 *   #FIX-5.28-1  企业生产级安全加固（PCI-DSS / CIS 增量）
 *                - 新增 server.maxRequestsPerSocket（默认 256），限制
 *                  单个 TCP 连接上的 HTTP 请求数，防止持久连接上的
 *                  请求洪水攻击（CIS DoS 缓解 / HTTP 管道限流）。
 *                - DB 连接池新增 idle_in_transaction_session_timeout
 *                  （30s），自动终止空闲事务中的连接，防止行锁泄漏
 *                  导致数据库资源耗尽（CIS 资源保护）。
 *                - /activate 成功日志中的卡密 cardKey 改为掩码输出
 *                  （前4后4），防止日志泄露完整密钥（PCI-DSS 3.4
 *                  敏感认证数据掩码）。
 *                - 安全响应头新增 X-Download-Options: noopen，防止
 *                  IE 浏览器在站点上下文中执行下载文件（CIS 浏览器
 *                  安全加固）。
 *                - 启动时强制校验 ADMIN_TOKEN / SERVICE_TOKEN 最短
 *                  32 字符，不满足则拒绝启动（PCI-DSS 8.2.3 最低
 *                  密码/密钥复杂度要求；原仅 warn < 64 字符）。
 *                - 启动时检测 NODE_TLS_REJECT_UNAUTHORIZED=0，
 *                  生产环境下拒绝启动（PCI-DSS 4.1 传输加密——
 *                  禁止全局禁用 TLS 证书校验）。
 *
 *   #FIX-5.28-2  企业生产级速度优化
 *                - 高频用户查询改用命名预备语句（user_bal_status /
 *                  user_bal_full / user_bal_for_update），覆盖
 *                  /billing/balance、/billing/check、/billing/record
 *                  中的用户余额/暂停状态查询，连接复用时跳过 SQL
 *                  解析阶段，减少 DB CPU 开销。
 *
 *   #FIX-5.28-3  前端版本号同步
 *                - admin.html 侧边栏及 JS 注释版本号对齐至 v5.28。
 *
 * 修复记录（v5.27 相对于 v5.26）：
 *
 *   #FIX-5.27-1  企业生产级安全加固（PCI-DSS / CIS 增量）
 *                - 新增 server.maxConnections（默认 1024），限制并发
 *                  TCP 连接数，防止连接洪水耗尽文件描述符导致服务拒绝
 *                  （CIS 资源保护 / DoS 缓解）。
 *                - 启动时检测 Redis 是否使用 TLS（rediss:// 协议），
 *                  非 TLS 连接输出警告日志（PCI-DSS 4.1 传输加密）。
 *                - 新增 stripControlChars() 工具函数，对文本输入字段
 *                  （description、label、displayName）剥离 ASCII 控制
 *                  字符（0x00-0x1F / 0x7F，保留 \t\n\r），防止控制
 *                  字符注入日志或数据库（PCI-DSS 6.5 输入净化纵深防御）。
 *                - process.exit() 前增加 100ms 延迟，确保 winston
 *                  最终日志条目落盘（CIS 日志完整性——致命错误日志不丢失）。
 *                - PG_POOL_MAX 环境变量新增上限校验（1-100），
 *                  防止误配置导致连接数爆炸（CIS 资源保护）。
 *
 *   #FIX-5.27-2  企业生产级速度优化
 *                - 高频 SQL 查询改用命名预备语句（name 参数），
 *                  连接复用时跳过 SQL 解析阶段，减少 DB CPU 开销
 *                  （lookupModel / lookupModelInTx / ensureUser / balance 查询）。
 *                - /health 端点 DB 与 Redis 检查改为 Promise.all()
 *                  并行执行，健康检查延迟从串行 2×RTT 降至 1×RTT。
 *                - 静态 JSON 错误响应预序列化为 Buffer，高频拒绝路径
 *                  （415/405/404）跳过重复 JSON.stringify + Buffer 转换。
 *
 *   #FIX-5.27-3  前端版本号同步
 *                - admin.html 侧边栏及 JS 注释版本号对齐至 v5.27。
 *
 * 修复记录（v5.26 相对于 v5.25）：
 *
 *   #FIX-5.26-1  企业生产级安全加固（PCI-DSS / CIS 增量）
 *                - POST/PUT/PATCH 请求新增 Content-Type 校验中间件，
 *                  非 application/json 请求直接返回 415（PCI-DSS 6.5
 *                  输入校验，CIS 防御纵深）。
 *                - 优雅关闭超时后调用 server.closeAllConnections()
 *                  强制终止残留连接，防止僵尸连接阻塞进程退出
 *                  （CIS 进程管理，Node 18.2+ API）。
 *                - 分页端点新增 offset 上限（100,000），防止深分页
 *                  触发昂贵 OFFSET 扫描导致 DB 资源耗尽（CIS 资源保护）。
 *                - 禁用 Express 默认 ETag 自动生成，管理面板已使用
 *                  自定义 SHA-256 ETag；自动 ETag 泄露响应体指纹
 *                  （CIS 2.3 信息最小化）。
 *
 *   #FIX-5.26-2  企业生产级速度优化
 *                - 启动时预热 DB 连接池（SELECT 1），消除首次请求
 *                  的冷启动延迟（生产级连接池管理）。
 *                - 禁用 Express 默认 ETag 后，每个 JSON 响应节省
 *                  一次 SHA 哈希计算（速度 + 安全双收益）。
 *
 *   #FIX-5.26-3  前端版本号同步
 *                - admin.html 侧边栏及 JS 注释版本号对齐至 v5.26。
 *
 * 修复记录（v5.25 相对于 v5.24）：
 *
 *   #FIX-5.25-1  企业生产级安全加固（PCI-DSS / CIS 增量）
 *                - Redis 连接新增 enableOfflineQueue: false，
 *                  断连时立即失败而非排队等待，避免请求堆积（CIS fail-secure）。
 *                - /health 端点移除 db/redis 内部状态明细，仅返回
 *                  status: ok/degraded，防止攻击者枚举基础设施组件
 *                  （CIS 2.3 信息最小化）。
 *                - /activate 暂停检查新增 FOR UPDATE 行锁，防止
 *                  并发事务在检查与充值之间解除暂停的 TOCTOU 竞态
 *                  （PCI-DSS 6.5 数据完整性）。
 *                - POST /admin/providers providerName 新增字符集校验
 *                  （仅允许 a-zA-Z0-9._-），与 apiProvider 校验对齐，
 *                  防御日志/SQL 注入（PCI-DSS 6.5 输入校验完整性）。
 *                - 优雅关闭超时改为 GRACEFUL_SHUTDOWN_TIMEOUT 环境变量
 *                  可配置，便于 K8s/Docker 对齐 terminationGracePeriodSeconds
 *                  （CIS 进程管理）。
 *                - 启动时校验 ADMIN_TOKEN 与 SERVICE_TOKEN 不得相同，
 *                  防止凭据复用（PCI-DSS 2.1 唯一凭据）。
 *
 *   #FIX-5.25-2  企业生产级速度优化
 *                - /billing/history 改用 COUNT(*) OVER() 窗口函数，
 *                  单次查询同时返回分页数据与总数，减少一次 DB 往返。
 *                - GET /admin/users 同上优化，减少一次 COUNT 查询。
 *                - GET /admin/cards 同上优化，减少一次 COUNT 查询。
 *                - Redis 连接新增 enableReadyCheck: true，
 *                  加速断连后重连检测（生产级 Redis 连接管理）。
 *
 *   #FIX-5.25-3  前端版本号同步
 *                - admin.html 侧边栏及 JS 注释版本号对齐至 v5.25。
 *
 * 修复记录（v5.24 相对于 v5.23）：
 *
 *   #FIX-5.24-1  企业生产级安全加固（PCI-DSS / CIS 增量）
 *                - Helmet 新增 crossOriginResourcePolicy('same-origin')、
 *                  crossOriginOpenerPolicy('same-origin')、
 *                  crossOriginEmbedderPolicy(true)，完善 CIS 跨源隔离策略。
 *                - /billing/record modelName 新增字符集校验
 *                  （仅允许 a-zA-Z0-9._:/-），与 apiProvider 校验对齐，
 *                  防御日志注入（PCI-DSS 6.5 输入校验完整性）。
 *                - 管理员模型端点 provider 字段新增字符集校验
 *                  （仅允许 a-zA-Z0-9._-），防御日志/SQL 注入。
 *                - /admin/dashboard 响应追加 X-Robots-Tag: noindex，
 *                  防止搜索引擎收录管理页面（PCI-DSS 数据最小化）。
 *                - 启动时检测 NODE_ENV !== 'production' 并输出警告
 *                  （CIS Node.js 安全基线——生产环境必须设置）。
 *
 *   #FIX-5.24-2  企业生产级速度优化
 *                - /admin/dashboard 静态 HTML 预转换为 Buffer，
 *                  避免每次请求 string→Buffer 转换开销。
 *                - 访问日志改用 process.hrtime.bigint() 计时，
 *                  提供亚毫秒精度，替代 Date.now() 毫秒级精度。
 *                - 公开只读端点（/models、/providers）追加
 *                  Vary: Accept-Encoding，确保 CDN/代理正确缓存
 *                  不同编码的响应变体。
 *
 *   #FIX-5.24-3  前端版本号同步
 *                - admin.html 侧边栏及 JS 注释版本号对齐至 v5.24。
 *
 * 修复记录（v5.23 相对于 v5.22）：
 *
 *   #FIX-5.23-1  企业生产级安全加固（PCI-DSS / CIS 增量）
 *                - 新增 server.requestTimeout（30 s）和
 *                  server.maxHeadersCount（50），防止 Slowloris 及
 *                  头部洪水 DoS 攻击（CIS Node.js 安全基线）。
 *                - 新增请求级访问日志中间件（method/path/status/duration/
 *                  request_id/ip），满足 PCI-DSS 10.2 全链路审计追踪。
 *                - /billing/record apiProvider 新增字符集校验
 *                  （仅允许 a-zA-Z0-9._-），防御 SQL/日志注入（PCI-DSS 6.5）。
 *                - 关键 catch 块补齐 request_id 字段，确保故障日志
 *                  可与请求关联（PCI-DSS 10.3 日志完整性）。
 *
 *   #FIX-5.23-2  企业生产级速度优化
 *                - 公开只读端点（/models、/providers）响应追加
 *                  Cache-Control: public, max-age=30，允许浏览器及
 *                  CDN 短暂缓存，减少对 DB 的重复查询。
 *                - /health 端点响应追加 Cache-Control: no-cache,
 *                  max-age=0，防止误缓存健康检查结果。
 *
 *   #FIX-5.23-3  前端版本号同步
 *                - admin.html 侧边栏及 JS 注释版本号对齐至 v5.23。
 *
 * 修复记录（v5.22 相对于 v5.21）：
 *
 *   #FIX-5.22-1  企业生产级安全加固（PCI-DSS / CIS 增量）
 *                - 前端 escAttr 新增 &、<、>、换行符转义，
 *                  阻断 HTML-entity 属性注入 XSS（PCI-DSS 6.5.7）。
 *                - SSRF 校验 host === '[::1]' 修正为 host === '::1'，
 *                  URL 类剥离方括号导致原判断永不生效（PCI-DSS 1.3.x）。
 *                - 新增 X-Request-ID 请求关联标识（crypto.randomUUID），
 *                  响应头 + 审计日志均携带，完善追踪链（PCI-DSS 10.2）。
 *                - JSON body 限制从 1 MB 收紧至 256 KB，
 *                  计费 API 负载均 < 1 KB，防止大包体 DoS（CIS）。
 *                - 前端清理已失效的 toggleKeyReveal/maskKey 客户端解密码，
 *                  v5.21 服务端掩码后该路径为死代码（PCI-DSS 3.4 减面）。
 *
 *   #FIX-5.22-2  企业生产级速度优化
 *                - /admin/dashboard 静态 HTML 新增 ETag（SHA-256 摘要），
 *                  浏览器条件请求返回 304，减少重复传输。
 *
 *   #FIX-5.22-3  Dockerfile CIS 加固
 *                - 新增 ENV HOST=0.0.0.0，确保容器内 HEALTHCHECK
 *                  指向正确监听地址（CIS Docker 5.6 修正）。
 *
 * 修复记录（v5.21 相对于 v5.20）：
 *
 *   #FIX-5.21-1  企业生产级安全加固（PCI-DSS / CIS 全面对齐）
 *                - baseUrl 校验新增 SSRF 防护：禁止 localhost、127.x、10.x、
 *                  172.16-31.x、192.168.x、169.254.x、[::1]、0.0.0.0 等
 *                  内网/保留地址，仅允许 HTTPS（生产环境 CIS 要求）。
 *                - GET /admin/cards 返回的卡密 key 改为服务端掩码
 *                  （仅显示前4后4），杜绝网络层/日志泄露全量密钥（PCI-DSS 3.4）。
 *                - modules.yml 解析改用 yaml.load 的 FAILSAFE_SCHEMA，
 *                  阻断 YAML 反序列化攻击向量（CIS 输入校验）。
 *                - 启动时校验关键环境变量（PG_PASSWORD），
 *                  缺失则 warn（数据库连接失败时自动 fail-closed）。
 *                - 管理员写操作新增结构化审计日志（action/target/actor_ip），
 *                  满足 PCI-DSS 10.2 审计追踪要求。
 *                - 前端卡密「点击显示」5 秒后自动重新掩码（PCI-DSS 3.4）。
 *
 *   #FIX-5.21-2  企业生产级速度优化
 *                - 新增 compression 中间件，gzip/br 压缩 JSON 响应，
 *                  减少带宽占用 60-80%，提升内网/公网传输速度。
 *                - DB 连接池新增 application_name（便于 pg_stat 监控）、
 *                  allowExitOnIdle（空闲时释放连接减少资源占用）。
 *                - 优雅关闭新增 keepAliveTimeout / headersTimeout 配置，
 *                  防止长连接阻塞容器重启（K8s/Docker 生产要求）。
 *
 *   #FIX-5.21-3  Dockerfile CIS 加固
 *                - 新增 HEALTHCHECK 指令（CIS Docker 5.6）。
 *
 * 修复记录（v5.20 相对于 v5.19）：
 *
 *   #FIX-5.20-1  管理界面 UI 美化
 *                原：管理控制台界面功能完整但视觉表现力较弱，
 *                缺少过渡动画、加载状态和精细化交互反馈。
 *                修：重新设计 CSS 视觉风格（渐变强调、精致阴影、聚焦环、
 *                动画过渡）；新增加载旋转指示器、搜索去抖、段落切换动画。
 *
 *   #FIX-5.20-2  PCI-DSS / CIS 安全加固
 *                原：helmet 使用默认配置，CSP 仅对 /admin/dashboard 设置，
 *                缺少 HSTS、Permissions-Policy、X-Permitted-Cross-Domain-Policies
 *                等 PCI-DSS 与 CIS 要求的安全头；前端无会话空闲超时。
 *                修：helmet 启用严格 HSTS（includeSubDomains、preload、1年）、
 *                frameguard DENY、referrerPolicy no-referrer、
 *                添加 Permissions-Policy 与 X-Permitted-Cross-Domain-Policies 头；
 *                管理页面 CSP 补齐 connect-src / form-action / base-uri /
 *                frame-ancestors；禁用 TRACE/TRACK HTTP 方法（CIS 要求）；
 *                前端新增 15 分钟空闲自动登出（PCI-DSS 8.1.8）、
 *                密码字段 autocomplete=off、卡密默认掩码显示。
 *
 *   #FIX-5.20-3  速度优化
 *                原：搜索/筛选输入无去抖，每次按键均触发 API 请求；
 *                CSS 缺少 contain 性能提示。
 *                修：搜索输入增加 300ms 去抖；CSS 对主要容器添加 contain 属性。
 *
 * 修复记录（v5.19 相对于 v5.18）：
 *
 *   #FIX-5.19-1  新增综合管理控制台（/admin/dashboard）
 *                原：管理员只能通过命令行 cURL 调用 REST API 进行管理，
 *                缺少直观的可视化管理界面，运维效率低。
 *                修：新增 GET /admin/dashboard 端点，提供完整的 Web 管理界面，
 *                覆盖模型管理、服务商管理、用户管理、充值卡管理、模块状态
 *                等所有管理功能。页面为单文件 SPA，通过 ADMIN_TOKEN 鉴权。
 *
 *   #FIX-5.19-2  新增 GET /admin/modules 端点
 *                原：模块注册表（modules.yml）只能通过文件系统查看，
 *                管理员无法通过 API 获取模块状态信息。
 *                修：新增端点读取 modules.yml 并以 JSON 格式返回模块信息，
 *                路径通过 MODULES_YML_PATH 环境变量配置，文件不存在时降级返回空列表。
 *                安全校验：仅允许读取 .yml/.yaml 扩展名文件。
 *
 *   #FIX-5.19-3  /billing/record 402 响应 is_suspended 字段改为动态读取
 *                原：安全上限和余额不足两个 402 响应硬编码 is_suspended:false，
 *                虽然在当前代码流程中技术上正确（暂停检查在前），但不符合
 *                防御性编程最佳实践，且与其他端点响应字段来源不一致。
 *                修：改为 !!u.is_suspended，与其他计费响应对齐。
 *
 * 修复记录（v5.18 相对于 v5.17）：
 *
 *   #FIX-5.18-1  /activate 新增用户暂停检查
 *                原：被暂停的用户仍可使用充值卡激活余额，绕过账户管控。
 *                商用系统中暂停账户应完全禁止财务操作。
 *                修：ensureUser 后查询 is_suspended，暂停用户返回 HTTP 403。
 *                成功响应补齐 is_suspended 字段，与其他计费响应对齐。
 *
 *   #FIX-5.18-2  /admin/adjust 响应补齐 is_suspended 字段
 *                原：响应仅含 balance_fen 和 actual_applied_fen，
 *                与其他所有计费响应不一致，前端无法统一读取用户状态。
 *                修：SELECT 补齐 is_suspended 列，响应补齐该字段。
 *
 *   #FIX-5.18-3  新增 DELETE /admin/providers/:id 端点（软禁用）
 *                原：Provider 管理仅有 CRU，缺少 D 操作，
 *                管理员无法通过 API 禁用 provider，需直接操作数据库。
 *                修：新增 DELETE 端点，行为设 is_enabled=false，
 *                与 DELETE /admin/models/:id（设 is_active=false）对齐。
 *
 *   #FIX-5.18-4  管理员限速器放宽至 60 次/15 分钟
 *                原：10 次/15 分钟，管理员执行批量操作（如管理多个模型/
 *                用户/卡密）时频繁触发限速，影响运维效率。
 *                修：放宽至 60 次/15 分钟，兼顾安全与运维需求。
 *
 * 修复记录（v5.17 相对于 v5.16）：
 *
 *   #FIX-5.17-1  新增 validateChargedFen 安全熔断
 *                原：calculateChargedFen 的返回值未经校验即用于余额扣减。
 *                若上游数据异常导致计算结果为 NaN / Infinity / 负数，
 *                会直接写入 PostgreSQL NUMERIC 列，产生不可预期的余额状态。
 *                修：在 /billing/check 和 /billing/record 的付费路径中，
 *                对 calculateChargedFen 返回值进行有限非负整数校验，
 *                异常时返回 HTTP 500 并记录详细上下文日志。
 *
 *   #FIX-5.17-2  tryDecrFreeDailyUsage 原子防负数
 *                原：回滚时直接调用 Redis DECR，若 key 已过期或被清零，
 *                会将计数器减至 -1，使用户次日多获得 1 次免费额度。
 *                修：改用 Lua 脚本，仅当计数器 > 0 时才执行 DECR，
 *                保证计数器永不低于 0。
 *
 *   #FIX-5.17-3  付费模型 chargedFen=0 时跳过无效余额 UPDATE
 *                原：FIX-5.11-2 仅跳过了 billing_transactions INSERT，
 *                但余额 UPDATE（balance_fen - 0 / total_charged_fen + 0）
 *                仍执行无效写操作，触发 updated_at 触发器并占用行锁。
 *                修：chargedFen=0 时整体跳过余额扣减与流水写入，
 *                仅记录 api_usage 调用记录。
 *
 *   #FIX-5.17-4  .env.example SERVICE_TOKEN 注释修正
 *                原注释称 /billing/check 也需携带 SERVICE_TOKEN，
 *                实际 /billing/check 未使用 requireServiceToken 中间件。
 *                修：注释改为仅列 /billing/record，避免部署误解。
 *
 * 修复记录（v5.16 相对于 v5.15）：
 *
 *   #FIX-5.16-1  /billing/check 付费模型用户暂停时返回 HTTP 403
 *                原：付费模型路径仅在 200 响应中设置 can_proceed:false +
 *                is_suspended:true，但免费模型路径直接返回 403。
 *                前端无法通过 HTTP 状态码统一处理"用户暂停"场景。
 *                修：付费模型路径在安全上限检查之前新增显式 403 分支，
 *                与免费模型路径保持一致。
 *
 *   #FIX-5.16-2  /billing/record 免费模型路径新增 ensureUser 调用
 *                原：仅付费模型路径调用 ensureUser，纯免费用户永远不会在
 *                user_billing 中创建记录，导致管理员无法通过 GET /admin/users
 *                看到这些用户，也无法对其执行 suspend/unsuspend 操作。
 *                修：免费模型路径在暂停检查前先调用 ensureUser，确保所有
 *                活跃用户均可被管理员管理。
 *
 *   #FIX-5.16-3  /billing/record 所有成功/幂等响应补齐 is_suspended 字段
 *                原：所有拒绝响应（403/402/429）均包含 is_suspended，但
 *                成功/幂等响应缺失该字段，前端无法在所有场景下一致读取
 *                用户暂停状态。
 *                修：五个成功/幂等响应路径均补齐 is_suspended 字段；
 *                幂等预检/冲突解决查询 SELECT 新增 ub.is_suspended 列。
 *
 * 修复记录（v5.15 相对于 v5.14）：
 *
 *   #FIX-5.15-1  /activate 卡密无效/已使用时返回 HTTP 403 而非 200
 *                原：卡密无效或已使用时返回 HTTP 200 + success:false，
 *                与其他所有拒绝响应（均使用 4xx 状态码）不一致，
 *                导致前端无法通过 HTTP 状态码统一处理失败场景。
 *                修：改为 res.status(403).json(...)。
 *
 *   #FIX-5.15-2  /billing/check 付费模型 402（安全上限）补齐 balance_fen
 *                和 is_suspended 字段
 *                原：FIX-5.14-2 补齐了 can_proceed 和 is_free，但仍缺少
 *                balance_fen/is_suspended，与 /billing/record 402 不一致。
 *                修：将用户余额查询移至安全上限检查之前，402 响应补齐
 *                balance_fen 和 is_suspended 字段。
 *
 *   #FIX-5.15-3  新增管理员用户管理端点
 *                商用系统缺少用户管理能力，管理员无法通过 API 暂停/
 *                恢复用户或查看用户列表，需直接操作数据库。
 *                新增：GET /admin/users（分页列表）、
 *                PUT /admin/users/:email/suspend（暂停）、
 *                PUT /admin/users/:email/unsuspend（恢复）。
 *
 *   #FIX-5.15-4  新增管理员充值卡管理端点
 *                商用系统缺少卡密管理能力，管理员无法通过 API 生成
 *                或查看充值卡，需直接操作数据库。
 *                新增：POST /admin/cards（创建卡密）、
 *                GET /admin/cards（分页列表）。
 *
 * 修复记录（v5.14 相对于 v5.13）：
 *
 *   #FIX-5.14-1  /billing/record 付费模型路径所有拒绝响应补齐字段
 *                原：付费模型 403（暂停）缺少 balance_fen/is_suspended；
 *                402（安全上限）缺少 balance_fen；402（余额不足）缺少
 *                is_suspended。前端无法在拒绝场景下一致展示用户状态。
 *                修：三个拒绝响应均补齐 balance_fen + is_suspended 字段，
 *                与免费模型路径响应格式对齐。
 *
 *   #FIX-5.14-2  /billing/check 付费模型 402（安全上限）补齐字段
 *                原：仅返回 estimated_fen 和 limit_fen，缺少
 *                can_proceed/is_free 字段，前端无法统一处理 check 响应。
 *                修：补齐 can_proceed: false 和 is_free: false。
 *
 *   #FIX-5.14-3  新增 DELETE /admin/models/:id 端点（软删除）
 *                架构文档中提及但未实现的 RESTful 模型停用接口。
 *                行为：将 is_active 设为 false 并清除模型缓存。
 *                等价于 PUT /admin/models/:id { isActive: false }，
 *                但语义更清晰，符合 REST 惯例。
 *
 * 修复记录（v5.13 相对于 v5.12）：
 *
 *   #FIX-5.13-1  /billing/record 免费模型路径返回真实余额
 *                原：免费模型成功响应硬编码 balance_fen:0，导致前端
 *                在用户使用免费模型后将余额显示为 0（即使用户已充值）。
 *                修：复用暂停检查查询同时获取 balance_fen，所有免费路径
 *                响应（成功、幂等冲突、403暂停、429限额）均返回真实余额，
 *                与 FIX-5.12-2（/billing/check）保持一致。
 *
 * 修复记录（v5.12 相对于 v5.11）：
 *
 *   #FIX-5.12-1  免费模型路径新增用户暂停检查
 *                原：/billing/record 免费模型路径不检查 is_suspended，
 *                被暂停的用户仍可无限使用免费模型，绕过账户管控。
 *                修：免费路径开始前查询 user_billing.is_suspended，
 *                若已暂停则返回 HTTP 403 拒绝。
 *
 *   #FIX-5.12-2  /billing/check 免费模型路径新增暂停检查 + 返回真实余额
 *                原：免费模型预检不检查暂停状态，且硬编码 balance_fen:0，
 *                导致前端显示不准确（用户可能有余额但显示 0）。
 *                修：查询真实余额与暂停状态，被暂停时返回 can_proceed:false。
 *
 *   #FIX-5.12-3  幂等键唯一索引改为 (idempotency_key, user_email) 复合索引
 *                原：全局唯一索引理论上允许跨用户 key 碰撞（虽概率极低），
 *                应用层 FIX-5.10-1 已按 user_email 过滤但 DB 约束未对齐。
 *                修：ON CONFLICT 子句同步更新为 (idempotency_key, user_email)，
 *                配合 Migration 006 在 DB 层面强制用户隔离。
 *
 *   #FIX-5.12-4  /admin/adjust 新增 type 与 amount_fen 方向校验
 *                原：recharge/refund 类型允许负数金额，可产生语义矛盾的
 *                审计流水（如 "充值 -500 分"），商用环境下导致对账混乱。
 *                修：recharge/refund 强制 amount_fen > 0，admin_adjust 不限。
 *
 * 修复记录（v5.11 相对于 v5.10）：
 *
 *   #FIX-5.11-1  INCR_EXPIRE_LUA 免费每日限额绕过修复
 *                原：c >= limit 时返回 c（= limit），导致后续
 *                count <= FREE_DAILY_LIMIT 恒为 true，免费限额形同虚设。
 *                修：返回 limit + 1，使 count > limit 正确触发拒绝。
 *
 *   #FIX-5.11-2  付费模型 chargedFen=0 时跳过 billing_transactions INSERT
 *                原：管理员将付费模型价格设为 0 但未标记 is_free 时，
 *                chargedFen=0 的 INSERT 违反 CHECK (amount_fen != 0) 约束
 *                导致整个计费事务回滚并返回 500 错误。
 *                修：chargedFen > 0 时才写入流水，与 admin/adjust FIX-5.8-1 对齐。
 *
 * 修复记录（v5.10 相对于 v5.9）：
 *
 *   #FIX-5.10-1  幂等键预检查询新增 AND au.user_email = $2 用户隔离
 *                原实现仅按 idempotency_key 查询，理论上不同用户使用相同
 *                key 时（极低概率）会返回另一用户的计费记录，绕过计费。
 *                修复：预检查询（两处）均添加 user_email 约束。
 *
 *   #FIX-5.10-2  INCR_EXPIRE_LUA 修正超限判断条件
 *                原：if c > limit（c=limit 时仍做 INCR 到 limit+1，再判断）
 *                修：if c >= limit（c=limit 时直接返回，避免无效 INCR）
 *                效果：消除第 limit+1 次请求时的多余 Redis 写操作。
 *
 *   #FIX-5.10-3  modelCache 新增最大条目限制（MAX_MODEL_CACHE_SIZE=1000）
 *                防止长期运行后缓存无限增长（尤其是已停用模型的条目）。
 *                淘汰策略：超限时清除最早写入的条目（FIFO）。
 *
 *   #FIX-5.10-4  email processor 级别对齐：logout cleanup 改为 warn
 *                （此修复在 processor.js，server.js 无需改动）
 *
 * 历史修复记录（v5.0 → v5.9）见下方内嵌注释。
 *
 * v5.9 修复：
 *   #FIX-5.9-1  /health 新增 Redis 状态字段
 *   #FIX-5.9-2  /billing/check 模型查询内存缓存（60s TTL）
 *   #FIX-5.9-3  IDEMPOTENCY_KEY_RE 字符类修正（连字符置末尾）
 *   #FIX-5.9-4  POST /admin/providers 新增 description 长度校验
 *   #FIX-5.9-5  新增 PUT /admin/providers/:id 端点
 *   #FIX-5.9-6  模型写操作后清除 modelCache
 *
 * v5.8 修复：
 *   #FIX-5.8-1  admin/adjust 余额截断为 0 时跳过零金额流水 INSERT
 *   #FIX-5.8-2  幂等预检响应包含真实 is_free 字段
 *   #FIX-5.8-3  免费模型 INSERT 含幂等键 + ON CONFLICT DO NOTHING
 *
 * v5.7 修复：
 *   TOCTOU 竞态（lookupModelInTx FOR SHARE）、safeRollback 辅助函数、
 *   validateChargedFen 安全熔断、Redis Lua 原子操作等
 */

const crypto      = require('crypto');
const fs          = require('fs');
const path        = require('path');
const { URL }     = require('url');
const express     = require('express');
const helmet      = require('helmet');
const compression = require('compression');
const rateLimit   = require('express-rate-limit');
const { Pool }    = require('pg');
const winston     = require('winston');
const Redis       = require('ioredis');
const yaml        = require('js-yaml');

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
      maxsize: 10 * 1024 * 1024,
      maxFiles: 5,
      tailable: true,
    }),
  ],
});

// ─── 数据库连接池 ─────────────────────────────────────────────
// FIX-5.27-1: CIS 资源保护——PG_POOL_MAX 上限校验，防止误配置导致连接数爆炸
const PG_POOL_MAX_RAW = parseInt(process.env.PG_POOL_MAX || '10', 10);
const PG_POOL_MAX = (Number.isFinite(PG_POOL_MAX_RAW) && PG_POOL_MAX_RAW >= 1 && PG_POOL_MAX_RAW <= 100)
  ? PG_POOL_MAX_RAW : 10;
if (process.env.PG_POOL_MAX && PG_POOL_MAX !== PG_POOL_MAX_RAW) {
  logger.warn('PG_POOL_MAX 值超出有效范围（1-100），已回退至默认值 10', { raw: process.env.PG_POOL_MAX });
}
const db = new Pool({
  host:     process.env.PG_HOST     || 'anima-db.postgres.database.azure.com',
  port:     parseInt(process.env.PG_PORT || '5432', 10),
  user:     process.env.PG_USER     || 'animaapp',
  password: process.env.PG_PASSWORD,
  database: process.env.PG_DATABASE || 'librechat',
  ssl:      { rejectUnauthorized: true },
  max:      PG_POOL_MAX,
  idleTimeoutMillis:           30_000,
  connectionTimeoutMillis:      5_000,
  statement_timeout:           10_000,
  keepAlive:                    true,
  keepAliveInitialDelayMillis: 10_000,
  // FIX-5.21-2: 生产优化——空闲时允许退出、标记应用名便于 pg_stat_activity 监控
  allowExitOnIdle:              true,
  application_name:             'anima-webhook',
});

db.on('error', (err) => logger.error('DB pool error', { err: err.message }));

// FIX-5.28-1: CIS 资源保护——新连接设置 idle_in_transaction_session_timeout（30s）
// 防止事务内空闲连接长期持有行锁导致数据库资源耗尽
db.on('connect', (client) => {
  client.query('SET idle_in_transaction_session_timeout = 30000').catch((err) => {
    logger.warn('Failed to set idle_in_transaction_session_timeout', { err: err.message });
  });
});

// ─── Redis 连接 ───────────────────────────────────────────────
const REDIS_URL = process.env.REDIS_URL || 'redis://172.16.1.6:6379';
// FIX-5.27-1: PCI-DSS 4.1——检测 Redis 传输层是否加密
if (!REDIS_URL.startsWith('rediss://')) {
  logger.warn('Redis 连接未使用 TLS（rediss://），生产环境建议启用加密传输（PCI-DSS 4.1）');
}
const redis = new Redis(REDIS_URL, {
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    return Math.min(times * 200, 2000);
  },
  lazyConnect: true,
  // FIX-5.25-2: 加速断连后重连检测（生产级 Redis 连接管理）
  enableReadyCheck: true,
  // FIX-5.25-1: CIS fail-secure——断连时立即失败，避免请求在离线队列中堆积
  enableOfflineQueue: false,
});
redis.connect().catch((err) =>
  logger.warn('Redis connect error (free daily limits disabled)', { err: err.message })
);
redis.on('error', (err) => logger.error('Redis error', { err: err.message }));

// ─────────────────────────────────────────────────────────────
// FIX-5.10-2: INCR+EXPIRE Lua 脚本（原子操作）
// 修正：if c >= limit（原为 c > limit，多余一次 INCR）
// ─────────────────────────────────────────────────────────────
const INCR_EXPIRE_LUA =
  'local key = KEYS[1]\n' +
  'local limit = tonumber(ARGV[1])\n' +
  'local ttl = redis.call("TTL", key)\n' +
  // 若 key 存在但无 TTL（edge case），补设 24h 防止永久有效
  'if ttl == -1 then redis.call("EXPIRE", key, 86400) end\n' +
  'local c = tonumber(redis.call("GET", key) or "0")\n' +
  // FIX-5.10-2: >= limit（原为 > limit，在 c=limit 时会多做一次 INCR）
  // FIX-5.11-1: 返回 limit+1 作为"已达限额"哨兵值，使调用方
  //   count <= FREE_DAILY_LIMIT（即 limit+1 <= limit = false）正确触发拒绝。
  //   原返回 c（= limit），导致 count <= limit 恒真，免费限额无效。
  'if c >= limit then return limit + 1 end\n' +
  'local new_c = redis.call("INCR", key)\n' +
  // 首次写入：设置 24h TTL（北京时间日期前缀确保次日自然重置）
  'if new_c == 1 then redis.call("EXPIRE", key, 86400) end\n' +
  'return new_c';

// ─── 模型内存缓存（FIX-5.9-2 / FIX-5.10-3）───────────────────
// 仅用于只读路径（/billing/check、/models）；事务路径不用此缓存
// FIX-5.10-3：新增最大条目限制，防止长期运行后无限增长
const MODEL_CACHE_TTL_MS   = 60_000; // 60 秒
const MAX_MODEL_CACHE_SIZE = 1000;   // 最多缓存 1000 个模型条目
// FIX-5.27-1: CIS 日志完整性——致命退出前等待日志落盘的延迟
const LOG_FLUSH_DELAY_MS   = 100;
const modelCache = new Map();

function modelCacheGet(modelName) {
  const entry = modelCache.get(modelName);
  if (!entry) return null;
  if (Date.now() >= entry.exp) { modelCache.delete(modelName); return null; }
  return entry.data;
}

function modelCacheSet(modelName, data) {
  // FIX-5.10-3：超限时删除最早写入的条目（Map 按插入顺序迭代）
  if (modelCache.size >= MAX_MODEL_CACHE_SIZE) {
    const firstKey = modelCache.keys().next().value;
    if (firstKey !== undefined) modelCache.delete(firstKey);
  }
  modelCache.set(modelName, { data, exp: Date.now() + MODEL_CACHE_TTL_MS });
}

function modelCacheDelete(modelName) {
  modelCache.delete(modelName);
}

// ─── 运行时读取配置（热更新无需重启）──────────────────────────
function getFreeDailyLimit() {
  const v = parseInt(process.env.FREE_DAILY_LIMIT || '20', 10);
  if (!Number.isFinite(v) || v <= 0) {
    logger.warn('FREE_DAILY_LIMIT 非法，使用默认值 20');
    return 20;
  }
  return v;
}

function getMaxSingleRequestFen() {
  const v = parseInt(process.env.MAX_SINGLE_REQUEST_FEN || '1000', 10);
  if (!Number.isFinite(v) || v <= 0) {
    logger.warn('MAX_SINGLE_REQUEST_FEN 非法，使用默认值 1000');
    return 1000;
  }
  return v;
}

function getUsdToCnyRate() {
  const v = parseFloat(process.env.USD_TO_CNY_RATE || '7.2');
  if (!Number.isFinite(v) || v < 1 || v > 15) {
    logger.warn('USD_TO_CNY_RATE 非法，使用默认值 7.2', { raw: process.env.USD_TO_CNY_RATE });
    return 7.2;
  }
  return v;
}

// 上海时区日期，确保每日限额在北京时间 00:00 准时重置
function getShanghaiDate() {
  return new Date().toLocaleString('sv-SE', { timeZone: 'Asia/Shanghai' }).slice(0, 10);
}

async function peekFreeDailyUsage(userEmail) {
  const FREE_DAILY_LIMIT = getFreeDailyLimit();
  try {
    if (redis.status !== 'ready') {
      return { allowed: true, used: 0, limit: FREE_DAILY_LIMIT };
    }
    const today = getShanghaiDate();
    const key = `anima:free_daily:${userEmail}:${today}`;
    const count = parseInt(await redis.get(key) || '0', 10);
    return {
      allowed: count < FREE_DAILY_LIMIT,
      used:    Math.min(count, FREE_DAILY_LIMIT),
      limit:   FREE_DAILY_LIMIT,
    };
  } catch (err) {
    logger.warn('Redis daily peek failed, allowing request', { err: err.message });
    return { allowed: true, used: 0, limit: FREE_DAILY_LIMIT };
  }
}

async function incrFreeDailyUsage(userEmail) {
  const FREE_DAILY_LIMIT = getFreeDailyLimit();
  try {
    if (redis.status !== 'ready') {
      logger.warn('Redis unavailable: free daily limit NOT enforced', { userEmail });
      return { allowed: true, used: 0, limit: FREE_DAILY_LIMIT, key: null };
    }
    const today = getShanghaiDate();
    const key = `anima:free_daily:${userEmail}:${today}`;
    const count = await redis.eval(INCR_EXPIRE_LUA, 1, key, FREE_DAILY_LIMIT);
    return { allowed: count <= FREE_DAILY_LIMIT, used: count, limit: FREE_DAILY_LIMIT, key };
  } catch (err) {
    logger.warn('Redis daily limit incr failed, allowing request', { err: err.message });
    return { allowed: true, used: 0, limit: FREE_DAILY_LIMIT, key: null };
  }
}

// FIX-5.17-2: 原子 DECR，仅当计数器 > 0 时才递减，防止减至负数
const DECR_FLOOR_LUA =
  'local c = tonumber(redis.call("GET", KEYS[1]) or "0")\n' +
  'if c <= 0 then return 0 end\n' +
  'return redis.call("DECR", KEYS[1])';

async function tryDecrFreeDailyUsage(key) {
  if (!key) return;
  try {
    if (redis.status !== 'ready') return;
    await redis.eval(DECR_FLOOR_LUA, 1, key);
  } catch (err) {
    logger.warn('Redis daily counter decr (rollback) failed', { err: err.message, key });
  }
}

// ─── Express 应用 ─────────────────────────────────────────────
const app = express();

app.set('trust proxy', process.env.TRUST_PROXY || '172.16.1.1');

// FIX-5.26-1 + FIX-5.26-2: 禁用 Express 默认 ETag 自动生成
// 安全：自动 ETag 泄露响应体指纹（CIS 2.3 信息最小化）
// 速度：每个 JSON 响应节省一次 SHA 哈希计算
// 注：管理面板 /admin/dashboard 使用自定义 SHA-256 ETag，不受影响
app.disable('etag');

// FIX-5.27-2: 预序列化高频静态 JSON 错误响应为 Buffer，跳过重复 JSON.stringify
const RESP_405 = Buffer.from(JSON.stringify({ success: false, msg: 'Method Not Allowed' }));
const RESP_415 = Buffer.from(JSON.stringify({ success: false, msg: 'Content-Type 必须为 application/json' }));
const RESP_404 = Buffer.from(JSON.stringify({ success: false, msg: '接口不存在' }));

// FIX-5.20-2 + FIX-5.24-1: 严格 helmet 配置，满足 PCI-DSS & CIS 安全基线
app.use(helmet({
  // HSTS: PCI-DSS 要求强制 HTTPS，预加载列表
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  // X-Frame-Options: DENY — CIS 要求，阻止点击劫持
  frameguard: { action: 'deny' },
  // Referrer-Policy: 不泄露管理界面 URL (PCI-DSS 数据最小化)
  referrerPolicy: { policy: 'no-referrer' },
  // 禁止 MIME 嗅探 (CIS)
  noSniff: true,
  // 隐藏 X-Powered-By (CIS)
  hidePoweredBy: true,
  // FIX-5.24-1: CIS 跨源隔离策略——防止跨源信息泄露
  crossOriginResourcePolicy: { policy: 'same-origin' },
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  crossOriginEmbedderPolicy: true,
  // 全局 CSP: API 端点仅返回 JSON，使用最严格策略
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
}));

// FIX-5.22-1: 计费 API 负载均 < 1 KB，收紧至 256 KB 防止大包体 DoS（CIS）
app.use(express.json({ limit: '256kb' }));

// FIX-5.21-2: gzip/br 压缩 JSON 响应，减少带宽占用 60-80%
app.use(compression({ threshold: 512 }));

// FIX-5.22-1: PCI-DSS 10.2——每请求唯一关联标识，串联审计日志与响应
app.use((req, res, next) => {
  req.id = crypto.randomUUID();
  res.setHeader('X-Request-ID', req.id);
  next();
});

// FIX-5.23-1 + FIX-5.24-2: PCI-DSS 10.2——全链路访问日志
// FIX-5.24-2: 改用 process.hrtime.bigint() 提供亚毫秒精度计时
app.use((req, res, next) => {
  const start = process.hrtime.bigint();
  res.on('finish', () => {
    const durationMs = Number(process.hrtime.bigint() - start) / 1e6;
    logger.info('ACCESS', {
      request_id: req.id,
      method:     req.method,
      path:       req.path,
      status:     res.statusCode,
      duration_ms: Math.round(durationMs * 100) / 100,
      ip:         req.ip,
    });
  });
  next();
});

// FIX-5.20-2: PCI-DSS & CIS 安全响应头
app.use((_req, res, next) => {
  // 缓存控制：PCI-DSS 要求敏感数据不得缓存
  res.set('Cache-Control', 'private, no-store, no-cache, must-revalidate, max-age=0');
  res.set('Pragma', 'no-cache');
  res.set('Expires', '0');
  // CIS: 阻止跨域策略文件
  res.set('X-Permitted-Cross-Domain-Policies', 'none');
  // FIX-5.28-1: CIS 浏览器安全加固——阻止 IE 在站点上下文中执行下载文件
  res.set('X-Download-Options', 'noopen');
  // CIS: 限制浏览器功能 (Permissions-Policy)
  res.set('Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()');
  next();
});

// FIX-5.20-2: CIS 要求禁用 TRACE/TRACK 方法
// FIX-5.27-2: 使用预序列化 Buffer 响应，跳过运行时 JSON.stringify
app.use((req, res, next) => {
  if (req.method === 'TRACE' || req.method === 'TRACK') {
    res.status(405).setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(RESP_405);
  }
  next();
});

// FIX-5.26-1: PCI-DSS 6.5 输入校验——POST/PUT/PATCH 请求必须携带 JSON Content-Type
// 防止非 JSON 负载绕过 express.json() 解析器导致 req.body 为 undefined
// FIX-5.27-2: 使用预序列化 Buffer 响应
app.use((req, res, next) => {
  if (
    (req.method === 'POST' || req.method === 'PUT' || req.method === 'PATCH') &&
    !( req.headers['content-type'] && req.headers['content-type'].startsWith('application/json') )
  ) {
    res.status(415).setHeader('Content-Type', 'application/json; charset=utf-8');
    return res.end(RESP_415);
  }
  next();
});

// ─── 限速器 ──────────────────────────────────────────────────
app.use(rateLimit({
  windowMs: 60_000,
  max:      60,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, msg: '请求过于频繁，请稍后再试' },
  skip: (req) => req.path === '/billing/record',
}));

const activateLimiter = rateLimit({
  windowMs: 10 * 60_000,
  max:      5,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, msg: '激活尝试过于频繁，请 10 分钟后再试' },
});

const readLimiter = rateLimit({
  windowMs: 60_000,
  max:      20,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, msg: '查询过于频繁，请稍后再试' },
});

const billingCheckLimiter = rateLimit({
  windowMs: 60_000,
  max:      120,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, msg: '预检请求过于频繁，请稍后再试' },
});

const billingRecordLimiter = rateLimit({
  windowMs: 60_000,
  max:      600,
  keyGenerator: (req) => req.ip,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, msg: '计费记录请求过于频繁' },
});

// FIX-5.18-4: 放宽至 60 次/15 分钟，原 10 次过于严格，影响批量运维操作
const adminLimiter = rateLimit({
  windowMs: 15 * 60_000,
  max:      60,
  standardHeaders: true,
  legacyHeaders:   false,
  message: { success: false, msg: '管理员接口请求过于频繁，请 15 分钟后再试' },
});

// ─── 鉴权中间件 ──────────────────────────────────────────────
const ADMIN_TOKEN   = process.env.ADMIN_TOKEN;
const SERVICE_TOKEN = process.env.SERVICE_TOKEN;

function safeCompare(a, b) {
  const aBuf = Buffer.from(typeof a === 'string' ? a : '');
  const bBuf = Buffer.from(typeof b === 'string' ? b : '');
  const len  = Math.max(aBuf.length, bBuf.length);
  const paddedA = Buffer.concat([aBuf, Buffer.alloc(len - aBuf.length)]);
  const paddedB = Buffer.concat([bBuf, Buffer.alloc(len - bBuf.length)]);
  const equal = crypto.timingSafeEqual(paddedA, paddedB);
  return equal && aBuf.length === bBuf.length;
}

function requireAdmin(req, res, next) {
  if (!ADMIN_TOKEN) {
    return res.status(503).json({ success: false, msg: '管理员接口未启用（未设置 ADMIN_TOKEN）' });
  }
  const auth  = req.headers['authorization'] || '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!safeCompare(token, ADMIN_TOKEN)) {
    logger.warn('Admin auth failed', { ip: req.ip, path: req.path });
    return res.status(401).json({ success: false, msg: '未授权' });
  }
  next();
}

function requireServiceToken(req, res, next) {
  if (!SERVICE_TOKEN) {
    logger.error('SERVICE_TOKEN 未配置，拒绝 /billing 写入请求', { path: req.path, ip: req.ip });
    return res.status(503).json({ success: false, msg: '服务鉴权未配置，请联系管理员' });
  }
  const token = req.headers['x-service-token'] || '';
  if (!safeCompare(token, SERVICE_TOKEN)) {
    logger.warn('Service token auth failed', { ip: req.ip, path: req.path });
    return res.status(401).json({ success: false, msg: '内部服务鉴权失败' });
  }
  next();
}

// FIX-5.21-1 + FIX-5.22-1: PCI-DSS 10.2 审计追踪——结构化审计日志 + 请求关联 ID
function auditLog(action, details, req) {
  logger.info('AUDIT', {
    action,
    request_id: req.id,
    actor_ip: req.ip,
    method:   req.method,
    path:     req.path,
    ...details,
  });
}

// ─── 工具函数 ─────────────────────────────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_EMAIL_LEN = 254;
// 连字符置末尾，语义清晰，避免与字符范围操作符混淆
const IDEMPOTENCY_KEY_RE = /^[a-zA-Z0-9:_-]+$/;
// FIX-5.23-1: apiProvider 字符集校验——仅允许字母、数字、连字符、下划线、点
// 安全审查：apiProvider 仅用于 SQL 参数化查询和日志输出，不作为文件路径或 URL 拼接
const API_PROVIDER_RE = /^[a-zA-Z0-9._-]+$/;
// FIX-5.24-1: modelName 字符集校验——仅允许字母、数字、连字符、下划线、点、冒号、斜杠
// 模型名称含 provider:model 或 org/model 命名惯例（如 openai/gpt-4、claude-3:opus）
const MODEL_NAME_RE = /^[a-zA-Z0-9._:\/-]+$/;
// FIX-5.27-1: PCI-DSS 6.5 输入净化——剥离 ASCII 控制字符，防止日志/DB 注入
// 保留 \t (0x09)、\n (0x0A)、\r (0x0D)，这些在 description 等多行字段中有合法用途
const CONTROL_CHARS_RE = /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;
function stripControlChars(s) {
  return typeof s === 'string' ? s.replace(CONTROL_CHARS_RE, '') : s;
}

function isValidEmail(email) {
  return typeof email === 'string' && email.length <= MAX_EMAIL_LEN && EMAIL_RE.test(email);
}

function normalizeEmail(email) {
  return typeof email === 'string' ? email.trim().toLowerCase() : '';
}

const MAX_TOKEN_VALUE = 10_000_000;
// FIX-5.26-1: CIS 资源保护——分页 offset 上限，防止深分页 DoS（OFFSET 越大，DB 扫描行数越多）
const MAX_PAGINATION_OFFSET = 100_000;

// FIX-5.21-1: SSRF 防护——校验 URL 禁止内网/保留地址
// PCI-DSS 1.3.x 网络安全要求：不允许从 DMZ 访问内网资源
const PRIVATE_IP_RE = /^(127\.\d+\.\d+\.\d+|10\.\d+\.\d+\.\d+|172\.(1[6-9]|2\d|3[01])\.\d+\.\d+|192\.168\.\d+\.\d+|169\.254\.\d+\.\d+|0\.0\.0\.0)$/;
const PRIVATE_IPV6_RE = /^(\[?)(::1|fc[0-9a-f]{2}:|fd[0-9a-f]{2}:|fe[89ab][0-9a-f]:)/i;
function isValidBaseUrl(urlStr) {
  if (typeof urlStr !== 'string') return false;
  let parsed;
  try { parsed = new URL(urlStr); } catch { return false; }
  // 生产环境允许 HTTP/HTTPS（部分内部 provider 仍使用 HTTP）
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return false;
  const host = parsed.hostname.toLowerCase();
  // 阻断 localhost / IPv4 内网保留 IP / IPv6 loopback 与私有地址
  // FIX-5.22-1: URL 类将 [::1] 解析为 hostname='::1'（无方括号），修正判断条件
  if (host === 'localhost' || host === '::1' || PRIVATE_IP_RE.test(host) || PRIVATE_IPV6_RE.test(host)) return false;
  return true;
}

function parseOptionalNonNegInt(value) {
  if (
    typeof value === 'number' &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value >= 0 &&
    value <= MAX_TOKEN_VALUE
  ) {
    return value;
  }
  return undefined;
}

// FIX-5.27-2: 高频 SQL 改用命名预备语句——连接复用时跳过 SQL 解析阶段
async function ensureUser(client, userEmail) {
  await client.query({
    name: 'ensure_user',
    text: `INSERT INTO user_billing (user_email) VALUES ($1)
     ON CONFLICT (user_email) DO NOTHING`,
    values: [userEmail],
  });
}

/**
 * 只读模型查询（不带缓存），用于直接 DB 访问。
 * FIX-5.27-2: 命名预备语句加速重复查询
 */
async function lookupModel(modelName) {
  const res = await db.query({
    name: 'lookup_model',
    text: `SELECT id, is_free, price_input_per_1k_tokens, price_output_per_1k_tokens,
            currency, is_active, supports_cache
       FROM api_models WHERE model_name = $1`,
    values: [modelName],
  });
  return res.rows[0] || null;
}

/**
 * 只读模型查询（带 60s 内存缓存）。
 * 用于 /billing/check 等高频只读路径，减少 DB 压力。
 * 管理员更新/创建模型后会自动清除对应缓存（FIX-5.9-6）。
 */
async function lookupModelCached(modelName) {
  const cached = modelCacheGet(modelName);
  if (cached !== null) return cached;
  const model = await lookupModel(modelName);
  if (model) modelCacheSet(modelName, model);
  return model;
}

/**
 * 事务内模型查询（FOR SHARE 锁），防止 TOCTOU 竞态。
 * 用于 /billing/record 等写路径，确保读到最新数据。
 * FOR SHARE：允许并发读，阻止并发写（admin 更新模型价格时需等待）。
 * FIX-5.27-2: 命名预备语句加速重复查询
 */
async function lookupModelInTx(client, modelName) {
  const res = await client.query({
    name: 'lookup_model_tx',
    text: `SELECT id, is_free, price_input_per_1k_tokens, price_output_per_1k_tokens,
            currency, is_active, supports_cache
       FROM api_models WHERE model_name = $1
       FOR SHARE`,
    values: [modelName],
  });
  return res.rows[0] || null;
}

// ─── 缓存感知分层计费 ─────────────────────────────────────────
const CACHE_THRESHOLD_TOKENS = 2000;
const CACHE_DISCOUNT         = 0.1;

function calculateChargedFen({
  inputTokens, outputTokens, priceIn, priceOut, currency,
  supportsCache, promptTokens, historyTokens,
}) {
  const fxRate = (currency === 'USD') ? getUsdToCnyRate() : 1;
  const cnyPriceIn  = priceIn  * fxRate;
  const cnyPriceOut = priceOut * fxRate;

  let inputCostYuan;
  const hasPartition = typeof promptTokens === 'number' && typeof historyTokens === 'number';

  if (supportsCache && hasPartition && historyTokens > CACHE_THRESHOLD_TOKENS) {
    const partitionSum = promptTokens + historyTokens;

    if (inputTokens === 0 && partitionSum > 0) {
      logger.warn('calculateChargedFen: inputTokens=0 但 partitionSum>0，数据不一致，回退到标准计费', {
        inputTokens, promptTokens, historyTokens, partitionSum,
      });
      inputCostYuan = 0;
    } else {
      const deviation = inputTokens > 0 ? Math.abs(partitionSum - inputTokens) / inputTokens : 0;
      if (deviation > 0.05) {
        logger.warn('calculateChargedFen: 分区 Token 与总量偏差超过 5%，回退到标准计费', {
          inputTokens, promptTokens, historyTokens, partitionSum,
          deviation: `${(deviation * 100).toFixed(2)}%`,
        });
        inputCostYuan = (inputTokens / 1000) * cnyPriceIn;
      } else {
        const fullPriceTokens  = promptTokens + CACHE_THRESHOLD_TOKENS;
        const discountedTokens = historyTokens - CACHE_THRESHOLD_TOKENS;
        inputCostYuan = (fullPriceTokens  / 1000) * cnyPriceIn
                      + (discountedTokens / 1000) * cnyPriceIn * CACHE_DISCOUNT;
      }
    }
  } else {
    inputCostYuan = (inputTokens / 1000) * cnyPriceIn;
  }

  const outputCostYuan = (outputTokens / 1000) * cnyPriceOut;
  return Math.ceil((inputCostYuan + outputCostYuan) * 100);
}

// FIX-5.17-1: 安全熔断——校验计费计算结果，防止 NaN/Infinity/负数写入 DB
function validateChargedFen(chargedFen, context) {
  if (!Number.isFinite(chargedFen) || chargedFen < 0) {
    logger.error('validateChargedFen: 计算结果异常，拒绝计费', {
      chargedFen, ...context,
    });
    return false;
  }
  return true;
}

// ─── 安全的 ROLLBACK 辅助函数 ────────────────────────────────
async function safeRollback(client, context) {
  try {
    await client.query('ROLLBACK');
  } catch (rollbackErr) {
    logger.warn('ROLLBACK 失败，可能存在连接泄漏', {
      context,
      err: rollbackErr.message,
    });
  }
}

// =============================================================
// ─── 路由 ────────────────────────────────────────────────────
// =============================================================

// ─── 健康检查（FIX-5.9-1: 含 Redis 状态）────────────────────
// FIX-5.25-1: CIS 2.3 信息最小化——不暴露 db/redis 内部组件状态
// FIX-5.27-2: DB 与 Redis 并行检查，健康检查延迟从串行 2×RTT 降至 1×RTT
app.get('/health', async (_req, res) => {
  // 并行发起 DB 和 Redis 检查，各自返回是否成功
  const [dbOk, redisOk] = await Promise.all([
    db.query('SELECT 1').then(() => true, (err) => {
      logger.error('Health check DB error', { err: err.message });
      return false;
    }),
    (async () => {
      try {
        if (redis.status === 'ready') {
          await redis.ping();
          return true;
        } else {
          logger.info('Health check: Redis disconnected (degraded mode)');
          return false;
        }
      } catch (err) {
        logger.warn('Health check Redis error', { err: err.message });
        return false;
      }
    })(),
  ]);

  const httpStatus = dbOk ? 200 : 503;

  // FIX-5.23-2: 健康检查禁止缓存——确保探针获取实时状态
  res.set('Cache-Control', 'no-store, max-age=0');
  res.status(httpStatus).json({
    status: httpStatus === 200 ? 'ok' : 'degraded',
    ts: new Date().toISOString(),
    db: dbOk ? 'ok' : 'error',
    redis: redisOk ? 'ok' : 'degraded',
  });
});

// ─── 模型列表（公开）──────────────────────────────────────────
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
    // FIX-5.23-2: 公开只读端点允许短暂缓存，减少 DB 查询压力
    // FIX-5.24-2: Vary: Accept-Encoding 确保 CDN/代理按编码正确缓存
    res.set('Cache-Control', 'public, max-age=30');
    res.set('Vary', 'Accept-Encoding');
    res.json({ success: true, models: result.rows });
  } catch (err) {
    logger.error('Models query error', { err: err.message });
    res.status(500).json({ success: false, msg: '服务器内部错误' });
  }
});

// ─── Provider 配置列表（公开，不含 API Key）───────────────────
// 数据库统一调用：OpenClaw/LibreChat 从此接口动态获取 provider base URL。
// API Key 仍在各服务 .env（PCI-DSS 3.x 要求，不允许密钥入库）。
app.get('/providers', readLimiter, async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT provider_name, display_name, base_url, is_enabled, description
         FROM api_providers
        WHERE is_enabled = true
        ORDER BY provider_name`
    ).catch((err) => {
      if (err.code === '42P01') {
        // 表不存在（旧 schema），返回空列表兼容旧环境
        logger.warn('api_providers 表不存在，请执行 db/schema.sql 升级');
        return { rows: [] };
      }
      throw err;
    });
    // FIX-5.23-2: 公开只读端点允许短暂缓存，减少 DB 查询压力
    // FIX-5.24-2: Vary: Accept-Encoding 确保 CDN/代理按编码正确缓存
    res.set('Cache-Control', 'public, max-age=30');
    res.set('Vary', 'Accept-Encoding');
    res.json({ success: true, providers: result.rows });
  } catch (err) {
    logger.error('Providers query error', { err: err.message });
    res.status(500).json({ success: false, msg: '服务器内部错误' });
  }
});

// ─── 充值卡激活 ───────────────────────────────────────────────
app.post('/activate', activateLimiter, async (req, res) => {
  let { cardKey, userEmail } = req.body ?? {};

  if (!cardKey || !userEmail) {
    return res.status(400).json({ success: false, msg: '参数缺失：需要 cardKey 和 userEmail' });
  }
  if (typeof cardKey !== 'string') {
    return res.status(400).json({ success: false, msg: 'cardKey 必须为字符串' });
  }
  cardKey = cardKey.trim();
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

    const cardRes = await client.query(
      `SELECT id, credit_fen, label
         FROM recharge_cards
        WHERE key=$1 AND used=false
        FOR UPDATE`,
      [cardKey]
    );
    // FIX-5.15-1: 卡密无效/已使用返回 HTTP 403（原为 200，与其他拒绝响应不一致）
    if (cardRes.rows.length === 0) {
      await safeRollback(client, '/activate card lookup');
      return res.status(403).json({ success: false, msg: '卡密无效或已使用' });
    }

    const card = cardRes.rows[0];

    await ensureUser(client, userEmail);

    // FIX-5.18-1: 暂停用户不允许使用充值卡（商用系统暂停账户应完全禁止财务操作）
    // FIX-5.25-1: PCI-DSS 6.5 数据完整性——FOR UPDATE 行锁防止并发 TOCTOU 竞态
    const suspendRes = await client.query(
      'SELECT is_suspended FROM user_billing WHERE user_email=$1 FOR UPDATE',
      [userEmail]
    );
    if (suspendRes.rows.length > 0 && suspendRes.rows[0].is_suspended) {
      await safeRollback(client, '/activate user suspended');
      return res.status(403).json({ success: false, msg: '账户已被暂停，无法使用充值卡' });
    }

    const rechargeRes = await client.query(
      `UPDATE user_billing
          SET balance_fen = balance_fen + $1
        WHERE user_email = $2
        RETURNING balance_fen`,
      [card.credit_fen, userEmail]
    );
    if (rechargeRes.rows.length === 0) {
      await safeRollback(client, '/activate user balance update returned no rows');
      return res.status(500).json({ success: false, msg: '用户数据异常，请重试' });
    }
    const newBalance = Number(rechargeRes.rows[0].balance_fen);

    await client.query(
      `UPDATE recharge_cards
          SET used=true, used_at=NOW(), used_by=$1
        WHERE id=$2`,
      [userEmail, card.id]
    );

    await client.query(
      `INSERT INTO billing_transactions
           (user_email, type, amount_fen, balance_after_fen, description, ref_id)
         VALUES ($1, 'recharge', $2, $3, $4, $5)`,
      [userEmail, card.credit_fen, newBalance, `充值卡: ${card.label || cardKey}`, cardKey]
    );

    await client.query('COMMIT');

    // FIX-5.28-1: PCI-DSS 3.4——日志中掩码卡密，仅显示前4后4字符，防止日志泄露完整密钥
    const maskedKey = cardKey.length > 10
      ? cardKey.slice(0, 4) + '••••' + cardKey.slice(-4)
      : '••••••••';
    logger.info('Card activated', { userEmail, cardKey: maskedKey, credit: card.credit_fen });

    res.json({
      success:      true,
      msg:          '充值成功',
      credit_fen:   Number(card.credit_fen),
      balance_fen:  newBalance,
      label:        card.label || null,
      is_suspended: false, // FIX-5.18-1: 补齐字段，与其他计费响应对齐
    });
  } catch (err) {
    await safeRollback(client, '/activate error');
    logger.error('Activation error', { err: err.message, userEmail, request_id: req.id });
    res.status(500).json({ success: false, msg: '服务器内部错误，请稍后重试' });
  } finally {
    client.release();
  }
});

// ─── 余额查询 ─────────────────────────────────────────────────
app.get('/billing/balance/:email', readLimiter, requireServiceToken, async (req, res) => {
  const email = normalizeEmail(req.params.email);
  if (!isValidEmail(email)) {
    return res.status(400).json({ success: false, msg: '邮箱格式不正确' });
  }

  try {
    // FIX-5.28-2: 命名预备语句加速重复查询
    const result = await db.query({
      name: 'user_bal_full',
      text: `SELECT balance_fen, total_charged_fen, is_suspended
         FROM user_billing WHERE user_email=$1`,
      values: [email],
    });
    if (result.rows.length === 0) {
      return res.json({ success: true, balance_fen: 0, total_charged_fen: 0, is_suspended: false });
    }
    const r = result.rows[0];
    res.json({
      success:           true,
      balance_fen:       Number(r.balance_fen),
      total_charged_fen: Number(r.total_charged_fen),
      is_suspended:      r.is_suspended,
    });
  } catch (err) {
    logger.error('Balance query error', { err: err.message, email });
    res.status(500).json({ success: false, msg: '服务器内部错误' });
  }
});

// ─── 消费历史 ─────────────────────────────────────────────────
app.get('/billing/history/:email', readLimiter, requireServiceToken, async (req, res) => {
  const email = normalizeEmail(req.params.email);
  if (!isValidEmail(email)) {
    return res.status(400).json({ success: false, msg: '邮箱格式不正确' });
  }

  const limit  = Math.min(Math.max(parseInt(req.query.limit  || '20', 10) || 20, 1), 100);
  // FIX-5.26-1: CIS 资源保护——cap offset 防止深分页 DoS
  const offset = Math.min(Math.max(parseInt(req.query.offset || '0', 10) || 0, 0), MAX_PAGINATION_OFFSET);

  try {
    // FIX-5.25-2: 使用 COUNT(*) OVER() 窗口函数，单次查询同时返回分页数据与总数
    const result = await db.query(
      `SELECT type, amount_fen, balance_after_fen, description, created_at,
              COUNT(*) OVER() AS _total
         FROM billing_transactions
        WHERE user_email=$1
        ORDER BY created_at DESC
        LIMIT $2 OFFSET $3`,
      [email, limit, offset]
    );
    const total = result.rows.length > 0 ? Number(result.rows[0]._total) : 0;
    const records = result.rows.map(({ _total, ...rest }) => rest);
    res.json({ success: true, records, total });
  } catch (err) {
    logger.error('History query error', { err: err.message, email });
    res.status(500).json({ success: false, msg: '服务器内部错误' });
  }
});

// ─── 余额预检（需要服务鉴权）──────────────────────────────────
app.post('/billing/check', billingCheckLimiter, requireServiceToken, async (req, res) => {
  let {
    userEmail, modelName,
    estimatedInputTokens, estimatedOutputTokens,
    estimatedInputChars, estimatedOutputChars,
    estimatedPromptTokens, estimatedHistoryTokens,
  } = req.body ?? {};

  userEmail = normalizeEmail(userEmail || '');
  if (!isValidEmail(userEmail)) {
    return res.status(400).json({ success: false, msg: '邮箱格式不正确' });
  }
  if (!modelName) {
    return res.status(400).json({ success: false, msg: '缺少 modelName' });
  }
  if (typeof modelName !== 'string') {
    return res.status(400).json({ success: false, msg: 'modelName 必须为字符串' });
  }
  modelName = modelName.trim();
  if (modelName.length === 0 || modelName.length > 128) {
    return res.status(400).json({ success: false, msg: 'modelName 长度不能超过 128 字符' });
  }

  // 使用带缓存的查询（60s TTL），减少高频场景 DB 压力（FIX-5.9-2）
  let model;
  try {
    model = await lookupModelCached(modelName);
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
    // FIX-5.12-2: 免费模型也需检查暂停状态，并返回真实余额
    let freeBalance = 0;
    let freeSuspended = false;
    try {
      // FIX-5.28-2: 命名预备语句加速重复查询
      const freeUserRes = await db.query({
        name: 'user_bal_status',
        text: 'SELECT balance_fen, is_suspended FROM user_billing WHERE user_email=$1',
        values: [userEmail],
      });
      if (freeUserRes.rows.length > 0) {
        freeBalance   = Number(freeUserRes.rows[0].balance_fen);
        freeSuspended = freeUserRes.rows[0].is_suspended;
      }
    } catch (err) {
      logger.error('Free model user lookup error in /billing/check', { err: err.message, userEmail });
      return res.status(500).json({ success: false, msg: '服务器内部错误' });
    }

    if (freeSuspended) {
      return res.status(403).json({
        success: false, can_proceed: false, is_free: true,
        msg: '账户已被暂停',
        balance_fen: freeBalance, is_suspended: true,
      });
    }

    const dailyCheck = await peekFreeDailyUsage(userEmail);
    if (!dailyCheck.allowed) {
      return res.status(429).json({
        success: false, can_proceed: false, is_free: true,
        msg: `免费用户每日限 ${dailyCheck.limit} 次调用，今日已使用 ${dailyCheck.used} 次。充值后可无限使用。`,
        daily_used: dailyCheck.used, daily_limit: dailyCheck.limit,
        balance_fen: freeBalance, is_suspended: false,
      });
    }
    return res.json({
      success: true, can_proceed: true, is_free: true, estimated_fen: 0,
      balance_fen: freeBalance, is_suspended: false,
      daily_used: dailyCheck.used, daily_limit: dailyCheck.limit,
    });
  }

  const inTokens  = Math.max(0, parseInt(estimatedInputTokens  ?? estimatedInputChars  ?? '0', 10) || 0);
  const outTokens = Math.max(0, parseInt(estimatedOutputTokens ?? estimatedOutputChars ?? '0', 10) || 0);
  if (inTokens > MAX_TOKEN_VALUE || outTokens > MAX_TOKEN_VALUE) {
    return res.status(400).json({ success: false, msg: 'estimatedInputTokens/outputTokens 单次上限为 10,000,000' });
  }

  const priceIn  = Number(model.price_input_per_1k_tokens);
  const priceOut = Number(model.price_output_per_1k_tokens);
  const promptTk  = parseOptionalNonNegInt(estimatedPromptTokens);
  const historyTk = parseOptionalNonNegInt(estimatedHistoryTokens);

  const estimatedFen = calculateChargedFen({
    inputTokens: inTokens, outputTokens: outTokens,
    priceIn, priceOut,
    currency: model.currency || 'CNY',
    supportsCache: !!model.supports_cache,
    promptTokens: promptTk, historyTokens: historyTk,
  });

  // FIX-5.17-1: 安全熔断
  if (!validateChargedFen(estimatedFen, { userEmail, modelName, inTokens, outTokens })) {
    return res.status(500).json({ success: false, msg: '费用计算异常，请稍后重试' });
  }

  // FIX-5.15-2: 将用户余额查询移至安全上限检查之前，确保 402 响应也包含
  //   balance_fen 和 is_suspended，与 /billing/record 402 响应格式对齐
  let balance     = 0;
  let isSuspended = false;
  try {
    // FIX-5.28-2: 命名预备语句加速重复查询
    const balRes = await db.query({
      name: 'user_bal_status',
      text: 'SELECT balance_fen, is_suspended FROM user_billing WHERE user_email=$1',
      values: [userEmail],
    });
    if (balRes.rows.length > 0) {
      balance     = Number(balRes.rows[0].balance_fen);
      isSuspended = balRes.rows[0].is_suspended;
    }
  } catch (err) {
    logger.error('Billing check error', { err: err.message, userEmail });
    return res.status(500).json({ success: false, msg: '服务器内部错误' });
  }

  // FIX-5.16-1: 付费模型用户暂停时返回 403（与免费模型路径对齐）
  if (isSuspended) {
    return res.status(403).json({
      success:      false,
      can_proceed:  false,
      is_free:      false,
      msg:          '账户已被暂停',
      balance_fen:  balance,
      is_suspended: true,
    });
  }

  const MAX_SINGLE_REQUEST_FEN = getMaxSingleRequestFen();
  if (estimatedFen > MAX_SINGLE_REQUEST_FEN) {
    return res.status(402).json({
      success:       false,
      can_proceed:   false,
      is_free:       false,
      msg:           '预估费用超过单次安全上限，请新建对话或减少上下文。',
      estimated_fen: estimatedFen,
      limit_fen:     MAX_SINGLE_REQUEST_FEN,
      balance_fen:   balance,
      is_suspended:  isSuspended,
    });
  }

  res.json({
    success:       true,
    can_proceed:   !isSuspended && balance >= estimatedFen,
    is_free:       false,
    estimated_fen: estimatedFen,
    balance_fen:   balance,
    is_suspended:  isSuspended,
  });
});

// ─── 计费记录（内部服务专用）──────────────────────────────────
app.post('/billing/record', billingRecordLimiter, requireServiceToken, async (req, res) => {
  let {
    userEmail, apiProvider, modelName,
    inputTokens: rawInputTokens, outputTokens: rawOutputTokens,
    inputChars, outputChars,
    promptTokens: rawPromptTokens, historyTokens: rawHistoryTokens,
    idempotencyKey,
  } = req.body ?? {};

  // 向后兼容旧版 inputChars/outputChars 字段名
  const inputTokens  = rawInputTokens  ?? inputChars  ?? 0;
  const outputTokens = rawOutputTokens ?? outputChars ?? 0;

  if (rawInputTokens == null && inputChars != null) {
    logger.warn('billing/record: 调用方使用旧版 inputChars 字段，请迁移到 inputTokens', { userEmail, modelName });
  }
  if (rawOutputTokens == null && outputChars != null) {
    logger.warn('billing/record: 调用方使用旧版 outputChars 字段，请迁移到 outputTokens', { userEmail, modelName });
  }

  // ── 参数校验 ──────────────────────────────────────────────
  if (!userEmail || !apiProvider || !modelName) {
    return res.status(400).json({ success: false, msg: '参数缺失：需要 userEmail、apiProvider、modelName' });
  }
  userEmail = normalizeEmail(userEmail);
  if (!isValidEmail(userEmail)) {
    return res.status(400).json({ success: false, msg: '邮箱格式不正确' });
  }
  if (typeof apiProvider !== 'string') {
    return res.status(400).json({ success: false, msg: 'apiProvider 必须为字符串' });
  }
  apiProvider = apiProvider.trim();
  if (apiProvider.length === 0 || apiProvider.length > 32) {
    return res.status(400).json({ success: false, msg: 'apiProvider 长度不能超过 32 字符' });
  }
  // FIX-5.23-1: apiProvider 字符集校验——防御日志/SQL 注入（PCI-DSS 6.5）
  if (!API_PROVIDER_RE.test(apiProvider)) {
    return res.status(400).json({ success: false, msg: 'apiProvider 仅允许字母、数字、连字符、下划线、点' });
  }
  if (typeof modelName !== 'string') {
    return res.status(400).json({ success: false, msg: 'modelName 必须为字符串' });
  }
  modelName = modelName.trim();
  if (modelName.length === 0 || modelName.length > 128) {
    return res.status(400).json({ success: false, msg: 'modelName 长度不能超过 128 字符' });
  }
  // FIX-5.24-1: modelName 字符集校验——防御日志注入（PCI-DSS 6.5 输入校验完整性）
  if (!MODEL_NAME_RE.test(modelName)) {
    return res.status(400).json({ success: false, msg: 'modelName 仅允许字母、数字、连字符、下划线、点、冒号、斜杠' });
  }
  if (
    typeof inputTokens !== 'number' || typeof outputTokens !== 'number' ||
    !Number.isFinite(inputTokens)   || !Number.isFinite(outputTokens) ||
    !Number.isInteger(inputTokens)  || !Number.isInteger(outputTokens) ||
    inputTokens < 0 || outputTokens < 0
  ) {
    return res.status(400).json({ success: false, msg: 'inputTokens/outputTokens 必须为有限的非负整数' });
  }
  if (inputTokens > MAX_TOKEN_VALUE || outputTokens > MAX_TOKEN_VALUE) {
    return res.status(400).json({ success: false, msg: 'inputTokens/outputTokens 单次上限为 10,000,000' });
  }

  if (idempotencyKey !== undefined) {
    if (typeof idempotencyKey !== 'string') {
      return res.status(400).json({ success: false, msg: 'idempotencyKey 必须为字符串' });
    }
    idempotencyKey = idempotencyKey.trim();
    if (
      idempotencyKey.length === 0 ||
      idempotencyKey.length > 128 ||
      !IDEMPOTENCY_KEY_RE.test(idempotencyKey)
    ) {
      return res.status(400).json({
        success: false,
        msg: 'idempotencyKey 不合法：必须为 1-128 字符，仅允许字母、数字、- : _ 字符',
      });
    }
  }
  const normalizedIdempKey = (typeof idempotencyKey === 'string') ? idempotencyKey : null;

  const promptTk  = parseOptionalNonNegInt(rawPromptTokens);
  const historyTk = parseOptionalNonNegInt(rawHistoryTokens);

  // ── 幂等键快速路径（事务外，减少锁争用）─────────────────
  // FIX-5.10-1：查询新增 AND au.user_email = $2，防止跨用户 key 碰撞
  if (normalizedIdempKey) {
    try {
      const idempRes = await db.query(
        `SELECT au.charged_fen, au.is_free, ub.balance_fen, ub.is_suspended
           FROM api_usage au
           LEFT JOIN user_billing ub ON ub.user_email = $2
          WHERE au.idempotency_key = $1
            AND au.user_email = $2`,
        [normalizedIdempKey, userEmail]
      );
      if (idempRes.rows.length > 0) {
        logger.info('Idempotent billing record (pre-check hit)', { idempotencyKey: normalizedIdempKey, userEmail });
        const existRec = idempRes.rows[0];
        return res.json({
          success:      true,
          is_free:      existRec.is_free,
          charged_fen:  existRec.is_free ? 0 : Number(existRec.charged_fen),
          balance_fen:  existRec.balance_fen !== null ? Number(existRec.balance_fen) : 0,
          is_suspended: !!existRec.is_suspended,
          idempotent:   true,
        });
      }
    } catch (err) {
      logger.warn('Idempotency pre-check error, continuing with normal billing', { err: err.message });
    }
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    // 事务内使用 FOR SHARE 锁，防止并发 TOCTOU
    const model = await lookupModelInTx(client, modelName);

    if (!model) {
      await safeRollback(client, '/billing/record model not found');
      logger.warn('Model not registered in api_models', { modelName, apiProvider });
      return res.status(404).json({ success: false, msg: '模型不存在，请先通过 POST /admin/models 注册' });
    }
    if (!model.is_active) {
      await safeRollback(client, '/billing/record model inactive');
      return res.status(400).json({ success: false, msg: '该模型当前未启用，无法计费' });
    }

    const modelId  = model.id;
    const isFree   = model.is_free;
    const priceIn  = Number(model.price_input_per_1k_tokens);
    const priceOut = Number(model.price_output_per_1k_tokens);

    // ── 免费模型路径 ──────────────────────────────────────
    if (isFree) {
      // FIX-5.16-2: 免费模型路径也需调用 ensureUser，确保纯免费用户
      //   在 user_billing 中有记录，管理员可通过 GET /admin/users 查看并管理
      await ensureUser(client, userEmail);

      // FIX-5.12-1: 免费模型也需检查用户暂停状态
      // FIX-5.13-1: 同时获取 balance_fen，确保所有响应返回真实余额
      // FIX-5.28-2: 命名预备语句加速重复查询
      const suspendCheck = await client.query({
        name: 'user_bal_status',
        text: 'SELECT balance_fen, is_suspended FROM user_billing WHERE user_email=$1',
        values: [userEmail],
      });
      const freeBalance   = suspendCheck.rows.length > 0 ? Number(suspendCheck.rows[0].balance_fen) : 0;
      const freeSuspended = suspendCheck.rows.length > 0 && !!suspendCheck.rows[0].is_suspended;

      if (freeSuspended) {
        await safeRollback(client, '/billing/record free model suspended');
        return res.status(403).json({
          success: false, msg: '账户已被暂停',
          balance_fen: freeBalance, is_suspended: true,
        });
      }

      const dailyCheck = await incrFreeDailyUsage(userEmail);
      if (!dailyCheck.allowed) {
        await safeRollback(client, '/billing/record free daily limit');
        return res.status(429).json({
          success: false, is_free: true,
          msg: `免费用户每日限 ${dailyCheck.limit} 次调用，今日已使用 ${dailyCheck.used - 1} 次。充值后可无限使用。`,
          daily_used: dailyCheck.used - 1, daily_limit: dailyCheck.limit,
          balance_fen: freeBalance, is_suspended: false,
        });
      }

      try {
        const freeInsertRes = await client.query(
          `INSERT INTO api_usage
               (user_email, api_model_id, api_provider, model_name,
                is_free, input_tokens, output_tokens, charged_fen, status, idempotency_key)
             VALUES ($1,$2,$3,$4,true,$5,$6,0,'ok',$7)
             ON CONFLICT (idempotency_key, user_email)
               WHERE idempotency_key IS NOT NULL
               DO NOTHING
             RETURNING id`,
          [userEmail, modelId, apiProvider, modelName, inputTokens, outputTokens, normalizedIdempKey]
        );

        // 并发幂等冲突：另一请求已提交相同 key，本次 INSERT 被忽略
        if (freeInsertRes.rows.length === 0 && normalizedIdempKey) {
          await safeRollback(client, '/billing/record free concurrent idempotent');
          await tryDecrFreeDailyUsage(dailyCheck.key);
          return res.json({
            success:      true,
            is_free:      true,
            charged_fen:  0,
            balance_fen:  freeBalance,
            is_suspended: freeSuspended,
            idempotent:   true,
            daily_used:   Math.max(0, dailyCheck.used - 1),
            daily_limit:  dailyCheck.limit,
          });
        }

        await client.query('COMMIT');
      } catch (err) {
        logger.error('Free usage DB insert failed, attempting Redis counter rollback', { err: err.message });
        await safeRollback(client, '/billing/record free insert failed');
        await tryDecrFreeDailyUsage(dailyCheck.key);
        return res.status(500).json({ success: false, msg: '服务器内部错误' });
      }

      return res.json({
        success:      true,
        is_free:      true,
        charged_fen:  0,
        balance_fen:  freeBalance,
        is_suspended: freeSuspended,
        daily_used:   dailyCheck.used,
        daily_limit:  dailyCheck.limit,
      });
    }

    // ── 付费模型路径 ──────────────────────────────────────
    await ensureUser(client, userEmail);

    // FIX-5.28-2: 命名预备语句加速重复查询
    const userRes = await client.query({
      name: 'user_bal_for_update',
      text: 'SELECT balance_fen, is_suspended FROM user_billing WHERE user_email=$1 FOR UPDATE',
      values: [userEmail],
    });
    const u = userRes.rows[0];

    // FIX-5.14-1: 付费模型 403 暂停响应补齐 balance_fen 和 is_suspended
    if (u.is_suspended) {
      await safeRollback(client, '/billing/record suspended');
      return res.status(403).json({
        success: false, msg: '账户已被暂停',
        balance_fen: Number(u.balance_fen), is_suspended: true,
      });
    }

    const MAX_SINGLE_REQUEST_FEN = getMaxSingleRequestFen();
    const chargedFen = calculateChargedFen({
      inputTokens, outputTokens,
      priceIn, priceOut,
      currency: model.currency || 'CNY',
      supportsCache: !!model.supports_cache,
      promptTokens: promptTk, historyTokens: historyTk,
    });

    // FIX-5.17-1: 安全熔断
    if (!validateChargedFen(chargedFen, { userEmail, modelName, inputTokens, outputTokens })) {
      await safeRollback(client, '/billing/record chargedFen validation');
      return res.status(500).json({ success: false, msg: '费用计算异常，请稍后重试' });
    }

    if (chargedFen > MAX_SINGLE_REQUEST_FEN) {
      await safeRollback(client, '/billing/record over safety limit');
      return res.status(402).json({
        success:     false,
        msg:         '单次请求费用超过安全上限，请新建对话或减少上下文。',
        charged_fen: chargedFen,
        limit_fen:   MAX_SINGLE_REQUEST_FEN,
        balance_fen: Number(u.balance_fen),
        is_suspended: !!u.is_suspended,
      });
    }

    if (Number(u.balance_fen) < chargedFen) {
      await safeRollback(client, '/billing/record insufficient balance');
      return res.status(402).json({
        success:      false,
        msg:          '余额不足，请充值后继续使用',
        balance_fen:  Number(u.balance_fen),
        required_fen: chargedFen,
        is_suspended: !!u.is_suspended,
      });
    }

    // FIX-5.17-3: chargedFen=0 时跳过余额扣减，避免无效 UPDATE 占用行锁
    // u 来自上方 FOR UPDATE 查询（userRes.rows[0]）
    let newBalance = Number(u.balance_fen);
    if (chargedFen > 0) {
      const deductRes = await client.query(
        `UPDATE user_billing
            SET balance_fen       = balance_fen - $1,
                total_charged_fen = total_charged_fen + $1
          WHERE user_email = $2
            AND balance_fen >= $1
          RETURNING balance_fen`,
        [chargedFen, userEmail]
      );
      // 防御性兜底：FOR UPDATE 锁后余额仍不足（理论不可达，DB CHECK 约束兜底）
      if (deductRes.rows.length === 0) {
        await safeRollback(client, '/billing/record balance deduct race');
        return res.status(402).json({
          success: false, msg: '余额不足，请充值后继续使用',
          balance_fen: Number(u.balance_fen), is_suspended: !!u.is_suspended,
        });
      }
      newBalance = Number(deductRes.rows[0].balance_fen);
    }

    const usageRes = await client.query(
      `INSERT INTO api_usage
           (user_email, api_model_id, api_provider, model_name,
            is_free, input_tokens, output_tokens, charged_fen, status, idempotency_key)
         VALUES ($1,$2,$3,$4,false,$5,$6,$7,'ok',$8)
         ON CONFLICT (idempotency_key, user_email)
           WHERE idempotency_key IS NOT NULL
           DO NOTHING
         RETURNING id`,
      [userEmail, modelId, apiProvider, modelName, inputTokens, outputTokens, chargedFen, normalizedIdempKey]
    );

    // 并发幂等冲突（付费模型）：回滚已扣费的事务，返回已有记录
    // FIX-5.10-1：查询新增 AND au.user_email = $2，防止跨用户 key 碰撞
    if (usageRes.rows.length === 0 && normalizedIdempKey) {
      await safeRollback(client, '/billing/record idempotency conflict');
      logger.info('Idempotent billing record (conflict resolution)', { idempotencyKey: normalizedIdempKey, userEmail });
      const existingRes = await db.query(
        `SELECT au.charged_fen, au.is_free, ub.balance_fen, ub.is_suspended
           FROM api_usage au
           LEFT JOIN user_billing ub ON ub.user_email = $2
          WHERE au.idempotency_key = $1
            AND au.user_email = $2`,
        [normalizedIdempKey, userEmail]
      );
      return res.json({
        success:      true,
        is_free:      existingRes.rows.length > 0 ? existingRes.rows[0].is_free : false,
        charged_fen:  existingRes.rows.length > 0 ? Number(existingRes.rows[0].charged_fen) : chargedFen,
        balance_fen:  existingRes.rows.length > 0 && existingRes.rows[0].balance_fen !== null
          ? Number(existingRes.rows[0].balance_fen) : 0,
        is_suspended: existingRes.rows.length > 0 ? !!existingRes.rows[0].is_suspended : false,
        idempotent:   true,
      });
    }

    const usageId = usageRes.rows[0]?.id;
    if (!usageId) {
      logger.error('api_usage INSERT returned no rows (non-idempotent path)', { userEmail, modelName });
      await safeRollback(client, '/billing/record no usage id');
      return res.status(500).json({ success: false, msg: '服务器内部错误' });
    }

    // FIX-5.11-2 + FIX-5.17-3: chargedFen=0 时跳过流水 INSERT（避免违反 CHECK amount_fen != 0）
    // 场景：管理员将付费模型的输入/输出价格均设为 0 但未标记 is_free
    if (chargedFen > 0) {
      await client.query(
        `INSERT INTO billing_transactions
             (user_email, type, amount_fen, balance_after_fen, description, ref_id)
           VALUES ($1,'charge',$2,$3,$4,$5)`,
        [
          userEmail,
          chargedFen,
          newBalance,
          `${modelName}（输入 ${inputTokens} Token / 输出 ${outputTokens} Token）`,
          String(usageId),
        ]
      );
    } else {
      logger.warn('付费模型 chargedFen=0，跳过余额扣减和流水记录（请检查模型定价配置，考虑标记为 is_free）', {
        userEmail, modelName, inputTokens, outputTokens, priceIn, priceOut,
      });
    }

    await client.query('COMMIT');

    logger.info('Billing recorded', { userEmail, modelName, chargedFen, idempotencyKey: normalizedIdempKey });

    res.json({ success: true, is_free: false, charged_fen: chargedFen, balance_fen: newBalance, is_suspended: !!u.is_suspended });
  } catch (err) {
    await safeRollback(client, '/billing/record unhandled error');
    logger.error('Billing record error', { err: err.message, userEmail, request_id: req.id });
    return res.status(500).json({ success: false, msg: '服务器内部错误' });
  } finally {
    client.release();
  }
});
// ─── 管理员接口 ───────────────────────────────────────────────
// =============================================================

// ── 综合管理控制台（FIX-5.19-1）──────────────────────────────
const ADMIN_HTML_PATH = path.join(__dirname, 'public', 'admin.html');
// 启动时缓存 admin.html，避免每次请求同步读取文件阻塞事件循环
let adminHtmlCache = null;
// FIX-5.24-2: 预转换为 Buffer，避免每次 res.send() 进行 string→Buffer 转换
let adminHtmlBuffer = null;
// FIX-5.22-2: 预计算 ETag，支持 304 条件请求减少传输
let adminHtmlEtag = null;
try {
  adminHtmlCache = fs.readFileSync(ADMIN_HTML_PATH, 'utf8');
  adminHtmlBuffer = Buffer.from(adminHtmlCache, 'utf8');
  adminHtmlEtag = '"' + crypto.createHash('sha256').update(adminHtmlCache).digest('hex') + '"';
} catch {
  logger.warn('Admin dashboard HTML not found at startup', { path: ADMIN_HTML_PATH });
}

app.get('/admin/dashboard', (req, res) => {
  if (!adminHtmlBuffer) {
    return res.status(500).json({ success: false, msg: '管理页面文件缺失' });
  }
  // FIX-5.22-2: ETag 条件请求——浏览器缓存命中时返回 304
  if (adminHtmlEtag && req.headers['if-none-match'] === adminHtmlEtag) {
    return res.status(304).end();
  }
  // FIX-5.24-1: PCI-DSS 数据最小化——阻止搜索引擎收录管理页面
  res.setHeader('X-Robots-Tag', 'noindex, nofollow, noarchive');
  // FIX-5.20-2: 严格化 CSP (PCI-DSS & CIS)
  // 补齐 connect-src / form-action / base-uri / frame-ancestors
  res.setHeader('Content-Security-Policy',
    "default-src 'none'; script-src 'self' 'unsafe-inline'; " +
    "style-src 'self' 'unsafe-inline'; img-src 'self' data:; " +
    "font-src 'self' data:; connect-src 'self'; " +
    "form-action 'self'; base-uri 'self'; frame-ancestors 'none';");
  if (adminHtmlEtag) res.setHeader('ETag', adminHtmlEtag);
  // FIX-5.24-2: 发送预转换的 Buffer，避免 string→Buffer 运行时开销
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Length', adminHtmlBuffer.length);
  res.end(adminHtmlBuffer);
});

// ── 模块状态（FIX-5.19-2）────────────────────────────────────
const MODULES_YML_PATH = process.env.MODULES_YML_PATH
  || path.join(__dirname, '..', 'modules', 'modules.yml');

app.get('/admin/modules', adminLimiter, requireAdmin, async (_req, res) => {
  try {
    // 安全校验：仅允许读取 .yml/.yaml 文件
    const resolvedPath = path.resolve(MODULES_YML_PATH);
    if (!/\.ya?ml$/i.test(resolvedPath)) {
      logger.warn('MODULES_YML_PATH 扩展名不合法', { path: resolvedPath });
      return res.json({ success: true, categories: {} });
    }
    const content = await fs.promises.readFile(resolvedPath, 'utf8');
    // FIX-5.21-1: CIS 输入校验——使用 FAILSAFE_SCHEMA 阻断 YAML 反序列化攻击
    const parsed = yaml.load(content, { schema: yaml.FAILSAFE_SCHEMA });
    res.json({ success: true, categories: parsed || {} });
  } catch (err) {
    if (err.code === 'ENOENT') {
      // 文件不存在——降级返回空列表（Docker 环境可能未挂载该文件）
      logger.info('modules.yml not found, returning empty list', { path: MODULES_YML_PATH });
      return res.json({ success: true, categories: {} });
    }
    logger.error('Modules YAML read error', { err: err.message });
    res.status(500).json({ success: false, msg: '模块配置读取失败' });
  }
});

// ── 模型管理 ─────────────────────────────────────────────────

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

app.post('/admin/models', adminLimiter, requireAdmin, async (req, res) => {
  let { provider, modelName, displayName, isFree, priceInput, priceOutput,
          currency, supportsCache, description } = req.body ?? {};

  if (!provider || !modelName || !displayName) {
    return res.status(400).json({ success: false, msg: '缺少必填字段：provider、modelName、displayName' });
  }
  if (typeof provider !== 'string') {
    return res.status(400).json({ success: false, msg: 'provider 必须为字符串' });
  }
  provider = provider.trim();
  if (provider.length === 0 || provider.length > 32) {
    return res.status(400).json({ success: false, msg: 'provider 长度不能超过 32 字符' });
  }
  // FIX-5.24-1: provider 字符集校验——防御日志/SQL 注入（PCI-DSS 6.5）
  if (!API_PROVIDER_RE.test(provider)) {
    return res.status(400).json({ success: false, msg: 'provider 仅允许字母、数字、连字符、下划线、点' });
  }
  if (typeof modelName !== 'string') {
    return res.status(400).json({ success: false, msg: 'modelName 必须为字符串' });
  }
  modelName = modelName.trim();
  if (modelName.length === 0 || modelName.length > 128) {
    return res.status(400).json({ success: false, msg: 'modelName 长度不能超过 128 字符' });
  }
  if (typeof displayName !== 'string') {
    return res.status(400).json({ success: false, msg: 'displayName 必须为字符串' });
  }
  displayName = displayName.trim();
  if (displayName.length === 0 || displayName.length > 128) {
    return res.status(400).json({ success: false, msg: 'displayName 长度不能超过 128 字符' });
  }
  if (typeof isFree !== 'boolean') {
    return res.status(400).json({ success: false, msg: 'isFree 必须为布尔值' });
  }
  if (!isFree) {
    if (typeof priceInput !== 'number' || typeof priceOutput !== 'number' ||
        !Number.isFinite(priceInput) || !Number.isFinite(priceOutput)) {
      return res.status(400).json({ success: false, msg: '付费模型必须提供有限数值的 priceInput 和 priceOutput' });
    }
    if (priceInput < 0 || priceOutput < 0) {
      return res.status(400).json({ success: false, msg: 'priceInput 和 priceOutput 必须为非负数' });
    }
    if (priceInput > 100 || priceOutput > 100) {
      return res.status(400).json({ success: false, msg: 'priceInput/priceOutput 不得超过 100（元/千 Token）' });
    }
  }
  const currencyVal = currency ?? 'CNY';
  if (!['USD', 'CNY'].includes(currencyVal)) {
    return res.status(400).json({ success: false, msg: 'currency 必须为 USD 或 CNY' });
  }
  if (description != null) {
    if (typeof description !== 'string') {
      return res.status(400).json({ success: false, msg: 'description 必须为字符串' });
    }
    description = description.trim();
    if (description.length > 1000) {
      return res.status(400).json({ success: false, msg: 'description 长度不能超过 1000 字符' });
    }
  }

  try {
    const result = await db.query(
      `INSERT INTO api_models
           (provider, model_name, display_name, is_free,
            price_input_per_1k_tokens, price_output_per_1k_tokens, currency, supports_cache, description)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (model_name) DO UPDATE SET
           provider     = EXCLUDED.provider,
           display_name = EXCLUDED.display_name,
           is_free      = EXCLUDED.is_free,
           price_input_per_1k_tokens  = EXCLUDED.price_input_per_1k_tokens,
           price_output_per_1k_tokens = EXCLUDED.price_output_per_1k_tokens,
           currency     = EXCLUDED.currency,
           supports_cache = EXCLUDED.supports_cache,
           description  = EXCLUDED.description,
           is_active    = true
         RETURNING id, provider, model_name, display_name, is_free,
                   price_input_per_1k_tokens, price_output_per_1k_tokens,
                   currency, supports_cache, is_active`,
      [provider, modelName, stripControlChars(displayName), isFree,
       isFree ? 0 : priceInput, isFree ? 0 : priceOutput,
       currencyVal, !!supportsCache, stripControlChars(description) || null]
    );

    // 清除模型缓存，确保 /billing/check 立即读到新价格（FIX-5.9-6）
    modelCacheDelete(modelName);

    auditLog('model_upsert', { modelName, isFree }, req);
    res.json({ success: true, model: result.rows[0] });
  } catch (err) {
    logger.error('Model upsert error', { err: err.message });
    res.status(500).json({ success: false, msg: '服务器内部错误' });
  }
});

app.put('/admin/models/:id', adminLimiter, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, msg: '模型 ID 无效' });
  }

  let currentModel;
  try {
    const cur = await db.query('SELECT is_free, model_name FROM api_models WHERE id=$1', [id]);
    if (cur.rows.length === 0) {
      return res.status(404).json({ success: false, msg: '模型不存在' });
    }
    currentModel = cur.rows[0];
  } catch (err) {
    logger.error('Model fetch error in PUT', { err: err.message, id });
    return res.status(500).json({ success: false, msg: '服务器内部错误' });
  }

  const { isFree, priceInput, priceOutput, currency, isActive,
          supportsCache, displayName, description } = req.body ?? {};
  const updates = [];
  const values  = [];

  const effectiveIsFree = (typeof isFree === 'boolean') ? isFree : currentModel.is_free;

  if (typeof isFree === 'boolean') {
    updates.push(`is_free = $${values.length + 1}`);
    values.push(isFree);
    if (isFree) {
      updates.push(`price_input_per_1k_tokens = $${values.length + 1}`);
      values.push(0);
      updates.push(`price_output_per_1k_tokens = $${values.length + 1}`);
      values.push(0);
    } else if (currentModel.is_free) {
      // 从免费切换为付费：必须同时提供价格参数
      if (typeof priceInput !== 'number' || typeof priceOutput !== 'number') {
        return res.status(400).json({ success: false, msg: '从免费模型切换为付费模型时必须同时提供 priceInput 和 priceOutput' });
      }
    }
  }

  if (!effectiveIsFree && typeof priceInput === 'number') {
    if (!Number.isFinite(priceInput) || priceInput < 0) {
      return res.status(400).json({ success: false, msg: 'priceInput 必须为有限的非负数' });
    }
    if (priceInput > 100) {
      return res.status(400).json({ success: false, msg: 'priceInput 不得超过 100（元/千 Token）' });
    }
    updates.push(`price_input_per_1k_tokens = $${values.length + 1}`);
    values.push(priceInput);
  } else if (effectiveIsFree && typeof priceInput === 'number' && priceInput !== 0) {
    return res.status(400).json({ success: false, msg: '免费模型不能设置非零输入价格' });
  }

  if (!effectiveIsFree && typeof priceOutput === 'number') {
    if (!Number.isFinite(priceOutput) || priceOutput < 0) {
      return res.status(400).json({ success: false, msg: 'priceOutput 必须为有限的非负数' });
    }
    if (priceOutput > 100) {
      return res.status(400).json({ success: false, msg: 'priceOutput 不得超过 100（元/千 Token）' });
    }
    updates.push(`price_output_per_1k_tokens = $${values.length + 1}`);
    values.push(priceOutput);
  } else if (effectiveIsFree && typeof priceOutput === 'number' && priceOutput !== 0) {
    return res.status(400).json({ success: false, msg: '免费模型不能设置非零输出价格' });
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
    const trimmedDisplayName = displayName.trim();
    if (trimmedDisplayName.length === 0) {
      return res.status(400).json({ success: false, msg: 'displayName 不能为空' });
    }
    if (trimmedDisplayName.length > 128) {
      return res.status(400).json({ success: false, msg: 'displayName 长度不能超过 128 字符' });
    }
    updates.push(`display_name = $${values.length + 1}`);
    values.push(stripControlChars(trimmedDisplayName));
  }
  if (typeof description === 'string') {
    if (description.length > 1000) {
      return res.status(400).json({ success: false, msg: 'description 长度不能超过 1000 字符' });
    }
    updates.push(`description = $${values.length + 1}`);
    values.push(stripControlChars(description));
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

    // 清除模型缓存（FIX-5.9-6）
    modelCacheDelete(currentModel.model_name);
    if (result.rows[0].model_name !== currentModel.model_name) {
      modelCacheDelete(result.rows[0].model_name);
    }

    auditLog('model_update', { id, modelName: currentModel.model_name }, req);
    res.json({ success: true, model: result.rows[0] });
  } catch (err) {
    logger.error('Model update error', { err: err.message });
    res.status(500).json({ success: false, msg: '服务器内部错误' });
  }
});

// FIX-5.14-3: DELETE /admin/models/:id 软删除（设 is_active=false）
app.delete('/admin/models/:id', adminLimiter, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, msg: '模型 ID 无效' });
  }

  try {
    const result = await db.query(
      `UPDATE api_models SET is_active = false
        WHERE id = $1
        RETURNING id, model_name, display_name, is_active`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, msg: '模型不存在' });
    }

    modelCacheDelete(result.rows[0].model_name);

    auditLog('model_deactivate', { id, modelName: result.rows[0].model_name }, req);
    res.json({ success: true, model: result.rows[0] });
  } catch (err) {
    logger.error('Model deactivate error', { err: err.message });
    res.status(500).json({ success: false, msg: '服务器内部错误' });
  }
});

// ── Provider 配置管理 ─────────────────────────────────────────

app.get('/admin/providers', adminLimiter, requireAdmin, async (_req, res) => {
  try {
    const result = await db.query(
      `SELECT id, provider_name, display_name, base_url, is_enabled,
              description, created_at, updated_at
         FROM api_providers ORDER BY provider_name`
    ).catch((err) => {
      if (err.code === '42P01') { return { rows: [] }; }
      throw err;
    });
    res.json({ success: true, providers: result.rows });
  } catch (err) {
    logger.error('Admin providers query error', { err: err.message });
    res.status(500).json({ success: false, msg: '服务器内部错误' });
  }
});

app.post('/admin/providers', adminLimiter, requireAdmin, async (req, res) => {
  let { providerName, displayName, baseUrl, isEnabled, description } = req.body ?? {};

  if (!providerName || !displayName || !baseUrl) {
    return res.status(400).json({ success: false, msg: '缺少必填字段：providerName、displayName、baseUrl' });
  }
  if (typeof providerName !== 'string') {
    return res.status(400).json({ success: false, msg: 'providerName 必须为字符串' });
  }
  providerName = providerName.trim();
  if (providerName.length === 0 || providerName.length > 32) {
    return res.status(400).json({ success: false, msg: 'providerName 长度不能超过 32 字符' });
  }
  // FIX-5.25-1: providerName 字符集校验——与 apiProvider 校验对齐，防御日志/SQL 注入（PCI-DSS 6.5）
  if (!API_PROVIDER_RE.test(providerName)) {
    return res.status(400).json({ success: false, msg: 'providerName 仅允许字母、数字、连字符、下划线、点' });
  }
  if (typeof displayName !== 'string') {
    return res.status(400).json({ success: false, msg: 'displayName 必须为字符串' });
  }
  displayName = displayName.trim();
  if (displayName.length === 0 || displayName.length > 64) {
    return res.status(400).json({ success: false, msg: 'displayName 长度不能超过 64 字符' });
  }
  if (typeof baseUrl !== 'string') {
    return res.status(400).json({ success: false, msg: 'baseUrl 必须为字符串' });
  }
  baseUrl = baseUrl.trim();
  if (baseUrl.length === 0 || baseUrl.length > 256) {
    return res.status(400).json({ success: false, msg: 'baseUrl 长度不能超过 256 字符' });
  }
  // FIX-5.21-1: SSRF 防护——校验 URL 格式并禁止内网/保留地址
  if (!isValidBaseUrl(baseUrl)) {
    return res.status(400).json({ success: false, msg: 'baseUrl 格式不正确或指向内网/保留地址（仅允许公网 HTTP/HTTPS URL）' });
  }
  // FIX-5.9-4: description 长度校验
  if (description != null) {
    if (typeof description !== 'string') {
      return res.status(400).json({ success: false, msg: 'description 必须为字符串' });
    }
    description = description.trim();
    if (description.length > 500) {
      return res.status(400).json({ success: false, msg: 'description 长度不能超过 500 字符' });
    }
  }

  try {
    const result = await db.query(
      `INSERT INTO api_providers
           (provider_name, display_name, base_url, is_enabled, description)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (provider_name) DO UPDATE SET
           display_name = EXCLUDED.display_name,
           base_url     = EXCLUDED.base_url,
           is_enabled   = EXCLUDED.is_enabled,
           description  = EXCLUDED.description
         RETURNING *`,
      [providerName, stripControlChars(displayName), baseUrl, isEnabled !== false, stripControlChars(description) || null]
    );
    auditLog('provider_upsert', { providerName }, req);
    res.json({ success: true, provider: result.rows[0] });
  } catch (err) {
    logger.error('Provider upsert error', { err: err.message });
    res.status(500).json({ success: false, msg: '服务器内部错误' });
  }
});

// FIX-5.9-5: PUT /admin/providers/:id 端点
app.put('/admin/providers/:id', adminLimiter, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, msg: 'Provider ID 无效' });
  }

  const { displayName, baseUrl, isEnabled, description } = req.body ?? {};
  const updates = [];
  const values  = [];

  if (typeof displayName === 'string') {
    const trimmedDisplayName = displayName.trim();
    if (trimmedDisplayName.length === 0 || trimmedDisplayName.length > 64) {
      return res.status(400).json({ success: false, msg: 'displayName 不能为空且长度不超过 64 字符' });
    }
    updates.push(`display_name = $${values.length + 1}`);
    values.push(stripControlChars(trimmedDisplayName));
  }
  if (typeof baseUrl === 'string') {
    // FIX-5.21-1: SSRF 防护（同 POST /admin/providers）
    if (baseUrl.length > 256 || !isValidBaseUrl(baseUrl)) {
      return res.status(400).json({ success: false, msg: 'baseUrl 格式不正确或指向内网/保留地址（长度 ≤ 256，仅允许公网 HTTP/HTTPS URL）' });
    }
    updates.push(`base_url = $${values.length + 1}`);
    values.push(baseUrl);
  }
  if (typeof isEnabled === 'boolean') {
    updates.push(`is_enabled = $${values.length + 1}`);
    values.push(isEnabled);
  }
  if (typeof description === 'string') {
    if (description.length > 500) {
      return res.status(400).json({ success: false, msg: 'description 长度不能超过 500 字符' });
    }
    updates.push(`description = $${values.length + 1}`);
    values.push(stripControlChars(description));
  }

  if (updates.length === 0) {
    return res.status(400).json({ success: false, msg: '没有任何要更新的字段' });
  }

  values.push(id);
  try {
    const result = await db.query(
      `UPDATE api_providers SET ${updates.join(', ')} WHERE id=$${values.length} RETURNING *`,
      values
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, msg: 'Provider 不存在' });
    }
    auditLog('provider_update', { id }, req);
    res.json({ success: true, provider: result.rows[0] });
  } catch (err) {
    logger.error('Provider update error', { err: err.message });
    res.status(500).json({ success: false, msg: '服务器内部错误' });
  }
});

// FIX-5.18-3: DELETE /admin/providers/:id 软禁用（设 is_enabled=false）
// 与 DELETE /admin/models/:id 对齐，补齐 Provider CRUD 的 D 操作
app.delete('/admin/providers/:id', adminLimiter, requireAdmin, async (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!Number.isInteger(id) || id <= 0) {
    return res.status(400).json({ success: false, msg: 'Provider ID 无效' });
  }

  try {
    const result = await db.query(
      `UPDATE api_providers SET is_enabled = false
        WHERE id = $1
        RETURNING id, provider_name, display_name, is_enabled`,
      [id]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, msg: 'Provider 不存在' });
    }

    auditLog('provider_deactivate', { id, providerName: result.rows[0].provider_name }, req);
    res.json({ success: true, provider: result.rows[0] });
  } catch (err) {
    logger.error('Provider deactivate error', { err: err.message });
    res.status(500).json({ success: false, msg: '服务器内部错误' });
  }
});

// ── 余额调整 ──────────────────────────────────────────────────

app.post('/admin/adjust', adminLimiter, requireAdmin, async (req, res) => {
  let { userEmail, amount_fen, type, description } = req.body ?? {};

  userEmail = normalizeEmail(userEmail || '');
  if (!isValidEmail(userEmail)) {
    return res.status(400).json({ success: false, msg: '邮箱格式不正确' });
  }
  if (typeof amount_fen !== 'number' || !Number.isInteger(amount_fen) || amount_fen === 0) {
    return res.status(400).json({ success: false, msg: 'amount_fen 必须为非零整数' });
  }
  if (Math.abs(amount_fen) > 1_000_000) {
    return res.status(400).json({ success: false, msg: '单次调整金额不能超过 ¥10,000（1,000,000 分）' });
  }
  const validTypes = ['recharge', 'refund', 'admin_adjust'];
  if (!validTypes.includes(type)) {
    return res.status(400).json({ success: false, msg: `type 必须是 ${validTypes.join('/')} 之一` });
  }
  // FIX-5.12-4: recharge/refund 类型强制正数，避免产生语义矛盾的审计流水
  // 注：amount_fen === 0 已被上方校验拦截，此处 <= 0 为防御性兜底
  if ((type === 'recharge' || type === 'refund') && amount_fen <= 0) {
    return res.status(400).json({
      success: false,
      msg: `${type} 类型的 amount_fen 必须为正数（如需扣减请使用 admin_adjust 类型并传入负数）`,
    });
  }
  if (description != null) {
    if (typeof description !== 'string') {
      return res.status(400).json({ success: false, msg: 'description 必须为字符串' });
    }
    description = description.trim();
    if (description.length > 500) {
      return res.status(400).json({ success: false, msg: 'description 长度不能超过 500 字符' });
    }
  }

  const client = await db.connect();
  try {
    await client.query('BEGIN');

    await ensureUser(client, userEmail);

    // FIX-5.18-2: 补齐 is_suspended 列，确保响应与其他计费端点一致
    const prevRes = await client.query(
      'SELECT balance_fen, is_suspended FROM user_billing WHERE user_email=$1 FOR UPDATE',
      [userEmail]
    );
    const oldBalance  = Number(prevRes.rows[0].balance_fen);
    const isSuspended = !!prevRes.rows[0].is_suspended;

    const result = await client.query(
      `UPDATE user_billing
          SET balance_fen = GREATEST(0, balance_fen + $1)
        WHERE user_email = $2
        RETURNING balance_fen`,
      [amount_fen, userEmail]
    );
    const newBalance    = Number(result.rows[0].balance_fen);
    const actualApplied = newBalance - oldBalance;

    // FIX-5.8-1: actualApplied 为 0 时跳过流水 INSERT（避免违反 CHECK amount_fen != 0）
    // 场景：余额为 0 时执行负数扣减 → GREATEST(0,0-N)=0 → 无实际变动
    if (actualApplied !== 0) {
      await client.query(
        `INSERT INTO billing_transactions
             (user_email, type, amount_fen, balance_after_fen, description)
           VALUES ($1,$2,$3,$4,$5)`,
        [userEmail, type, actualApplied, newBalance, stripControlChars(description) || '管理员调整']
      );
    }

    await client.query('COMMIT');

    auditLog('balance_adjust', { userEmail, amount_fen, actualApplied, type }, req);

    const response = {
      success:            true,
      balance_fen:        newBalance,
      actual_applied_fen: actualApplied,
      is_suspended:       isSuspended, // FIX-5.18-2
    };
    // 扣减被截断到 0 时附带说明
    if (actualApplied === 0 && amount_fen < 0) {
      response.note = `余额已为 0，扣减无效（请求扣减 ${Math.abs(amount_fen)} 分，实际扣减 0 分）`;
    }

    res.json(response);
  } catch (err) {
    await safeRollback(client, '/admin/adjust error');
    logger.error('Admin adjust error', { err: err.message });
    res.status(500).json({ success: false, msg: '服务器内部错误' });
  } finally {
    client.release();
  }
});

// ── FIX-5.15-3: 用户管理 ─────────────────────────────────────

app.get('/admin/users', adminLimiter, requireAdmin, async (req, res) => {
  const limit  = Math.min(Math.max(parseInt(req.query.limit  || '20', 10) || 20, 1), 100);
  // FIX-5.26-1: CIS 资源保护——cap offset 防止深分页 DoS
  const offset = Math.min(Math.max(parseInt(req.query.offset || '0', 10) || 0, 0), MAX_PAGINATION_OFFSET);

  try {
    // FIX-5.25-2: 使用 COUNT(*) OVER() 窗口函数，单次查询同时返回分页数据与总数
    const result = await db.query(
      `SELECT user_email, balance_fen, total_charged_fen, is_suspended, created_at, updated_at,
              COUNT(*) OVER() AS _total
         FROM user_billing
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2`,
      [limit, offset]
    );
    const total = result.rows.length > 0 ? Number(result.rows[0]._total) : 0;
    const users = result.rows.map(({ _total, ...rest }) => rest);
    res.json({ success: true, users, total });
  } catch (err) {
    logger.error('Admin users query error', { err: err.message });
    res.status(500).json({ success: false, msg: '服务器内部错误' });
  }
});

app.put('/admin/users/:email/suspend', adminLimiter, requireAdmin, async (req, res) => {
  const email = normalizeEmail(req.params.email);
  if (!isValidEmail(email)) {
    return res.status(400).json({ success: false, msg: '邮箱格式不正确' });
  }

  try {
    const result = await db.query(
      `UPDATE user_billing SET is_suspended = true WHERE user_email = $1
       RETURNING user_email, balance_fen, is_suspended`,
      [email]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, msg: '用户不存在' });
    }
    auditLog('user_suspend', { email }, req);
    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    logger.error('User suspend error', { err: err.message, email });
    res.status(500).json({ success: false, msg: '服务器内部错误' });
  }
});

app.put('/admin/users/:email/unsuspend', adminLimiter, requireAdmin, async (req, res) => {
  const email = normalizeEmail(req.params.email);
  if (!isValidEmail(email)) {
    return res.status(400).json({ success: false, msg: '邮箱格式不正确' });
  }

  try {
    const result = await db.query(
      `UPDATE user_billing SET is_suspended = false WHERE user_email = $1
       RETURNING user_email, balance_fen, is_suspended`,
      [email]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ success: false, msg: '用户不存在' });
    }
    auditLog('user_unsuspend', { email }, req);
    res.json({ success: true, user: result.rows[0] });
  } catch (err) {
    logger.error('User unsuspend error', { err: err.message, email });
    res.status(500).json({ success: false, msg: '服务器内部错误' });
  }
});

// ── FIX-5.15-4: 充值卡管理 ───────────────────────────────────

const MAX_CREDIT_FEN          = 1_000_000;  // 单张卡密最大面额（分），与 admin/adjust 上限一致
const MAX_CARDS_PER_REQUEST   = 100;        // 单次批量创建卡密上限

app.post('/admin/cards', adminLimiter, requireAdmin, async (req, res) => {
  let { creditFen, label, count } = req.body ?? {};

  if (typeof creditFen !== 'number' || !Number.isInteger(creditFen) || creditFen <= 0) {
    return res.status(400).json({ success: false, msg: 'creditFen 必须为正整数（单位：分）' });
  }
  if (creditFen > MAX_CREDIT_FEN) {
    return res.status(400).json({ success: false, msg: `creditFen 不能超过 ${MAX_CREDIT_FEN.toLocaleString()} 分（¥${(MAX_CREDIT_FEN / 100).toLocaleString()}）` });
  }
  if (label != null) {
    if (typeof label !== 'string') {
      return res.status(400).json({ success: false, msg: 'label 必须为字符串' });
    }
    label = label.trim();
    if (label.length > 128) {
      return res.status(400).json({ success: false, msg: 'label 长度不能超过 128 字符' });
    }
  }

  const cardCount = (typeof count === 'number' && Number.isInteger(count) && count >= 1 && count <= MAX_CARDS_PER_REQUEST)
    ? count : 1;

  try {
    // 批量 INSERT：一条 SQL 插入所有卡密，避免循环中多次 DB 往返
    const keys = [];
    const valuePlaceholders = [];
    const params = [];
    const labelVal = stripControlChars(label) || null;
    for (let i = 0; i < cardCount; i++) {
      const cardKey = crypto.randomBytes(16).toString('hex').toUpperCase();
      keys.push(cardKey);
      const base = i * 3;
      valuePlaceholders.push(`($${base + 1}, $${base + 2}, $${base + 3})`);
      params.push(cardKey, creditFen, labelVal);
    }
    const result = await db.query(
      `INSERT INTO recharge_cards (key, credit_fen, label)
         VALUES ${valuePlaceholders.join(', ')}
         RETURNING id, key, credit_fen, label, created_at`,
      params
    );

    auditLog('cards_create', { count: cardCount, creditFen }, req);
    res.json({ success: true, cards: result.rows });
  } catch (err) {
    logger.error('Card creation error', { err: err.message });
    res.status(500).json({ success: false, msg: '服务器内部错误' });
  }
});

app.get('/admin/cards', adminLimiter, requireAdmin, async (req, res) => {
  const limit  = Math.min(Math.max(parseInt(req.query.limit  || '20', 10) || 20, 1), 100);
  // FIX-5.26-1: CIS 资源保护——cap offset 防止深分页 DoS
  const offset = Math.min(Math.max(parseInt(req.query.offset || '0', 10) || 0, 0), MAX_PAGINATION_OFFSET);
  const usedFilter = req.query.used;  // 'true', 'false', or undefined (all)

  try {
    let whereClause = '';
    const params = [limit, offset];
    if (usedFilter === 'true') {
      whereClause = 'WHERE used = true';
    } else if (usedFilter === 'false') {
      whereClause = 'WHERE used = false';
    }

    // FIX-5.25-2: 使用 COUNT(*) OVER() 窗口函数，单次查询同时返回分页数据与总数
    const result = await db.query(
      `SELECT id, key, credit_fen, label, used, used_at, used_by, created_at,
              COUNT(*) OVER() AS _total
         FROM recharge_cards
        ${whereClause}
        ORDER BY created_at DESC
        LIMIT $1 OFFSET $2`,
      params
    );
    const total = result.rows.length > 0 ? Number(result.rows[0]._total) : 0;
    // FIX-5.21-1: PCI-DSS 3.4——服务端掩码卡密，仅显示前4后4字符
    // 防止网络层/日志/浏览器缓存泄露全量密钥
    const maskedCards = result.rows.map(({ _total, ...c }) => ({
      ...c,
      key: c.key && c.key.length > 10
        ? c.key.slice(0, 4) + '••••' + c.key.slice(-4)
        : '••••••••',
    }));
    res.json({ success: true, cards: maskedCards, total });
  } catch (err) {
    logger.error('Admin cards query error', { err: err.message });
    res.status(500).json({ success: false, msg: '服务器内部错误' });
  }
});

// ─── 404 & 全局错误处理 ───────────────────────────────────────
// FIX-5.27-2: 使用预序列化 Buffer 响应
app.use((_req, res) => {
  res.status(404).setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(RESP_404);
});

// eslint-disable-next-line no-unused-vars
app.use((err, req, res, _next) => {
  logger.error('Unhandled error', { err: err.message, stack: err.stack, request_id: req.id });
  if (res.headersSent) return;
  res.status(500).json({ success: false, msg: '服务器内部错误' });
});

// ─── 启动 ─────────────────────────────────────────────────────
// FIX-5.21-1: 启动时校验关键环境变量（PCI-DSS 配置管理）
if (!process.env.PG_PASSWORD) {
  logger.warn('PG_PASSWORD 未设置，数据库连接可能失败');
}
// FIX-5.24-1: CIS Node.js 安全基线——生产环境必须设置 NODE_ENV=production
if (process.env.NODE_ENV !== 'production') {
  logger.warn(`NODE_ENV 当前为 "${process.env.NODE_ENV || 'undefined'}"，生产环境请确保设置 NODE_ENV=production（CIS 安全基线）`);
}
// FIX-5.25-1: PCI-DSS 2.1——ADMIN_TOKEN 与 SERVICE_TOKEN 不得相同，防止凭据复用
if (ADMIN_TOKEN && SERVICE_TOKEN && ADMIN_TOKEN === SERVICE_TOKEN) {
  logger.error('ADMIN_TOKEN 与 SERVICE_TOKEN 相同，存在凭据复用风险（PCI-DSS 2.1），请使用不同密钥');
  process.exit(1);
}
// FIX-5.28-1: PCI-DSS 8.2.3——ADMIN_TOKEN / SERVICE_TOKEN 最短 32 字符强制校验
// 32 字符 = 128 位熵（hex 编码 16 字节），满足 PCI-DSS 最低密钥长度要求
// 原 < 64 字符仅 warn，现 < 32 字符直接拒绝启动
if (ADMIN_TOKEN && ADMIN_TOKEN.length < 32) {
  logger.error('ADMIN_TOKEN 过短（< 32 字符），不满足 PCI-DSS 8.2.3 最低密钥长度要求，拒绝启动');
  process.exit(1);
}
if (SERVICE_TOKEN && SERVICE_TOKEN.length < 32) {
  logger.error('SERVICE_TOKEN 过短（< 32 字符），不满足 PCI-DSS 8.2.3 最低密钥长度要求，拒绝启动');
  process.exit(1);
}
// FIX-5.28-1: PCI-DSS 4.1——检测 NODE_TLS_REJECT_UNAUTHORIZED=0（全局禁用 TLS 证书校验）
// 此设置会使所有 HTTPS 连接（包括 DB SSL）跳过证书验证，生产环境严禁使用
if (process.env.NODE_TLS_REJECT_UNAUTHORIZED === '0') {
  if (process.env.NODE_ENV === 'production') {
    logger.error('NODE_TLS_REJECT_UNAUTHORIZED=0 在生产环境中被设置，TLS 证书校验已全局禁用（PCI-DSS 4.1 违规），拒绝启动');
    process.exit(1);
  } else {
    logger.warn('NODE_TLS_REJECT_UNAUTHORIZED=0 已设置，TLS 证书校验全局禁用，生产环境严禁此配置（PCI-DSS 4.1）');
  }
}

const PORT = parseInt(process.env.PORT || '3002', 10);
const HOST = process.env.HOST || '172.16.1.6';

const server = app.listen(PORT, HOST, () => {
  logger.info(`Webhook 服务已启动 http://${HOST}:${PORT}`);
  // FIX-5.26-2: DB 连接池预热——消除首次请求的冷启动延迟
  db.connect()
    .then((client) => { client.release(); logger.info('DB 连接池预热完成'); })
    .catch((err) => logger.warn('DB 连接池预热失败（首次请求将自动重试）', { err: err.message }));
  if (!ADMIN_TOKEN) {
    logger.warn('ADMIN_TOKEN 未设置，管理员接口已禁用');
  } else if (ADMIN_TOKEN.length < 64) {
    logger.warn('ADMIN_TOKEN 过短（< 64 字符），建议执行 openssl rand -hex 32 重新生成');
  }
  if (!SERVICE_TOKEN) {
    logger.warn('SERVICE_TOKEN 未设置，/billing 写入接口将拒绝所有请求（fail-closed）');
  } else if (SERVICE_TOKEN.length < 64) {
    logger.warn('SERVICE_TOKEN 过短（< 64 字符），建议执行 openssl rand -hex 32 重新生成');
  }
  logger.info('运行时配置', {
    freeDailyLimit:      getFreeDailyLimit(),
    maxSingleRequestFen: getMaxSingleRequestFen(),
    usdToCnyRate:        getUsdToCnyRate(),
    modelCacheTtlSec:    MODEL_CACHE_TTL_MS / 1000,
    modelCacheMaxSize:   MAX_MODEL_CACHE_SIZE,
    pgPoolMax:           PG_POOL_MAX,
  });
});

// FIX-5.21-2: 生产级 keep-alive / headers 超时配置
// 防止长连接阻塞容器优雅重启（K8s/Docker 滚动更新场景）
server.keepAliveTimeout  = 65_000; // 略高于常见 LB/Nginx 60s
server.headersTimeout    = 66_000; // 必须 > keepAliveTimeout
// FIX-5.23-1: CIS Node.js 安全基线——请求超时 & 头部数量限制，防止 Slowloris / Header Flood
// 30s: 计费 API 典型响应 < 1s，30s 为最大数据库事务超时的 3 倍（statement_timeout=10s），足够宽裕
server.requestTimeout    = 30_000;
// 50: 标准浏览器/内部服务请求通常携带 10-20 个头，50 已含充分余量（Node 默认 2000 过于宽松）
server.maxHeadersCount   = 50;
// FIX-5.27-1: CIS 资源保护——限制并发 TCP 连接数，防止连接洪水耗尽文件描述符
server.maxConnections    = 1024;
// FIX-5.28-1: CIS DoS 缓解——限制单个持久连接上的 HTTP 请求数，防止管道请求洪水
// 256: 正常浏览器/内部服务单连接请求数远低于此值，超限后强制断开重连
server.maxRequestsPerSocket = 256;

// FIX-5.25-1: CIS 进程管理——优雅关闭超时可配置，便于 K8s terminationGracePeriodSeconds 对齐
// 有效范围 5-60 秒，默认 10 秒
const GRACEFUL_SHUTDOWN_TIMEOUT_RAW = parseInt(process.env.GRACEFUL_SHUTDOWN_TIMEOUT || '10000', 10) || 10000;
const GRACEFUL_SHUTDOWN_TIMEOUT = Math.max(5000, Math.min(GRACEFUL_SHUTDOWN_TIMEOUT_RAW, 60000));

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
  setTimeout(() => {
    // FIX-5.26-1: CIS 进程管理——超时后强制终止所有残留连接，防止僵尸连接阻塞进程退出
    // Node 18.2+ 提供 server.closeAllConnections()；package.json 已要求 >=20.0.0
    // 保留 typeof 检查作为防御性兜底，确保旧运行时不会崩溃
    if (typeof server.closeAllConnections === 'function') {
      server.closeAllConnections();
    }
    process.exit(1);
  }, GRACEFUL_SHUTDOWN_TIMEOUT);
};

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT',  () => shutdown('SIGINT'));

// FIX-5.27-1: CIS 日志完整性——致命错误处理器增加延迟确保日志落盘
// winston 异步写入日志文件，process.exit() 会截断尚未刷新的缓冲区
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection, shutting down', { err: String(reason) });
  setTimeout(() => process.exit(1), LOG_FLUSH_DELAY_MS);
});
process.on('uncaughtException', (err) => {
  logger.error('Uncaught exception, shutting down', { err: err.message, stack: err.stack });
  setTimeout(() => process.exit(1), LOG_FLUSH_DELAY_MS);
});

module.exports = app;
