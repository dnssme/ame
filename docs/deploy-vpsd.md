# VPS D (172.16.1.4) 详细部署教程
## Nextcloud（日历 CalDAV + 网盘 WebDAV）

> ✅ **VPS D 已重新激活**：Nextcloud 已从 CXI4 迁回 VPS D (172.16.1.4)，与 Azure PostgreSQL 同在香港机房，消除跨境数据库延迟。  
> CXI4 (172.16.1.5) 现仅承担 ML 推理（Whisper + TTS）和本地服务（Email + HA）。

---

> **节点角色**：Nextcloud 私有云平台（CalDAV + WebDAV）  
> **硬件规格**：2 核 CPU · 1 GB RAM  
> **操作系统**：Ubuntu 22.04 LTS（推荐）

---

## 目录

1. [前置条件](#1-前置条件)
2. [OS 基线加固（CIS L1）](#2-os-基线加固cis-l1)
3. [UFW 防火墙配置](#3-ufw-防火墙配置)
4. [WireGuard 内网配置](#4-wireguard-内网配置)
5. [安装 Docker](#5-安装-docker)
6. [部署 Nextcloud](#6-部署-nextcloud)
7. [配置日历 CalDAV](#7-配置日历-caldav)
8. [配置网盘 WebDAV](#8-配置网盘-webdav)
9. [auditd 操作审计](#9-auditd-操作审计)
10. [CIS 合规核查清单](#10-cis-合规核查清单)
11. [PCI-DSS 合规核查清单](#11-pci-dss-合规核查清单)
12. [功能测试](#12-功能测试)
13. [日常运维](#13-日常运维)
14. [故障排查](#14-故障排查)

---

## 1. 前置条件

- [ ] Ubuntu 22.04 LTS 全新安装，已完成基础系统更新
- [ ] 已分配 WireGuard 内网 IP `172.16.1.4`
- [ ] **Azure PostgreSQL** 已创建 `nextcloud` 数据库
- [ ] 已记录以下信息：
  - Azure PostgreSQL `animaapp` 用户密码
  - 计划使用的 Nextcloud 管理员用户名和密码

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
EOF
sysctl --system
```

### 2.3 fail2ban 防暴力破解

```bash
apt-get install -y fail2ban
cat > /etc/fail2ban/jail.local <<'EOF'
[sshd]
enabled = true
port = ssh
filter = sshd
logpath = /var/log/auth.log
maxretry = 3
bantime = 3600
findtime = 600
EOF
systemctl enable --now fail2ban
```

---

## 3. UFW 防火墙配置

```bash
ufw default deny incoming
ufw default allow outgoing

# SSH（仅管理员 IP 或不限）
ufw allow 22/tcp

# WireGuard VPN
ufw allow 51820/udp

# Nextcloud — 仅允许 VPN 内网访问
ufw allow from 172.16.1.0/24 to any port 8090 proto tcp comment "Nextcloud HTTP"

ufw --force enable
ufw status verbose
```

---

## 4. WireGuard 内网配置

```bash
apt-get install -y wireguard

# 生成密钥对
wg genkey | tee /etc/wireguard/private.key | wg pubkey > /etc/wireguard/public.key
chmod 600 /etc/wireguard/private.key

# 配置 WireGuard 接口
cat > /etc/wireguard/wg0.conf <<'EOF'
[Interface]
PrivateKey = <VPS-D 私钥>
Address = 172.16.1.4/24, fd00:ai::4/64
ListenPort = 51820

# ─── VPS A（Nginx 反向代理）───
[Peer]
PublicKey = <VPS-A 公钥>
AllowedIPs = 172.16.1.1/32, fd00:ai::1/128
Endpoint = <VPS-A 公网IP>:51820
PersistentKeepalive = 25

# ─── VPS B（OpenClaw Agent）───
[Peer]
PublicKey = <VPS-B 公钥>
AllowedIPs = 172.16.1.2/32, fd00:ai::2/128
Endpoint = <VPS-B 公网IP>:51820
PersistentKeepalive = 25

# ─── CXI4（Webhook / Redis / Voice / HA）───
[Peer]
PublicKey = <CXI4 公钥>
AllowedIPs = 172.16.1.5/32, fd00:ai::5/128
Endpoint = <CXI4 公网IP/DDNS>:51820
PersistentKeepalive = 25
EOF

systemctl enable --now wg-quick@wg0

# 验证连通性
ping -c 3 172.16.1.1  # VPS A
ping -c 3 172.16.1.5  # CXI4
```

---

## 5. 安装 Docker

```bash
# 添加 Docker 官方 GPG 密钥和仓库
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc

echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list

apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin

# 验证
docker --version
docker compose version

# CIS Docker Benchmark 5.10：限制默认网桥
cat > /etc/docker/daemon.json <<'EOF'
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "20m",
    "max-file": "3"
  },
  "default-ulimits": {
    "nofile": { "Name": "nofile", "Hard": 65535, "Soft": 32768 }
  }
}
EOF
systemctl restart docker
```

---

## 6. 部署 Nextcloud

### 6.1 准备配置

```bash
mkdir -p /opt/ai/modules/nextcloud
cd /opt/ai/modules/nextcloud

# 复制项目文件
cp /opt/ai/repo/modules/nextcloud/docker-compose.yml /opt/ai/modules/nextcloud/
```

### 6.2 创建环境变量文件

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

### 6.3 启动服务

```bash
docker compose up -d

# 等待初始化完成（首次约 2-3 分钟）
docker compose logs -f --tail=50

# 验证服务状态
docker compose ps
curl -sf http://172.16.1.4:8090/status.php | jq .
```

### 6.4 Nextcloud 初始配置

```bash
# 设置可信域名
docker exec -u www-data anima-nextcloud php occ config:system:set \
  trusted_domains 0 --value="172.16.1.4"
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

# 启用日历应用（CalDAV）
docker exec -u www-data anima-nextcloud php occ app:enable calendar
```

---

## 7. 配置日历 CalDAV

### 7.1 创建 AI 专用日历

```bash
# 创建名为 anima 的日历
docker exec -u www-data anima-nextcloud php occ dav:create-calendar admin anima

# 验证日历 CalDAV 地址
curl -sf -u admin:<密码> \
  http://172.16.1.4:8090/remote.php/dav/calendars/admin/anima/ \
  && echo "CalDAV OK"
```

### 7.2 手机同步设置

#### iOS

1. **设置** → **日历** → **账户** → **添加账户** → **其他** → **CalDAV**
2. 服务器：`https://<你的域名>/nextcloud/remote.php/dav`
3. 用户名 / 密码：Nextcloud 账号

#### Android

1. 安装 **DAVx⁵** 应用（F-Droid 免费下载）
2. 添加账户 → 输入 `https://<你的域名>/nextcloud/remote.php/dav`
3. 自动同步到系统日历

---

## 8. 配置网盘 WebDAV

### 8.1 设置用户配额

```bash
# 设置默认用户存储配额为 5GB
docker exec -u www-data anima-nextcloud php occ config:app:set \
  files default_quota --value="5 GB"
```

### 8.2 客户端连接

- **手机端**：App Store / Google Play 搜索 "Nextcloud"
- **桌面端**：[nextcloud.com/install](https://nextcloud.com/install/#install-clients)
- **Web 端**：`https://<你的域名>/nextcloud/`

### 8.3 WebDAV 地址

```
https://<你的域名>/nextcloud/remote.php/dav/files/<用户名>/
```

---

## 9. auditd 操作审计

```bash
# 安装 auditd
apt-get install -y auditd audispd-plugins

# 配置审计规则
cat > /etc/audit/rules.d/anima.rules <<'EOF'
# 监控 Docker 容器操作
-w /usr/bin/docker -p x -k docker_cmd
-w /usr/bin/containerd -p x -k container_runtime

# 监控 Nextcloud 配置变更
-w /opt/ai/modules/nextcloud/ -p wa -k nextcloud_config

# 监控环境变量文件（敏感信息）
-w /opt/ai/modules/nextcloud/.env -p rwa -k secrets_access

# 监控用户认证
-w /etc/passwd -p wa -k user_accounts
-w /etc/shadow -p rwa -k user_passwords
-w /etc/ssh/sshd_config -p wa -k sshd_config

# 监控 sudo / su 提权操作
-w /usr/bin/sudo -p x -k privilege_escalation
-w /usr/bin/su -p x -k privilege_escalation

# 监控系统关键文件
-w /etc/crontab -p wa -k cron_changes
-w /etc/cron.d/ -p wa -k cron_changes

# 监控防火墙变更
-w /usr/sbin/ufw -p x -k firewall_changes
-w /usr/sbin/iptables -p x -k firewall_changes
EOF

# 加载规则并启动
systemctl enable --now auditd
augenrules --load

# 验证
auditctl -l | head -10
echo "auditd 规则已加载 $(auditctl -l | wc -l) 条"
```

---

## 10. CIS 合规核查清单

| 序号 | CIS 控制项 | 检查命令 | 预期结果 |
|------|-----------|---------|---------|
| 1 | SSH 禁止密码登录 | `grep PasswordAuthentication /etc/ssh/sshd_config` | `PasswordAuthentication no` |
| 2 | SSH 禁止 Root 登录 | `grep PermitRootLogin /etc/ssh/sshd_config` | `PermitRootLogin no` |
| 3 | UFW 默认拒绝入站 | `ufw status` | `Default: deny (incoming)` |
| 4 | fail2ban 已启用 | `systemctl is-active fail2ban` | `active` |
| 5 | Docker 非特权容器 | `docker inspect anima-nextcloud \| jq '.[0].HostConfig.SecurityOpt'` | 包含 `no-new-privileges` |
| 6 | WireGuard 运行中 | `wg show wg0` | 显示接口信息 |
| 7 | auditd 运行中 | `systemctl is-active auditd` | `active` |
| 8 | 内核参数加固 | `sysctl net.ipv4.tcp_syncookies` | `= 1` |

---

## 11. PCI-DSS 合规核查清单

| 序号 | PCI-DSS 要求 | 验证方式 |
|------|-------------|---------|
| 6.5.1 | 注入防护 | 数据库参数化查询（Nextcloud 内置） |
| 6.5.5 | 错误处理 | Docker 健康检查 + 自动重启 |
| 8.2 | 强密码 | Nextcloud 管理员密码 ≥16 字符 |
| 8.3 | 防暴力 | fail2ban SSH 3 次锁定 |
| 10.1 | 审计日志 | auditd 记录所有特权操作 |
| 10.5 | 日志保护 | `/var/log/audit/` 默认权限 `640` |

---

## 12. 功能测试

```bash
echo "=== VPS D 功能测试 ==="

# 1. Nextcloud 健康检查
echo -n "1. Nextcloud 状态: "
STATUS=$(curl -sf http://172.16.1.4:8090/status.php | jq -r .installed)
[ "$STATUS" = "true" ] && echo "✅ 已安装" || echo "❌ 未安装"

# 2. CalDAV 可访问
echo -n "2. CalDAV 日历: "
HTTP=$(curl -sf -o /dev/null -w "%{http_code}" -u admin:<密码> \
  http://172.16.1.4:8090/remote.php/dav/calendars/admin/anima/)
[ "$HTTP" = "207" ] && echo "✅ 可访问" || echo "❌ HTTP $HTTP"

# 3. WebDAV 可访问
echo -n "3. WebDAV 网盘: "
HTTP=$(curl -sf -o /dev/null -w "%{http_code}" -u admin:<密码> \
  -X PROPFIND http://172.16.1.4:8090/remote.php/dav/files/admin/)
[ "$HTTP" = "207" ] && echo "✅ 可访问" || echo "❌ HTTP $HTTP"

# 4. 从 VPS A (Nginx) 可达
echo -n "4. VPS A → VPS D 连通: "
ping -c 1 -W 2 172.16.1.1 &>/dev/null && echo "✅" || echo "❌"

# 5. 从 CXI4 可达
echo -n "5. CXI4 → VPS D 连通: "
ping -c 1 -W 2 172.16.1.5 &>/dev/null && echo "✅" || echo "❌"

# 6. auditd 运行
echo -n "6. auditd: "
systemctl is-active auditd 2>/dev/null && echo "✅" || echo "❌ 未运行"

# 7. Docker 容器健康
echo -n "7. Docker 容器: "
docker inspect --format='{{.State.Health.Status}}' anima-nextcloud 2>/dev/null || echo "❌ 未运行"

echo "=== 测试完成 ==="
```

---

## 13. 日常运维

### 查看日志

```bash
# Nextcloud 容器日志
docker compose logs -f --tail=100

# auditd 审计日志
ausearch -ts today | head -50

# 搜索可疑操作
ausearch -k secrets_access -ts today
ausearch -k privilege_escalation -ts today
```

### 更新 Nextcloud

```bash
cd /opt/ai/modules/nextcloud
docker compose pull
docker compose up -d
docker exec -u www-data anima-nextcloud php occ upgrade
```

### 磁盘清理

```bash
# 查看 Docker 磁盘使用
docker system df

# 清理未使用的镜像
docker image prune -f
```

---

## 14. 故障排查

| 症状 | 可能原因 | 解决方案 |
|------|---------|---------|
| 无法访问 8090 端口 | UFW 规则 | `ufw status` 检查是否允许 172.16.1.0/24 |
| CalDAV 返回 401 | 密码错误 | 重置 Nextcloud 管理员密码 |
| CalDAV 返回 404 | 日历不存在 | 执行步骤 7.1 创建日历 |
| 容器不断重启 | 数据库连接失败 | 检查 `.env` 中 PG_PASSWORD 和 Azure 连通性 |
| 同步慢/超时 | 网络问题 | 检查 WireGuard `wg show wg0` |
