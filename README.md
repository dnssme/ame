# Anima · 灵枢 私有 AI 手机助理

> 完整生产级部署 · 按模型按量计费 · 安全加固

---

## 目录

1. [最终用户使用说明](#最终用户使用说明)
2. [架构概览](#架构概览)
3. [计费规则](#计费规则)
4. [前置条件](#前置条件)
5. [第一步：CXI4 — 初始化 Webhook 计费服务](#第一步cxi4--初始化-webhook-计费服务)
6. [第二步：VPS C — 部署 LibreChat](#第二步vps-c--部署-librechat)
7. [第三步：VPS B — 部署 OpenClaw](#第三步vps-b--部署-openclaw)
8. [第四步：VPS A — 配置 Nginx + ModSecurity WAF](#第四步vps-a--配置-nginx--modsecurity-waf)
9. [第五步：初始化模型定价](#第五步初始化模型定价)
10. [API 接口完整参考](#api-接口完整参考)
11. [常用运维 SQL](#常用运维-sql)
12. [故障排查](#故障排查)
13. [CIS / PCI-DSS 合规说明](#cis--pci-dss-合规说明)

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
| `nginx/modsecurity/` | ModSecurity WAF 规则 | 可选（按需调整排除规则） |
| `librechat/.env.example` | LibreChat 配置模板 | 必须（填写密钥和密码） |
| `librechat/docker-compose.yml` | LibreChat 容器定义 | 可选（调整内存限制） |
| `openclaw/.env.example` | OpenClaw 配置模板 | 必须（填写 API Key） |
| `openclaw/config.yml` | OpenClaw Agent 配置 | 可选（调整工具和模型） |
| `openclaw/docker-compose.yml` | OpenClaw 容器定义 | 可选（调整内存限制） |
| `scripts/setup.sh` | CXI4 一键初始化脚本 | 否（直接执行） |

---

## 架构概览

```
互联网用户
    │ HTTPS
    ▼
[VPS A] Nginx 反向代理 (172.16.1.1)
    ├─── /          → [VPS C] LibreChat :3080
    ├─── /api/agent → [VPS B] OpenClaw  :3000
    └─── /activate  → [CXI4] Webhook    :3002

[CXI4] (172.16.1.5)
    ├─── Webhook 计费服务  :3002  ←── OpenClaw / LibreChat 自动调用
    ├─── Redis             :6379  ←── LibreChat / OpenClaw 缓存
    └─── (Whisper STT)     :8080  （可选）

[Azure PostgreSQL]
    ├─── librechat  ←── LibreChat 用户数据 + 计费数据
    └─── openclaw   ←── OpenClaw 记忆数据库
```

所有节点通过 **WireGuard 内网（172.16.1.0/24）** 互通，Webhook 服务和数据库完全不暴露公网。

### 目录结构

```
.
├── db/
│   └── schema.sql           # PostgreSQL Schema（v4）
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
└── scripts/
    └── setup.sh             # CXI4 一键初始化脚本
```

---

## 计费规则

| 规则 | 说明 |
|------|------|
| **按模型独立定价** | 每个 API 模型在 `api_models` 表中单独设定价格，无套餐绑定 |
| **免费模型** | `is_free=true` 的模型（如 `claude-haiku-4-5-20251001`）永久免费，不扣余额 |
| **付费模型** | 仅在实际使用时扣费：`⌈(输入字数/1000 × 输入价格) + (输出字数/1000 × 输出价格)⌉` 分 |
| **预付费** | 用户充值后使用；余额不足时系统返回 HTTP 402 拒绝调用 |
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
| **VPS B** (172.16.1.2) | OpenClaw Agent | 2 核 | 1 GB | — | 容器 ≤600 MB | ~400 MB 系统 |
| **VPS C** (172.16.1.3) | LibreChat | 2 核 | 1 GB | — | 容器 ≤768 MB | ~256 MB 系统 |
| **VPS D** (172.16.1.4) | Nextcloud（可选） | 2 核 | 1 GB | — | — | — |
| **CXI4** (172.16.1.5) | Webhook + Redis + Whisper | 4 核 8 线程 (i5-10610U) | 8 GB | 500 GB | Webhook ~256 MB / Redis ≤1 GB / Whisper ~2 GB | ~4 GB 系统 |

> ⚠️ **1 GB 内存 VPS 注意事项**：Linux 内核 + 系统服务约占 200–300 MB，Docker 容器的 `mem_limit` 不能设为 1g（会导致 OOM Kill）。LibreChat 设为 768m、OpenClaw 设为 600m，均已在 `docker-compose.yml` 中配置。

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
# CXI4 (172.16.1.5) — Webhook / Redis（内网专用）
# ──────────────────────────────────────────
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow in from 172.16.1.0/24 to any port 3002  # Webhook 计费服务
ufw allow in from 172.16.1.0/24 to any port 6379  # Redis（禁止公网直连）
ufw allow in on wg0
ufw enable
```

> ⚠️ 执行 `ufw enable` 前确认 SSH 端口（22）已在规则中，否则会断开连接。

### 验证 WireGuard 内网互通

```bash
# 在任意节点执行，确认四个 IP 均可达
ping -c 2 172.16.1.1   # VPS A (Nginx)
ping -c 2 172.16.1.2   # VPS B (OpenClaw)
ping -c 2 172.16.1.3   # VPS C (LibreChat)
ping -c 2 172.16.1.4   # VPS D (Nextcloud，如有）
ping -c 2 172.16.1.5   # CXI4 (Webhook/Redis)
```

---

## 第一步：CXI4 — 初始化 Webhook 计费服务

> **执行节点：CXI4 (172.16.1.5)**

### 1.1 安装 Redis

```bash
# 安装 Redis
apt-get update && apt-get install -y redis-server

# 配置 Redis 监听内网、设置密码
# ⚠️ 密码请勿包含 / & \ 等特殊字符（会破坏下方 sed 命令）
REDIS_PASS="<强随机字符串>"   # 记录此密码，后续 LibreChat 和 OpenClaw 需要

# 修改监听地址
sed -i 's/^bind 127.0.0.1.*/bind 172.16.1.5 127.0.0.1/' /etc/redis/redis.conf
# 设置密码（取消 requirepass 注释并写入密码）
sed -i "s/^# requirepass .*/requirepass ${REDIS_PASS}/" /etc/redis/redis.conf

systemctl enable --now redis-server
systemctl restart redis-server

# 验证（REDISCLI_AUTH 避免密码出现在进程列表 ps aux 中）
REDISCLI_AUTH="${REDIS_PASS}" redis-cli -h 172.16.1.5 ping
# 预期输出：PONG
```

> ⚠️ **Redis 内存限制（CXI4 共 8 GB，需为 Webhook / Whisper 预留内存）**：
> ```bash
> # 设置 Redis 最大内存为 1 GB，超出后按 LRU 策略淘汰
> echo 'maxmemory 1gb' >> /etc/redis/redis.conf
> echo 'maxmemory-policy allkeys-lru' >> /etc/redis/redis.conf
> systemctl restart redis-server
> ```
> 未设置 `maxmemory` 时，Redis 可能占满全部可用内存导致系统 OOM Kill。

### 1.2 克隆仓库

```bash
git clone https://github.com/dnssme/ame.git /opt/ai/repo
```

### 1.3 运行初始化脚本

> 脚本会完成：安装 Node.js 20 → 部署文件 → 初始化 DB Schema → 生成 systemd 服务 → 自动写入 `.env` 并生成 `ADMIN_TOKEN`

```bash
cd /opt/ai/repo
bash scripts/setup.sh '<animaapp数据库密码>' '<Redis密码>' 'anima-db.postgres.database.azure.com'
```

**输出示例（正常）：**
```
✅ Node.js 20 已安装，跳过
✅ Webhook 依赖安装完成
✅ .env 已创建（ADMIN_TOKEN 已自动生成并写入）
⚠  请保存 ADMIN_TOKEN: a3f9e2b1c5d8...
✅ 数据库 Schema 初始化完成
✅ systemd 服务已创建并启动（ai-webhook）
✅ Webhook 服务运行正常
```

> ⚠️ **请立即保存脚本输出中的 `ADMIN_TOKEN`**，后续模型管理接口需要用到。

### 1.4 验证 Webhook 服务

```bash
# 健康检查
curl http://172.16.1.5:3002/health
# 预期：{"status":"ok","db":"ok","ts":"..."}

# 查看预置模型列表
curl http://172.16.1.5:3002/models
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

### 4.1 安装 Nginx + ModSecurity

```bash
apt-get update && apt-get install -y nginx certbot python3-certbot-nginx

# 安装 ModSecurity + OWASP CRS（PCI-DSS 6.4.1 要求 WAF）
apt-get install -y libmodsecurity3 libnginx-mod-security modsecurity-crs

# 创建 ModSecurity 日志目录和临时目录
mkdir -p /var/log/modsecurity /tmp/modsecurity/{tmp,data,upload}
chown www-data:www-data /var/log/modsecurity /tmp/modsecurity -R
```

### 4.2 申请 SSL 证书（Let's Encrypt）

```bash
DOMAIN="ai.example.com"   # 替换为你的真实域名

# 先确保 80 端口可访问（UFW 允许）
ufw allow 80/tcp
ufw allow 443/tcp

# 申请证书
certbot certonly --nginx -d "${DOMAIN}" --non-interactive --agree-tos \
  --email admin@example.com   # 替换为你的邮箱

# 证书位置
ls /etc/letsencrypt/live/${DOMAIN}/
# 应有：fullchain.pem  privkey.pem
```

### 4.3 部署 ModSecurity WAF 配置

```bash
# 部署 ModSecurity 主配置
cp /opt/ai/repo/nginx/modsecurity/modsecurity.conf /etc/modsecurity/modsecurity.conf
cp /opt/ai/repo/nginx/modsecurity/crs-setup.conf /etc/modsecurity/crs-setup.conf

# 部署应用专属排除规则
cp /opt/ai/repo/nginx/modsecurity/REQUEST-900-EXCLUSION-RULES-BEFORE-CRS.conf \
   /etc/modsecurity/REQUEST-900-EXCLUSION-RULES-BEFORE-CRS.conf
cp /opt/ai/repo/nginx/modsecurity/RESPONSE-999-EXCLUSION-RULES-AFTER-CRS.conf \
   /etc/modsecurity/RESPONSE-999-EXCLUSION-RULES-AFTER-CRS.conf
```

> ⚠️ **首次部署建议**：先将 `modsecurity.conf` 中的 `SecRuleEngine On` 改为 `SecRuleEngine DetectionOnly`，
> 观察 `/var/log/modsecurity/audit.log` 一段时间确认无误报后，再改回 `On` 启用拦截模式。

### 4.4 部署 Nginx 配置

> ⚠️ **Worker 进程数**：VPS A 为双核 CPU，请确认 `/etc/nginx/nginx.conf` 主配置中设置了 `worker_processes auto;`（默认值为 1，会浪费一个 CPU 核心）：
> ```bash
> # 确认或修改（该指令在 main 上下文，不在 http{} 中）
> grep -n 'worker_processes' /etc/nginx/nginx.conf
> # 如显示 "worker_processes 1;"，则改为：
> sed -i 's/^worker_processes.*/worker_processes auto;/' /etc/nginx/nginx.conf
> ```

```bash
DOMAIN="ai.example.com"   # 与上面相同

# 替换域名占位符
sed "s/<你的域名>/${DOMAIN}/g" /opt/ai/repo/nginx/anima.conf \
  > /etc/nginx/sites-available/anima

# 启用并测试
ln -sf /etc/nginx/sites-available/anima /etc/nginx/sites-enabled/
nginx -t
# 预期：configuration file ... syntax is ok
#       configuration file ... test is successful

# 重载
systemctl reload nginx
```

> **注意**：`nginx/anima.conf` 已包含 `ssl_trusted_certificate /etc/letsencrypt/live/<你的域名>/chain.pem;`  
> 该文件由 certbot 自动生成（`chain.pem` 为 Let's Encrypt 中间 CA 链），上方 `sed` 替换域名后即可正确指向该文件。  
> 此指令与 `ssl_stapling_verify on` 配合，使 Nginx 能验证 OCSP 响应的签名（CIS TLS 配置要求）。

### 4.5 配置证书自动续期

```bash
# 测试续期（不实际续期）
certbot renew --dry-run
# 预期：Congratulations, all simulated renewals succeeded.

# certbot 安装时已自动配置 systemd timer，确认状态
systemctl status certbot.timer
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
tail -20 /var/log/modsecurity/audit.log
```

---

## 第五步：初始化模型定价

初始化脚本已通过 `db/schema.sql` 预置了以下模型：

| 模型 | 提供商 | 免费 | 输入价（元/1k字） | 输出价（元/1k字） |
|------|--------|------|-------------------|-------------------|
| `claude-haiku-4-5-20251001` | anthropic | ✅ 是 | 0 | 0 |
| `claude-sonnet-4-5` | anthropic | — | 0.03（示例） | 0.06（示例） |
| `gpt-4o-mini` | openai | — | 0.0015（示例） | 0.003（示例） |
| `gpt-4o` | openai | — | 0.025（示例） | 0.05（示例） |
| `mistral-small-latest` | mistral | — | 0.002（示例） | 0.006（示例） |

> ⚠️ **付费模型价格为示例占位符，请按实际 API 成本调整！**

### 5.1 查看当前所有模型

```bash
ADMIN_TOKEN="$(grep '^ADMIN_TOKEN=' /opt/ai/webhook/.env | cut -d= -f2)"

curl http://172.16.1.5:3002/admin/models \
  -H "Authorization: Bearer ${ADMIN_TOKEN}"
```

### 5.2 修改模型价格

```bash
# 先查询模型 ID（从上一步输出中找到对应 id 字段）
MODEL_ID=2   # claude-sonnet-4-5 的 id

curl -X PUT "http://172.16.1.5:3002/admin/models/${MODEL_ID}" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"priceInput": 0.025, "priceOutput": 0.050}'
```

### 5.3 添加新模型

```bash
# 添加付费模型
curl -X POST http://172.16.1.5:3002/admin/models \
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
curl -X POST http://172.16.1.5:3002/admin/models \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "provider":     "anthropic",
    "modelName":    "claude-haiku-4-5-20251001",
    "displayName":  "Claude Haiku 4.5",
    "isFree":       true
  }'
```

### 5.4 停用/启用模型

```bash
# 停用模型（用户将无法选择该模型）
curl -X PUT "http://172.16.1.5:3002/admin/models/${MODEL_ID}" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"isActive": false}'

# 重新启用
curl -X PUT "http://172.16.1.5:3002/admin/models/${MODEL_ID}" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"isActive": true}'
```

### 5.5 生成充值卡

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

### 5.6 人工为用户充值

```bash
curl -X POST http://172.16.1.5:3002/admin/adjust \
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
curl http://172.16.1.5:3002/health
```
```json
{"status":"ok","db":"ok","ts":"2026-01-01T00:00:00.000Z"}
```

---

#### `GET /models` — 查看所有可用模型及定价

```bash
curl http://172.16.1.5:3002/models
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

#### `POST /activate` — 充值卡激活

```bash
curl -X POST http://172.16.1.5:3002/activate \
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
curl "http://172.16.1.5:3002/billing/balance/user@example.com"
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
curl "http://172.16.1.5:3002/billing/history/user@example.com"

# 分页
curl "http://172.16.1.5:3002/billing/history/user@example.com?limit=10&offset=10"
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
curl -X POST http://172.16.1.5:3002/billing/check \
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
curl -X POST http://172.16.1.5:3002/billing/record \
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
curl http://172.16.1.5:3002/admin/models \
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
# 2. 数据库连接失败 → 检查 Azure PostgreSQL 防火墙是否允许 172.16.1.5
# 3. 端口已被占用 → ss -tlnp | grep 3002
```

### 数据库 Schema 初始化失败

```bash
# 手动执行 Schema（使用正确的 SSL 参数）
PGPASSWORD="<密码>" PGSSLMODE=require psql \
  -h anima-db.postgres.database.azure.com \
  -U animaapp -d librechat \
  -f /opt/ai/repo/db/schema.sql

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
curl -X POST http://172.16.1.5:3002/billing/record \
  -H "Content-Type: application/json" \
  -d '{"userEmail":"test@test.com","apiProvider":"anthropic","modelName":"claude-haiku-4-5-20251001","inputChars":100,"outputChars":50}'
# 预期：{"success":true,"is_free":true,...}

# 检查 OpenClaw 日志
cd /opt/ai/repo/openclaw
docker compose logs --tail=50 openclaw
```

### Nginx 配置测试失败

```bash
nginx -t
# 若报错 "unknown directive http2"，说明 Nginx 版本 < 1.25.1
# 解决：编辑 /etc/nginx/sites-available/anima
# 将 "http2 on;" 删除，改为 listen 行改为：
# listen 443 ssl http2;
# listen [::]:443 ssl http2;

# 若报错 "unknown directive modsecurity"，说明 ModSecurity 模块未安装
# 解决：apt-get install -y libnginx-mod-security

# 查看 Nginx 版本
nginx -v
```

### ModSecurity WAF 误报处理

```bash
# 查看最近被拦截的请求
tail -100 /var/log/modsecurity/audit.log | grep -A5 '"id"'

# 若合法请求被误拦截：
# 1. 从日志中找到触发的规则 ID（如 942100）
# 2. 在 REQUEST-900-EXCLUSION-RULES-BEFORE-CRS.conf 中添加排除规则
# 3. 重载 Nginx：systemctl reload nginx

# 临时切换为仅检测模式（不拦截）
sed -i 's/^SecRuleEngine.*/SecRuleEngine DetectionOnly/' /etc/modsecurity/modsecurity.conf
systemctl reload nginx
# 排查完成后记得改回 On
sed -i 's/^SecRuleEngine.*/SecRuleEngine On/' /etc/modsecurity/modsecurity.conf
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
curl http://172.16.1.5:3002/admin/models \
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
| 审计日志（CIS 8, PCI 10.x） | 记录操作日志 | 双层日志：Winston 应用日志（10 MB × 5 轮替）+ ModSecurity JSON 审计日志（`/var/log/modsecurity/audit.log`） |
| 密钥保护（PCI 3.x） | 不硬编码凭证 | 所有密码/令牌通过环境变量注入；`.env` 权限 600 |
| 数据完整性（PCI 6.4） | DB 约束防异常数据 | CHECK 约束：余额/充值金额/累计费用均不允许负值/零值 |
| 容器加固（CIS Docker 5.3） | 最小权限容器 | `cap_drop: ALL` + 选择性 `cap_add`；`no-new-privileges:true`；内存限制（LibreChat 768m / OpenClaw 600m）；JSON 日志轮替 |
| 资源管理（CIS 4, PCI 6.4） | 防止资源耗尽 | Docker 容器内存限制适配 1 GB VPS；Redis `maxmemory 1gb` + LRU 淘汰策略；Nginx `worker_processes auto`；ModSecurity `SecPcreMatchLimit` 防 ReDoS |
| 纵深防御（CIS 12, PCI 1.x） | 多层访问控制 | UFW 防火墙 → Nginx 限速/路径拦截 → ModSecurity WAF → 应用层校验 → DB 约束（五层纵深防御） |

### WAF 性能优化措施

为确保 ModSecurity WAF 不影响 AI 聊天的低延迟体验，已采取以下优化：

| 优化项 | 措施 | 影响 |
|--------|------|------|
| 响应体检查 | `SecResponseBodyAccess Off` | 避免检查 AI 生成的长文本（可达数万字符），显著降低延迟 |
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

> 完整网络架构与 WireGuard 组网详见 `Anima灵枢_完整部署教程_172.16.1.0_24.docx`
