# VPS C (172.16.1.3) 详细部署教程
## LibreChat Web UI

> **节点角色**：LibreChat Web 前端，用户交互入口（内网服务，由 VPS A Nginx 反向代理后对外）  
> **硬件规格**：2 核 CPU · 1 GB RAM  
> **操作系统**：Ubuntu 22.04 LTS（推荐）

---

## 目录

1. [前置条件](#1-前置条件)
2. [OS 基线加固（CIS L1）](#2-os-基线加固cis-l1)
3. [UFW 防火墙配置](#3-ufw-防火墙配置)
4. [WireGuard 内网配置](#4-wireguard-内网配置)
5. [安装 Docker](#5-安装-docker)
6. [部署 LibreChat](#6-部署-librechat)
7. [CIS 合规核查清单](#7-cis-合规核查清单)
8. [PCI-DSS 合规核查清单](#8-pci-dss-合规核查清单)
9. [功能测试](#9-功能测试)
10. [日常运维](#10-日常运维)
11. [故障排查](#11-故障排查)

---

## 1. 前置条件

- [ ] Ubuntu 22.04 LTS 全新安装，已完成基础系统更新
- [ ] 已分配 WireGuard 内网 IP `172.16.1.3`
- [ ] **CXI4 已完成部署**（Webhook + Redis 已运行）
- [ ] Azure PostgreSQL `librechat` 数据库已初始化 Schema
- [ ] 已记录以下信息：
  - Redis 密码（CXI4 步骤 5.2 中生成）
  - Azure PostgreSQL 密码
  - `animaapp` 用户密码

```bash
# 系统更新
apt-get update && apt-get upgrade -y
apt-get install -y curl wget git openssl ca-certificates gnupg lsb-release jq

# 确认 OS 版本
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
# VPS C 无公网 IPv6，禁用 IPv6
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

ufw default deny incoming
ufw default allow outgoing

# SSH
ufw allow 22/tcp
# WireGuard
ufw allow 51820/udp
# LibreChat 仅内网访问（VPS A Nginx 反代）
ufw allow in from 172.16.1.0/24 to any port 3080
# WireGuard 接口放行
ufw allow in on wg0

ufw --force enable
ufw status verbose
```

> ⚠️ **LibreChat 端口 3080 严禁直接对公网开放**，必须通过 VPS A 的 Nginx 反向代理访问。

---

## 4. WireGuard 内网配置

```bash
apt-get install -y wireguard

wg genkey | tee /etc/wireguard/privatekey | wg pubkey > /etc/wireguard/publickey
chmod 600 /etc/wireguard/privatekey
cat /etc/wireguard/publickey   # 记录此公钥，需在其他节点添加此 Peer

cat > /etc/wireguard/wg0.conf <<'EOF'
[Interface]
PrivateKey = <VPS C 私钥>
Address    = 172.16.1.3/24
ListenPort = 51820

# VPS A (172.16.1.1) — Nginx 反向代理，下行流量的来源
[Peer]
PublicKey  = <VPS A 公钥>
AllowedIPs = 172.16.1.1/32
Endpoint   = <VPS A 公网IP>:51820
PersistentKeepalive = 25

# FIX #4: VPS B (172.16.1.2) — OpenClaw Agent
# LibreChat 可能直接调用 OpenClaw API（如 http://172.16.1.2:3000/api/chat）
# 作为其 AI 后端。原文档缺少此 Peer，若 LibreChat→OpenClaw 存在直连调用，
# 会导致连接超时。即使当前所有流量经 Nginx 中转，添加此 Peer 确保
# 未来直连模式下也能正常工作，成本极低。
[Peer]
PublicKey  = <VPS B 公钥>
AllowedIPs = 172.16.1.2/32
Endpoint   = <VPS B 公网IP>:51820
PersistentKeepalive = 25

# FIX #4: VPS D (172.16.1.4) — Nextcloud（日历 CalDAV / 网盘 WebDAV）
# 若 LibreChat 集成了日历或文件功能，需要直接访问 Nextcloud。
# 添加此 Peer 为未来集成预留路由能力。
[Peer]
PublicKey  = <VPS D 公钥>
AllowedIPs = 172.16.1.4/32
Endpoint   = <VPS D 公网IP>:51820
PersistentKeepalive = 25

# VPS E (172.16.1.6) — Webhook 计费 + Redis
# LibreChat 使用 Redis 作为会话缓存（REDIS_URI=redis://172.16.1.6:6379）
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

# 验证内网互通（全部节点须可达）
wg show wg0
ping -c 2 172.16.1.1   # VPS A（nginx，来源流量）
ping -c 2 172.16.1.2   # VPS B（OpenClaw）
ping -c 2 172.16.1.4   # VPS D（Nextcloud）
ping -c 2 172.16.1.5   # CXI4（Whisper/TTS）
ping -c 2 172.16.1.6   # VPS E（Redis）
# 验证 Redis 连通性（LibreChat 依赖）
redis-cli -h 172.16.1.6 -a "<Redis密码>" ping   # 预期：PONG
```

---

## 5. 安装 Docker

```bash
# 添加 Docker 官方 GPG Key 和软件源
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

# 验证安装
docker --version
docker compose version

# Docker daemon 安全配置（CIS Docker Benchmark 2.x）
cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "50m",
    "max-file": "5"
  },
  "no-new-privileges": true,
  "live-restore": true,
  "userland-proxy": false
}
EOF
systemctl restart docker
```

---

## 6. 部署 LibreChat

### 6.1 克隆仓库

```bash
git clone https://github.com/dnssme/ame.git /opt/ai/repo
chmod 750 /opt/ai/repo
```

### 6.2 创建 `.env` 配置文件

```bash
cd /opt/ai/repo/librechat
cp .env.example .env
chmod 600 .env
```

用编辑器填写所有占位符：

```bash
vim .env
```

**关键配置字段说明：**

| 字段 | 说明 | 生成方法 |
|------|------|----------|
| `DOMAIN_CLIENT` | 你的公网域名，如 `https://ai.example.com` | — |
| `DOMAIN_SERVER` | 同上 | — |
| `JWT_SECRET` | 64 字符随机十六进制（至少 32 字节熵） | 见下方命令 |
| `JWT_REFRESH_SECRET` | 另一个 64 字符随机十六进制 | 见下方命令 |
| `POSTGRES_URI` | 替换 `<animaapp密码>` 部分 | — |
| `REDIS_URI` | 替换 `<Redis密码>` 部分（CXI4 步骤 5.2 中生成的密码） | — |
| `ANTHROPIC_API_KEY` | Claude API Key | — |
| `CREDS_KEY` | 32 字节随机 HEX（64 字符） | 见下方命令 |
| `CREDS_IV` | 16 字节随机 HEX（32 字符） | 见下方命令 |

```bash
# 生成各随机密钥
echo "JWT_SECRET:"
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

echo "JWT_REFRESH_SECRET:"
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

echo "CREDS_KEY:"
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"

echo "CREDS_IV:"
node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"
```

**完整 `.env` 关键配置示例（填写后删除尖括号）：**

```dotenv
HOST=172.16.1.3
PORT=3080
DOMAIN_CLIENT=https://ai.example.com
DOMAIN_SERVER=https://ai.example.com
JWT_SECRET=<64字符随机十六进制>
JWT_REFRESH_SECRET=<另一个64字符随机十六进制>
POSTGRES_URI=postgresql://animaapp:<密码>@anima-db.postgres.database.azure.com:5432/librechat?sslmode=require
REDIS_URI=redis://:<Redis密码>@172.16.1.6:6379
ANTHROPIC_API_KEY=sk-ant-...
CREDS_KEY=<64字符随机十六进制>
CREDS_IV=<32字符随机十六进制>
ALLOW_REGISTRATION=true
```

### 6.3 验证配置文件中无空占位符

```bash
# 检查是否有未填写的占位符（尖括号）
grep -n '<.*>' /opt/ai/repo/librechat/.env \
  && echo "⚠️  发现未填写的占位符，请全部替换后再启动" \
  || echo "✅ 所有占位符已填写"
```

### 6.4 创建必要目录并启动

```bash
cd /opt/ai/repo/librechat
mkdir -p uploads logs

# 目录权限（容器以非 root 用户运行，需确保可写）
chmod 755 uploads logs

# 启动
docker compose up -d

# 等待容器启动（约 30-60 秒）
sleep 30
docker compose ps
```

**预期输出（健康状态）：**

```
NAME        IMAGE                              COMMAND    SERVICE     STATUS
librechat   ghcr.io/danny-avila/librechat:latest   ...   librechat   Up (healthy)
```

### 6.5 验证 LibreChat 内网连通性

```bash
# 健康检查
curl -sf http://172.16.1.3:3080/health
# 预期：{"status":"ok"} 或 HTTP 200

# 检查容器日志（应无 ERROR 级别日志）
docker compose logs --tail=50 librechat | grep -i error || echo "✅ 无错误日志"
```

---

## 6.5 配置 auditd 操作审计

```bash
sudo bash /opt/ai/scripts/audit-setup.sh
systemctl is-active auditd
```

---

## 7. CIS 合规核查清单

```bash
echo "=== CIS 合规核查 ==="

# CIS L1: SSH root 禁用
echo -n "[CIS 5.2.10] SSH root 禁用: "
grep '^PermitRootLogin no' /etc/ssh/sshd_config &>/dev/null && echo "✅ 通过" || echo "❌ 失败"

# CIS L1: SSH 密码认证禁用
echo -n "[CIS 5.2.11] SSH 密码认证禁用: "
grep '^PasswordAuthentication no' /etc/ssh/sshd_config &>/dev/null && echo "✅ 通过" || echo "❌ 失败"

# CIS L1: SYN cookies
echo -n "[CIS 3.4.x] TCP SYN cookies: "
sysctl net.ipv4.tcp_syncookies | grep -q '= 1' && echo "✅ 通过" || echo "❌ 失败"

# CIS Docker 5.x: no-new-privileges
echo -n "[CIS Docker 5.3] no-new-privileges: "
docker inspect librechat 2>/dev/null | grep -q '"NoNewPrivileges": true' \
  && echo "✅ 通过" || echo "❌ 失败"

# CIS Docker 5.x: cap_drop ALL
echo -n "[CIS Docker 5.3] cap_drop ALL: "
docker inspect librechat 2>/dev/null | grep -q '"CapDrop"' \
  && echo "✅ 通过" || echo "❌ 失败"

# CIS Docker 5.x: 容器内存限制
echo -n "[CIS Docker 5.4] 内存限制: "
MEM=$(docker inspect librechat 2>/dev/null | jq '.[0].HostConfig.Memory')
[ "${MEM}" -gt 0 ] 2>/dev/null && echo "✅ 通过 (${MEM} bytes)" || echo "❌ 失败"

# CIS 3.x: 不暴露公网
echo -n "[CIS 12.x] LibreChat 仅内网监听: "
ss -tlnp | grep ':3080' | grep -q '172.16.1.3' && echo "✅ 通过" || echo "❌ 失败"

# .env 权限 600
echo -n "[CIS 5.x] .env 权限 600: "
stat -c "%a" /opt/ai/repo/librechat/.env | grep -q '600' && echo "✅ 通过" || echo "❌ 失败"

# Docker 日志轮替
echo -n "[CIS Docker 6.6] 日志轮替配置: "
docker inspect librechat 2>/dev/null | grep -q '"MaxSize"' \
  && echo "✅ 通过" || echo "❌ 失败"

# 时间同步
echo -n "[PCI 10.4.1] NTP 时间同步: "
chronyc tracking &>/dev/null && echo "✅ 通过" || echo "❌ 失败"
```

---

## 8. PCI-DSS 合规核查清单

```bash
echo "=== PCI-DSS 合规核查 ==="

# PCI-DSS 3.x: 密钥不硬编码
echo -n "[PCI 3.x] JWT_SECRET 已在 .env 中配置: "
grep -q 'JWT_SECRET=' /opt/ai/repo/librechat/.env && \
  ! grep '^JWT_SECRET=<' /opt/ai/repo/librechat/.env &>/dev/null \
  && echo "✅ 通过" || echo "❌ 失败（占位符未替换）"

# PCI-DSS 4.2: DB SSL 连接
echo -n "[PCI 4.2] PostgreSQL SSL 连接: "
grep 'sslmode=require' /opt/ai/repo/librechat/.env &>/dev/null \
  && echo "✅ 通过" || echo "❌ 失败"

# PCI-DSS 4.2: Redis 内网（未加密，但限于 WireGuard 隧道内）
echo -n "[PCI 4.2] Redis 通过 WireGuard 内网: "
grep 'REDIS_URI=redis://.*172.16.1.6' /opt/ai/repo/librechat/.env &>/dev/null \
  && echo "✅ 通过（WireGuard 隧道加密）" || echo "⚠️  请确认 Redis 地址为 172.16.1.6"

# PCI-DSS 6.3.x: JWT Secret 长度 ≥ 32 字节
echo -n "[PCI 6.3.3] JWT_SECRET ≥ 64 字符: "
JWT_LEN=$(grep '^JWT_SECRET=' /opt/ai/repo/librechat/.env | cut -d= -f2 | tr -d '\n' | wc -c)
[ "${JWT_LEN}" -ge 64 ] \
  && echo "✅ 通过 (${JWT_LEN} 字符)" \
  || echo "❌ 失败 (${JWT_LEN} 字符，需 ≥ 64)"

# PCI-DSS 7.x: 最小化端口暴露
echo -n "[PCI 7.x] 仅内网端口暴露: "
ufw status | grep -q '3080.*172.16.1.0/24' \
  && echo "✅ 通过" \
  || echo "⚠️  请核查 UFW 规则，3080 端口不应对公网开放"

# PCI-DSS 8.2.2: 用户注册配置
echo -n "[PCI 8.2.2] 注册控制已配置: "
grep -q 'ALLOW_REGISTRATION=' /opt/ai/repo/librechat/.env \
  && echo "✅ 通过（请根据业务需求确认 true/false）" \
  || echo "⚠️  未找到 ALLOW_REGISTRATION 配置"

# PCI-DSS 10.x: Docker 日志已配置
echo -n "[PCI 10.x] 容器日志记录: "
docker inspect librechat 2>/dev/null | grep -q '"Type": "json-file"' \
  && echo "✅ 通过" || echo "❌ 失败"
```

---

## 9. 功能测试

### 9.1 服务健康检查

```bash
echo "=== LibreChat 功能测试 ==="

# 容器健康状态
echo -n "[测试 1] 容器健康状态: "
cd /opt/ai/repo/librechat
STATUS=$(docker compose ps --format json | jq -r '.[0].Health // .[0].Status')
echo "${STATUS}" | grep -qi 'healthy\|running' \
  && echo "✅ 通过 (${STATUS})" \
  || echo "❌ 失败 (${STATUS})"

# HTTP 健康端点
echo -n "[测试 2] HTTP 健康端点: "
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://172.16.1.3:3080/health)
[ "${HTTP_CODE}" = "200" ] && echo "✅ 通过 (HTTP 200)" || echo "❌ 失败 (HTTP ${HTTP_CODE})"
```

### 9.2 数据库连通性

```bash
echo -n "[测试 3] 数据库连通性（通过容器日志判断）: "
docker compose logs librechat 2>&1 | grep -qi 'connected to database\|postgres.*connected\|db.*ok' \
  && echo "✅ 通过" \
  || echo "⚠️  未在日志中找到 DB 连接成功标志，请人工检查日志"
docker compose logs --tail=30 librechat
```

### 9.3 Redis 连通性

```bash
echo -n "[测试 4] Redis 连通性（通过容器日志判断）: "
docker compose logs librechat 2>&1 | grep -qi 'redis.*connect\|cache.*ready\|session.*store' \
  && echo "✅ 通过" \
  || echo "⚠️  未在日志中找到 Redis 连接成功标志，请人工检查日志"
```

### 9.4 前端页面加载测试

```bash
# 通过内网访问前端页面（由 VPS A 测试，或本机测试）
echo -n "[测试 5] 前端页面可访问: "
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://172.16.1.3:3080/)
[ "${HTTP_CODE}" = "200" ] \
  && echo "✅ 通过 (HTTP 200)" \
  || echo "⚠️  HTTP ${HTTP_CODE}（LibreChat 可能仍在初始化，请等待并重试）"
```

### 9.5 用户注册流程测试

```bash
# API 方式测试用户注册
echo -n "[测试 6] 用户注册 API: "
REG_RESULT=$(curl -sf -X POST http://172.16.1.3:3080/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "name": "测试用户",
    "username": "testuser",
    "email": "functest@test.com",
    "password": "TestPass@12345",
    "confirm_password": "TestPass@12345"
  }' 2>&1)
echo "${REG_RESULT}" | grep -qi 'token\|user\|success' \
  && echo "✅ 通过（注册成功）" \
  || echo "⚠️  注册响应: ${REG_RESULT:0:200}"
```

### 9.6 内存使用检查

```bash
echo -n "[测试 7] 容器内存使用（需 ≤ 768m）: "
MEM_USAGE=$(docker stats librechat --no-stream --format "{{.MemUsage}}")
echo "当前内存使用: ${MEM_USAGE}"
```

### 9.7 完整 E2E 测试（从 VPS A 发起）

> 以下命令应在 **VPS A** 上执行，验证反向代理路径正确性：

```bash
# 在 VPS A 执行
DOMAIN="ai.example.com"

# HTTPS 访问主页
echo -n "[E2E 1] HTTPS 主页: "
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://${DOMAIN}/")
[ "${HTTP_CODE}" = "200" ] && echo "✅ 通过" || echo "HTTP ${HTTP_CODE}"

# HTTP → HTTPS 跳转
echo -n "[E2E 2] HTTP→HTTPS 跳转: "
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://${DOMAIN}/")
[ "${HTTP_CODE}" = "301" ] && echo "✅ 通过 (301)" || echo "HTTP ${HTTP_CODE}"

# 安全响应头
echo "[E2E 3] 安全响应头:"
curl -sI "https://${DOMAIN}/" | grep -E "Strict-Transport|X-Frame|Content-Security|X-Content-Type"
```

---

## 10. 日常运维

### 查看状态

```bash
cd /opt/ai/repo/librechat
docker compose ps
docker compose logs --tail=50 librechat
docker stats librechat --no-stream
```

### 重启服务

```bash
cd /opt/ai/repo/librechat
docker compose restart librechat
```

### 更新镜像

```bash
cd /opt/ai/repo/librechat
docker compose pull
docker compose up -d
# 清理旧镜像
docker image prune -f
```

### 日志管理

```bash
# 实时查看日志
docker compose logs -f librechat

# 查看应用日志（挂载卷中的日志）
ls -la /opt/ai/repo/librechat/logs/
tail -100 /opt/ai/repo/librechat/logs/*.log 2>/dev/null

# 上传文件目录使用量
du -sh /opt/ai/repo/librechat/uploads/
```

---

## 11. 故障排查

### 容器启动失败

```bash
cd /opt/ai/repo/librechat
docker compose logs --tail=100 librechat

# 常见原因 1: JWT_SECRET 太短
grep 'JWT_SECRET' .env | awk -F= '{print length($2), "字符"}'

# 常见原因 2: PostgreSQL 连接失败
# 在容器内测试 DB 连接
docker compose exec librechat sh -c \
  'node -e "const {Pool}=require(\"pg\");const p=new Pool({connectionString:process.env.POSTGRES_URI});p.query(\"SELECT 1\").then(()=>console.log(\"DB OK\")).catch(e=>console.error(e.message))"'

# 常见原因 3: 内存不足（OOM Kill）
dmesg | grep -i 'oom\|killed'
free -h
```

### Redis 连接失败

```bash
# 在 VPS C 测试内网连通性
ping -c 2 172.16.1.6

# 从 VPS C 测试 Redis 连接
REDIS_PASS="<Redis密码>"
redis-cli -h 172.16.1.6 -a "${REDIS_PASS}" ping
# 预期：PONG

# 如果 ping 通但 redis-cli 失败，检查防火墙（在 VPS E 上检查）
# ufw status | grep 6379
```

### JWT 错误 / 登录失败

```bash
# 确认 JWT_SECRET 和 JWT_REFRESH_SECRET 格式正确
grep '^JWT' /opt/ai/repo/librechat/.env

# 重新生成 JWT 密钥并重启
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
# 编辑 .env 替换后重启
docker compose restart librechat
```
