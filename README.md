# Anima · 灵枢 私有 AI 手机助理

> 完整生产级部署 · 按模型按量计费 · 模块化功能 · 安全加固

---

## 目录

1. [功能矩阵](#功能矩阵)
2. [模块化架构](#模块化架构)
3. [数据安全与运维](#数据安全与运维)
4. [手机 APP 使用方案](#手机-app-使用方案)
5. [最终用户使用说明](#最终用户使用说明)
6. [架构概览](#架构概览)
7. [计费规则](#计费规则)
8. [前置条件](#前置条件)
9. [各服务器详细部署教程](#各服务器详细部署教程)
10. [第一步：VPS E — 初始化 Webhook 计费服务](#第一步vps-e--初始化-webhook-计费服务)
11. [第二步：VPS C — 部署 LibreChat](#第二步vps-c--部署-librechat)
12. [第三步：VPS B — 部署 OpenClaw](#第三步vps-b--部署-openclaw)
13. [第四步：VPS A — 配置 Nginx + ModSecurity WAF](#第四步vps-a--配置-nginx--modsecurity-waf)
14. [第五步：VPS D — 部署 Nextcloud](#第五步vps-d--部署-nextcloud)
15. [第六步：初始化模型定价](#第六步初始化模型定价)
16. [API 接口完整参考](#api-接口完整参考)
17. [常用运维 SQL](#常用运维-sql)
18. [故障排查](#故障排查)
19. [CIS / PCI-DSS 合规说明](#cis--pci-dss-合规说明)

---

## 功能矩阵

所有功能均为独立模块，可按需启用或禁用。模块配置集中在 [`modules/modules.yml`](modules/modules.yml)。

| 分类 | 功能 | 状态 | 模块目录 | 说明 |
|------|------|------|----------|------|
| 一、AI 对话与推理 | 🤖 日常 AI 对话 | ✅ 已部署 | `librechat/` | LibreChat Web UI，多轮对话，1-100 人并发 |
| | 🧠 持久记忆 | ✅ 已部署 | `openclaw/` | 用户偏好、历史上下文写入 Azure PostgreSQL + Redis 缓存 |
| | 🔀 多模型切换 | ✅ 已部署 | `openclaw/` | 全球 Top 10 + 中国 Top 5 提供商，90+ 模型可选 |
| | 🔄 智能降级 | ✅ 已配置 | `openclaw/` | 复杂任务自动 fallback 到 Claude / Mistral |
| 二、语音能力 | 🎤 语音输入 (ASR) | ✅ 已部署 | [`modules/voice/`](modules/voice/) | Whisper Small CPU int8，中文优先，10s 音频 ≈ 3s 识别 |
| | 🔊 语音输出 (TTS) | ✅ 已部署 | [`modules/voice/`](modules/voice/) | Coqui TTS 中文 Baker 模型，延迟 <100ms |
| 三、AI 工具调用 | 🌐 网页搜索 | ✅ 已部署 | [`modules/web-search/`](modules/web-search/) | DuckDuckGo，无需 API Key |
| | 📧 邮件处理 | ✅ 已部署 | [`modules/email/`](modules/email/) | AI 自动分类、摘要邮件并推送到通知邮箱（IMAP/SMTP）；自动起草回复需配置 NOTIFY_EMAIL 后生效 |
| | 📄 文件分析 | ✅ 已部署 | [`modules/file-analysis/`](modules/file-analysis/) | 上传 PDF / 图片 / 文档，AI 解析 |
| | 🧠 持久记忆 | ✅ 已部署 | `openclaw/` | 用户偏好、历史上下文存入数据库 |
| 四、智能家居 | 🏠 设备控制 | ✅ 已部署 | [`modules/smart-home/`](modules/smart-home/) | HA Core on CXI4，Zigbee/WiFi/Matter，语音控制 |
| | 🏠 场景自动化 | ✅ 已配置 | [`modules/smart-home/`](modules/smart-home/) | AI 联动自定义场景（如"回家模式"） |
| 五、日历与提醒 | 📅 日历管理 | ✅ 已部署 | [`modules/calendar/`](modules/calendar/) | 自然语言 "明天10点开会" → Nextcloud CalDAV |
| | 🔔 提醒推送 | ✅ 已配置 | [`modules/calendar/`](modules/calendar/) | Nextcloud 原生提醒，邮件 + App 推送 |
| 六、数据安全 | 🔒 三层加密 | ✅ 已部署 | `nginx/` + WireGuard | HTTPS + WireGuard ChaCha20 + Azure SSL |
| | 💾 双重备份 | ✅ 已配置 | [`scripts/backup-pg.sh`](scripts/backup-pg.sh) | Azure 每日自动备份（7天）+ CXI4 每日 pg_dump 冷备 |
| | 📋 操作审计 | ✅ 已配置 | [`scripts/audit-setup.sh`](scripts/audit-setup.sh) | 全节点 auditd，记录所有特权操作和可疑行为 |
| | 🛡 入侵防护 | ✅ 已部署 | 各节点部署文档 | fail2ban + UFW + SSH 禁密码登录 |
| 七、商业化 | 💰 卡密充值 | ✅ 已部署 | `webhook/` | 卡密充值，按量计费 + 充值卡系统 |
| | 🆓 免费/付费分层 | ✅ 已部署 | `webhook/` | 免费用户每日 20 次，付费无限制，Redis 速率控制 |
| 渠道接入 | 💬 微信接入 | ✅ 就绪 | [`modules/wechat/`](modules/wechat/) | 基于 Wechaty 框架（配置 Token 即可启用） |
| | ✈️ Telegram 接入 | ✅ 就绪 | [`modules/telegram/`](modules/telegram/) | 基于 Telegraf 框架（配置 Token 即可启用） |
| 扩展功能 | ☁️ 用户网盘 | ✅ 已部署 | [`modules/cloud-storage/`](modules/cloud-storage/) | Nextcloud WebDAV，多设备文件同步 |
| | 📱 手机 APP | ✅ 就绪 | [`mobile/`](mobile/) | Flutter 开源 APP 适配方案（Maid / PWA / 自建） |

---

## 模块化架构

所有功能以独立模块形式组织，每个模块包含自己的 Docker Compose、环境变量模板和文档。
启用或禁用模块只需修改 `modules/modules.yml` 并部署/停止对应容器。

### 目录结构

```
modules/
├── modules.yml              # 中央模块注册表（启用/禁用控制）
├── wechat/                  # 微信接入
│   ├── bot.js               # Wechaty Bot 主程序
│   ├── docker-compose.yml
│   ├── .env.example
│   └── README.md
├── telegram/                # Telegram 接入
│   ├── bot.js               # Telegraf Bot 主程序
│   ├── docker-compose.yml
│   ├── .env.example
│   └── README.md
├── email/                   # 邮件处理
│   ├── processor.js         # IMAP/SMTP 处理器
│   ├── docker-compose.yml
│   ├── .env.example
│   └── README.md
├── calendar/                # 日历管理（Nextcloud CalDAV）
├── cloud-storage/           # 用户网盘（Nextcloud WebDAV）
├── voice/                   # 语音交互（Whisper + Coqui TTS）
├── smart-home/              # 智能家居（Home Assistant）
├── web-search/              # 网页搜索
└── file-analysis/           # 文件分析

mobile/
├── README.md                # 手机 APP 完整方案
└── app_config.json          # APP 后端 API 配置模板
```

### 启用模块示例

```bash
# 1. 在 modules.yml 中将目标模块的 enabled 改为 true
# 2. 进入模块目录，配置并启动
cd modules/telegram
cp .env.example .env
vim .env                     # 填写 Bot Token 等
docker compose up -d         # 启动模块

# 禁用模块
docker compose down          # 停止模块
# 在 modules.yml 中将 enabled 改为 false
```

---

## 数据安全与运维

### 三层加密

| 层级 | 技术 | 保护范围 |
|------|------|---------|
| 第一层 | HTTPS（Let's Encrypt + Certbot） | 用户 ↔ VPS A（Nginx 反向代理） |
| 第二层 | WireGuard ChaCha20（双栈 172.16.1.0/24 + fd00:ai::/64） | 所有节点间内网通信 |
| 第三层 | Azure PostgreSQL SSL（PGSSLMODE=require） | 应用 ↔ 数据库 |

### 双重备份

| 备份 | 方式 | 保留 | 配置 |
|------|------|------|------|
| Azure 自动备份 | Azure PostgreSQL 内置 | 7 天 | Azure 控制台默认启用 |
| CXI4 冷备 | [`scripts/backup-pg.sh`](scripts/backup-pg.sh) 每日 pg_dump | 7 天（可配置） | `crontab: 0 2 * * * /opt/ai/scripts/backup-pg.sh` |

### 操作审计（auditd）

所有节点统一部署 auditd 审计规则：[`scripts/audit-setup.sh`](scripts/audit-setup.sh)

```bash
# 一键部署审计规则（在每台服务器执行）
sudo bash scripts/audit-setup.sh
```

监控项：Docker 操作、敏感文件访问、提权行为、防火墙变更、SSH 配置变更、VPN 配置变更

### 入侵防护

| 措施 | 说明 |
|------|------|
| fail2ban | SSH 暴力破解防护，3 次失败锁定 1 小时 |
| UFW 防火墙 | 默认拒绝入站，仅开放必要端口 |
| SSH 禁密码登录 | `PasswordAuthentication no`，仅允许密钥认证 |
| ModSecurity WAF | OWASP CRS 规则集，防 SQL 注入 / XSS / 目录遍历 |
| Docker 安全加固 | `no-new-privileges` + `read_only` + `cap_drop: ALL` |

---

## 手机 APP 使用方案

详见 [`mobile/README.md`](mobile/README.md)

### 快速总结

| 方案 | 适合场景 | 开发周期 | 技术栈 |
|------|----------|----------|--------|
| **PWA（零开发）** | 快速上线 | 立即 | 浏览器添加到主屏幕 |
| **Maid 适配（推荐）** | 品牌 APP | 1-2 周 | Flutter（MIT 开源） |
| **Chatbox 适配** | 多平台客户端 | 1-2 周 | React Native |
| **自建 Flutter APP** | 完全自主 | 1-2 月 | Flutter/Dart |

### PWA 使用（最快方式）

无需任何开发，用手机浏览器打开你的域名：

- **iOS**：Safari → 分享 → "添加到主屏幕"
- **Android**：Chrome → 菜单 → "添加到主屏幕"

### 独立 APP（推荐 Maid）

[Maid](https://github.com/Mobile-Artificial-Intelligence/maid) 是一个开源 Flutter AI 聊天应用（MIT 协议），支持自定义 API 端点：

1. 克隆 Maid 源码 → 修改品牌和默认 API 地址为你的域名
2. `flutter build apk --release`（Android）或 `flutter build ios --release`（iOS）
3. 安装到手机即可使用

APP 后端 API 配置模板见 [`mobile/app_config.json`](mobile/app_config.json)

---

## 最终用户使用说明

### 这是什么？

Anima 灵枢是一套**开源的私有 AI 助理部署方案**，基于 [LibreChat](https://github.com/danny-avila/LibreChat)（前端聊天界面）和 [OpenClaw](https://github.com/openclaw)（Agent 后端）构建，附带完整的**按量计费系统**和**生产级安全加固**。

### 如何使用？

**本项目不是一个需要从零开发的 App**，而是一套可以直接克隆并部署的完整方案。使用方式：

1. **直接部署（推荐）**
   - 克隆本仓库 → 按照下方五步部署教程操作 → 获得一个完整的私有 AI 助理
   - 最终用户通过浏览器或手机访问你的域名（如 `https://ai.example.com`）即可使用
   - 界面由 LibreChat 提供，支持多模型切换、对话历史、文件上传等功能

2. **定制修改**
   - **修改计费规则**：编辑 `webhook/server.js` 和 `db/schema.sql` 调整定价逻辑
   - **增减 AI 模型**：通过管理员 API（`POST /admin/models`）或直接修改 `db/schema.sql` 的预置数据
   - **修改前端界面**：LibreChat 本身支持自定义主题和配置，通过 `.env` 和 Docker 卷挂载实现
   - **修改 Agent 行为**：编辑 `openclaw/config.yml` 调整 Agent 工具和推理后端
   - **替换组件**：可以只使用计费系统（webhook/）配合其他 AI 前端，或只使用 Nginx 安全配置

3. **最终用户（非部署者）的体验**
   - 在浏览器中打开部署域名 → 注册/登录 → 选择模型 → 开始对话
   - 如需使用付费模型，先输入管理员分发的充值卡密进行充值
   - 免费模型（如 Claude Haiku）无需充值即可使用

### 文件用途速查

| 文件/目录 | 用途 | 你需要修改吗？ |
|-----------|------|---------------|
| `README.md` | 部署教程 | 否（参考即可） |
| `db/schema.sql` | 数据库结构 + 预置模型 | 可选（调整预置模型价格） |
| `webhook/server.js` | 计费 API 服务 | 一般不需要 |
| `webhook/package.json` | Node.js 依赖 | 一般不需要 |
| `nginx/anima.conf` | Nginx 反向代理 + WAF | 必须（替换域名占位符） |
| `nginx/modsecurity/` | ModSecurity WAF 规则（含 `main.conf` 入口） | 可选（按需调整排除规则） |
| `librechat/.env.example` | LibreChat 配置模板 | 必须（填写密钥和密码） |
| `librechat/docker-compose.yml` | LibreChat 容器定义 | 可选（调整内存限制） |
| `openclaw/.env.example` | OpenClaw 配置模板 | 必须（填写 API Key） |
| `openclaw/config.yml` | OpenClaw Agent 配置 | 可选（调整工具和模型） |
| `openclaw/docker-compose.yml` | OpenClaw 容器定义 | 可选（调整内存限制） |
| `modules/modules.yml` | 功能模块注册表 | 必须（启用需要的模块） |
| `modules/*/` | 各功能模块（微信/Telegram/邮件等） | 按需（启用时需配置 .env） |
| `mobile/` | 手机 APP 方案和配置 | 按需（需要独立 APP 时参考） |

---

## 架构概览

```
互联网用户
    │ HTTPS
    ▼
[VPS A] Nginx 反向代理 (172.16.1.1)
    ├─── /              → [VPS C] LibreChat    :3080
    ├─── /api/agent     → [VPS B] OpenClaw     :3000
    ├─── /clawbot/*     → [VPS B] ClawBot      :3004  （微信/企业微信 Webhook）
    ├─── /activate      → [VPS E] Webhook      :3002
    ├─── /billing/*     → [VPS E] Webhook      :3002
    ├─── /models        → [VPS E] Webhook      :3002
    ├─── /tts/          → [CXI4]  Coqui TTS    :8082  （语音合成，中文 Baker）
    ├─── /whisper/      → [CXI4]  Whisper      :8080  （语音识别，Small 中文优先）
    └─── /nextcloud/    → [VPS D] Nextcloud    :8090  （日历/网盘）

[VPS D] (172.16.1.4) — Nextcloud（香港 Azure，重新激活）
    └─── Nextcloud         :8090  ←── 日历 CalDAV + 网盘 WebDAV

[VPS E] (172.16.1.6) — Webhook + Redis（香港 Azure，新增）
    ├─── Webhook 计费服务  :3002  ←── OpenClaw / LibreChat 自动调用
    └─── Redis             :6379  ←── 会话缓存 + 免费用户每日限额

[CXI4] (172.16.1.5, i7-10610U / 8GB / 500GB SSD) — 青岛，ML 推理专用
    ├─── Whisper STT       :8080  （Small 模型，中文优先，10s≈3s）
    ├─── Coqui TTS         :8082  （中文 Baker 模型，延迟 <100ms）
    ├─── (Email 处理)      :3004  （邮件处理模块）
    └─── (Home Assistant)  :8123  （智能家居 Zigbee/WiFi/Matter）

[VPS B] (172.16.1.2) ── OpenClaw + 可选模块
    ├─── OpenClaw Agent    :3000  （AI Agent 后端）
    ├─── (ClawBot 灵枢)    :3004  （微信/企业微信接入通道）
    ├─── (微信 Bot)        :3001  （微信接入模块）
    └─── (Telegram Bot)    :3003  （Telegram 接入模块）

[Azure PostgreSQL]
    ├─── librechat  ←── LibreChat 用户数据 + 计费数据
    └─── openclaw   ←── OpenClaw 记忆数据库
```

所有节点通过 **WireGuard 内网（172.16.1.0/24）** 互通，Webhook 服务和数据库完全不暴露公网。5× 双核 1 GB VPS（香港 Azure）+ CXI4（青岛）共 6 节点企业架构——DB 依赖服务（Nextcloud、Webhook）部署在香港，与 Azure PostgreSQL 同机房，消除跨境延迟；CXI4 仅承担 ML 推理负载。

### 目录结构

```
.
├── db/
│   ├── schema.sql           # PostgreSQL Schema（v5.4: 核心 6 表 + 预置模型）
│   └── migrations/          # 增量迁移（001-020: ClawBot 扩展表等 31 张）
├── webhook/
│   ├── package.json         # Node.js 依赖
│   └── server.js            # Webhook 计费服务（11 个接口）
├── nginx/
│   ├── anima.conf           # Nginx 反向代理 + WAF 配置
│   └── modsecurity/         # ModSecurity + OWASP CRS 规则
│       ├── modsecurity.conf                            # ModSecurity 引擎配置
│       ├── crs-setup.conf                              # OWASP CRS 调优（异常评分阈值等）
│       ├── REQUEST-900-EXCLUSION-RULES-BEFORE-CRS.conf # 应用专属排除规则（CRS 前）
│       └── RESPONSE-999-EXCLUSION-RULES-AFTER-CRS.conf # 响应排除规则（CRS 后）
├── librechat/
│   ├── .env.example         # LibreChat 环境变量模板
│   └── docker-compose.yml   # LibreChat Docker Compose
├── openclaw/
│   ├── .env.example         # OpenClaw 环境变量模板
│   ├── config.yml           # OpenClaw Agent 配置
│   └── docker-compose.yml   # OpenClaw Docker Compose
├── modules/                 # 功能模块（按需启用）
│   ├── modules.yml          # 中央模块注册表
│   ├── wechat/              # 微信接入
│   ├── telegram/            # Telegram 接入
│   ├── email/               # 邮件处理
│   ├── calendar/            # 日历管理（Nextcloud CalDAV）
│   ├── cloud-storage/       # 用户网盘（Nextcloud WebDAV）
│   ├── nextcloud/           # Nextcloud 基础设施（CalDAV + WebDAV 底层）
│   ├── voice/               # 语音交互（Whisper STT + Coqui TTS）
│   ├── smart-home/          # 智能家居（Home Assistant Core）
│   ├── web-search/          # 网页搜索
│   └── file-analysis/       # 文件分析
├── mobile/                  # 手机 APP 方案
│   ├── README.md            # 完整 APP 方案对比与适配指南
│   └── app_config.json      # APP 后端 API 配置模板
├── docs/                    # 各节点详细部署教程
│   ├── deploy-vpsa.md       # VPS A — Nginx + WAF
│   ├── deploy-vpsb.md       # VPS B — OpenClaw Agent
│   ├── deploy-vpsc.md       # VPS C — LibreChat
│   ├── deploy-vpsd.md       # VPS D — Nextcloud（CalDAV + WebDAV）
│   ├── deploy-vpse.md       # VPS E — Webhook 计费 + Redis
│   ├── deploy-cxi4.md       # CXI4 — Whisper + TTS + Email + HA（ML 推理专用）
│   └── cloudflare-tunnel.md # Cloudflare Tunnel 配置
└── scripts/
    ├── watchdog.sh          # Webhook 健康检查看门狗
    ├── backup-pg.sh         # PostgreSQL 每日冷备（7 天保留）
    └── audit-setup.sh       # auditd 操作审计统一配置
```

---

## 计费规则

| 规则 | 说明 |
|------|------|
| **按模型独立定价** | 每个 API 模型在 `api_models` 表中单独设定价格，无套餐绑定 |
| **免费模型** | `is_free=true` 的模型（如 `glm-4-flash`）免费使用，**每日限 20 次**（Redis 计数） |
| **付费模型** | 仅在实际使用时按 Token 扣费：`⌈(输入Token/1000 × 输入价格) + (输出Token/1000 × 输出价格)⌉` 分（v5: 基于 Tiktoken 计数，对齐上游 API 定价） |
| **预付费** | 用户充值后使用付费模型；余额不足时系统返回 HTTP 402 拒绝调用 |
| **免费/付费分层** | 免费用户每日 20 次（`FREE_DAILY_LIMIT`），付费用户无限制；Redis 速率控制 |
| **本地模型** | Ollama 模型 `is_active=false`，接口定义保留但拒绝所有计费请求 |

---

## 前置条件

在开始部署前，请确认以下条件已满足：

- [ ] 所有 VPS 节点已通过 **WireGuard** 组成 `172.16.1.0/24` 内网（各节点互通）
- [ ] **Azure PostgreSQL** 已创建实例，已建 `librechat` 和 `openclaw` 两个数据库
- [ ] 已为 `animaapp` 数据库用户分配两个数据库的所有权限
- [ ] 已为 `animaapp` 用户授予 `azure_pg_admin` 角色（或在 Azure 门户 → 服务器参数中把 `pgcrypto` 和 `pg_stat_statements` 加入 `azure.extensions` 允许列表），否则 Schema 初始化中 `CREATE EXTENSION` 会报权限错误
- [ ] 所有节点已完成基础安全加固（UFW / fail2ban）
- [ ] VPS A 已申请域名 SSL 证书（见[第四步](#第四步vps-a--配置-nginx)）

### 硬件规格与资源分配

| 节点 | 角色 | CPU | 内存 | 存储 | 容器/服务内存 | 系统预留 |
|------|------|-----|------|------|--------------|---------|
| **VPS A** (172.16.1.1) | Nginx 反向代理 | 2 核 | 1 GB | — | Nginx ~50 MB | ~950 MB 系统 |
| **VPS B** (172.16.1.2) | OpenClaw + ClawBot | 2 核 | 1 GB | — | OpenClaw 384m + ClawBot 192m = 576m | ~448 MB 系统 |
| **VPS C** (172.16.1.3) | LibreChat | 2 核 | 1 GB | — | 容器 ≤680 MB | ~320 MB 系统 |
| **VPS D** (172.16.1.4) | Nextcloud | 2 核 | 1 GB | — | 容器 ≤512 MB | ~500 MB 系统 |
| **VPS E** (172.16.1.6) | Webhook + Redis | 2 核 | 1 GB | — | Webhook 256m + Redis 128m | ~640 MB 系统 |
| **CXI4** (172.16.1.5) | Whisper + TTS + Email + HA | 4 核 8 线程 (i7-10610U) | 8 GB | 500 GB SSD | Whisper 2g + TTS 768m + Email 192m + HA 512m ≈ 3.5g | ~4.5 GB 系统 |

> ⚠️ **1 GB 内存 VPS 注意事项**：Linux 内核 + 系统服务约占 200–300 MB，Docker 容器的 `mem_limit` 不能设为 1g（会导致 OOM Kill）。LibreChat 设为 680m、OpenClaw 设为 384m（启用 ClawBot 时）或 450m（独立部署时），均已在 `docker-compose.yml` 中配置。
>
> 📌 **6 节点企业架构**：VPS A–E 均为香港 Azure 双核 1 GB VPS，与 Azure PostgreSQL 同机房，DB 依赖服务（Nextcloud、Webhook + Redis）部署在港内消除跨境延迟。CXI4（青岛）仅承担 ML 推理（Whisper + TTS）和本地服务（Email + HA），负载从 5.6 GB 降至 3.5 GB。

### 各节点 UFW 防火墙规则（CIS L1 要求）

每台 VPS 在部署前先配置最小化防火墙规则，仅开放所需端口：

> ⚠️ 每台节点还需开放 WireGuard 监听的 UDP 端口（默认 51820）：`ufw allow 51820/udp`，否则 `default deny incoming` 会阻断 VPN 隧道。

```bash
# ──────────────────────────────────────────
# VPS A (172.16.1.1) — Nginx 公网入口
# ──────────────────────────────────────────
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp       # SSH（若已配置 WireGuard 后可限制为内网 SSH）
ufw allow 80/tcp       # HTTP（Let's Encrypt ACME 验证）
ufw allow 443/tcp      # HTTPS
ufw allow in on wg0    # WireGuard 内网流量全部放行
ufw enable

# ──────────────────────────────────────────
# VPS B (172.16.1.2) — OpenClaw（内网专用）
# ──────────────────────────────────────────
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow in from 172.16.1.0/24 to any port 3000  # 仅内网访问 OpenClaw
ufw allow in on wg0
ufw enable

# ──────────────────────────────────────────
# VPS C (172.16.1.3) — LibreChat（内网专用）
# ──────────────────────────────────────────
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow in from 172.16.1.0/24 to any port 3080  # 仅内网访问 LibreChat
ufw allow in on wg0
ufw enable

# ──────────────────────────────────────────
# VPS D (172.16.1.4) — Nextcloud（内网专用）
# ──────────────────────────────────────────
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow in from 172.16.1.0/24 to any port 8090  # Nextcloud（日历/网盘）
ufw allow in on wg0
ufw enable

# ──────────────────────────────────────────
# VPS E (172.16.1.6) — Webhook + Redis（内网专用）
# ──────────────────────────────────────────
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow in from 172.16.1.0/24 to any port 3002  # Webhook 计费服务
ufw allow in from 172.16.1.0/24 to any port 6379  # Redis（禁止公网直连）
ufw allow in on wg0
ufw enable

# ──────────────────────────────────────────
# CXI4 (172.16.1.5) — Whisper + TTS + Email + HA（内网专用）
# ──────────────────────────────────────────
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow in from 172.16.1.0/24 to any port 8080  # Whisper STT
ufw allow in from 172.16.1.0/24 to any port 8082  # Coqui TTS
ufw allow in from 172.16.1.0/24 to any port 3004  # Email 处理
ufw allow in from 172.16.1.0/24 to any port 8123  # Home Assistant
ufw allow in on wg0
ufw enable
```

> ⚠️ 执行 `ufw enable` 前确认 SSH 端口（22）已在规则中，否则会断开连接。

### 验证 WireGuard 内网互通

```bash
# 在任意节点执行，确认各节点 IP 均可达
ping -c 2 172.16.1.1   # VPS A (Nginx)
ping -c 2 172.16.1.2   # VPS B (OpenClaw)
ping -c 2 172.16.1.3   # VPS C (LibreChat)
ping -c 2 172.16.1.4   # VPS D (Nextcloud)
ping -c 2 172.16.1.5   # CXI4 (Whisper/TTS/Email/HA)
ping -c 2 172.16.1.6   # VPS E (Webhook/Redis)
```

---

## 第一步：VPS E — 初始化 Webhook 计费服务

> **执行节点：VPS E (172.16.1.6)**

### 1.1 安装 Redis

```bash
# 安装 Redis
apt-get update && apt-get install -y redis-server

# 配置 Redis 监听内网、设置密码
# ⚠️ 密码请勿包含 / & \ 等特殊字符（会破坏下方 sed 命令）
REDIS_PASS="<强随机字符串>"   # 记录此密码，后续 LibreChat 和 OpenClaw 需要

# 修改监听地址
sed -i 's/^bind 127.0.0.1.*/bind 172.16.1.6 127.0.0.1/' /etc/redis/redis.conf
# 设置密码（取消 requirepass 注释并写入密码）
sed -i "s/^# requirepass .*/requirepass ${REDIS_PASS}/" /etc/redis/redis.conf

systemctl enable --now redis-server
systemctl restart redis-server

# 验证（REDISCLI_AUTH 避免密码出现在进程列表 ps aux 中）
REDISCLI_AUTH="${REDIS_PASS}" redis-cli -h 172.16.1.6 ping
# 预期输出：PONG
```

> ⚠️ **Redis 内存限制（VPS E 仅 1 GB，需为 Webhook + 系统预留内存）**：
> ```bash
> # 设置 Redis 最大内存为 128 MB，超出后按 LRU 策略淘汰
> echo 'maxmemory 128mb' >> /etc/redis/redis.conf
> echo 'maxmemory-policy allkeys-lru' >> /etc/redis/redis.conf
> systemctl restart redis-server
> ```
> 未设置 `maxmemory` 时，Redis 可能占满全部可用内存导致系统 OOM Kill。

### 1.2 克隆仓库

```bash
git clone https://github.com/dnssme/ame.git /opt/ai/repo
```

### 1.3 安装 Node.js 20

```bash
# 检查是否已安装 Node.js 20
if node --version 2>/dev/null | grep -q '^v20'; then
  echo "Node.js 20 已安装，跳过"
else
  # 手动添加 NodeSource 官方软件源（不执行管道脚本 — CIS 2.1.x / PCI-DSS 6.3.x 合规）
  apt-get install -y ca-certificates curl gnupg
  mkdir -p /etc/apt/keyrings

  # 导入 NodeSource GPG 签名密钥（验证软件包完整性）
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  chmod 644 /etc/apt/keyrings/nodesource.gpg

  # 添加软件源（使用 signed-by 确保每个包都经 GPG 验证）
  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list

  apt-get update
  apt-get install -y nodejs
  echo "Node.js $(node --version) 安装完成"
fi
```

### 1.4 部署 Webhook 服务目录

```bash
# 创建目录并复制文件
WEBHOOK_DIR="/opt/ai/webhook"
mkdir -p "${WEBHOOK_DIR}"
cp /opt/ai/repo/webhook/server.js    "${WEBHOOK_DIR}/server.js"
cp /opt/ai/repo/webhook/package.json "${WEBHOOK_DIR}/package.json"

# 安装依赖（仅生产依赖）
cd "${WEBHOOK_DIR}"
npm install --omit=dev
```

### 1.5 创建 .env 配置文件

```bash
# 生成随机 ADMIN_TOKEN（32字节 = 64个十六进制字符）
# 生成 SERVICE_TOKEN
ADMIN_TOKEN_VAL="$(openssl rand -hex 32)"
SERVICE_TOKEN_VAL="$(openssl rand -hex 32)"

cat > /opt/ai/webhook/.env <<EOF
PG_HOST=anima-db.postgres.database.azure.com
PG_PORT=5432
PG_USER=animaapp
PG_PASSWORD=<animaapp数据库密码>
PG_DATABASE=librechat
PORT=3002
HOST=0.0.0.0
NODE_ENV=production
LOG_LEVEL=info
ADMIN_TOKEN=${ADMIN_TOKEN_VAL}
SERVICE_TOKEN=${SERVICE_TOKEN_VAL}
REDIS_URL=redis://:<Redis密码>@127.0.0.1:6379
FREE_DAILY_LIMIT=20
MAX_SINGLE_REQUEST_FEN=1000
USD_TO_CNY_RATE=7.2
TRUST_PROXY=172.16.1.1
NODE_OPTIONS=--max-old-space-size=256
TZ=Asia/Shanghai
EOF

chmod 600 /opt/ai/webhook/.env
echo "ADMIN_TOKEN:   ${ADMIN_TOKEN_VAL}"
echo "SERVICE_TOKEN: ${SERVICE_TOKEN_VAL}"
```

> ⚠️ **请立即保存 `ADMIN_TOKEN`**，后续模型管理接口需要用到。

### 1.6 初始化数据库 Schema

```bash
# 安装 PostgreSQL 客户端（如未安装）
apt-get install -y postgresql-client

# 执行 Schema SQL
PGPASSWORD='<animaapp数据库密码>' PGSSLMODE=require psql \
  --quiet \
  -h anima-db.postgres.database.azure.com \
  -U animaapp \
  -d librechat \
  -f /opt/ai/repo/db/schema.sql \
  -v ON_ERROR_STOP=1

# 执行所有数据库迁移（ClawBot 等模块所需的扩展表）
for f in /opt/ai/repo/db/migrations/*.sql; do
  echo "▸ 执行迁移: $(basename "$f")"
  PGPASSWORD='<animaapp数据库密码>' PGSSLMODE=require psql \
    --quiet \
    -h anima-db.postgres.database.azure.com \
    -U animaapp \
    -d librechat \
    -f "$f" \
    -v ON_ERROR_STOP=1
done
echo "✅ 所有迁移执行完成"
```

> **注意**：`db/schema.sql` 包含 6 张核心表（api_models、api_providers、user_billing 等），`db/migrations/` 目录包含 20 个增量迁移文件（001-020），添加了 ClawBot 相关的 31 张扩展表。**全新部署时两者都需要执行。**

### 1.7 创建 systemd 服务并启动

```bash
cat > /etc/systemd/system/ai-webhook.service <<'SERVICE'
[Unit]
Description=Anima 灵枢 Webhook 计费服务
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=/opt/ai/webhook
EnvironmentFile=/opt/ai/webhook/.env
ExecStart=/usr/bin/node /opt/ai/webhook/server.js
Environment=NODE_OPTIONS=--max-old-space-size=256
Restart=on-failure
RestartSec=10

# 安全加固
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

# 日志
StandardOutput=journal
StandardError=journal
SyslogIdentifier=ai-webhook

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable --now ai-webhook
sleep 3
```

### 1.8 验证 Webhook 服务

```bash
# 健康检查
curl http://172.16.1.6:3002/health
# 预期：{"status":"ok","db":"ok","ts":"..."}

# 查看预置模型列表
curl http://172.16.1.6:3002/models
# 预期：返回 5 个已启用模型（含 Claude Haiku 免费模型）

# 查看服务日志
journalctl -u ai-webhook -n 30 --no-pager
```

---

## 第二步：VPS C — 部署 LibreChat

> **执行节点：VPS C (172.16.1.3)**

### 2.1 安装 Docker

```bash
apt-get update
apt-get install -y ca-certificates curl
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
```

### 2.2 克隆仓库（如尚未克隆）

```bash
git clone https://github.com/dnssme/ame.git /opt/ai/repo
```

### 2.3 创建 `.env` 配置文件

```bash
cd /opt/ai/repo/librechat
cp .env.example .env
chmod 600 .env
```

用编辑器填写所有 `<占位符>`：

```bash
vim .env
```

需要填写的关键字段：

| 字段 | 说明 | 生成方法 |
|------|------|----------|
| `DOMAIN_CLIENT` | 你的域名，如 `https://ai.example.com` | — |
| `DOMAIN_SERVER` | 同上 | — |
| `JWT_SECRET` | 64 字符随机十六进制 | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `JWT_REFRESH_SECRET` | 另一个 64 字符随机十六进制 | 同上 |
| `POSTGRES_URI` | 替换 `<animaapp密码>` | — |
| `REDIS_URI` | 替换 `<Redis密码>`（与第一步相同） | — |
| `ANTHROPIC_API_KEY` | Claude API Key | — |
| `CREDS_KEY` | 32 字节随机 HEX（64字符） | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `CREDS_IV` | 16 字节随机 HEX（32字符） | `node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"` |

### 2.4 创建必要目录并启动

```bash
cd /opt/ai/repo/librechat
mkdir -p uploads logs
docker compose up -d
```

### 2.5 验证 LibreChat

```bash
# 等待容器启动（约 30 秒）
docker compose ps
# 预期：librechat 状态为 Up (healthy)

# 检查日志
docker compose logs --tail=50 librechat

# 内网连通性测试
curl -sf http://172.16.1.3:3080/health
# 预期：{"status":"ok"} 或 HTTP 200
```

---

## 第三步：VPS B — 部署 OpenClaw

> **执行节点：VPS B (172.16.1.2)**

### 3.1 安装 Docker（同第二步 2.1）

### 3.2 克隆仓库（如尚未克隆）

```bash
git clone https://github.com/dnssme/ame.git /opt/ai/repo
```

### 3.3 创建 `.env` 配置文件

```bash
cd /opt/ai/repo/openclaw
cp .env.example .env
chmod 600 .env
vim .env   # 填入所有 API Key 和密码
```

> ⚠️ **重要**：`docker-compose.yml` 通过 `env_file: .env` 加载变量，不要用 `export` 方式注入（容器重启后失效）。

### 3.4 创建数据目录并启动

```bash
cd /opt/ai/repo/openclaw
mkdir -p data
docker compose up -d
```

### 3.5 验证 OpenClaw

```bash
docker compose ps
# 预期：openclaw 状态为 Up (healthy)

curl -sf http://172.16.1.2:3000/health
# 预期：HTTP 200
```

---

## 第四步：VPS A — 配置 Nginx + ModSecurity WAF

> **执行节点：VPS A (172.16.1.1)**

### 4.1 安装 Nginx + ModSecurity + OWASP CRS

手动编译安装 Nginx + ModSecurity v3 + OWASP CRS v4（不执行第三方脚本 — CIS 2.1.x / PCI-DSS 6.3.x 合规），安装路径：`/opt/nginx/`、`/opt/owasp/owasp-rules/`。

> ⏱️ 编译耗时约 10–20 分钟

#### 安装编译依赖

```bash
apt-get install -y \
  build-essential git automake autoconf libtool pkg-config \
  libpcre2-dev libpcre3-dev libssl-dev zlib1g-dev \
  libxml2-dev libxslt1-dev libyajl-dev libgeoip-dev \
  libgd-dev liblmdb-dev libcurl4-openssl-dev
```

#### 编译 ModSecurity v3

```bash
mkdir -p /opt/nginx/src
git clone --depth 1 -b v3/master \
  https://github.com/SpiderLabs/ModSecurity.git \
  /opt/nginx/src/ModSecurity
cd /opt/nginx/src/ModSecurity
git submodule init && git submodule update
./build.sh && ./configure
make -j"$(nproc)" && make install
```

#### 下载 ModSecurity-nginx 连接器

```bash
git clone --depth 1 \
  https://github.com/SpiderLabs/ModSecurity-nginx.git \
  /opt/nginx/src/ModSecurity-nginx
```

#### 编译 Nginx（带 ModSecurity 模块）

```bash
NGINX_VER="1.26.3"
cd /tmp
curl -fsSL "https://nginx.org/download/nginx-${NGINX_VER}.tar.gz" \
  -o "nginx-${NGINX_VER}.tar.gz"
tar xzf "nginx-${NGINX_VER}.tar.gz"
cd "nginx-${NGINX_VER}"
./configure \
  --prefix=/opt/nginx \
  --sbin-path=/opt/nginx/sbin/nginx \
  --conf-path=/opt/nginx/conf/nginx.conf \
  --pid-path=/opt/nginx/logs/nginx.pid \
  --error-log-path=/opt/nginx/logs/error.log \
  --http-log-path=/opt/nginx/logs/access.log \
  --with-http_ssl_module \
  --with-http_v2_module \
  --with-http_realip_module \
  --with-http_gzip_static_module \
  --with-http_stub_status_module \
  --add-module=/opt/nginx/src/ModSecurity-nginx
make -j"$(nproc)" && make install
# 确认 Worker 进程数为 auto（双核以上推荐）
sed -i 's/^worker_processes.*/worker_processes auto;/' /opt/nginx/conf/nginx.conf
```

#### 下载 OWASP CRS v4

```bash
CRS_VER="4.8.0"
mkdir -p /opt/owasp
cd /opt/owasp
curl -fsSL \
  "https://github.com/coreruleset/coreruleset/archive/refs/tags/v${CRS_VER}.tar.gz" \
  -o "coreruleset-${CRS_VER}.tar.gz"
tar xzf "coreruleset-${CRS_VER}.tar.gz"
mv "coreruleset-${CRS_VER}" owasp-rules
cp /opt/owasp/owasp-rules/crs-setup.conf.example \
   /opt/owasp/owasp-rules/crs-setup.conf
```

#### 创建目录结构并验证

```bash
mkdir -p /opt/owasp/conf /opt/nginx/conf/conf.d /var/www/certbot
mkdir -p /www/wwwlogs/owasp
chown root:root /www/wwwlogs/owasp
chmod 700 /www/wwwlogs/owasp

# 验证安装
/opt/nginx/sbin/nginx -v
# 预期：nginx version: nginx/1.26.3
/opt/nginx/sbin/nginx -V 2>&1 | grep -o 'ModSecurity\|ngx_http_modsecurity'
# 预期：含 ModSecurity 字样
```

### 4.2 申请 SSL 证书（Let's Encrypt）

```bash
DOMAIN="ai.example.com"   # 替换为你的真实域名

# 安装 certbot（如果尚未安装）
apt-get update && apt-get install -y certbot

# 先确保 80 端口可访问（UFW 允许）
ufw allow 80/tcp
ufw allow 443/tcp

# 申请证书（使用 standalone 模式，无需 Nginx 运行）
certbot certonly --standalone -d "${DOMAIN}" --non-interactive --agree-tos \
  --email admin@example.com   # 替换为你的邮箱

# 证书位置
ls /etc/letsencrypt/live/${DOMAIN}/
# 应有：fullchain.pem  privkey.pem  chain.pem
```

### 4.3 部署 ModSecurity WAF 配置

```bash
# 部署 ModSecurity 引擎配置（替换安装脚本的默认配置）
cp /opt/ai/repo/nginx/modsecurity/modsecurity.conf \
   /opt/nginx/src/ModSecurity/modsecurity.conf

# 部署 OWASP CRS 调优配置（替换安装脚本的默认配置）
cp /opt/ai/repo/nginx/modsecurity/crs-setup.conf \
   /opt/owasp/owasp-rules/crs-setup.conf

# 部署 WAF 入口配置（替换安装脚本的默认配置）
cp /opt/ai/repo/nginx/modsecurity/main.conf \
   /opt/owasp/conf/main.conf

# 部署应用专属排除规则
cp /opt/ai/repo/nginx/modsecurity/REQUEST-900-EXCLUSION-RULES-BEFORE-CRS.conf \
   /opt/owasp/owasp-rules/rules/REQUEST-900-EXCLUSION-RULES-BEFORE-CRS.conf
cp /opt/ai/repo/nginx/modsecurity/RESPONSE-999-EXCLUSION-RULES-AFTER-CRS.conf \
   /opt/owasp/owasp-rules/rules/RESPONSE-999-EXCLUSION-RULES-AFTER-CRS.conf

# 设置文件权限（CIS 安全配置）
chmod 600 /opt/nginx/src/ModSecurity/modsecurity.conf
chmod 600 /opt/owasp/owasp-rules/crs-setup.conf
chmod 600 /opt/owasp/conf/main.conf
chown root:root /opt/nginx/src/ModSecurity/modsecurity.conf
chown root:root /opt/owasp/owasp-rules/crs-setup.conf
chown root:root /opt/owasp/conf/main.conf
```

> ⚠️ **首次部署建议**：先将 `modsecurity.conf` 中的 `SecRuleEngine On` 改为 `SecRuleEngine DetectionOnly`，
> 观察 `/www/wwwlogs/owasp/modsec_audit.log` 一段时间确认无误报后，再改回 `On` 启用拦截模式。

### 4.4 部署 Nginx 配置

> ⚠️ **Worker 进程数**：VPS A 为双核 CPU，请确认 `/opt/nginx/conf/nginx.conf` 主配置中设置了 `worker_processes auto;`（默认值为 1，会浪费一个 CPU 核心）：
> ```bash
> # 确认或修改（该指令在 main 上下文，不在 http{} 中）
> grep -n 'worker_processes' /opt/nginx/conf/nginx.conf
> # 如显示 "worker_processes 1;"，则改为：
> sed -i 's/^worker_processes.*/worker_processes auto;/' /opt/nginx/conf/nginx.conf
> ```

```bash
DOMAIN="ai.example.com"   # 与上面相同

# 替换域名占位符并部署
sed "s/<你的域名>/${DOMAIN}/g" /opt/ai/repo/nginx/anima.conf \
  > /opt/nginx/conf/conf.d/anima.conf

# 测试配置
/opt/nginx/sbin/nginx -t
# 预期：configuration file ... syntax is ok
#       configuration file ... test is successful

# 重载 Nginx
/opt/nginx/sbin/nginx -s reload
```

### 4.5 配置证书自动续期

```bash
# 测试续期（不实际续期）
certbot renew --dry-run
# 预期：Congratulations, all simulated renewals succeeded.

# 如安装脚本未配置自动续期 timer，手动添加 crontab
(crontab -l 2>/dev/null; echo "0 3 * * * certbot renew --quiet --deploy-hook '/opt/nginx/sbin/nginx -s reload'") | crontab -
```

### 4.6 验证

```bash
# 测试 HTTPS
curl -sv https://ai.example.com/health 2>&1 | grep -E "HTTP|status"

# 测试 HTTP → HTTPS 跳转
curl -Lv http://ai.example.com/ 2>&1 | grep "Location"
# 预期：Location: https://ai.example.com/

# 检查安全头
curl -sI https://ai.example.com/ | grep -E "Strict|Content-Security|X-Frame"

# 验证 ModSecurity WAF 正常工作（发送测试攻击，应返回 403）
curl -s -o /dev/null -w "%{http_code}" \
  "https://ai.example.com/?param=<script>alert(1)</script>"
# 预期：403（被 WAF 拦截）

# 查看 ModSecurity 审计日志
tail -20 /www/wwwlogs/owasp/modsec_audit.log
```

---

## 第五步：VPS D — 部署 Nextcloud

详细教程参见 [docs/deploy-vpsd.md](docs/deploy-vpsd.md) 中 Nextcloud 部分。

> 📌 Nextcloud 部署在 VPS D（香港 Azure），与 Azure PostgreSQL 同机房，消除跨境数据库延迟。

### 5.1 前置条件

- VPS D (172.16.1.4) 已完成基础安全加固（UFW / fail2ban）
- Azure PostgreSQL 已创建 `nextcloud` 数据库

### 5.2 部署 Nextcloud

```bash
mkdir -p /opt/ai/modules/nextcloud
cd /opt/ai/modules/nextcloud

# 从仓库复制 docker-compose.yml
cp /opt/ai/repo/modules/nextcloud/docker-compose.yml .

# 创建环境变量文件
cat > .env <<'EOF'
PG_PASSWORD=<Azure PostgreSQL 密码>
NEXTCLOUD_USERNAME=admin
NEXTCLOUD_PASSWORD=<管理员密码，至少 16 字符>
NEXTCLOUD_DOMAIN=<你的域名>
TZ=Asia/Shanghai
EOF
chmod 600 .env

docker compose up -d
```

### 5.3 初始化日历

```bash
# 启用日历应用并创建 AI 专用日历
docker exec -u www-data anima-nextcloud php occ app:enable calendar
docker exec -u www-data anima-nextcloud php occ dav:create-calendar admin anima

# 验证 CalDAV
curl -sf -u admin:<密码> http://172.16.1.4:8090/remote.php/dav/calendars/admin/anima/
```

### 5.4 配置 auditd 审计

```bash
# 部署审计规则（每台服务器都应执行）
sudo bash scripts/audit-setup.sh
```

---

## 第六步：初始化模型定价

初始化脚本已通过 `db/schema.sql` 预置了以下模型：

| 模型 | 提供商 | 免费 | 输入价（元/1k字） | 输出价（元/1k字） |
|------|--------|------|-------------------|-------------------|
| `claude-haiku-4-5-20251001` | anthropic | ✅ 是 | 0 | 0 |
| `claude-sonnet-4-5` | anthropic | — | 0.03（示例） | 0.06（示例） |
| `gpt-4o-mini` | openai | — | 0.0015（示例） | 0.003（示例） |
| `gpt-4o` | openai | — | 0.025（示例） | 0.05（示例） |
| `mistral-small-latest` | mistral | — | 0.002（示例） | 0.006（示例） |

> ⚠️ **付费模型价格为示例占位符，请按实际 API 成本调整！**

### 6.1 查看当前所有模型

```bash
ADMIN_TOKEN="$(grep '^ADMIN_TOKEN=' /opt/ai/webhook/.env | cut -d= -f2)"

curl http://172.16.1.6:3002/admin/models \
  -H "Authorization: Bearer ${ADMIN_TOKEN}"
```

### 6.2 修改模型价格

```bash
# 先查询模型 ID（从上一步输出中找到对应 id 字段）
MODEL_ID=2   # claude-sonnet-4-5 的 id

curl -X PUT "http://172.16.1.6:3002/admin/models/${MODEL_ID}" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"priceInput": 0.025, "priceOutput": 0.050}'
```

### 6.3 添加新模型

```bash
# 添加付费模型
curl -X POST http://172.16.1.6:3002/admin/models \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "provider":     "openai",
    "modelName":    "gpt-4-turbo",
    "displayName":  "GPT-4 Turbo",
    "isFree":       false,
    "priceInput":   0.04,
    "priceOutput":  0.08,
    "description":  "GPT-4 Turbo 付费模型"
  }'

# 添加免费模型
curl -X POST http://172.16.1.6:3002/admin/models \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "provider":     "anthropic",
    "modelName":    "claude-haiku-4-5-20251001",
    "displayName":  "Claude Haiku 4.5",
    "isFree":       true
  }'
```

### 6.4 停用/启用模型

```bash
# 停用模型（用户将无法选择该模型）
curl -X PUT "http://172.16.1.6:3002/admin/models/${MODEL_ID}" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"isActive": false}'

# 重新启用
curl -X PUT "http://172.16.1.6:3002/admin/models/${MODEL_ID}" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"isActive": true}'
```

### 6.5 生成充值卡

```bash
# 通过数据库生成充值卡（使用 heredoc 避免 shell 引号嵌套问题）
PGPASSWORD="<animaapp密码>" PGSSLMODE=require psql \
  -h anima-db.postgres.database.azure.com \
  -U animaapp -d librechat <<'SQL'
INSERT INTO recharge_cards (key, credit_fen, label)
SELECT 'ANIMA-' || upper(encode(gen_random_bytes(8),'hex')),
       2000,
       '¥20 充值卡'
FROM generate_series(1,5)   -- 一次生成5张
RETURNING key, credit_fen, label;
SQL
```

### 6.6 人工为用户充值

```bash
curl -X POST http://172.16.1.6:3002/admin/adjust \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "userEmail":   "user@example.com",
    "amount_fen":  2000,
    "type":        "recharge",
    "description": "管理员手动充值 ¥20"
  }'
```

---

## API 接口完整参考

### 公开接口（无需鉴权）

#### `GET /health` — 健康检查

```bash
curl http://172.16.1.6:3002/health
```
```json
{"status":"ok","db":"ok","ts":"2026-01-01T00:00:00.000Z"}
```

---

#### `GET /models` — 查看所有可用模型及定价

```bash
curl http://172.16.1.6:3002/models
```
```json
{
  "success": true,
  "models": [
    {
      "provider": "anthropic",
      "model_name": "claude-haiku-4-5-20251001",
      "display_name": "Claude Haiku 4.5",
      "is_free": true,
      "price_input_per_1k_chars": "0.0000",
      "price_output_per_1k_chars": "0.0000",
      "description": "免费模型"
    }
  ]
}
```

---

#### `GET /providers` — 查看所有 API 提供商

```bash
curl http://172.16.1.6:3002/providers
```
```json
{
  "success": true,
  "providers": [
    {
      "id": 1,
      "provider_name": "anthropic",
      "display_name": "Anthropic",
      "base_url": "https://api.anthropic.com"
    }
  ]
}
```

---

#### `POST /activate` — 充值卡激活

```bash
curl -X POST http://172.16.1.6:3002/activate \
  -H "Content-Type: application/json" \
  -d '{"cardKey":"ANIMA-TOP20-DEMO","userEmail":"user@example.com"}'
```
**成功响应：**
```json
{
  "success": true,
  "msg": "充值成功",
  "credit_fen": 2000,
  "balance_fen": 2000,
  "label": "¥20 演示充值卡"
}
```
**失败响应：**
```json
{"success": false, "msg": "卡密无效或已使用"}
```

---

#### `GET /billing/balance/:email` — 查询用户余额

```bash
curl "http://172.16.1.6:3002/billing/balance/user@example.com"
```
```json
{
  "success": true,
  "balance_fen": 1950,
  "total_charged_fen": 50,
  "is_suspended": false
}
```

---

#### `GET /billing/history/:email` — 查询消费历史（支持分页）

```bash
# 第一页（默认20条）
curl "http://172.16.1.6:3002/billing/history/user@example.com"

# 分页
curl "http://172.16.1.6:3002/billing/history/user@example.com?limit=10&offset=10"
```
```json
{
  "success": true,
  "total": 42,
  "records": [
    {
      "type": "charge",
      "amount_fen": "15.0000",
      "balance_after_fen": "1985.00",
      "description": "claude-sonnet-4-5（输入 300 字 / 输出 200 字）",
      "created_at": "2026-01-01T12:00:00.000Z"
    }
  ]
}
```

---

#### `POST /billing/check` — 调用前预检余额（不扣费）

```bash
curl -X POST http://172.16.1.6:3002/billing/check \
  -H "Content-Type: application/json" \
  -d '{
    "userEmail": "user@example.com",
    "modelName": "claude-sonnet-4-5",
    "estimatedInputChars": 2000,
    "estimatedOutputChars": 500
  }'
```
```json
{
  "success": true,
  "can_proceed": true,
  "is_free": false,
  "estimated_fen": 8,
  "balance_fen": 1950,
  "is_suspended": false
}
```

---

#### `POST /billing/record` — 记录 API 调用并计费（由 OpenClaw 自动调用）

```bash
curl -X POST http://172.16.1.6:3002/billing/record \
  -H "Content-Type: application/json" \
  -d '{
    "userEmail":   "user@example.com",
    "apiProvider": "anthropic",
    "modelName":   "claude-sonnet-4-5",
    "inputChars":  500,
    "outputChars": 200
  }'
```
**成功（付费模型）：**
```json
{"success":true,"is_free":false,"charged_fen":3,"balance_fen":1947}
```
**成功（免费模型）：**
```json
{"success":true,"is_free":true,"charged_fen":0,"balance_fen":null}
```
**余额不足（HTTP 402）：**
```json
{"success":false,"msg":"余额不足，请充值后继续使用","balance_fen":0,"required_fen":3}
```
**账户暂停（HTTP 403）：**
```json
{"success":false,"msg":"账户已被暂停"}
```
**模型不存在（HTTP 404）：**
```json
{"success":false,"msg":"模型不存在，请先通过 POST /admin/models 注册"}
```
**模型未启用（HTTP 400）：**
```json
{"success":false,"msg":"该模型当前未启用，无法计费"}
```

---

### 管理员接口（需 `Authorization: Bearer <ADMIN_TOKEN>`）

#### `GET /admin/models` — 查看所有模型（含未启用）

```bash
curl http://172.16.1.6:3002/admin/models \
  -H "Authorization: Bearer ${ADMIN_TOKEN}"
```

---

#### `POST /admin/models` — 添加或更新模型定价

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `provider` | string | ✅ | `anthropic`/`openai`/`mistral` 等 |
| `modelName` | string | ✅ | API 中使用的模型标识符（唯一键） |
| `displayName` | string | ✅ | 界面显示名称 |
| `isFree` | boolean | ✅ | `true` = 免费，`false` = 付费 |
| `priceInput` | number | 付费必填 | 输入价格（元/1000字），必须 ≥ 0 |
| `priceOutput` | number | 付费必填 | 输出价格（元/1000字），必须 ≥ 0 |
| `description` | string | 可选 | 管理员备注 |

> 若 `modelName` 已存在，会自动更新（upsert）并重新激活（`is_active=true`）。

---

#### `PUT /admin/models/:id` — 修改模型定价或启停

| 字段 | 类型 | 说明 |
|------|------|------|
| `isFree` | boolean | 切换免费/付费（切为免费时自动清零价格） |
| `priceInput` | number | 修改输入价，必须 ≥ 0 |
| `priceOutput` | number | 修改输出价，必须 ≥ 0 |
| `isActive` | boolean | `true`=启用，`false`=停用 |
| `displayName` | string | 修改显示名称 |
| `description` | string | 修改备注 |

---

#### `POST /admin/adjust` — 人工调整用户余额

| 字段 | 类型 | 说明 |
|------|------|------|
| `userEmail` | string | 用户邮箱 |
| `amount_fen` | number | 调整金额（分）。正数 = 增加，负数 = 减少 |
| `type` | string | `recharge`/`refund`/`admin_adjust` |
| `description` | string | 操作说明（可选） |

```json
{"success":true,"balance_fen":3000,"actual_applied_fen":500}
```

> `actual_applied_fen`：负数调整时，若余额不足以完全扣减，此字段显示实际扣减金额（余额会被截断到 0，不会出现负余额）。

---

#### `GET /admin/dashboard` — Web 管理控制台

浏览器访问即可打开管理面板，提供模型管理、用户管理、充值卡管理等可视化界面。

```bash
# 访问地址（需通过 Nginx 反向代理或直接内网访问）
curl http://172.16.1.6:3002/admin/dashboard
# 返回 HTML 管理页面
```

---

#### `GET /admin/modules` — 查看已注册模块状态

```bash
curl http://172.16.1.6:3002/admin/modules \
  -H "Authorization: Bearer \${ADMIN_TOKEN}"
```
```json
{
  "success": true,
  "modules": [
    { "name": "voice", "enabled": true, "version": "1.0.0" },
    { "name": "email", "enabled": true, "version": "1.0.0" }
  ]
}
```

---

#### `DELETE /admin/models/:id` — 删除模型定价记录

```bash
curl -X DELETE "http://172.16.1.6:3002/admin/models/42" \
  -H "Authorization: Bearer \${ADMIN_TOKEN}"
```
```json
{"success": true, "msg": "模型已删除"}
```

---

#### `GET /admin/providers` — 查看所有 API 提供商

```bash
curl http://172.16.1.6:3002/admin/providers \
  -H "Authorization: Bearer \${ADMIN_TOKEN}"
```

---

#### `POST /admin/providers` — 添加 API 提供商

```bash
curl -X POST http://172.16.1.6:3002/admin/providers \
  -H "Authorization: Bearer \${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"provider_name":"newprovider","display_name":"New Provider","base_url":"https://api.newprovider.com"}'
```

---

#### `PUT /admin/providers/:id` — 修改 API 提供商

```bash
curl -X PUT "http://172.16.1.6:3002/admin/providers/3" \
  -H "Authorization: Bearer \${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"display_name":"Updated Name","base_url":"https://new-api.example.com"}'
```

---

#### `DELETE /admin/providers/:id` — 删除 API 提供商

```bash
curl -X DELETE "http://172.16.1.6:3002/admin/providers/3" \
  -H "Authorization: Bearer \${ADMIN_TOKEN}"
```

---

#### `GET /admin/users` — 查看用户列表

```bash
curl http://172.16.1.6:3002/admin/users \
  -H "Authorization: Bearer \${ADMIN_TOKEN}"
```
```json
{
  "success": true,
  "users": [
    {
      "user_email": "user@example.com",
      "balance_fen": 2000,
      "is_suspended": false,
      "created_at": "2026-01-01T00:00:00.000Z"
    }
  ]
}
```

---

#### `PUT /admin/users/:email/suspend` — 停用用户

```bash
curl -X PUT "http://172.16.1.6:3002/admin/users/user@example.com/suspend" \
  -H "Authorization: Bearer \${ADMIN_TOKEN}"
```
```json
{"success": true, "msg": "用户已停用"}
```

---

#### `PUT /admin/users/:email/unsuspend` — 恢复用户

```bash
curl -X PUT "http://172.16.1.6:3002/admin/users/user@example.com/unsuspend" \
  -H "Authorization: Bearer \${ADMIN_TOKEN}"
```
```json
{"success": true, "msg": "用户已恢复"}
```

---

#### `POST /admin/cards` — 批量生成充值卡

| 字段 | 类型 | 说明 |
|------|------|------|
| `credit_fen` | number | 面值（分） |
| `label` | string | 卡标签（如 "¥20 充值卡"） |
| `count` | number | 生成数量（默认 1，最大 100） |

```bash
curl -X POST http://172.16.1.6:3002/admin/cards \
  -H "Authorization: Bearer \${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"credit_fen":2000,"label":"¥20 充值卡","count":5}'
```

---

#### `GET /admin/cards` — 查看充值卡列表

```bash
curl http://172.16.1.6:3002/admin/cards \
  -H "Authorization: Bearer \${ADMIN_TOKEN}"
```
```json
{
  "success": true,
  "cards": [
    {
      "key": "ANIMA-A1B2C3D4E5F6",
      "credit_fen": 2000,
      "label": "¥20 充值卡",
      "used": false,
      "used_by": null,
      "created_at": "2026-01-01T00:00:00.000Z"
    }
  ]
}
```

---

## 常用运维 SQL

```sql
-- ─── 查看余额 ──────────────────────────────────────────────
SELECT user_email, balance_fen, total_charged_fen, is_suspended
FROM user_billing ORDER BY total_charged_fen DESC;

-- ─── 查看近期流水 ──────────────────────────────────────────
SELECT user_email, type, amount_fen, balance_after_fen, description, created_at
FROM billing_transactions ORDER BY created_at DESC LIMIT 20;

-- ─── 今日各模型调用量 ──────────────────────────────────────
SELECT * FROM v_today_model_usage;

-- ─── 查看所有模型定价 ──────────────────────────────────────
SELECT id, provider, model_name, display_name, is_free,
       price_input_per_1k_chars, price_output_per_1k_chars, is_active
FROM api_models ORDER BY provider, model_name;

-- ─── 修改模型价格 ──────────────────────────────────────────
UPDATE api_models
SET price_input_per_1k_chars=0.025, price_output_per_1k_chars=0.050
WHERE model_name='claude-sonnet-4-5';

-- ─── 生成充值卡 ────────────────────────────────────────────
INSERT INTO recharge_cards (key, credit_fen, label)
VALUES ('ANIMA-' || upper(encode(gen_random_bytes(8),'hex')), 2000, '¥20 充值卡');

-- ─── 批量生成充值卡（一次生成10张¥20充值卡）──────────────
INSERT INTO recharge_cards (key, credit_fen, label)
SELECT 'ANIMA-' || upper(encode(gen_random_bytes(8),'hex')),
       2000,
       '¥20 充值卡'
FROM generate_series(1,10)
RETURNING key, credit_fen, label;

-- ─── 暂停/恢复用户 ────────────────────────────────────────
UPDATE user_billing SET is_suspended=true  WHERE user_email='user@example.com';
UPDATE user_billing SET is_suspended=false WHERE user_email='user@example.com';

-- ─── 启用本地 Ollama 模型（如需） ─────────────────────────
UPDATE api_models SET is_active=true WHERE provider='ollama';
```

---

## 故障排查

### Webhook 服务无法启动

```bash
# 查看详细日志
journalctl -u ai-webhook -n 50 --no-pager

# 常见原因：
# 1. .env 中 PG_PASSWORD 错误 → 修改后 systemctl restart ai-webhook
# 2. 数据库连接失败 → 检查 Azure PostgreSQL 防火墙是否允许 172.16.1.6（VPS E）、172.16.1.4（VPS D）
# 3. 端口已被占用 → ss -tlnp | grep 3002
```

### 数据库 Schema 初始化失败

```bash
# 手动执行 Schema（使用正确的 SSL 参数）
PGPASSWORD="<密码>" PGSSLMODE=require psql \
  -h anima-db.postgres.database.azure.com \
  -U animaapp -d librechat \
  -f /opt/ai/repo/db/schema.sql

# 执行所有迁移
for f in /opt/ai/repo/db/migrations/*.sql; do
  PGPASSWORD="<密码>" PGSSLMODE=require psql \
    -h anima-db.postgres.database.azure.com \
    -U animaapp -d librechat \
    -f "$f"
done

# 检查错误（不过滤输出）
PGPASSWORD="<密码>" PGSSLMODE=require psql \
  -h anima-db.postgres.database.azure.com \
  -U animaapp -d librechat \
  -c "\dt"   # 列出所有表
```

### LibreChat 容器启动失败

```bash
cd /opt/ai/repo/librechat
docker compose logs --tail=100 librechat

# 常见原因：
# 1. POSTGRES_URI 密码错误
# 2. JWT_SECRET 太短（需至少 32 字节随机值）
# 3. 内存不足（需 1GB+）
docker stats librechat
```

### OpenClaw 计费 Webhook 失败

```bash
# 测试 Webhook 连通性（在 VPS B 上执行）
curl -X POST http://172.16.1.6:3002/billing/record \
  -H "Content-Type: application/json" \
  -d '{"userEmail":"test@test.com","apiProvider":"anthropic","modelName":"claude-haiku-4-5-20251001","inputChars":100,"outputChars":50}'
# 预期：{"success":true,"is_free":true,...}

# 检查 OpenClaw 日志
cd /opt/ai/repo/openclaw
docker compose logs --tail=50 openclaw
```

### Nginx 配置测试失败

```bash
/opt/nginx/sbin/nginx -t
# 若报错 "unknown directive http2"，说明 Nginx 版本 < 1.25.1
# 解决：编辑 /opt/nginx/conf/conf.d/anima.conf
# 将 "http2 on;" 删除，改为 listen 行改为：
# listen 443 ssl http2;
# listen [::]:443 ssl http2;

# 若报错 "unknown directive modsecurity"，说明 ModSecurity 模块未正确编译
# 解决：重新运行安装脚本确保 ModSecurity-nginx 连接器已编译

# 查看 Nginx 版本
/opt/nginx/sbin/nginx -v
```

### ModSecurity WAF 误报处理

```bash
# 查看最近被拦截的请求
tail -100 /www/wwwlogs/owasp/modsec_audit.log | grep -A5 '"id"'

# 若合法请求被误拦截：
# 1. 从日志中找到触发的规则 ID（如 942100）
# 2. 在 REQUEST-900-EXCLUSION-RULES-BEFORE-CRS.conf 中添加排除规则
# 3. 重载 Nginx：/opt/nginx/sbin/nginx -s reload

# 临时切换为仅检测模式（不拦截）
sed -i 's/^SecRuleEngine.*/SecRuleEngine DetectionOnly/' /opt/nginx/src/ModSecurity/modsecurity.conf
/opt/nginx/sbin/nginx -s reload
# 排查完成后记得改回 On
sed -i 's/^SecRuleEngine.*/SecRuleEngine On/' /opt/nginx/src/ModSecurity/modsecurity.conf
```

### 查询 ADMIN_TOKEN

```bash
grep '^ADMIN_TOKEN=' /opt/ai/webhook/.env
```

### 轮换 ADMIN_TOKEN（PCI-DSS 8.6.3 建议定期轮换）

```bash
# 1. 生成新令牌
NEW_TOKEN="$(openssl rand -hex 32)"

# 2. 写入 .env（原子替换）
sed -i "s/^ADMIN_TOKEN=.*/ADMIN_TOKEN=${NEW_TOKEN}/" /opt/ai/webhook/.env

# 3. 重启服务使新令牌生效
systemctl restart ai-webhook

# 4. 验证（输出应为新令牌）
grep '^ADMIN_TOKEN=' /opt/ai/webhook/.env

# 5. 用新令牌测试管理员接口
curl http://172.16.1.6:3002/admin/models \
  -H "Authorization: Bearer ${NEW_TOKEN}"
```

> ⚠️ 轮换后请同步更新使用该令牌的所有自动化脚本/监控工具。

---

## CIS / PCI-DSS 合规说明

本系统在设计上对齐 CIS Controls v8 和 PCI-DSS v4.0 的核心控制项，下表列出关键映射：

| 控制项 | CIS/PCI-DSS 要求 | 本系统实现 |
|--------|-----------------|-----------|
| **WAF（PCI 6.4.1/6.4.2）** | 部署 WAF 保护公共 Web 应用，检测/阻止 OWASP Top 10 攻击 | ModSecurity v3 + OWASP CRS v4（异常评分模式，PL1 阈值=5）；覆盖 SQLi/XSS/RCE/LFI 等；JSON 审计日志 |
| 网络安全（CIS 12, PCI 1.x） | 最小化暴露面，分段网络 | 所有服务仅监听 WireGuard 内网；Nginx 为唯一公网入口；UFW 白名单规则 |
| 传输加密（CIS 3, PCI 4.x） | 仅 TLS 1.2/1.3，强密码套件 | Nginx 仅启用 TLSv1.2/1.3；ECDHE 密码套件；HSTS（max-age=63072000） |
| OCSP Stapling（CIS TLS） | 证书状态验证 | `ssl_stapling on; ssl_stapling_verify on; ssl_trusted_certificate` |
| 安全配置（CIS 4, PCI 2.x） | 关闭默认服务/版本信息 | `server_tokens off`；`X-Powered-By` 已禁用；helmet 安全响应头；ModSecurity `SecServerSignature " "` |
| 访问控制（CIS 6, PCI 7.x） | 最小权限，强认证 | ADMIN_TOKEN 使用 `openssl rand -hex 32` 生成（256 位熵）；接口仅内网可达 |
| 防暴力破解（PCI 8.3） | 速率限制，账户锁定 | 激活接口 5 次/10 分；全局 60 次/分；Express rate-limit；Nginx 三级限速（API/登录/TTS） |
| 令牌安全（PCI 8.3.6, 8.6.3） | 令牌最小长度；定期轮换 | 启动时检查 ADMIN_TOKEN ≥ 32 字符；提供轮换操作步骤 |
| 防计时攻击（PCI 6.3.2） | 定时安全比较 | `crypto.timingSafeEqual()` 用于 ADMIN_TOKEN 比较 |
| 输入验证（CIS 16, PCI 6.4） | 拒绝非法输入 | 双层防御：应用层（类型/范围/格式校验）+ WAF 层（OWASP CRS 规则检测恶意 payload）；字符串长度匹配 DB VARCHAR 约束；字符数上限 10M |
| SQL 注入防护（PCI 6.4） | 参数化查询 | 双层防御：全部 DB 操作使用 `$1,$2,...` 参数化查询 + OWASP CRS 942xxx SQLi 检测规则 |
| 并发安全（PCI 6.4） | 防 TOCTOU/竞态 | 充值激活使用 `SELECT ... FOR UPDATE` 行锁；余额扣减及管理员调整均使用事务 + 行锁 |
| 审计日志（CIS 8, PCI 10.x） | 记录操作日志 | 双层日志：Winston 应用日志（10 MB × 5 轮替）+ ModSecurity 审计日志（`/www/wwwlogs/owasp/modsec_audit.log`，并发模式） |
| 密钥保护（PCI 3.x） | 不硬编码凭证 | 所有密码/令牌通过环境变量注入；`.env` 权限 600 |
| 数据完整性（PCI 6.4） | DB 约束防异常数据 | CHECK 约束：余额/充值金额/累计费用均不允许负值/零值 |
| 容器加固（CIS Docker 5.3） | 最小权限容器 | `cap_drop: ALL` + 选择性 `cap_add`；`no-new-privileges:true`；内存限制（LibreChat 680m / OpenClaw 384m–450m / Nextcloud 512m）；JSON 日志轮替 |
| 资源管理（CIS 4, PCI 6.4） | 防止资源耗尽 | Docker 容器内存限制适配各节点；CXI4 托管 Whisper（2g）+ TTS（768m）+ Email（192m）+ HA（512m），合计 ≈ 3.5g / 8 GB；VPS E 托管 Webhook（256m）+ Redis（128m）；VPS D 托管 Nextcloud（512m）；Nginx `worker_processes auto`；ModSecurity `SecPcreMatchLimit` 防 ReDoS |
| 纵深防御（CIS 12, PCI 1.x） | 多层访问控制 | UFW 防火墙 → Nginx 限速/路径拦截 → ModSecurity WAF → 应用层校验 → DB 约束（五层纵深防御） |

### WAF 性能优化措施

为确保 ModSecurity WAF 不影响 AI 聊天的低延迟体验，已采取以下优化：

| 优化项 | 措施 | 影响 |
|--------|------|------|
| 响应体检查 | `SecResponseBodyAccess Off` | 避免检查 AI 生成的长文本（可达数万字符），显著降低延迟 |
| 请求体解析 | `SecRequestBodyJsonDepthLimit 512` + `SecArgumentsLimit 1000` | 防止深度嵌套 JSON 和参数污染，同时保证 AI 聊天低延迟 |
| 静态资源 | 排除规则跳过 `.js/.css/.woff2/图片` | 静态资源零 WAF 开销 |
| 语音上传 | `/whisper/` 路径完全跳过 WAF | 避免对二进制音频文件运行正则匹配 |
| 健康检查 | `/health` 路径跳过 WAF + 审计日志 | 减少高频内部探测的日志噪声 |
| AI 对话体 | 仅排除 `text/content/message` 字段的 SQLi/XSS 规则 | 请求头和 URL 仍受完整 CRS 保护 |
| 正则防护 | `SecPcreMatchLimit 500000` | 防止恶意构造的正则导致 CPU 暴涨 |
| 异常评分 | PL1 阈值=5（单条 CRITICAL 即拦截） | 避免 PL2+ 的大量规则增加延迟 |

### 已知合规说明（可接受风险）

| 项目 | 说明 |
|------|------|
| CSP `'unsafe-inline'` | LibreChat 前端需要内联脚本/样式；已通过其他 CSP 指令（`object-src 'none'`、`base-uri 'self'`）降低风险 |
| AI 对话内容 WAF 排除 | AI 聊天的用户输入文本字段（text/content/message）排除了 SQLi/XSS/RCE 检测，因用户可能合法讨论代码；请求 URL 和 Header 仍受完整保护 |

---

## 各服务器详细部署教程

每台服务器均提供独立的详细部署文档，涵盖 **OS 基线加固（CIS L1）、服务安装、CIS 合规核查清单、PCI-DSS 合规核查清单以及逐项功能测试**：

| 节点 | 角色 | 详细文档 |
|------|------|---------|
| **VPS A** (172.16.1.1) | Nginx 反向代理 + ModSecurity WAF | [docs/deploy-vpsa.md](docs/deploy-vpsa.md) |
| **VPS B** (172.16.1.2) | OpenClaw Agent + 可选 Bot 模块 | [docs/deploy-vpsb.md](docs/deploy-vpsb.md) |
| **VPS C** (172.16.1.3) | LibreChat Web UI | [docs/deploy-vpsc.md](docs/deploy-vpsc.md) |
| **VPS D** (172.16.1.4) | Nextcloud（CalDAV + WebDAV） | [docs/deploy-vpsd.md](docs/deploy-vpsd.md) |
| **VPS E** (172.16.1.6) | Webhook 计费 + Redis | [docs/deploy-vpse.md](docs/deploy-vpse.md) |
| **CXI4** (172.16.1.5) | Whisper + TTS + Email + HA | [docs/deploy-cxi4.md](docs/deploy-cxi4.md) |

**推荐部署顺序：** VPS E（Webhook + Redis）→ VPS D（Nextcloud）→ VPS C → VPS B → VPS A

---

> 完整网络架构与 WireGuard 组网详见 `Anima灵枢_完整部署教程_172.16.1.0_24.docx`
