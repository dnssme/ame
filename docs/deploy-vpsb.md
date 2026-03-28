# VPS B (172.16.1.2) 详细部署教程
## OpenClaw Agent

> **节点角色**：OpenClaw AI Agent 后端，处理多模型推理、记忆管理、工具调用，连接计费 Webhook  
> **硬件规格**：2 核 CPU · 1 GB RAM  
> **操作系统**：Ubuntu 22.04 LTS（推荐）

---

## 目录

1. [前置条件](#1-前置条件)
2. [OS 基线加固（CIS L1）](#2-os-基线加固cis-l1)
3. [UFW 防火墙配置](#3-ufw-防火墙配置)
4. [WireGuard 内网配置](#4-wireguard-内网配置)
5. [安装 Docker](#5-安装-docker)
6. [部署 OpenClaw](#6-部署-openclaw)
7. [可选：部署微信/Telegram 模块](#7-可选部署微信telegram-模块)
8. [配置 auditd 操作审计](#8-配置-auditd-操作审计)
9. [CIS 合规核查清单](#9-cis-合规核查清单)
10. [PCI-DSS 合规核查清单](#10-pci-dss-合规核查清单)
11. [功能测试](#11-功能测试)
12. [日常运维](#12-日常运维)
13. [故障排查](#13-故障排查)

---

## 1. 前置条件

- [ ] Ubuntu 22.04 LTS 全新安装，已完成基础系统更新
- [ ] 已分配 WireGuard 内网 IP `172.16.1.2`
- [ ] **CXI4 已完成部署**（Webhook + Redis 已运行）
- [ ] 已准备好 AI API 密钥（至少一个）：
  - Anthropic API Key（Claude 模型）
  - OpenAI API Key（GPT 模型，可选）
  - Mistral API Key（可选）
- [ ] 已记录以下信息：
  - Redis 密码（CXI4 步骤 5.2 中生成）
  - Azure PostgreSQL `animaapp` 用户密码

```bash
# 系统更新
apt-get update && apt-get upgrade -y
apt-get install -y curl wget git openssl ca-certificates gnupg lsb-release jq
lsb_release -a
```

---

## 2. OS 基线加固（CIS L1）

### 2.1 SSH 加固

```bash
sed -i 's/^#*PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
sed -i 's/^#*X11Forwarding.*/X11Forwarding no/' /etc/ssh/sshd_config
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
# VPS B 有公网 IPv6，保留 IPv6 支持（不禁用）
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
```

---

## 3. UFW 防火墙配置

```bash
apt-get install -y ufw

# VPS B 有公网 IPv6，确保 UFW 同时管理 IPv4 和 IPv6 规则
sed -i 's/^IPV6=.*/IPV6=yes/' /etc/default/ufw

ufw default deny incoming
ufw default allow outgoing

# SSH（IPv4 + IPv6）
ufw allow 22/tcp
# WireGuard
ufw allow 51820/udp
# OpenClaw Agent：仅 VPS A 和 VPS C 需要访问
ufw allow in from 172.16.1.0/24 to any port 3000
# ClawBot 灵枢接入通道（微信/企业微信 Webhook）
ufw allow in from 172.16.1.0/24 to any port 3004
# 微信 Bot 健康检查端口（如启用微信模块）
ufw allow in from 172.16.1.0/24 to any port 3001
# Telegram Bot 健康检查端口（如启用 Telegram 模块）
ufw allow in from 172.16.1.0/24 to any port 3003
# WireGuard 接口
ufw allow in on wg0

ufw --force enable
ufw status verbose
```

---

## 4. WireGuard 内网配置

```bash
apt-get install -y wireguard

wg genkey | tee /etc/wireguard/privatekey | wg pubkey > /etc/wireguard/publickey
chmod 600 /etc/wireguard/privatekey
cat /etc/wireguard/publickey   # 记录此公钥

cat > /etc/wireguard/wg0.conf <<'EOF'
[Interface]
PrivateKey = <VPS B 私钥>
Address    = 172.16.1.2/24
ListenPort = 51820

# VPS A (172.16.1.1) — Nginx 反向代理，/api/agent 路径流量来源
[Peer]
PublicKey  = <VPS A 公钥>
AllowedIPs = 172.16.1.1/32
Endpoint   = <VPS A 公网IP>:51820
PersistentKeepalive = 25

# VPS C (172.16.1.3) — LibreChat
# 若 LibreChat 直接调用 OpenClaw API（不经过 Nginx），
# 需要此 Peer 才能建立 VPS C→VPS B 的直连隧道。
[Peer]
PublicKey  = <VPS C 公钥>
AllowedIPs = 172.16.1.3/32
Endpoint   = <VPS C 公网IP>:51820
PersistentKeepalive = 25

# FIX #3: VPS D (172.16.1.4) — Nextcloud
# OpenClaw config.yml 中 tools.calendar.url 指向 172.16.1.4:8090；
# 原文档缺少此 Peer，导致 OpenClaw 日历工具调用 Nextcloud CalDAV 时路由失败。
[Peer]
PublicKey  = <VPS D 公钥>
AllowedIPs = 172.16.1.4/32
Endpoint   = <VPS D 公网IP>:51820
PersistentKeepalive = 25

# VPS E (172.16.1.6) — Webhook 计费 + Redis
# OpenClaw 通过此节点发送计费记录和读取 Redis 会话缓存
[Peer]
PublicKey  = <VPS E 公钥>
AllowedIPs = 172.16.1.6/32
Endpoint   = <VPS E 公网IP>:51820
PersistentKeepalive = 25

# CXI4 (172.16.1.5) — Whisper + TTS + Email + HA
# 注意：CXI4 使用动态公网 IP，不设置 Endpoint；
# CXI4 会主动连接本节点并维持隧道，本节点通过学习对端地址进行通信。
[Peer]
PublicKey  = <CXI4 公钥>
AllowedIPs = 172.16.1.5/32
PersistentKeepalive = 25
EOF

chmod 600 /etc/wireguard/wg0.conf
systemctl enable --now wg-quick@wg0

# 验证连通性
wg show wg0
ping -c 2 172.16.1.1   # VPS A（nginx，来源流量）
ping -c 2 172.16.1.4   # VPS D（Nextcloud，日历工具）
ping -c 2 172.16.1.5   # CXI4（Whisper/TTS）
ping -c 2 172.16.1.6   # VPS E（Webhook + Redis）
# 验证 Webhook 服务可达
curl -sf http://172.16.1.6:3002/health
# 预期：{"status":"ok","db":"ok","ts":"..."}
```

---

## 5. 安装 Docker

```bash
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

docker --version
docker compose version

# Docker daemon 安全配置
cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "20m",
    "max-file": "3"
  },
  "no-new-privileges": true,
  "live-restore": true,
  "userland-proxy": false
}
EOF
systemctl restart docker
```

---

## 6. 部署 OpenClaw

### 6.1 克隆仓库

```bash
git clone https://github.com/dnssme/ame.git /opt/ai/repo
chmod 750 /opt/ai/repo
```

### 6.2 创建 `.env` 配置文件

```bash
cd /opt/ai/repo/openclaw
cp .env.example .env
chmod 600 .env
vim .env   # 填写所有占位符
```

**需要填写的字段：**

| 字段 | 说明 |
|------|------|
| `ANTHROPIC_API_KEY` | Claude API Key（`sk-ant-...`） |
| `OPENAI_API_KEY` | OpenAI API Key（可留空） |
| `MISTRAL_API_KEY` | Mistral API Key（可留空） |
| `PG_PASSWORD` | Azure PostgreSQL `animaapp` 用户密码 |
| `REDIS_PASSWORD` | CXI4 Redis 密码（步骤 5.2 中生成） |
| `NEXTCLOUD_PASSWORD` | Nextcloud admin 密码（如未部署可留空） |
| `HA_TOKEN` | Home Assistant 长期令牌（如未部署可留空） |

```bash
# 验证无未填写的占位符
grep -n '<.*>' /opt/ai/repo/openclaw/.env \
  && echo "⚠️  发现未填写的占位符" \
  || echo "✅ 所有占位符已填写"
```

### 6.3 核查 `config.yml` 配置

```bash
# 确认 billing webhookUrl 指向 VPS-E
grep 'webhookUrl' /opt/ai/repo/openclaw/config.yml
# 预期：webhookUrl: http://172.16.1.6:3002/billing/record

# 确认 Redis 地址
grep 'url:' /opt/ai/repo/openclaw/config.yml | grep redis
# 预期：url: redis://:${REDIS_PASSWORD}@172.16.1.6:6379

# 确认数据库地址
grep 'database:' /opt/ai/repo/openclaw/config.yml
# 预期：...anima-db.postgres.database.azure.com...

# 限制 config.yml 权限（含有 API Key 等敏感变量引用，最小权限原则）
chmod 600 /opt/ai/repo/openclaw/config.yml
chown root:root /opt/ai/repo/openclaw/config.yml
```

### 6.4 创建数据目录并启动

```bash
cd /opt/ai/repo/openclaw
mkdir -p data

docker compose up -d

# 等待容器启动
sleep 30
docker compose ps
```

**预期输出：**

```
NAME      IMAGE                    COMMAND    SERVICE   STATUS
openclaw  openclaw/openclaw:latest    ...    openclaw  Up (healthy)
```

### 6.5 验证 OpenClaw

```bash
# 健康检查
curl -sf http://172.16.1.2:3000/health
# 预期：HTTP 200

# 查看日志
docker compose logs --tail=50 openclaw | grep -v DEBUG
```

---

## 7. 可选：部署 ClawBot / 微信 / Telegram 模块

### 7.0 ClawBot 灵枢接入通道（微信/企业微信 Webhook）

ClawBot 是独立于 OpenClaw 的微信消息接入服务，监听端口 3004，接收微信公众号/企业微信消息并桥接到 OpenClaw API。

> ⚠️ 如果不需要微信公众号对话功能，可跳过此步骤。

```bash
# 创建 ClawBot 配置文件
cd /opt/ai/repo/modules/clawbot
cp .env.example .env
chmod 600 .env
vim .env   # 填写微信公众号 AppID、AppSecret、Token、EncodingAESKey 等

# 验证配置
grep -n '<.*>' .env && echo "⚠️  占位符未填写" || echo "✅ 配置完整"
```

ClawBot 服务定义在 `openclaw/docker-compose.yml` 中，与 OpenClaw 一起管理：

```bash
cd /opt/ai/repo/openclaw

# 启动（如 OpenClaw 已运行，会自动添加 clawbot 服务）
docker compose up -d

# 等待启动
sleep 15
docker compose ps

# 健康检查
curl -sf http://172.16.1.2:3004/health && echo "ClawBot OK" || echo "ClawBot FAIL"

# 查看日志
docker compose logs --tail=50 clawbot
```

**预期输出：**

```
NAME            IMAGE                         SERVICE    STATUS
openclaw        openclaw/openclaw:latest         ...     Up (healthy)
anima-clawbot   openclaw-clawbot:latest          ...     Up (healthy)
```

### 7.1 Telegram 模块

```bash
cd /opt/ai/repo/modules/telegram
cp .env.example .env
chmod 600 .env
vim .env   # 填写 BOT_TOKEN 和 OPENCLAW_URL

# 验证配置
grep -n '<.*>' .env && echo "⚠️  占位符未填写" || echo "✅ 配置完整"

docker compose up -d
sleep 10
docker compose ps
# 健康检查
curl -sf http://172.16.1.2:3003/health
```

### 7.2 微信模块

```bash
cd /opt/ai/repo/modules/wechat
cp .env.example .env
chmod 600 .env
vim .env   # 填写微信 Bot 配置

docker compose up -d
sleep 10
# 健康检查
curl -sf http://172.16.1.2:3001/health
```

---

## 8. 配置 auditd 操作审计

```bash
sudo bash /opt/ai/scripts/audit-setup.sh
systemctl is-active auditd
```

---

## 9. CIS 合规核查清单

```bash
echo "=== CIS 合规核查 ==="

# SSH
echo -n "[CIS 5.2.10] SSH root 禁用: "
grep '^PermitRootLogin no' /etc/ssh/sshd_config &>/dev/null && echo "✅ 通过" || echo "❌ 失败"

echo -n "[CIS 5.2.11] SSH 密码认证禁用: "
grep '^PasswordAuthentication no' /etc/ssh/sshd_config &>/dev/null && echo "✅ 通过" || echo "❌ 失败"

# 内核
echo -n "[CIS 3.4.x] SYN cookies: "
sysctl net.ipv4.tcp_syncookies | grep -q '= 1' && echo "✅ 通过" || echo "❌ 失败"

# Docker 安全
echo -n "[CIS Docker 5.3] no-new-privileges: "
docker inspect openclaw 2>/dev/null | grep -q '"NoNewPrivileges": true' \
  && echo "✅ 通过" || echo "❌ 失败"

echo -n "[CIS Docker 5.3] cap_drop ALL: "
docker inspect openclaw 2>/dev/null | jq -r '.[0].HostConfig.CapDrop[]' 2>/dev/null | grep -q 'ALL' \
  && echo "✅ 通过" || echo "❌ 失败"

echo -n "[CIS Docker 5.4] 内存限制: "
MEM=$(docker inspect openclaw 2>/dev/null | jq '.[0].HostConfig.Memory')
[ "${MEM}" -gt 0 ] 2>/dev/null && echo "✅ 通过 (${MEM} bytes)" || echo "❌ 失败"

# .env 权限
echo -n "[CIS 5.x] .env 权限 600: "
stat -c "%a" /opt/ai/repo/openclaw/.env | grep -q '600' && echo "✅ 通过" || echo "❌ 失败"

# 仅内网监听
echo -n "[CIS 12.x] OpenClaw 仅内网监听: "
ss -tlnp | grep ':3000' | grep -q '172.16.1.2' && echo "✅ 通过" || echo "❌ 失败"

# 时间同步
echo -n "[CIS 2.1.x] 时间同步: "
chronyc tracking &>/dev/null && echo "✅ 通过" || echo "❌ 失败"

# Docker 模块安全（read_only）
if docker inspect anima-clawbot &>/dev/null; then
  echo -n "[CIS Docker 5.12] ClawBot 模块 read_only: "
  docker inspect anima-clawbot | grep -q '"ReadonlyRootfs": true' \
    && echo "✅ 通过" || echo "❌ 失败"
fi

if docker inspect anima-wechat &>/dev/null; then
  echo -n "[CIS Docker 5.12] 微信模块 read_only: "
  docker inspect anima-wechat | grep -q '"ReadonlyRootfs": true' \
    && echo "✅ 通过" || echo "❌ 失败"
fi

if docker inspect anima-telegram &>/dev/null; then
  echo -n "[CIS Docker 5.12] Telegram 模块 read_only: "
  docker inspect anima-telegram | grep -q '"ReadonlyRootfs": true' \
    && echo "✅ 通过" || echo "❌ 失败"
fi
```

---

## 10. PCI-DSS 合规核查清单

```bash
echo "=== PCI-DSS 合规核查 ==="

# PCI-DSS 3.x: API Key 通过环境变量注入，不硬编码
echo -n "[PCI 3.x] API Key 环境变量注入（config.yml）: "
grep -E 'apiKey.*\$\{' /opt/ai/repo/openclaw/config.yml &>/dev/null \
  && echo "✅ 通过（使用环境变量插值）" \
  || echo "⚠️  请确认 config.yml 中 apiKey 使用 \${VAR} 形式"

# PCI-DSS 4.2: DB SSL
echo -n "[PCI 4.2] PostgreSQL SSL 连接: "
grep 'sslmode=require' /opt/ai/repo/openclaw/config.yml &>/dev/null \
  && echo "✅ 通过" || echo "❌ 失败"

# PCI-DSS 6.5.5: 错误处理
echo -n "[PCI 6.5.5] 全局错误处理: "
grep -q 'unhandledRejection\|uncaughtException' /opt/ai/repo/openclaw/config.yml 2>/dev/null \
  || echo "⚠️  OpenClaw 错误处理由其自身实现，需人工查阅容器日志确认"

# PCI-DSS 7.x: 最小权限
echo -n "[PCI 7.x] OpenClaw 仅内网暴露: "
ufw status | grep '3000' | grep -q '172.16.1.0/24' \
  && echo "✅ 通过" || echo "⚠️  请核查 UFW 规则"

echo -n "[PCI 7.x] ClawBot 仅内网暴露: "
ufw status | grep '3004' | grep -q '172.16.1.0/24' \
  && echo "✅ 通过" || echo "⚠️  请核查 UFW 规则"

# PCI-DSS 10.x: 日志
echo -n "[PCI 10.x] 容器日志记录: "
docker inspect openclaw 2>/dev/null | grep -q '"Type": "json-file"' \
  && echo "✅ 通过" || echo "❌ 失败"

# PCI-DSS 10.4: 时间同步
echo -n "[PCI 10.4.1] NTP 时间同步: "
chronyc tracking &>/dev/null && echo "✅ 通过" || echo "❌ 失败"

# PCI-DSS 6.3.x: Billing Webhook URL 配置
echo -n "[PCI 6.3.x] 计费 Webhook 已配置: "
grep -q 'webhookUrl.*172.16.1.6:3002' /opt/ai/repo/openclaw/config.yml \
  && echo "✅ 通过" || echo "❌ 失败（计费未接入）"
```

---

## 11. 功能测试

### 11.1 容器健康检查

```bash
echo "=== OpenClaw 功能测试 ==="

echo -n "[测试 1] 容器健康状态: "
cd /opt/ai/repo/openclaw
STATUS=$(docker compose ps --format json 2>/dev/null | jq -r '.[0].Health // .[0].Status')
echo "${STATUS}" | grep -qi 'healthy\|running' \
  && echo "✅ 通过 (${STATUS})" \
  || echo "❌ 失败 (${STATUS})"

echo -n "[测试 2] 健康端点 HTTP 200: "
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://172.16.1.2:3000/health)
[ "${HTTP_CODE}" = "200" ] && echo "✅ 通过" || echo "❌ 失败 (HTTP ${HTTP_CODE})"
```

### 11.2 Webhook 计费接口连通性

```bash
# 从 VPS B 发起计费请求，验证与 VPS-E 的连通性
echo -n "[测试 3] 计费 Webhook 连通性（内网）: "
BILL_RESULT=$(curl -sf -X POST http://172.16.1.6:3002/billing/record \
  -H "Content-Type: application/json" \
  -d '{
    "userEmail": "optest@test.com",
    "apiProvider": "anthropic",
    "modelName": "claude-haiku-4-5-20251001",
    "inputTokens": 100,
    "outputTokens": 50
  }')
echo "${BILL_RESULT}" | grep -q '"success":true' \
  && echo "✅ 通过（计费接口可达）" \
  || echo "❌ 失败 → ${BILL_RESULT}"
```

### 11.3 Redis 连通性

```bash
echo -n "[测试 4] Redis 连通性（从 VPS B 访问 VPS-E Redis）: "
REDIS_PASS="$(grep '^REDIS_PASSWORD=' /opt/ai/repo/openclaw/.env | cut -d= -f2)"
redis-cli -h 172.16.1.6 -a "${REDIS_PASS}" ping 2>/dev/null | grep -q 'PONG' \
  && echo "✅ 通过" \
  || echo "❌ 失败（Redis 不可达或密码错误）"
```

### 11.4 AI API 连通性

```bash
# 验证 Anthropic API 可访问（需要公网出口）
echo -n "[测试 5] Anthropic API 连通性: "
ANTHROPIC_KEY="$(grep '^ANTHROPIC_API_KEY=' /opt/ai/repo/openclaw/.env | cut -d= -f2)"
if [ -z "${ANTHROPIC_KEY}" ] || [ "${ANTHROPIC_KEY}" = "<你的 Claude API Key>" ]; then
  echo "⚠️  ANTHROPIC_API_KEY 未配置，跳过"
else
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -H "x-api-key: ${ANTHROPIC_KEY}" \
    -H "anthropic-version: 2023-06-01" \
    https://api.anthropic.com/v1/models)
  [ "${HTTP_CODE}" = "200" ] \
    && echo "✅ 通过 (HTTP ${HTTP_CODE})" \
    || echo "⚠️  HTTP ${HTTP_CODE}（检查 API Key 是否有效）"
fi
```

### 11.5 模拟完整 AI 请求测试

```bash
# 通过 OpenClaw API 发起实际聊天请求
echo "[测试 6] AI 对话端到端测试..."
CHAT_RESULT=$(curl -sf -X POST http://172.16.1.2:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{
    "userEmail": "optest@test.com",
    "model": "claude-haiku-4-5-20251001",
    "messages": [{"role": "user", "content": "请用一句话说明你是什么"}]
  }' 2>&1)
echo "${CHAT_RESULT}" | grep -qi 'content\|message\|reply\|assistant' \
  && echo "✅ 通过（AI 返回了响应）" \
  || echo "⚠️  响应: ${CHAT_RESULT:0:300}"
```

### 11.6 ClawBot 灵枢测试（如已启用）

```bash
if docker ps --format '{{.Names}}' | grep -q 'anima-clawbot'; then
  echo -n "[测试 6] ClawBot 模块健康: "
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://172.16.1.2:3004/health)
  [ "${HTTP_CODE}" = "200" ] && echo "✅ 通过" || echo "❌ 失败 (HTTP ${HTTP_CODE})"
fi
```

### 11.7 Telegram Bot 测试（如已启用）

```bash
if docker ps --format '{{.Names}}' | grep -q 'anima-telegram'; then
  echo -n "[测试 7] Telegram 模块健康: "
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://172.16.1.2:3003/health)
  [ "${HTTP_CODE}" = "200" ] && echo "✅ 通过" || echo "❌ 失败 (HTTP ${HTTP_CODE})"
fi
```

### 11.8 微信 Bot 测试（如已启用）

```bash
if docker ps --format '{{.Names}}' | grep -q 'anima-wechat'; then
  echo -n "[测试 8] 微信模块健康: "
  HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://172.16.1.2:3001/health)
  [ "${HTTP_CODE}" = "200" ] && echo "✅ 通过" || echo "❌ 失败 (HTTP ${HTTP_CODE})"
fi
```

---

## 12. 日常运维

```bash
# 查看 OpenClaw 状态
cd /opt/ai/repo/openclaw
docker compose ps
docker compose logs --tail=50 openclaw

# 查看 ClawBot 日志
docker compose logs --tail=50 clawbot

# 内存使用
docker stats openclaw anima-clawbot --no-stream

# 重启
docker compose restart openclaw
docker compose restart clawbot

# 更新镜像
docker compose pull && docker compose up -d
docker image prune -f
```

---

## 13. 故障排查

### OpenClaw 启动失败

```bash
cd /opt/ai/repo/openclaw
docker compose logs --tail=100 openclaw

# 常见原因 1: PG_PASSWORD 错误
# 在容器内测试 DB
docker compose exec openclaw sh -c \
  'node -e "const {Client}=require(\"pg\");const c=new Client({connectionString:process.env.DATABASE_URL});c.connect().then(()=>console.log(\"DB OK\")).catch(e=>console.error(e.message))"' 2>/dev/null || true

# 常见原因 2: Redis 不可达
ping -c 2 172.16.1.6
REDIS_PASS="$(grep '^REDIS_PASSWORD=' /opt/ai/repo/openclaw/.env | cut -d= -f2)"
redis-cli -h 172.16.1.6 -a "${REDIS_PASS}" ping

# 常见原因 3: 内存不足
free -h
docker stats --no-stream
```

### 计费失败（AI 调用后无计费记录）

```bash
# 在 VPS B 上手动测试计费接口
curl -X POST http://172.16.1.6:3002/billing/record \
  -H "Content-Type: application/json" \
  -d '{"userEmail":"test@test.com","apiProvider":"anthropic","modelName":"claude-haiku-4-5-20251001","inputTokens":100,"outputTokens":50}'

# 查看 CXI4 Webhook 日志
# 在 CXI4 上执行：
# journalctl -u ai-webhook -n 50 --no-pager
```

### API Key 无效

```bash
# 查看日志中的鉴权错误
docker compose logs openclaw 2>&1 | grep -i 'auth\|401\|403\|invalid'

# 重新检查 .env 中的 API Key
cat /opt/ai/repo/openclaw/.env
```
