# CXI4 (172.16.1.5) 详细部署教程
## Nextcloud · Webhook 计费服务 · Redis · Whisper STT · Coqui TTS · Email · Home Assistant

> **节点角色**：内网核心服务节点，托管 Nextcloud 私有云（日历 CalDAV + 网盘 WebDAV）、Webhook 计费 API、Redis 缓存、Whisper STT 语音识别、Coqui TTS 语音合成、邮件处理、Home Assistant 智能家居  
> **硬件规格**：Intel i7-10610U · 8 GB RAM · 500 GB SSD  
> **操作系统**：Ubuntu 22.04 LTS（推荐）

---

## 目录

1. [前置条件](#1-前置条件)
2. [OS 基线加固（CIS L1）](#2-os-基线加固cis-l1)
3. [UFW 防火墙配置](#3-ufw-防火墙配置)
4. [WireGuard 内网配置](#4-wireguard-内网配置)
5. [安装 Redis](#5-安装-redis)
6. [部署 Webhook 计费服务](#6-部署-webhook-计费服务)
7. [部署 Nextcloud（日历 CalDAV + 网盘 WebDAV）](#7-部署-nextcloud日历-caldav--网盘-webdav)
8. [可选：部署 Whisper STT + Coqui TTS + Email + Home Assistant](#8-可选部署-whisper-stt--coqui-tts--email--home-assistant)
9. [auditd 操作审计](#9-auditd-操作审计)
10. [CIS 合规核查清单](#10-cis-合规核查清单)
11. [PCI-DSS 合规核查清单](#11-pci-dss-合规核查清单)
12. [功能测试](#12-功能测试)
13. [日常运维](#13-日常运维)
14. [故障排查](#14-故障排查)

---

## 1. 前置条件

在开始前确认：

- [ ] Ubuntu 22.04 LTS 全新安装，已完成基础系统更新
- [ ] 已分配 WireGuard 内网 IP `172.16.1.5`
- [ ] Azure PostgreSQL 实例已创建，`librechat`、`openclaw` 和 `nextcloud` 数据库已建立
- [ ] `animaapp` 数据库用户已创建，已授予两个数据库的所有权限
- [ ] 已为 `animaapp` 授予 `azure_pg_admin` 角色（用于 `CREATE EXTENSION`）
- [ ] 本机 IP 已加入 Azure PostgreSQL 防火墙规则（`172.16.1.5`）

```bash
# 系统更新
apt-get update && apt-get upgrade -y
apt-get install -y curl wget git openssl ca-certificates gnupg lsb-release unzip jq

# 确认 OS 版本
lsb_release -a
# 预期：Ubuntu 22.04.x LTS
```

---

## 2. OS 基线加固（CIS L1）

> 以下步骤对应 **CIS Ubuntu Linux 22.04 LTS Benchmark Level 1**

### 2.1 禁用不必要服务

```bash
# 列出当前启用服务
systemctl list-unit-files --type=service --state=enabled

# 禁用无需的服务（如有）
for svc in avahi-daemon cups bluetooth ModemManager; do
  systemctl disable --now "${svc}" 2>/dev/null && echo "已禁用: ${svc}" || true
done

# 禁用 root 远程 SSH 登录（CIS 5.2.10）
sed -i 's/^#*PermitRootLogin.*/PermitRootLogin no/' /etc/ssh/sshd_config
# 禁用密码认证，仅允许密钥登录（CIS 5.2.11）
sed -i 's/^#*PasswordAuthentication.*/PasswordAuthentication no/' /etc/ssh/sshd_config
# 禁用 X11 转发（CIS 5.2.6）
sed -i 's/^#*X11Forwarding.*/X11Forwarding no/' /etc/ssh/sshd_config
# 设置 SSH 空闲超时（CIS 5.2.16）
grep -q 'ClientAliveInterval' /etc/ssh/sshd_config \
  && sed -i 's/^#*ClientAliveInterval.*/ClientAliveInterval 300/' /etc/ssh/sshd_config \
  || echo 'ClientAliveInterval 300' >> /etc/ssh/sshd_config
grep -q 'ClientAliveCountMax' /etc/ssh/sshd_config \
  && sed -i 's/^#*ClientAliveCountMax.*/ClientAliveCountMax 0/' /etc/ssh/sshd_config \
  || echo 'ClientAliveCountMax 0' >> /etc/ssh/sshd_config
systemctl restart sshd
```

### 2.2 系统内核加固（CIS 3.x / PCI-DSS 2.2）

```bash
# 创建 sysctl 加固配置
cat > /etc/sysctl.d/99-cis-hardening.conf <<'EOF'
# ── 网络加固 (CIS 3.x) ──────────────────────────────────
# 禁用 IP 转发（非路由节点）
net.ipv4.ip_forward = 0
net.ipv6.conf.all.forwarding = 0
# 禁用 ICMP 重定向
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv6.conf.all.accept_redirects = 0
# 禁用源路由
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.default.accept_source_route = 0
# 启用反向路径过滤（防 IP 欺骗）
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1
# 启用 SYN cookies（防 SYN Flood）
net.ipv4.tcp_syncookies = 1
# 忽略广播 ICMP
net.ipv4.icmp_echo_ignore_broadcasts = 1
# 忽略伪造错误包
net.ipv4.icmp_ignore_bogus_error_responses = 1
# CXI4 有公网 IPv6，保留 IPv6 支持（不禁用）

# ── 内核加固 (CIS 1.x) ──────────────────────────────────
# 防止 core dump 泄露（CIS 1.6.1）
fs.suid_dumpable = 0
kernel.core_uses_pid = 1
# ASLR（地址空间布局随机化）
kernel.randomize_va_space = 2
# 限制 dmesg 读取
kernel.dmesg_restrict = 1
# 限制 ptrace
kernel.yama.ptrace_scope = 1
EOF

sysctl -p /etc/sysctl.d/99-cis-hardening.conf
```

### 2.3 时间同步（PCI-DSS 10.4.1）

```bash
# 安装并配置 chrony（时间同步，PCI-DSS 要求所有节点时间一致）
apt-get install -y chrony
systemctl enable --now chrony

# 验证同步状态
chronyc tracking
# 预期：Reference ID 应显示 NTP 服务器 IP，System time 误差 < 1 秒
```

### 2.4 安装 fail2ban（CIS 6.x / PCI-DSS 8.3）

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
# 验证
fail2ban-client status sshd
```

### 2.5 文件系统加固

```bash
# /tmp 使用 tmpfs（防止 /tmp 中执行程序）
grep -q 'tmpfs /tmp' /etc/fstab \
  || echo 'tmpfs /tmp tmpfs defaults,noexec,nosuid,nodev 0 0' >> /etc/fstab
mount -o remount /tmp 2>/dev/null || true

# 日志目录权限（CIS 4.2.x）
chmod 640 /var/log/syslog
chmod 640 /var/log/auth.log
```

---

## 3. UFW 防火墙配置

```bash
# 安装 UFW
apt-get install -y ufw

# CXI4 有公网 IPv6，确保 UFW 同时管理 IPv4 和 IPv6 规则
sed -i 's/^IPV6=.*/IPV6=yes/' /etc/default/ufw

# 默认拒绝入站，允许出站
ufw default deny incoming
ufw default allow outgoing

# 允许 SSH（IPv4 + IPv6）
ufw allow 22/tcp

# 允许 WireGuard UDP
ufw allow 51820/udp

# 允许内网访问 Webhook（仅 WireGuard 内网）
ufw allow in from 172.16.1.0/24 to any port 3002

# 允许内网访问 Nextcloud（仅 WireGuard 内网）
ufw allow in from 172.16.1.0/24 to any port 8090 proto tcp comment "Nextcloud HTTP"

# 允许内网访问 Redis（仅 WireGuard 内网，禁止公网）
ufw allow in from 172.16.1.0/24 to any port 6379

# 允许内网访问 Whisper STT（如启用）
ufw allow in from 172.16.1.0/24 to any port 8080

# 允许内网访问 Coqui TTS（从 VPS A 迁移至 CXI4）
ufw allow in from 172.16.1.0/24 to any port 8082

# 允许 WireGuard 接口所有流量
ufw allow in on wg0

# 启用防火墙
ufw --force enable
ufw status verbose
```

---

## 4. WireGuard 内网配置

```bash
# 安装 WireGuard
apt-get install -y wireguard

# 生成密钥对
wg genkey | tee /etc/wireguard/privatekey | wg pubkey > /etc/wireguard/publickey
chmod 600 /etc/wireguard/privatekey
cat /etc/wireguard/publickey   # 记录此公钥，需与其他节点配置

# 创建 WireGuard 配置（替换 <私钥> 和各节点 <公钥>/<端点>）
# 注意：CXI4 公网 IP 为动态 IP，因此 CXI4 必须主动连接到固定 IP 的对端节点。
# 其他节点的配置中不设置 CXI4 的 Endpoint，由 CXI4 通过 PersistentKeepalive 主动维持隧道。
cat > /etc/wireguard/wg0.conf <<'EOF'
[Interface]
PrivateKey = <CXI4私钥>
Address    = 172.16.1.5/24
ListenPort = 51820

# VPS A (172.16.1.1) — 固定公网 IP，CXI4 主动连接
[Peer]
PublicKey  = <VPS A 公钥>
AllowedIPs = 172.16.1.1/32
Endpoint   = <VPS A 公网IP>:51820
PersistentKeepalive = 25

# VPS B (172.16.1.2) — 固定公网 IP，CXI4 主动连接
[Peer]
PublicKey  = <VPS B 公钥>
AllowedIPs = 172.16.1.2/32
Endpoint   = <VPS B 公网IP>:51820
PersistentKeepalive = 25

# VPS C (172.16.1.3) — 固定公网 IP，CXI4 主动连接
[Peer]
PublicKey  = <VPS C 公钥>
AllowedIPs = 172.16.1.3/32
Endpoint   = <VPS C 公网IP>:51820
PersistentKeepalive = 25
EOF

chmod 600 /etc/wireguard/wg0.conf

# 启动 WireGuard
systemctl enable --now wg-quick@wg0

# 验证隧道
wg show wg0
ping -c 2 172.16.1.1   # VPS A
ping -c 2 172.16.1.2   # VPS B
ping -c 2 172.16.1.3   # VPS C
```

---

## 5. 安装 Redis

### 5.1 安装

```bash
apt-get install -y redis-server

# 停止服务先修改配置
systemctl stop redis-server
```

### 5.2 安全配置（CIS Redis / PCI-DSS 2.2）

```bash
# 生成强密码（32 字节随机十六进制）
REDIS_PASS="$(openssl rand -hex 32)"
echo "Redis 密码（请保存）: ${REDIS_PASS}"

# 备份默认配置
cp /etc/redis/redis.conf /etc/redis/redis.conf.bak

# 仅监听 WireGuard 内网接口（禁止公网）
sed -i 's/^bind 127.0.0.1.*/bind 172.16.1.5 127.0.0.1/' /etc/redis/redis.conf

# 设置访问密码
sed -i "s/^# requirepass .*/requirepass ${REDIS_PASS}/" /etc/redis/redis.conf
# 若 requirepass 行不带 #，直接替换
grep -q '^requirepass' /etc/redis/redis.conf \
  || echo "requirepass ${REDIS_PASS}" >> /etc/redis/redis.conf

# 禁用危险命令（CIS Redis Benchmark）
cat >> /etc/redis/redis.conf <<EOF

# ── 安全加固 ──────────────────────────────────────────────
# 禁用危险管理命令（防止未授权访问执行系统命令）
rename-command CONFIG   ""
rename-command DEBUG    ""
rename-command FLUSHALL ""
rename-command FLUSHDB  ""
rename-command SLAVEOF  ""

# 内存限制（防止 OOM Kill）
maxmemory 1gb
maxmemory-policy allkeys-lru

# 持久化（CIS: 只读节点禁用持久化以减少攻击面）
save ""
appendonly no

# 保护模式（额外防护）
protected-mode yes

# 客户端连接数限制
maxclients 100
EOF

# 文件权限加固（CIS 6.x）
chmod 600 /etc/redis/redis.conf
chown redis:redis /etc/redis/redis.conf

# 启动 Redis
systemctl enable --now redis-server
systemctl restart redis-server
sleep 2

# 验证
REDISCLI_AUTH="${REDIS_PASS}" redis-cli -h 172.16.1.5 ping
# 预期：PONG
REDISCLI_AUTH="${REDIS_PASS}" redis-cli -h 172.16.1.5 info server | grep redis_version
```

### 5.3 Redis systemd 安全加固（CIS Docker Benchmark 类似要求）

```bash
# 创建 systemd override，添加安全限制
mkdir -p /etc/systemd/system/redis-server.service.d
cat > /etc/systemd/system/redis-server.service.d/override.conf <<'EOF'
[Service]
# 进程隔离
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ReadWritePaths=/var/lib/redis /var/log/redis /run/redis
# 内存锁（高性能 Redis 需要）
LimitMEMLOCK=infinity
EOF

systemctl daemon-reload
systemctl restart redis-server
```

---

## 6. 部署 Webhook 计费服务

### 6.1 克隆仓库

```bash
git clone https://github.com/dnssme/ame.git /opt/ai/repo
chmod 750 /opt/ai/repo
```

### 6.2 安装 Node.js 20

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

### 6.3 部署 Webhook 服务目录

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

### 6.4 创建 .env 配置文件

```bash
# 生成随机 ADMIN_TOKEN（32字节 = 64个十六进制字符）
ADMIN_TOKEN_VAL="$(openssl rand -hex 32)"
# 生成随机 SERVICE_TOKEN（用于 /billing/record 和 /billing/check 内部服务鉴权）
SERVICE_TOKEN_VAL="$(openssl rand -hex 32)"

cat > /opt/ai/webhook/.env <<EOF
PG_HOST=anima-db.postgres.database.azure.com
PG_PORT=5432
PG_USER=animaapp
PG_PASSWORD=<animaapp数据库密码>
PG_DATABASE=librechat
PORT=3002
HOST=172.16.1.5
LOG_LEVEL=info
# 管理员接口令牌（已自动生成，请妥善保管）
ADMIN_TOKEN=${ADMIN_TOKEN_VAL}
# 内部服务鉴权令牌（OpenClaw 调用 /billing/record 时携带，防止内网未授权访问）
SERVICE_TOKEN=${SERVICE_TOKEN_VAL}
EOF

chmod 600 /opt/ai/webhook/.env
echo "ADMIN_TOKEN: ${ADMIN_TOKEN_VAL}"
echo "SERVICE_TOKEN: ${SERVICE_TOKEN_VAL}"
```

> ⚠️ **立即保存 `ADMIN_TOKEN` 和 `SERVICE_TOKEN`**，后续所有管理员 API 操作均需 ADMIN_TOKEN；
> OpenClaw 的 `openclaw/.env` 需将 `SERVICE_TOKEN` 填入 `SERVICE_TOKEN` 字段。

### 6.5 初始化数据库 Schema

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

echo "数据库 Schema 初始化完成"
```

> 若出现 `ERROR` 提示，请检查 `PG_PASSWORD`、`PG_HOST` 及 Azure PostgreSQL 防火墙规则（需将 `172.16.1.5` 加入允许列表）。

### 6.6 创建 systemd 服务

> ⚠️ **二选一**：本节使用 systemd 直接运行 Webhook。如果你使用根目录 `docker-compose.yml` 中的 `webhook` 服务（容器化部署），请跳过本节，**不要同时启用两套部署方式**，否则会产生端口冲突（两者都监听 `172.16.1.5:3002`）。

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
echo "systemd 服务已创建并启动（ai-webhook）"
```

### 6.7 验证服务

```bash
# 健康检查
if curl -sf http://172.16.1.5:3002/health | grep -q '"db":"ok"'; then
  echo "✅ Webhook 服务运行正常"
else
  echo "⚠  Webhook 服务可能未完全启动，查看日志："
  journalctl -u ai-webhook -n 30 --no-pager
fi

# 常用运维命令
echo "  状态：systemctl status ai-webhook"
echo "  日志：journalctl -u ai-webhook -f"
echo "  测试：curl http://172.16.1.5:3002/health"
```

### 6.8 加固 .env 权限及内容核查

```bash
# 确认权限为 600（仅 root 可读写，PCI-DSS 3.x）
ls -la /opt/ai/webhook/.env
# 预期：-rw------- 1 root root

# 核查必要字段
grep -E '^(PG_HOST|PG_USER|PG_DATABASE|PORT|HOST|ADMIN_TOKEN)=' /opt/ai/webhook/.env
```

### 6.9 配置日志轮替

```bash
cat > /etc/logrotate.d/ai-webhook <<'EOF'
/opt/ai/webhook/logs/*.log {
    daily
    rotate 7
    compress
    delaycompress
    missingok
    notifempty
    create 640 root root
}
EOF
```

### 6.10 配置看门狗（可选）

```bash
# 安装看门狗脚本
cp /opt/ai/repo/scripts/watchdog.sh /opt/ai/webhook/watchdog.sh
chmod 750 /opt/ai/webhook/watchdog.sh

# 添加 crontab：每 5 分钟检查服务是否存活
(crontab -l 2>/dev/null; echo "*/5 * * * * /opt/ai/webhook/watchdog.sh >> /var/log/webhook-watchdog.log 2>&1") | crontab -
```

---

## 7. 部署 Nextcloud（日历 CalDAV + 网盘 WebDAV）

> Nextcloud 部署在 CXI4 而非独立 VPS，因为 CXI4 拥有 **500 GB SSD**，更适合企业级文件存储。
> Nextcloud 是必选基础设施模块，为日历管理（CalDAV）和用户网盘（WebDAV）提供底层支撑。

### 7.1 CXI4 资源分配总览

| 服务 | mem_limit | mem_reservation | cpus | 备注 |
|------|-----------|-----------------|------|------|
| **Nextcloud** | 768m | 384m | 1.0 | 企业级文件存储 + CalDAV + WebDAV |
| **Webhook** | 384m | 192m | 1.5 | 计费服务 |
| **Redis** | 1g (maxmemory) | — | — | 系统级缓存 |
| **Whisper STT** | 2g | 1g | 2.0 | ML 语音识别模型 |
| **Coqui TTS** | 768m | 384m | 1.0 | ML 语音合成模型 |
| **Email** | 192m | 64m | 0.5 | IMAP/SMTP 处理 |
| **Home Assistant** | 512m | 256m | 1.0 | 智能家居（可选） |
| **合计** | **≈ 5.6g** | — | — | 系统预留 ≈ 2.4 GB |

### 7.2 准备配置

```bash
mkdir -p /opt/ai/modules/nextcloud
cd /opt/ai/modules/nextcloud

# 复制 docker-compose.yml
cp /opt/ai/repo/modules/nextcloud/docker-compose.yml .
```

### 7.3 创建环境变量文件

```bash
cat > .env <<'EOF'
PG_PASSWORD=<Azure PostgreSQL animaapp 密码>
NEXTCLOUD_USERNAME=admin
NEXTCLOUD_PASSWORD=<Nextcloud 管理员密码，至少 16 字符>
NEXTCLOUD_DOMAIN=<你的域名>
TZ=Asia/Shanghai
EOF
chmod 600 .env
```

### 7.4 启动 Nextcloud

```bash
docker compose up -d

# 等待初始化完成（首次约 2-3 分钟）
docker compose logs -f --tail=50

# 验证服务状态
docker compose ps
curl -sf http://172.16.1.5:8090/status.php | jq .
```

### 7.5 Nextcloud 初始配置

```bash
# 设置可信域名
docker exec -u www-data anima-nextcloud php occ config:system:set \
  trusted_domains 0 --value="172.16.1.5"
docker exec -u www-data anima-nextcloud php occ config:system:set \
  trusted_domains 1 --value="<你的域名>"

# 设置默认语言和区域
docker exec -u www-data anima-nextcloud php occ config:system:set \
  default_language --value="zh_CN"
docker exec -u www-data anima-nextcloud php occ config:system:set \
  default_locale --value="zh_CN"
docker exec -u www-data anima-nextcloud php occ config:system:set \
  default_phone_region --value="CN"

# 禁用不需要的应用（减少攻击面）
docker exec -u www-data anima-nextcloud php occ app:disable survey_client
docker exec -u www-data anima-nextcloud php occ app:disable firstrunwizard

# 启用日历应用（CalDAV）并创建 AI 专用日历
docker exec -u www-data anima-nextcloud php occ app:enable calendar
docker exec -u www-data anima-nextcloud php occ dav:create-calendar admin anima
```

### 7.6 设置用户配额

```bash
# 设置默认用户存储配额为 5GB
docker exec -u www-data anima-nextcloud php occ config:app:set \
  files default_quota --value="5 GB"
```

### 7.7 验证 CalDAV / WebDAV

```bash
# 验证 CalDAV 日历
curl -sf -u admin:<密码> \
  http://172.16.1.5:8090/remote.php/dav/calendars/admin/anima/ \
  && echo "CalDAV OK"

# 验证 WebDAV 网盘
curl -sf -u admin:<密码> -X PROPFIND \
  http://172.16.1.5:8090/remote.php/dav/files/admin/ \
  -o /dev/null -w "HTTP %{http_code}" && echo " WebDAV OK"
```

---

## 8. 可选：部署 Whisper STT + Coqui TTS + Email + Home Assistant

CXI4 是主要算力节点（8GB RAM），以下服务均可按需部署在此节点：

### 8.1 Whisper STT（语音识别）

```bash
cd /opt/ai/modules/voice
docker compose -f docker-compose.whisper.yml up -d

# 验证（Whisper Small 模型，中文优先，10s 音频 ≈ 3s）
curl -sf http://172.16.1.5:8080/ || echo "Whisper STT 未就绪，稍候重试"
```

### 8.2 Coqui TTS（语音合成）

```bash
cd /opt/ai/modules/voice
docker compose -f docker-compose.tts.yml up -d

# 验证（中文 Baker 模型，延迟 <100ms）
curl -sf http://172.16.1.5:8082/api/tts \
  -H "Content-Type: application/json" \
  -d '{"text":"你好"}' --output /dev/null && echo "TTS OK"
```

### 8.3 Email 处理模块

```bash
cd /opt/ai/modules/email
cp .env.example .env
vim .env  # 填写 IMAP/SMTP 配置
docker compose up -d

# 验证
curl -sf http://172.16.1.5:3004/health && echo "Email OK"
```

### 8.4 Home Assistant（智能家居）

```bash
cd /opt/ai/modules/smart-home
cp .env.example .env
vim .env  # 设置时区
docker compose up -d

# 首次启动较慢（约 2 分钟），浏览器访问完成初始设置
echo "访问 http://172.16.1.5:8123 完成 Home Assistant 初始配置"
echo "配置完成后，创建长期访问令牌填入 openclaw/.env 的 HA_TOKEN"
```

---

## 9. auditd 操作审计

```bash
# 使用统一审计配置脚本
# 脚本位于仓库 scripts/audit-setup.sh
sudo bash /opt/ai/scripts/audit-setup.sh

# 验证 auditd 运行状态
systemctl is-active auditd
auditctl -l | wc -l  # 应显示已加载的规则数

# 查看今日审计事件
ausearch -ts today | head -20
```

---

## 10. CIS 合规核查清单

执行以下检查，确认所有项目通过：

### 10.1 操作系统加固

```bash
echo "=== CIS OS 加固核查 ==="

# CIS 1.6.1: core dump 禁用
echo -n "[CIS 1.6.1] core dump 禁用: "
sysctl fs.suid_dumpable | grep -q '= 0' && echo "✅ 通过" || echo "❌ 失败"

# CIS 3.x: IP 转发禁用
echo -n "[CIS 3.1.1] IP 转发禁用: "
sysctl net.ipv4.ip_forward | grep -q '= 0' && echo "✅ 通过" || echo "❌ 失败"

# CIS 3.x: SYN cookies 启用
echo -n "[CIS 3.4.x] TCP SYN cookies: "
sysctl net.ipv4.tcp_syncookies | grep -q '= 1' && echo "✅ 通过" || echo "❌ 失败"

# CIS 4.x: 时间同步
echo -n "[CIS 2.1.x] 时间同步 (chrony): "
chronyc tracking &>/dev/null && echo "✅ 通过" || echo "❌ 失败"

# CIS 5.2.x: SSH root 登录禁用
echo -n "[CIS 5.2.10] SSH root 禁用: "
grep '^PermitRootLogin no' /etc/ssh/sshd_config &>/dev/null && echo "✅ 通过" || echo "❌ 失败"

# CIS 5.2.x: SSH 密码认证禁用
echo -n "[CIS 5.2.11] SSH 密码认证禁用: "
grep '^PasswordAuthentication no' /etc/ssh/sshd_config &>/dev/null && echo "✅ 通过" || echo "❌ 失败"
```

### 10.2 服务安全

```bash
echo "=== CIS 服务安全核查 ==="

# Redis 仅监听内网
echo -n "[Redis] 仅监听内网: "
ss -tlnp | grep ':6379' | grep -q '172.16.1.5' && echo "✅ 通过" || echo "❌ 失败"

# Webhook 仅监听内网
echo -n "[Webhook] 仅监听内网: "
ss -tlnp | grep ':3002' | grep -q '172.16.1.5' && echo "✅ 通过" || echo "❌ 失败"

# .env 权限 600
echo -n "[PCI 3.x] .env 权限 600: "
stat -c "%a" /opt/ai/webhook/.env | grep -q '600' && echo "✅ 通过" || echo "❌ 失败"

# Node.js 版本 20
echo -n "[依赖] Node.js 20: "
node -p 'process.versions.node.split(".")[0]' | grep -q '20' && echo "✅ 通过" || echo "❌ 失败"

# systemd 服务安全配置
echo -n "[CIS Docker 5.x] NoNewPrivileges: "
systemctl show ai-webhook | grep -q 'NoNewPrivileges=yes' && echo "✅ 通过" || echo "❌ 失败"
```

### 10.3 防火墙规则

```bash
echo "=== UFW 防火墙规则核查 ==="
ufw status verbose

# 确认没有公网暴露的敏感端口
echo -n "[UFW] 3002端口仅内网: "
ufw status | grep '3002' | grep -q '172.16.1.0/24' && echo "✅ 通过" || echo "❌ 失败（请检查规则）"

echo -n "[UFW] 6379端口仅内网: "
ufw status | grep '6379' | grep -q '172.16.1.0/24' && echo "✅ 通过" || echo "❌ 失败（请检查规则）"
```

---

## 11. PCI-DSS 合规核查清单

```bash
echo "=== PCI-DSS 合规核查 ==="

# PCI-DSS 2.2: 系统加固
echo -n "[PCI 2.2.1] 安全配置基线（sysctl）: "
sysctl net.ipv4.tcp_syncookies | grep -q '= 1' && echo "✅ 通过" || echo "❌ 失败"

# PCI-DSS 3.x: 密钥不硬编码
echo -n "[PCI 3.x] .env 中无明文密码在代码中: "
grep -r 'PG_PASSWORD\|REDIS_PASS\|ADMIN_TOKEN' /opt/ai/webhook/server.js 2>/dev/null \
  | grep -v 'process.env' | grep -q '.' \
  && echo "❌ 失败（检测到硬编码凭证）" || echo "✅ 通过"

# PCI-DSS 4.2: 传输加密（Redis 内网，PostgreSQL SSL）
echo -n "[PCI 4.2] PostgreSQL SSL 连接: "
grep 'PGSSLMODE=require\|sslmode=require' /opt/ai/webhook/.env &>/dev/null \
  || grep 'sslmode=require' /opt/ai/webhook/server.js &>/dev/null \
  && echo "✅ 通过" || echo "⚠️  需人工核查 server.js SSL 配置"

# PCI-DSS 6.5.5: 错误处理（unhandledRejection）
echo -n "[PCI 6.5.5] 全局错误处理器: "
grep -q 'unhandledRejection\|uncaughtException' /opt/ai/webhook/server.js \
  && echo "✅ 通过" || echo "❌ 失败"

# PCI-DSS 8.3: 速率限制（防暴力破解）
echo -n "[PCI 8.3] 接口速率限制: "
grep -q 'express-rate-limit\|rateLimit' /opt/ai/webhook/server.js \
  && echo "✅ 通过" || echo "❌ 失败"

# PCI-DSS 8.6.3: 管理员令牌长度
echo -n "[PCI 8.6.3] ADMIN_TOKEN ≥ 32 字符: "
TOKEN_LEN=$(grep '^ADMIN_TOKEN=' /opt/ai/webhook/.env | cut -d= -f2 | tr -d '\n' | wc -c)
[ "${TOKEN_LEN}" -ge 32 ] && echo "✅ 通过（${TOKEN_LEN} 字符）" || echo "❌ 失败（${TOKEN_LEN} 字符，需 ≥ 32）"

# PCI-DSS 10.x: 日志记录
echo -n "[PCI 10.x] 应用日志记录 (winston): "
grep -q 'winston' /opt/ai/webhook/server.js && echo "✅ 通过" || echo "❌ 失败"

# PCI-DSS 10.4: 时间同步
echo -n "[PCI 10.4.1] NTP 时间同步: "
chronyc tracking &>/dev/null && echo "✅ 通过" || echo "❌ 失败"
```

---

## 12. 功能测试

### 12.1 健康检查

```bash
echo "=== Webhook 功能测试 ==="

# 健康检查（验证 DB + 服务均正常）
echo -n "[测试 1] 健康检查: "
HEALTH=$(curl -sf http://172.16.1.5:3002/health)
echo "${HEALTH}" | grep -q '"db":"ok"' \
  && echo "✅ 通过 → ${HEALTH}" \
  || echo "❌ 失败 → ${HEALTH}"
```

### 12.2 模型接口测试

```bash
# 查询预置模型列表
echo -n "[测试 2] 模型列表接口: "
MODELS=$(curl -sf http://172.16.1.5:3002/models)
echo "${MODELS}" | grep -q '"success":true' \
  && echo "✅ 通过 → $(echo "${MODELS}" | jq '.models | length') 个模型" \
  || echo "❌ 失败 → ${MODELS}"
```

### 12.3 免费模型计费测试

```bash
# 免费模型计费（应记录但不扣费）
echo -n "[测试 3] 免费模型计费: "
RESULT=$(curl -sf -X POST http://172.16.1.5:3002/billing/record \
  -H "Content-Type: application/json" \
  -d '{"userEmail":"test@test.com","apiProvider":"anthropic","modelName":"claude-haiku-4-5-20251001","inputTokens":100,"outputTokens":50}')
echo "${RESULT}" | grep -q '"is_free":true' \
  && echo "✅ 通过（免费模型不扣费）" \
  || echo "❌ 失败 → ${RESULT}"
```

### 12.4 充值卡激活测试

```bash
# 首先创建测试充值卡（需 psql）
echo "[准备] 创建测试充值卡..."
TEST_CARD="TEST-$(openssl rand -hex 4 | tr '[:lower:]' '[:upper:]')"
PGPASSWORD="<animaapp密码>" PGSSLMODE=require psql \
  -h anima-db.postgres.database.azure.com \
  -U animaapp -d librechat \
  -c "INSERT INTO recharge_cards (key, credit_fen, label) VALUES ('${TEST_CARD}', 100, '测试卡');"

# 测试充值卡激活
echo -n "[测试 4] 充值卡激活: "
ACTIVATE=$(curl -sf -X POST http://172.16.1.5:3002/activate \
  -H "Content-Type: application/json" \
  -d "{\"cardKey\":\"${TEST_CARD}\",\"userEmail\":\"test@test.com\"}")
echo "${ACTIVATE}" | grep -q '"success":true' \
  && echo "✅ 通过 → 充值 $(echo "${ACTIVATE}" | jq '.credit_fen') 分" \
  || echo "❌ 失败 → ${ACTIVATE}"

# 重复使用已用卡（应拒绝）
echo -n "[测试 5] 重复激活拒绝: "
DUPLICATE=$(curl -sf -X POST http://172.16.1.5:3002/activate \
  -H "Content-Type: application/json" \
  -d "{\"cardKey\":\"${TEST_CARD}\",\"userEmail\":\"test2@test.com\"}")
echo "${DUPLICATE}" | grep -q '"success":false' \
  && echo "✅ 通过（正确拒绝重复激活）" \
  || echo "❌ 失败（应拒绝但未拒绝）"
```

### 12.5 余额查询测试

```bash
echo -n "[测试 6] 余额查询: "
BALANCE=$(curl -sf "http://172.16.1.5:3002/billing/balance/test@test.com")
echo "${BALANCE}" | grep -q '"success":true' \
  && echo "✅ 通过 → 余额 $(echo "${BALANCE}" | jq '.balance_fen') 分" \
  || echo "❌ 失败 → ${BALANCE}"
```

### 12.6 付费模型余额不足测试

```bash
# 用余额 < 所需的用户测试付费模型
echo -n "[测试 7] 余额不足拦截 (HTTP 402): "
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST http://172.16.1.5:3002/billing/record \
  -H "Content-Type: application/json" \
  -d '{"userEmail":"nofunds@test.com","apiProvider":"anthropic","modelName":"claude-sonnet-4-5","inputTokens":10000,"outputTokens":5000}')
[ "${HTTP_CODE}" = "402" ] \
  && echo "✅ 通过（HTTP 402）" \
  || echo "⚠️  余额不足用户可能不存在（HTTP ${HTTP_CODE}），该场景需余额为 0 的用户"
```

### 12.7 管理员接口鉴权测试

```bash
ADMIN_TOKEN="$(grep '^ADMIN_TOKEN=' /opt/ai/webhook/.env | cut -d= -f2)"

# 无令牌应返回 401
echo -n "[测试 8] 未鉴权拒绝 (HTTP 401): "
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" http://172.16.1.5:3002/admin/models)
[ "${HTTP_CODE}" = "401" ] && echo "✅ 通过" || echo "❌ 失败（HTTP ${HTTP_CODE}）"

# 有效令牌应返回 200
echo -n "[测试 9] 有效令牌通过 (HTTP 200): "
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  http://172.16.1.5:3002/admin/models \
  -H "Authorization: Bearer ${ADMIN_TOKEN}")
[ "${HTTP_CODE}" = "200" ] && echo "✅ 通过" || echo "❌ 失败（HTTP ${HTTP_CODE}）"
```

### 12.8 速率限制测试（PCI-DSS 8.3）

```bash
echo -n "[测试 10] 激活接口速率限制: "
BLOCKED=false
for i in $(seq 1 8); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST http://172.16.1.5:3002/activate \
    -H "Content-Type: application/json" \
    -d '{"cardKey":"RATE-TEST","userEmail":"ratetest@test.com"}')
  if [ "${CODE}" = "429" ]; then
    BLOCKED=true
    echo "✅ 通过（第 ${i} 次触发限速 HTTP 429）"
    break
  fi
done
${BLOCKED} || echo "⚠️  速率限制未在 8 次内触发（检查 LIMIT_ACTIVATE_MAX 配置）"
```

### 12.9 Redis 连通性测试

```bash
echo -n "[测试 11] Redis 连通性（内网）: "
REDISCLI_AUTH="${REDIS_PASS}" redis-cli -h 172.16.1.5 ping | grep -q 'PONG' \
  && echo "✅ 通过" \
  || echo "❌ 失败（Redis 连接失败）"

# 验证密码保护（使用错误密码应失败）
echo -n "[测试 12] Redis 密码保护: "
redis-cli -h 172.16.1.5 ping 2>&1 | grep -qi 'NOAUTH\|Authentication required' \
  && echo "✅ 通过（未授权正确拒绝）" \
  || echo "❌ 失败（Redis 无密码保护！）"
```

---

## 13. 日常运维

### 查看服务状态

```bash
# Webhook 服务状态
systemctl status ai-webhook
journalctl -u ai-webhook -n 50 --no-pager

# Redis 状态
systemctl status redis-server
REDISCLI_AUTH="${REDIS_PASS}" redis-cli -h 172.16.1.5 info stats | grep -E 'connected_clients|used_memory_human'
```

### 轮换 ADMIN_TOKEN（PCI-DSS 8.6.3 建议定期轮换）

```bash
NEW_TOKEN="$(openssl rand -hex 32)"
sed -i "s/^ADMIN_TOKEN=.*/ADMIN_TOKEN=${NEW_TOKEN}/" /opt/ai/webhook/.env
systemctl restart ai-webhook
echo "新 ADMIN_TOKEN: ${NEW_TOKEN}"
# 验证
curl -s -o /dev/null -w "%{http_code}" \
  http://172.16.1.5:3002/admin/models \
  -H "Authorization: Bearer ${NEW_TOKEN}"
# 预期：200
```

### 数据库备份

```bash
# 手动备份（使用 backup-pg.sh 脚本，自动备份 librechat + openclaw 双库）
/opt/ai/scripts/backup-pg.sh

# 配置每日自动备份（凌晨 2 点执行，含错误处理、自动清理、双库备份）
(crontab -l 2>/dev/null; echo "0 2 * * * /opt/ai/scripts/backup-pg.sh >> /var/log/anima-backup.log 2>&1") | crontab -
```

---

## 14. 故障排查

### Webhook 无法启动

```bash
journalctl -u ai-webhook -n 100 --no-pager

# 常见原因：
# 1. PG_PASSWORD 错误 → psql 手动测试连接
PGPASSWORD="<密码>" PGSSLMODE=require psql \
  -h anima-db.postgres.database.azure.com \
  -U animaapp -d librechat -c "SELECT 1;"

# 2. 端口被占用
ss -tlnp | grep 3002

# 3. Node.js 版本不匹配
node --version   # 需为 v20.x
```

### Redis 连接失败

```bash
# 检查 Redis 监听地址
ss -tlnp | grep 6379

# 查看 Redis 日志
journalctl -u redis-server -n 50 --no-pager

# 检查防火墙
ufw status | grep 6379
```

### DB Schema 初始化失败

```bash
# 手动执行 Schema
PGPASSWORD="<密码>" PGSSLMODE=require psql \
  -h anima-db.postgres.database.azure.com \
  -U animaapp -d librechat \
  -f /opt/ai/repo/db/schema.sql

# 检查扩展权限
PGPASSWORD="<密码>" PGSSLMODE=require psql \
  -h anima-db.postgres.database.azure.com \
  -U animaapp -d librechat \
  -c "SELECT * FROM pg_extension;"
```
