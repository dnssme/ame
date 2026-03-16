# CXI4 (172.16.1.5) 详细部署教程
## Whisper STT · Coqui TTS · Email · Home Assistant

> **节点角色**：ML 推理与智能服务节点（青岛），托管 Whisper STT 语音识别、Coqui TTS 语音合成、邮件处理、Home Assistant 智能家居  
> **硬件规格**：Intel i7-10610U · 8 GB RAM · 500 GB SSD  
> **操作系统**：Ubuntu 22.04 LTS（推荐）

---

## 目录

1. [前置条件](#1-前置条件)
2. [OS 基线加固（CIS L1）](#2-os-基线加固cis-l1)
3. [UFW 防火墙配置](#3-ufw-防火墙配置)
4. [WireGuard 内网配置](#4-wireguard-内网配置)
5. [部署 Whisper STT + Coqui TTS + Email + Home Assistant](#5-部署-whisper-stt--coqui-tts--email--home-assistant)
6. [auditd 操作审计](#6-auditd-操作审计)
7. [CIS 合规核查清单](#7-cis-合规核查清单)
8. [PCI-DSS 合规核查清单](#8-pci-dss-合规核查清单)
9. [功能测试](#9-功能测试)
10. [日常运维](#10-日常运维)
11. [故障排查](#11-故障排查)

---

## 1. 前置条件

在开始前确认：

- [ ] Ubuntu 22.04 LTS 全新安装，已完成基础系统更新
- [ ] 已分配 WireGuard 内网 IP `172.16.1.5`
- [ ] Docker 和 Docker Compose 已安装（用于运行 ML 服务容器）

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

# 允许内网访问 Whisper STT
ufw allow in from 172.16.1.0/24 to any port 8080

# 允许内网访问 Coqui TTS
ufw allow in from 172.16.1.0/24 to any port 8082

# 允许内网访问 Email 模块
ufw allow in from 172.16.1.0/24 to any port 3004

# 允许内网访问 Home Assistant
ufw allow in from 172.16.1.0/24 to any port 8123

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

# VPS D (172.16.1.4, 香港) — 固定公网 IP，CXI4 主动连接
[Peer]
PublicKey  = <VPS D 公钥>
AllowedIPs = 172.16.1.4/32
Endpoint   = <VPS D 公网IP>:51820
PersistentKeepalive = 25

# VPS E (172.16.1.6, 香港) — 固定公网 IP，CXI4 主动连接
[Peer]
PublicKey  = <VPS E 公钥>
AllowedIPs = 172.16.1.6/32
Endpoint   = <VPS E 公网IP>:51820
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
ping -c 2 172.16.1.4   # VPS D
ping -c 2 172.16.1.6   # VPS E
```

---

## 5. 部署 Whisper STT + Coqui TTS + Email + Home Assistant

CXI4 是主要算力节点（8GB RAM），以下 ML 推理与智能服务部署在此节点：

### CXI4 资源分配总览

| 服务 | mem_limit | mem_reservation | cpus | 备注 |
|------|-----------|-----------------|------|------|
| **Whisper STT** | 2g | 1g | 2.0 | ML 语音识别模型 |
| **Coqui TTS** | 768m | 384m | 1.0 | ML 语音合成模型 |
| **Email** | 192m | 64m | 0.5 | IMAP/SMTP 处理 |
| **Home Assistant** | 512m | 256m | 1.0 | 智能家居 |
| **合计** | **≈ 3.5g** | — | — | 系统预留 ≈ 4.5 GB |

### 5.1 Whisper STT（语音识别）

```bash
cd /opt/ai/modules/voice
docker compose -f docker-compose.whisper.yml up -d

# 验证（Whisper Small 模型，中文优先，10s 音频 ≈ 3s）
curl -sf http://172.16.1.5:8080/ || echo "Whisper STT 未就绪，稍候重试"
```

### 5.2 Coqui TTS（语音合成）

```bash
cd /opt/ai/modules/voice
docker compose -f docker-compose.tts.yml up -d

# 验证（中文 Baker 模型，延迟 <100ms）
curl -sf http://172.16.1.5:8082/api/tts \
  -H "Content-Type: application/json" \
  -d '{"text":"你好"}' --output /dev/null && echo "TTS OK"
```

### 5.3 Email 处理模块

```bash
cd /opt/ai/modules/email
cp .env.example .env
vim .env  # 填写 IMAP/SMTP 配置
docker compose up -d

# 验证
curl -sf http://172.16.1.5:3004/health && echo "Email OK"
```

### 5.4 Home Assistant（智能家居）

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

## 6. auditd 操作审计

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

## 7. CIS 合规核查清单

执行以下检查，确认所有项目通过：

### 7.1 操作系统加固

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

### 7.2 服务安全

```bash
echo "=== CIS 服务安全核查 ==="

# Whisper STT 仅监听内网
echo -n "[Whisper] 仅监听内网: "
ss -tlnp | grep ':8080' | grep -q '172.16.1.5\|0.0.0.0' && echo "✅ 通过" || echo "❌ 失败"

# Coqui TTS 仅监听内网
echo -n "[TTS] 仅监听内网: "
ss -tlnp | grep ':8082' | grep -q '172.16.1.5\|0.0.0.0' && echo "✅ 通过" || echo "❌ 失败"

# Email 模块仅监听内网
echo -n "[Email] 仅监听内网: "
ss -tlnp | grep ':3004' | grep -q '172.16.1.5\|0.0.0.0' && echo "✅ 通过" || echo "❌ 失败"

# Home Assistant 仅监听内网
echo -n "[HA] 仅监听内网: "
ss -tlnp | grep ':8123' | grep -q '172.16.1.5\|0.0.0.0' && echo "✅ 通过" || echo "❌ 失败"
```

### 7.3 防火墙规则

```bash
echo "=== UFW 防火墙规则核查 ==="
ufw status verbose

# 确认没有公网暴露的敏感端口
echo -n "[UFW] 8080端口仅内网: "
ufw status | grep '8080' | grep -q '172.16.1.0/24' && echo "✅ 通过" || echo "❌ 失败（请检查规则）"

echo -n "[UFW] 8082端口仅内网: "
ufw status | grep '8082' | grep -q '172.16.1.0/24' && echo "✅ 通过" || echo "❌ 失败（请检查规则）"

echo -n "[UFW] 3004端口仅内网: "
ufw status | grep '3004' | grep -q '172.16.1.0/24' && echo "✅ 通过" || echo "❌ 失败（请检查规则）"

echo -n "[UFW] 8123端口仅内网: "
ufw status | grep '8123' | grep -q '172.16.1.0/24' && echo "✅ 通过" || echo "❌ 失败（请检查规则）"
```

---

## 8. PCI-DSS 合规核查清单

```bash
echo "=== PCI-DSS 合规核查 ==="

# PCI-DSS 2.2: 系统加固
echo -n "[PCI 2.2.1] 安全配置基线（sysctl）: "
sysctl net.ipv4.tcp_syncookies | grep -q '= 1' && echo "✅ 通过" || echo "❌ 失败"

# PCI-DSS 10.4: 时间同步
echo -n "[PCI 10.4.1] NTP 时间同步: "
chronyc tracking &>/dev/null && echo "✅ 通过" || echo "❌ 失败"
```

---

## 9. 功能测试

### 9.1 Whisper STT 测试

```bash
echo "=== ML 服务功能测试 ==="

echo -n "[测试 1] Whisper STT 健康检查: "
curl -sf http://172.16.1.5:8080/ \
  && echo "✅ 通过" \
  || echo "❌ 失败（Whisper STT 未就绪）"
```

### 9.2 Coqui TTS 测试

```bash
echo -n "[测试 2] Coqui TTS 合成测试: "
curl -sf http://172.16.1.5:8082/api/tts \
  -H "Content-Type: application/json" \
  -d '{"text":"你好"}' --output /dev/null \
  && echo "✅ 通过" \
  || echo "❌ 失败（TTS 未就绪）"
```

### 9.3 Email 模块测试

```bash
echo -n "[测试 3] Email 模块健康检查: "
curl -sf http://172.16.1.5:3004/health \
  && echo "✅ 通过" \
  || echo "❌ 失败（Email 模块未就绪）"
```

### 9.4 Home Assistant 测试

```bash
echo -n "[测试 4] Home Assistant 可访问: "
curl -sf -o /dev/null -w "%{http_code}" http://172.16.1.5:8123/ | grep -q '200\|401' \
  && echo "✅ 通过" \
  || echo "❌ 失败（Home Assistant 未就绪）"
```

---

## 10. 日常运维

### 查看服务状态

```bash
# Docker 容器状态（Whisper / TTS / Email / HA）
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"

# WireGuard 隧道状态
wg show wg0
```

---

## 11. 故障排查

### Docker 容器无法启动

```bash
# 查看容器日志
docker compose logs --tail=50

# 检查资源使用
docker stats --no-stream

# 常见原因：
# 1. 内存不足 → 检查 docker stats，考虑减少并发服务
# 2. 端口被占用
ss -tlnp | grep -E '8080|8082|3004|8123'

# 3. 镜像拉取失败
docker compose pull
```

### WireGuard 隧道不通

```bash
# 检查 WireGuard 状态
wg show wg0

# 检查对端连通性
ping -c 2 172.16.1.1   # VPS A
ping -c 2 172.16.1.6   # VPS E

# 重启 WireGuard
systemctl restart wg-quick@wg0
```
