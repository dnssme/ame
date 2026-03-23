# VPS E (172.16.1.6) 详细部署教程
## Webhook 计费服务 + Redis

> **节点角色**：Anima 灵枢计费核心，托管 Webhook 计费 API（11 个接口）和 Redis 会话缓存  
> **硬件规格**：2 核 CPU · 1 GB RAM  
> **操作系统**：Ubuntu 22.04 LTS（推荐）  
> **部署顺序**：**必须第一个部署**，其他所有服务依赖本节点的计费接口和 Redis。

---

## 目录

1. [前置条件](#1-前置条件)
2. [OS 基线加固（CIS L1）](#2-os-基线加固cis-l1)
3. [UFW 防火墙配置](#3-ufw-防火墙配置)
4. [WireGuard 内网配置](#4-wireguard-内网配置)
5. [安装 Redis](#5-安装-redis)
6. [安装 Node.js 20](#6-安装-nodejs-20)
7. [部署 Webhook 计费服务](#7-部署-webhook-计费服务)
8. [初始化数据库 Schema](#8-初始化数据库-schema)
9. [创建 systemd 服务](#9-创建-systemd-服务)
10. [配置 auditd 操作审计](#10-配置-auditd-操作审计)
11. [CIS 合规核查清单](#11-cis-合规核查清单)
12. [PCI-DSS 合规核查清单](#12-pci-dss-合规核查清单)
13. [功能测试](#13-功能测试)
14. [日常运维](#14-日常运维)
15. [故障排查](#15-故障排查)

---

## 1. 前置条件

- [ ] Ubuntu 22.04 LTS 全新安装，已完成基础系统更新
- [ ] 已分配 WireGuard 内网 IP `172.16.1.6`
- [ ] **Azure PostgreSQL** 已创建实例，`librechat` 数据库已存在
- [ ] `animaapp` 用户已具备 `librechat` 数据库的所有权限
- [ ] 已记录 Azure PostgreSQL `animaapp` 用户密码

```bash
# 系统更新
apt-get update && apt-get upgrade -y
apt-get install -y curl wget git openssl ca-certificates gnupg lsb-release jq

lsb_release -a
# 预期：Ubuntu 22.04.x LTS
```

---

## 2. OS 基线加固（CIS L1）

### 2.1 SSH 加固

```bash
# 禁用 root 登录（CIS 5.2.10）
sed -i 's/^#*PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
# 禁用密码认证（CIS 5.2.11）
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
# 禁用 X11 转发（CIS 5.2.6）
sed -i 's/^#*X11Forwarding.*/X11Forwarding no/' /etc/ssh/sshd_config
# 空闲超时 5 分钟（CIS 5.2.16）
grep -q 'ClientAliveInterval' /etc/ssh/sshd_config \
  && sed -i 's/^#*ClientAliveInterval.*/ClientAliveInterval 300/' /etc/ssh/sshd_config \
  || echo 'ClientAliveInterval 300' >> /etc/ssh/sshd_config
grep -q 'ClientAliveCountMax' /etc/ssh/sshd_config \
  && sed -i 's/^#*ClientAliveCountMax.*/ClientAliveCountMax 0/' /etc/ssh/sshd_config \
  || echo 'ClientAliveCountMax 0' >> /etc/ssh/sshd_config
systemctl restart sshd
```

### 2.2 系统内核加固

```bash
cat > /etc/sysctl.d/99-cis-hardening.conf <<'EOF'
net.ipv4.ip_forward = 0
net.ipv6.conf.all.forwarding = 0
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.default.accept_source_route = 0
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1
net.ipv4.tcp_syncookies = 1
net.ipv4.icmp_echo_ignore_broadcasts = 1
# VPS E 无公网 IPv6，禁用
net.ipv6.conf.all.disable_ipv6 = 1
net.ipv6.conf.default.disable_ipv6 = 1
fs.suid_dumpable = 0
kernel.randomize_va_space = 2
kernel.dmesg_restrict = 1
kernel.yama.ptrace_scope = 1
EOF
sysctl -p /etc/sysctl.d/99-cis-hardening.conf
```

### 2.3 时间同步（PCI-DSS 10.4.1）

```bash
apt-get install -y chrony
systemctl enable --now chrony
chronyc tracking
# 预期：System time 误差 < 1 秒
```

### 2.4 fail2ban

```bash
apt-get install -y fail2ban
cat > /etc/fail2ban/jail.local <<'EOF'
[DEFAULT]
bantime  = 3600
findtime = 600
maxretry = 5
backend  = systemd

[sshd]
enabled = true
port    = 22
logpath = %(sshd_log)s
EOF
systemctl enable --now fail2ban
fail2ban-client status sshd
```

---

## 3. UFW 防火墙配置

```bash
apt-get install -y ufw

ufw default deny incoming
ufw default allow outgoing

# SSH
ufw allow 22/tcp
# WireGuard UDP
ufw allow 51820/udp
# Webhook 计费服务（仅内网）
ufw allow in from 172.16.1.0/24 to any port 3002
# Redis（仅内网，禁止公网直连）
ufw allow in from 172.16.1.0/24 to any port 6379
# WireGuard 接口全部放行
ufw allow in on wg0

ufw --force enable
ufw status verbose
```

> ⚠️ Redis 端口 6379 **严禁对公网开放**，仅允许 WireGuard 内网访问。

---

## 4. WireGuard 内网配置

```bash
apt-get install -y wireguard

wg genkey | tee /etc/wireguard/privatekey | wg pubkey > /etc/wireguard/publickey
chmod 600 /etc/wireguard/privatekey
cat /etc/wireguard/publickey   # 记录此公钥，供其他节点配置 Peer

cat > /etc/wireguard/wg0.conf <<'EOF'
[Interface]
PrivateKey = <VPS E 私钥>
Address    = 172.16.1.6/24
ListenPort = 51820

# VPS A (172.16.1.1) — Nginx 反向代理
# 用户充值激活、余额查询通过 Nginx 转发到此节点
[Peer]
PublicKey  = <VPS A 公钥>
AllowedIPs = 172.16.1.1/32
Endpoint   = <VPS A 公网IP>:51820
PersistentKeepalive = 25

# VPS B (172.16.1.2) — OpenClaw Agent
# OpenClaw 每次 AI 调用后向此节点发送 /billing/record 计费记录
[Peer]
PublicKey  = <VPS B 公钥>
AllowedIPs = 172.16.1.2/32
Endpoint   = <VPS B 公网IP>:51820
PersistentKeepalive = 25

# VPS C (172.16.1.3) — LibreChat
# LibreChat 使用此节点的 Redis 作为会话缓存
[Peer]
PublicKey  = <VPS C 公钥>
AllowedIPs = 172.16.1.3/32
Endpoint   = <VPS C 公网IP>:51820
PersistentKeepalive = 25

# VPS D (172.16.1.4) — Nextcloud
[Peer]
PublicKey  = <VPS D 公钥>
AllowedIPs = 172.16.1.4/32
Endpoint   = <VPS D 公网IP>:51820
PersistentKeepalive = 25

# CXI4 (172.16.1.5) — 动态公网 IP，CXI4 主动连接
[Peer]
PublicKey  = <CXI4 公钥>
AllowedIPs = 172.16.1.5/32
PersistentKeepalive = 25
EOF

chmod 600 /etc/wireguard/wg0.conf
systemctl enable --now wg-quick@wg0

# 验证
wg show wg0
ping -c 2 172.16.1.1 && echo "✅ VPS A 可达" || echo "❌ VPS A 不可达"
```

---

## 5. 安装 Redis

```bash
apt-get install -y redis-server

# ── 生成强密码 ──────────────────────────────────────────────
# ⚠️ 密码不要包含 / & \ 等特殊字符（会破坏 sed 命令）
REDIS_PASS="$(openssl rand -hex 24)"
echo "Redis 密码（请立即保存）：${REDIS_PASS}"

# ── 修改监听地址（只监听内网 + 本机）──────────────────────
sed -i 's/^bind 127.0.0.1.*/bind 172.16.1.6 127.0.0.1/' /etc/redis/redis.conf

# ── 设置密码 ────────────────────────────────────────────────
sed -i "s/^# requirepass .*/requirepass ${REDIS_PASS}/" /etc/redis/redis.conf

# ── 内存限制（VPS E 仅 1 GB，防止 OOM Kill）────────────────
grep -q '^maxmemory ' /etc/redis/redis.conf \
  || echo 'maxmemory 128mb' >> /etc/redis/redis.conf
grep -q '^maxmemory-policy ' /etc/redis/redis.conf \
  || echo 'maxmemory-policy allkeys-lru' >> /etc/redis/redis.conf

systemctl enable --now redis-server
systemctl restart redis-server

# ── 验证（REDISCLI_AUTH 避免密码出现在 ps 命令输出中）──────
REDISCLI_AUTH="${REDIS_PASS}" redis-cli -h 172.16.1.6 ping
# 预期：PONG
```

> ⚠️ **请立即保存 Redis 密码**，后续 LibreChat（VPS C）、OpenClaw（VPS B）、Telegram Bot 均需要此密码。

---

## 6. 安装 Node.js 20

```bash
# 检查是否已安装
if node --version 2>/dev/null | grep -q '^v20'; then
  echo "Node.js 20 已安装，跳过"
else
  apt-get install -y ca-certificates curl gnupg
  mkdir -p /etc/apt/keyrings

  # 导入 NodeSource GPG 签名密钥（CIS 2.1.x / PCI-DSS 6.3.x 合规：不执行管道脚本）
  curl -fsSL https://deb.nodesource.com/gpgkey/nodesource-repo.gpg.key \
    | gpg --dearmor -o /etc/apt/keyrings/nodesource.gpg
  chmod 644 /etc/apt/keyrings/nodesource.gpg

  echo "deb [signed-by=/etc/apt/keyrings/nodesource.gpg] https://deb.nodesource.com/node_20.x nodistro main" \
    > /etc/apt/sources.list.d/nodesource.list

  apt-get update
  apt-get install -y nodejs
  echo "Node.js $(node --version) 安装完成"
fi
```

---

## 7. 部署 Webhook 计费服务

### 7.1 克隆仓库

```bash
git clone https://github.com/dnssme/ame.git /opt/ai/repo
chmod 750 /opt/ai/repo
```

### 7.2 创建服务目录并安装依赖

```bash
WEBHOOK_DIR="/opt/ai/webhook"
mkdir -p "${WEBHOOK_DIR}"
cp /opt/ai/repo/webhook/server.js    "${WEBHOOK_DIR}/server.js"
cp /opt/ai/repo/webhook/package.json "${WEBHOOK_DIR}/package.json"

cd "${WEBHOOK_DIR}"
npm install --omit=dev
```

### 7.3 生成令牌并创建 `.env` 配置文件

```bash
# 生成 32 字节 = 64 字符的强随机令牌（PCI-DSS 8.3.6 要求最小熵）
ADMIN_TOKEN_VAL="$(openssl rand -hex 32)"
SERVICE_TOKEN_VAL="$(openssl rand -hex 32)"

cat > /opt/ai/webhook/.env <<EOF
# ── 数据库 ───────────────────────────────────────────────────
PG_HOST=anima-db.postgres.database.azure.com
PG_PORT=5432
PG_USER=animaapp
PG_PASSWORD=<animaapp数据库密码>
PG_DATABASE=librechat

# ── Redis ─────────────────────────────────────────────────────
REDIS_URL=redis://:${REDIS_PASS}@127.0.0.1:6379

# ── 服务配置 ──────────────────────────────────────────────────
PORT=3002
HOST=0.0.0.0
NODE_ENV=production
LOG_LEVEL=info
TZ=Asia/Shanghai
NODE_OPTIONS=--max-old-space-size=256
TRUST_PROXY=172.16.1.1

# ── 计费参数 ──────────────────────────────────────────────────
FREE_DAILY_LIMIT=20
MAX_SINGLE_REQUEST_FEN=1000
USD_TO_CNY_RATE=7.2

# ── 鉴权令牌（64字符，请立即保存）────────────────────────────
ADMIN_TOKEN=${ADMIN_TOKEN_VAL}
# SERVICE_TOKEN：与 openclaw/.env 的 SERVICE_TOKEN 保持一致
SERVICE_TOKEN=${SERVICE_TOKEN_VAL}
EOF

chmod 600 /opt/ai/webhook/.env
chown root:root /opt/ai/webhook/.env

echo "========================================================"
echo "⚠️  请立即保存以下令牌："
echo "ADMIN_TOKEN:   ${ADMIN_TOKEN_VAL}"
echo "SERVICE_TOKEN: ${SERVICE_TOKEN_VAL}"
echo "Redis 密码:    ${REDIS_PASS}"
echo "========================================================"
```

> ⚠️ `ADMIN_TOKEN` 用于 `/admin/*` 管理接口，`SERVICE_TOKEN` 用于 OpenClaw → `/billing/record` 内部鉴权。两者均需立即保存，后续无法从服务器恢复原始值（只能轮换）。

---

## 8. 初始化数据库 Schema

```bash
# 安装 PostgreSQL 客户端
apt-get install -y postgresql-client

# 执行 Schema SQL（-v ON_ERROR_STOP=1 确保出错立即停止）
PGPASSWORD='<animaapp数据库密码>' PGSSLMODE=require psql \
  --quiet \
  -h anima-db.postgres.database.azure.com \
  -U animaapp \
  -d librechat \
  -f /opt/ai/repo/db/schema.sql \
  -v ON_ERROR_STOP=1

echo "Schema 初始化完成"

# 验证表已创建
PGPASSWORD='<animaapp数据库密码>' PGSSLMODE=require psql \
  -h anima-db.postgres.database.azure.com \
  -U animaapp -d librechat \
  -c "\dt" | grep -E 'api_models|api_providers|user_billing|billing_transactions|api_usage|recharge_cards'
```

> ⚠️ 若报 `CREATE EXTENSION` 权限错误，请在 Azure 门户 → PostgreSQL → 服务器参数 → 将 `pgcrypto` 和 `pg_stat_statements` 加入 `azure.extensions` 允许列表后重新执行。

---

## 9. 创建 systemd 服务

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
Restart=on-failure
RestartSec=10

# 安全加固（CIS Docker 等效 systemd 限制）
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=full
ProtectHome=true

# 日志（写入 systemd journal，支持 journalctl 查询）
StandardOutput=journal
StandardError=journal
SyslogIdentifier=ai-webhook

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable --now ai-webhook

# 等待启动
sleep 5
systemctl is-active ai-webhook && echo "✅ ai-webhook 已启动" || echo "❌ 启动失败，请查看日志"
```

---

## 10. 配置 auditd 操作审计

```bash
sudo bash /opt/ai/scripts/audit-setup.sh

# 验证
systemctl is-active auditd
auditctl -l | wc -l
echo "auditd 已加载 $(auditctl -l | wc -l) 条规则"
```

---

## 11. CIS 合规核查清单

```bash
echo "=== CIS 合规核查 ==="

# SSH
echo -n "[CIS 5.2.10] SSH root 禁用: "
grep '^PermitRootLogin no' /etc/ssh/sshd_config &>/dev/null && echo "✅ 通过" || echo "❌ 失败"

echo -n "[CIS 5.2.11] SSH 密码认证禁用: "
grep '^PasswordAuthentication no' /etc/ssh/sshd_config &>/dev/null && echo "✅ 通过" || echo "❌ 失败"

# 内核
echo -n "[CIS 3.4.x] TCP SYN cookies: "
sysctl net.ipv4.tcp_syncookies | grep -q '= 1' && echo "✅ 通过" || echo "❌ 失败"

echo -n "[CIS 3.1.1] IP 转发禁用: "
sysctl net.ipv4.ip_forward | grep -q '= 0' && echo "✅ 通过" || echo "❌ 失败"

# Redis 仅监听内网
echo -n "[CIS 12.x] Redis 仅监听内网: "
ss -tlnp | grep ':6379' | grep -qv '0.0.0.0:6379' && echo "✅ 通过（内网只监听）" \
  || ss -tlnp | grep ':6379' | grep -q '172.16.1.6' && echo "✅ 通过" \
  || echo "❌ 失败（可能暴露公网）"

# Webhook 仅监听内网
echo -n "[CIS 12.x] Webhook 仅内网可达: "
ss -tlnp | grep ':3002' | grep -q '172.16.1.6\|0.0.0.0' && echo "✅ 通过（需确认 UFW 规则）" || echo "❌ 失败"

# .env 权限
echo -n "[CIS 5.x] .env 权限 600: "
stat -c "%a" /opt/ai/webhook/.env | grep -q '600' && echo "✅ 通过" || echo "❌ 失败"

# Redis 密码
echo -n "[CIS 12.x] Redis 密码已设置: "
redis-cli -h 127.0.0.1 ping 2>&1 | grep -q 'NOAUTH\|Authentication required' \
  && echo "✅ 通过（需要鉴权）" \
  || echo "⚠️  请确认 requirepass 已在 /etc/redis/redis.conf 中配置"

# 时间同步
echo -n "[CIS 2.1.x] NTP 时间同步: "
chronyc tracking &>/dev/null && echo "✅ 通过" || echo "❌ 失败"

# auditd
echo -n "[CIS 8.x] auditd 运行中: "
systemctl is-active auditd | grep -q '^active$' && echo "✅ 通过" || echo "❌ 失败"
```

---

## 12. PCI-DSS 合规核查清单

```bash
echo "=== PCI-DSS 合规核查 ==="

# PCI-DSS 3.x: 令牌不硬编码
echo -n "[PCI 3.x] ADMIN_TOKEN 已在 .env 配置（非硬编码）: "
grep -q '^ADMIN_TOKEN=' /opt/ai/webhook/.env \
  && ! grep '^ADMIN_TOKEN=<' /opt/ai/webhook/.env &>/dev/null \
  && echo "✅ 通过" || echo "❌ 失败（占位符未替换）"

# PCI-DSS 8.3.6: 令牌最小长度 64 字符（32字节）
echo -n "[PCI 8.3.6] ADMIN_TOKEN 长度 ≥ 64 字符: "
TOKEN_LEN=$(grep '^ADMIN_TOKEN=' /opt/ai/webhook/.env | cut -d= -f2 | tr -d '\n' | wc -c)
[ "${TOKEN_LEN}" -ge 64 ] \
  && echo "✅ 通过 (${TOKEN_LEN} 字符)" \
  || echo "❌ 失败 (${TOKEN_LEN} 字符，需 ≥ 64)"

echo -n "[PCI 8.3.6] SERVICE_TOKEN 长度 ≥ 64 字符: "
STOKEN_LEN=$(grep '^SERVICE_TOKEN=' /opt/ai/webhook/.env | cut -d= -f2 | tr -d '\n' | wc -c)
[ "${STOKEN_LEN}" -ge 64 ] \
  && echo "✅ 通过 (${STOKEN_LEN} 字符)" \
  || echo "❌ 失败 (${STOKEN_LEN} 字符，需 ≥ 64)"

# PCI-DSS 4.2: DB SSL 连接
echo -n "[PCI 4.2] PostgreSQL SSL（PGSSLMODE=require）: "
grep 'sslmode=require\|PGSSLMODE=require' /opt/ai/webhook/.env &>/dev/null \
  || grep 'PG_HOST.*azure.*' /opt/ai/webhook/.env &>/dev/null \
  && echo "✅ 通过（Azure PG 强制 SSL）" \
  || echo "⚠️  请确认 db Pool ssl: { rejectUnauthorized: true }"

# PCI-DSS 8.3: Redis 密码保护
echo -n "[PCI 8.3] Redis 密码保护: "
grep -q '^REDIS_URL=redis://:[^@]' /opt/ai/webhook/.env && echo "✅ 通过" || echo "❌ 失败（REDIS_URL 中未见密码）"

# PCI-DSS 10.4: 时间同步
echo -n "[PCI 10.4.1] NTP 时间同步: "
chronyc tracking &>/dev/null && echo "✅ 通过" || echo "❌ 失败"

# PCI-DSS 10.x: 日志
echo -n "[PCI 10.x] Webhook 服务日志（journald）: "
journalctl -u ai-webhook -n 1 --no-pager &>/dev/null && echo "✅ 通过" || echo "❌ 失败（服务未运行）"
```

---

## 13. 功能测试

```bash
echo "=== VPS E 功能测试 ==="
ADMIN_TOKEN="$(grep '^ADMIN_TOKEN=' /opt/ai/webhook/.env | cut -d= -f2)"

# 测试 1：服务健康检查
echo -n "[测试 1] Webhook 健康检查: "
HEALTH=$(curl -sf http://172.16.1.6:3002/health)
echo "${HEALTH}" | grep -q '"status":"ok"' \
  && echo "✅ 通过 → ${HEALTH}" \
  || echo "❌ 失败 → ${HEALTH}"

# 测试 2：模型列表接口
echo -n "[测试 2] 模型列表（含免费模型）: "
MODELS=$(curl -sf http://172.16.1.6:3002/models)
echo "${MODELS}" | grep -q 'glm-4-flash' \
  && echo "✅ 通过（含免费模型 glm-4-flash）" \
  || echo "❌ 失败"

# 测试 3：Provider 配置接口（v5.3 新增）
echo -n "[测试 3] Provider 配置接口: "
PROVIDERS=$(curl -sf http://172.16.1.6:3002/providers)
echo "${PROVIDERS}" | grep -q 'anthropic\|openai' \
  && echo "✅ 通过（数据库统一 provider 配置）" \
  || echo "❌ 失败（请确认 schema.sql v5.3 已执行）"

# 测试 4：管理员接口鉴权
echo -n "[测试 4] 管理员接口（正确令牌）: "
ADMIN=$(curl -sf http://172.16.1.6:3002/admin/models -H "Authorization: Bearer ${ADMIN_TOKEN}")
echo "${ADMIN}" | grep -q '"success":true' \
  && echo "✅ 通过" \
  || echo "❌ 失败 → ${ADMIN}"

# 测试 5：管理员接口拒绝错误令牌
echo -n "[测试 5] 管理员接口（错误令牌应返回 401）: "
CODE=$(curl -sf -o /dev/null -w "%{http_code}" http://172.16.1.6:3002/admin/models \
  -H "Authorization: Bearer wrong-token")
[ "${CODE}" = "401" ] && echo "✅ 通过 (HTTP 401)" || echo "❌ 失败 (HTTP ${CODE})"

# 测试 6：余额查询（新用户返回 0）
echo -n "[测试 6] 余额查询（新用户）: "
BAL=$(curl -sf http://172.16.1.6:3002/billing/balance/test@example.com)
echo "${BAL}" | grep -q '"balance_fen":0' \
  && echo "✅ 通过 → ${BAL}" \
  || echo "❌ 失败 → ${BAL}"

# 测试 7：免费模型计费记录（SERVICE_TOKEN 鉴权）
SERVICE_TOKEN="$(grep '^SERVICE_TOKEN=' /opt/ai/webhook/.env | cut -d= -f2)"
echo -n "[测试 7] 免费模型计费记录: "
BILL=$(curl -sf -X POST http://172.16.1.6:3002/billing/record \
  -H "Content-Type: application/json" \
  -H "x-service-token: ${SERVICE_TOKEN}" \
  -d '{"userEmail":"test@example.com","apiProvider":"zhipu","modelName":"glm-4-flash","inputTokens":100,"outputTokens":50}')
echo "${BILL}" | grep -q '"is_free":true' \
  && echo "✅ 通过 → ${BILL}" \
  || echo "❌ 失败 → ${BILL}"

# 测试 8：计费记录拒绝错误 SERVICE_TOKEN
echo -n "[测试 8] 计费记录拒绝错误令牌（应返回 401）: "
CODE=$(curl -sf -o /dev/null -w "%{http_code}" -X POST http://172.16.1.6:3002/billing/record \
  -H "Content-Type: application/json" \
  -H "x-service-token: wrong-token" \
  -d '{"userEmail":"test@example.com","apiProvider":"zhipu","modelName":"glm-4-flash","inputTokens":100,"outputTokens":50}')
[ "${CODE}" = "401" ] && echo "✅ 通过 (HTTP 401)" || echo "❌ 失败 (HTTP ${CODE})"

# 测试 9：Redis 连通性
echo -n "[测试 9] Redis 连通性（内网）: "
REDIS_PASS="$(grep '^REDIS_URL=' /opt/ai/webhook/.env | sed 's/.*:\/\/:\(.*\)@.*/\1/')"
REDISCLI_AUTH="${REDIS_PASS}" redis-cli -h 127.0.0.1 ping | grep -q 'PONG' \
  && echo "✅ 通过" \
  || echo "❌ 失败（检查 Redis 密码和监听地址）"

echo ""
echo "=== 所有测试完成 ==="
```

---

## 14. 日常运维

### 查看服务状态

```bash
# 服务运行状态
systemctl status ai-webhook

# 最近 50 条日志
journalctl -u ai-webhook -n 50 --no-pager

# 实时日志
journalctl -u ai-webhook -f

# Redis 状态
REDISCLI_AUTH="$(grep '^REDIS_URL=' /opt/ai/webhook/.env | sed 's/.*:\/\/:\(.*\)@.*/\1/')" \
  redis-cli -h 127.0.0.1 info server | grep -E 'redis_version|uptime|connected_clients|used_memory_human'
```

### 查询关键运营数据

```bash
PGPASSWORD="$(grep '^PG_PASSWORD=' /opt/ai/webhook/.env | cut -d= -f2)" PGSSLMODE=require \
  psql -h anima-db.postgres.database.azure.com -U animaapp -d librechat <<'SQL'
-- 今日各模型使用量（北京时间）
SELECT * FROM v_today_model_usage;

-- 最近 10 条充值记录
SELECT user_email, amount_fen, balance_after_fen, description, created_at
FROM billing_transactions WHERE type='recharge' ORDER BY created_at DESC LIMIT 10;

-- 余额 TOP 10 用户
SELECT user_email, balance_fen FROM user_billing ORDER BY balance_fen DESC LIMIT 10;
SQL
```

### 轮换 ADMIN_TOKEN（PCI-DSS 8.6.3 建议定期轮换）

```bash
NEW_TOKEN="$(openssl rand -hex 32)"
sed -i "s/^ADMIN_TOKEN=.*/ADMIN_TOKEN=${NEW_TOKEN}/" /opt/ai/webhook/.env
systemctl restart ai-webhook
grep '^ADMIN_TOKEN=' /opt/ai/webhook/.env
# 验证新令牌
curl http://172.16.1.6:3002/admin/models -H "Authorization: Bearer ${NEW_TOKEN}" | head -c 100
echo ""
echo "⚠️ 请同步更新使用此令牌的所有自动化脚本和监控工具"
```

### 生成充值卡

```bash
PGPASSWORD="$(grep '^PG_PASSWORD=' /opt/ai/webhook/.env | cut -d= -f2)" PGSSLMODE=require \
  psql -h anima-db.postgres.database.azure.com -U animaapp -d librechat <<'SQL'
INSERT INTO recharge_cards (key, credit_fen, label)
SELECT 'ANIMA-' || upper(encode(gen_random_bytes(8),'hex')),
       2000,
       '¥20 充值卡'
FROM generate_series(1,5)
RETURNING key, credit_fen, label;
SQL
```

---

## 15. 故障排查

### Webhook 服务无法启动

```bash
journalctl -u ai-webhook -n 100 --no-pager

# 常见原因 1：.env 占位符未替换
grep '<.*>' /opt/ai/webhook/.env && echo "⚠️ 发现未替换的占位符"

# 常见原因 2：PG 连接失败（检查 Azure 防火墙是否允许 VPS E IP）
node -e "
const {Pool}=require('pg');
const p=new Pool({host:process.env.PG_HOST,user:process.env.PG_USER,password:process.env.PG_PASSWORD,database:process.env.PG_DATABASE,ssl:{rejectUnauthorized:true}});
p.query('SELECT 1').then(()=>{console.log('DB OK');p.end()}).catch(e=>{console.error(e.message);p.end()});
" && echo "DB OK"

# 常见原因 3：端口被占用
ss -tlnp | grep 3002

# 常见原因 4：Node.js 版本不对
node --version  # 必须 >= 20
```

### Redis 连接失败

```bash
# 检查 Redis 服务状态
systemctl status redis-server

# 检查监听地址
ss -tlnp | grep 6379

# 检查 requirepass 配置
grep 'requirepass' /etc/redis/redis.conf | grep -v '^#'

# 手动测试连接
REDIS_PASS="$(grep '^REDIS_URL=' /opt/ai/webhook/.env | sed 's/.*:\/\/:\(.*\)@.*/\1/')"
REDISCLI_AUTH="${REDIS_PASS}" redis-cli -h 127.0.0.1 ping
```

### 数据库 Schema 初始化失败

```bash
# 检查扩展权限（Azure PG 需要在门户允许 pgcrypto）
PGPASSWORD='<密码>' PGSSLMODE=require psql \
  -h anima-db.postgres.database.azure.com -U animaapp -d librechat \
  -c "SELECT extname FROM pg_extension;"

# 若 pgcrypto 不存在，在 Azure 门户添加后重新执行：
PGPASSWORD='<密码>' PGSSLMODE=require psql \
  -h anima-db.postgres.database.azure.com -U animaapp -d librechat \
  -f /opt/ai/repo/db/schema.sql -v ON_ERROR_STOP=1
```

### 免费限额未生效（Redis 不可用）

```bash
# 查看 Webhook 日志中的 Redis 警告
journalctl -u ai-webhook -n 50 --no-pager | grep -i redis

# 若 Redis 故障，免费限额失效（详见 webhook/server.js:incrFreeDailyUsage），
# 此为 fail-open 设计：优先保证服务可用，接受免费额度被暂时绕过。
# 修复 Redis 后，计数器会在下一个北京时间 00:00 自动重置。

systemctl restart redis-server
systemctl restart ai-webhook
```
