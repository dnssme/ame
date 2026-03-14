# VPS A (172.16.1.1) 详细部署教程
## Nginx 反向代理 + ModSecurity WAF

> **节点角色**：公网唯一入口，HTTPS 终结，ModSecurity WAF，反向代理至内网各服务  
> **硬件规格**：2 核 CPU · 1 GB RAM  
> **操作系统**：Ubuntu 22.04 LTS（推荐）

---

## 目录

1. [前置条件](#1-前置条件)
2. [OS 基线加固（CIS L1）](#2-os-基线加固cis-l1)
3. [UFW 防火墙配置](#3-ufw-防火墙配置)
4. [WireGuard 内网配置](#4-wireguard-内网配置)
5. [安装 Nginx + ModSecurity + OWASP CRS](#5-安装-nginx--modsecurity--owasp-crs)
6. [申请 SSL 证书（Let's Encrypt）](#6-申请-ssl-证书lets-encrypt)
7. [部署 WAF 配置](#7-部署-waf-配置)
8. [部署 Nginx 反向代理配置](#8-部署-nginx-反向代理配置)
9. [配置证书自动续期](#9-配置证书自动续期)
10. [CIS 合规核查清单](#10-cis-合规核查清单)
11. [PCI-DSS 合规核查清单](#11-pci-dss-合规核查清单)
12. [功能测试](#12-功能测试)
13. [日常运维](#13-日常运维)
14. [故障排查](#14-故障排查)

---

## 1. 前置条件

- [ ] Ubuntu 22.04 LTS 全新安装，已完成基础系统更新
- [ ] 已分配 WireGuard 内网 IP `172.16.1.1`
- [ ] **所有内网节点已完成部署**：CXI4 + VPS B + VPS C
- [ ] 已拥有公网域名（如 `ai.example.com`），并将域名 A 记录指向 VPS A 的公网 IP
- [ ] 域名 DNS 解析已生效（`dig ai.example.com` 应返回 VPS A 公网 IP）

```bash
# 系统更新
apt-get update && apt-get upgrade -y
apt-get install -y curl wget git openssl ca-certificates gnupg lsb-release jq dnsutils

lsb_release -a

# 确认域名已解析到本机
DOMAIN="ai.example.com"   # 替换为你的域名
PUBLIC_IP=$(curl -sf https://api.ipify.org)
RESOLVED_IP=$(dig +short "${DOMAIN}" | tail -1)
echo "本机公网 IP: ${PUBLIC_IP}"
echo "域名解析 IP: ${RESOLVED_IP}"
[ "${PUBLIC_IP}" = "${RESOLVED_IP}" ] \
  && echo "✅ 域名解析正确" \
  || echo "⚠️  域名解析不匹配，请检查 DNS 记录（可能有传播延迟）"
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
# 非路由器，禁用 IP 转发
net.ipv4.ip_forward = 0
net.ipv6.conf.all.forwarding = 0
net.ipv4.conf.all.accept_redirects = 0
net.ipv4.conf.default.accept_redirects = 0
net.ipv4.conf.all.accept_source_route = 0
net.ipv4.conf.default.accept_source_route = 0
net.ipv4.conf.all.rp_filter = 1
net.ipv4.conf.default.rp_filter = 1
# SYN Flood 防护
net.ipv4.tcp_syncookies = 1
net.ipv4.icmp_echo_ignore_broadcasts = 1
# 禁用 IPv6（如不使用）
net.ipv6.conf.all.disable_ipv6 = 1
net.ipv6.conf.default.disable_ipv6 = 1
# 内核加固
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

### 2.4 fail2ban（防暴力破解 + 防扫描）

```bash
apt-get install -y fail2ban

cat > /etc/fail2ban/jail.local <<'EOF'
[DEFAULT]
bantime  = 3600
findtime = 600
maxretry = 5
backend  = systemd

[sshd]
enabled  = true
port     = 22
logpath  = %(sshd_log)s

[nginx-limit-req]
enabled  = true
port     = http,https
logpath  = /opt/nginx/logs/error.log
maxretry = 10
EOF

systemctl enable --now fail2ban
fail2ban-client status
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
# HTTP（Let's Encrypt ACME 验证 + HTTP→HTTPS 跳转）
ufw allow 80/tcp
# HTTPS（用户访问入口）
ufw allow 443/tcp
# Coqui TTS（如在 VPS A 本机运行语音合成服务，按需开启）
# ufw allow in from 172.16.1.0/24 to any port 8082
# WireGuard 接口全部放行（内网流量）
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
cat /etc/wireguard/publickey   # 记录此公钥，供其他节点添加 Peer

cat > /etc/wireguard/wg0.conf <<'EOF'
[Interface]
PrivateKey = <VPS A 私钥>
Address    = 172.16.1.1/24
ListenPort = 51820

[Peer]
# VPS B (172.16.1.2) — OpenClaw
PublicKey  = <VPS B 公钥>
AllowedIPs = 172.16.1.2/32
Endpoint   = <VPS B 公网IP>:51820
PersistentKeepalive = 25

[Peer]
# VPS C (172.16.1.3) — LibreChat
PublicKey  = <VPS C 公钥>
AllowedIPs = 172.16.1.3/32
Endpoint   = <VPS C 公网IP>:51820
PersistentKeepalive = 25

[Peer]
# CXI4 (172.16.1.5) — Webhook + Redis
PublicKey  = <CXI4 公钥>
AllowedIPs = 172.16.1.5/32
Endpoint   = <CXI4 公网IP>:51820
PersistentKeepalive = 25
EOF

chmod 600 /etc/wireguard/wg0.conf
systemctl enable --now wg-quick@wg0

# 验证所有节点连通
wg show wg0
echo "--- 内网连通性验证 ---"
ping -c 2 172.16.1.2 && echo "✅ VPS B 可达" || echo "❌ VPS B 不可达"
ping -c 2 172.16.1.3 && echo "✅ VPS C 可达" || echo "❌ VPS C 不可达"
ping -c 2 172.16.1.5 && echo "✅ CXI4 可达"  || echo "❌ CXI4 不可达"

# 验证各服务健康状态
curl -sf http://172.16.1.3:3080/health && echo "✅ LibreChat" || echo "❌ LibreChat 不可达"
curl -sf http://172.16.1.2:3000/health && echo "✅ OpenClaw"  || echo "❌ OpenClaw 不可达"
curl -sf http://172.16.1.5:3002/health && echo "✅ Webhook"   || echo "❌ Webhook 不可达"
```

---

## 5. 安装 Nginx + ModSecurity + OWASP CRS

使用自动安装脚本（编译安装 Nginx + ModSecurity v3 + OWASP CRS v4）：

```bash
# 安装路径说明：
#   · Nginx 主程序:         /opt/nginx/
#   · ModSecurity 源码:     /opt/nginx/src/ModSecurity/
#   · OWASP CRS 规则集:     /opt/owasp/owasp-rules/
#   · WAF 入口配置:         /opt/owasp/conf/main.conf
# 安装耗时约 5-15 分钟（编译过程）

wget -O /tmp/nginx-install.sh \
  https://raw.githubusercontent.com/mzwrt/system_script/refs/heads/main/nginx/nginx-install.sh
chmod +x /tmp/nginx-install.sh
bash /tmp/nginx-install.sh
```

**安装完成后验证：**

```bash
# Nginx 版本
/opt/nginx/sbin/nginx -v
# 预期：nginx version: nginx/1.xx.x

# 确认 ModSecurity 模块已编译
/opt/nginx/sbin/nginx -V 2>&1 | grep -o 'ModSecurity\|ngx_http_modsecurity'
# 预期：含 ModSecurity 字样

# 确认 Worker 进程数（双核应设为 auto）
grep -n 'worker_processes' /opt/nginx/conf/nginx.conf
# 若显示 "worker_processes 1;"，修改为 auto
sed -i 's/^worker_processes.*/worker_processes auto;/' /opt/nginx/conf/nginx.conf

# 创建 WAF 审计日志目录
mkdir -p /www/wwwlogs/owasp
chown root:root /www/wwwlogs/owasp
chmod 700 /www/wwwlogs/owasp

# 创建 ACME 验证目录（Let's Encrypt Standalone 续期需要）
mkdir -p /var/www/certbot
```

---

## 6. 申请 SSL 证书（Let's Encrypt）

```bash
DOMAIN="ai.example.com"   # ← 修改为你的真实域名

# 安装 certbot
apt-get install -y certbot

# 确认 80 端口可访问
ufw allow 80/tcp

# 申请证书（standalone 模式，Nginx 未启动时使用）
certbot certonly \
  --standalone \
  -d "${DOMAIN}" \
  --non-interactive \
  --agree-tos \
  --email "admin@example.com"   # ← 修改为你的邮箱

# 确认证书已生成
ls -la /etc/letsencrypt/live/${DOMAIN}/
# 应含：fullchain.pem  privkey.pem  chain.pem

# 确认证书有效期
openssl x509 -noout -dates -in /etc/letsencrypt/live/${DOMAIN}/fullchain.pem
```

---

## 7. 部署 WAF 配置

```bash
# 克隆仓库（如尚未克隆）
git clone https://github.com/dnssme/ame.git /opt/ai/repo
chmod 750 /opt/ai/repo

# ── 部署 ModSecurity 引擎配置 ──────────────────────────────
cp /opt/ai/repo/nginx/modsecurity/modsecurity.conf \
   /opt/nginx/src/ModSecurity/modsecurity.conf

# ── 部署 OWASP CRS 调优配置 ────────────────────────────────
cp /opt/ai/repo/nginx/modsecurity/crs-setup.conf \
   /opt/owasp/owasp-rules/crs-setup.conf

# ── 部署 WAF 入口配置 ───────────────────────────────────────
cp /opt/ai/repo/nginx/modsecurity/main.conf \
   /opt/owasp/conf/main.conf

# ── 部署应用专属排除规则 ────────────────────────────────────
cp /opt/ai/repo/nginx/modsecurity/REQUEST-900-EXCLUSION-RULES-BEFORE-CRS.conf \
   /opt/owasp/owasp-rules/rules/REQUEST-900-EXCLUSION-RULES-BEFORE-CRS.conf
cp /opt/ai/repo/nginx/modsecurity/RESPONSE-999-EXCLUSION-RULES-AFTER-CRS.conf \
   /opt/owasp/owasp-rules/rules/RESPONSE-999-EXCLUSION-RULES-AFTER-CRS.conf

# ── 设置文件权限（CIS 配置文件最小权限原则）───────────────
chmod 600 /opt/nginx/src/ModSecurity/modsecurity.conf
chmod 600 /opt/owasp/owasp-rules/crs-setup.conf
chmod 600 /opt/owasp/conf/main.conf
chown root:root /opt/nginx/src/ModSecurity/modsecurity.conf \
                /opt/owasp/owasp-rules/crs-setup.conf \
                /opt/owasp/conf/main.conf
```

> ⚠️ **首次部署建议（DetectionOnly 模式）**：
> 先将 ModSecurity 设为检测模式观察误报，确认无误后再开启拦截模式：
>
> ```bash
> # 临时切换为检测模式（仅记录不拦截）
> sed -i 's/^SecRuleEngine.*/SecRuleEngine DetectionOnly/' \
>   /opt/nginx/src/ModSecurity/modsecurity.conf
> 
> # 观察日志约 24-72 小时，确认无误报后切换为拦截模式
> sed -i 's/^SecRuleEngine.*/SecRuleEngine On/' \
>   /opt/nginx/src/ModSecurity/modsecurity.conf
> ```

---

## 8. 部署 Nginx 反向代理配置

```bash
DOMAIN="ai.example.com"   # ← 与步骤 6 相同

# 替换配置中的域名占位符
sed "s/<你的域名>/${DOMAIN}/g" /opt/ai/repo/nginx/anima.conf \
  > /opt/nginx/conf/conf.d/anima.conf

# 验证配置语法
/opt/nginx/sbin/nginx -t
# 预期输出：
#   nginx: the configuration file /opt/nginx/conf/nginx.conf syntax is ok
#   nginx: configuration file /opt/nginx/conf/nginx.conf test is successful
```

**如果报错 `unknown directive http2`（Nginx < 1.25.1）：**

```bash
# 旧版 Nginx 使用 listen 443 ssl http2 语法
sed -i 's/^\s*http2\s*on;//' /opt/nginx/conf/conf.d/anima.conf
sed -i 's/listen 443 ssl;/listen 443 ssl http2;/' /opt/nginx/conf/conf.d/anima.conf
sed -i 's/listen \[::\]:443 ssl;/listen [::]:443 ssl http2;/' /opt/nginx/conf/conf.d/anima.conf
/opt/nginx/sbin/nginx -t
```

**启动 Nginx：**

```bash
# 启动（或重载）
/opt/nginx/sbin/nginx

# 确认进程运行
ps aux | grep nginx

# 设置开机自启（创建 systemd 服务）
cat > /etc/systemd/system/nginx.service <<'EOF'
[Unit]
Description=Nginx HTTP Server (custom install)
After=network-online.target
Wants=network-online.target

[Service]
Type=forking
PIDFile=/opt/nginx/logs/nginx.pid
ExecStartPre=/opt/nginx/sbin/nginx -t
ExecStart=/opt/nginx/sbin/nginx
ExecReload=/bin/kill -s HUP $MAINPID
ExecStop=/bin/kill -s QUIT $MAINPID
PrivateTmp=true
NoNewPrivileges=true

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable nginx
```

---

## 9. 配置证书自动续期

```bash
DOMAIN="ai.example.com"

# 测试续期（不实际续期）
certbot renew --dry-run
# 预期：Congratulations, all simulated renewals succeeded.

# 配置自动续期 crontab（每天凌晨 3 点检查）
(crontab -l 2>/dev/null; \
 echo "0 3 * * * certbot renew --quiet --deploy-hook '/opt/nginx/sbin/nginx -s reload' >> /var/log/certbot-renew.log 2>&1") \
  | crontab -

# 验证 crontab
crontab -l | grep certbot
```

---

## 10. CIS 合规核查清单

```bash
echo "=== CIS 合规核查 ==="

# SSH
echo -n "[CIS 5.2.10] SSH root 禁用: "
grep '^PermitRootLogin no' /etc/ssh/sshd_config &>/dev/null && echo "✅ 通过" || echo "❌ 失败"

echo -n "[CIS 5.2.11] SSH 密码认证禁用: "
grep '^PasswordAuthentication no' /etc/ssh/sshd_config &>/dev/null && echo "✅ 通过" || echo "❌ 失败"

# 内核加固
echo -n "[CIS 3.4.x] SYN cookies: "
sysctl net.ipv4.tcp_syncookies | grep -q '= 1' && echo "✅ 通过" || echo "❌ 失败"

echo -n "[CIS 3.1.1] IP 转发禁用: "
sysctl net.ipv4.ip_forward | grep -q '= 0' && echo "✅ 通过" || echo "❌ 失败"

# Nginx 安全配置
echo -n "[CIS 13.x] Nginx 隐藏版本号: "
grep -q 'server_tokens off' /opt/nginx/conf/conf.d/anima.conf && echo "✅ 通过" || echo "❌ 失败"

echo -n "[CIS 13.x] TLS 1.2/1.3 仅: "
grep 'ssl_protocols' /opt/nginx/conf/conf.d/anima.conf | grep -q 'TLSv1.2 TLSv1.3' \
  && echo "✅ 通过" || echo "❌ 失败"

echo -n "[CIS TLS] HSTS 已启用: "
grep 'Strict-Transport-Security' /opt/nginx/conf/conf.d/anima.conf &>/dev/null \
  && echo "✅ 通过" || echo "❌ 失败"

echo -n "[CIS TLS] OCSP Stapling 已启用: "
grep -q 'ssl_stapling on' /opt/nginx/conf/conf.d/anima.conf && echo "✅ 通过" || echo "❌ 失败"

# WAF
echo -n "[PCI 6.4.1] ModSecurity WAF 已加载: "
grep 'modsecurity on' /opt/nginx/conf/conf.d/anima.conf &>/dev/null \
  && echo "✅ 通过" || echo "❌ 失败"

echo -n "[PCI 6.4.2] WAF 规则文件存在: "
[ -f /opt/owasp/conf/main.conf ] && echo "✅ 通过" || echo "❌ 失败"

echo -n "[CIS 4.x] WAF 配置文件权限 600: "
stat -c "%a" /opt/owasp/conf/main.conf | grep -q '600' && echo "✅ 通过" || echo "❌ 失败"

# 审计日志目录
echo -n "[CIS 8.x] WAF 审计日志目录权限: "
stat -c "%a" /www/wwwlogs/owasp | grep -q '700' && echo "✅ 通过" || echo "❌ 失败"

# Worker 进程数
echo -n "[CIS 4.x] Nginx worker_processes: "
grep 'worker_processes auto' /opt/nginx/conf/nginx.conf &>/dev/null \
  && echo "✅ 通过 (auto)" || echo "⚠️  建议设为 auto"

# 时间同步
echo -n "[CIS 2.1.x] NTP 时间同步: "
chronyc tracking &>/dev/null && echo "✅ 通过" || echo "❌ 失败"
```

---

## 11. PCI-DSS 合规核查清单

```bash
echo "=== PCI-DSS 合规核查 ==="
DOMAIN="ai.example.com"

# PCI-DSS 4.2.1: TLS 1.2/1.3 仅
echo -n "[PCI 4.2.1] TLS 仅 1.2/1.3: "
grep 'ssl_protocols' /opt/nginx/conf/conf.d/anima.conf | grep -q 'TLSv1.2 TLSv1.3' \
  && echo "✅ 通过" || echo "❌ 失败"

# PCI-DSS 4.2.1: HSTS
echo -n "[PCI 4.2.1] HSTS max-age ≥ 1 年: "
grep 'Strict-Transport-Security' /opt/nginx/conf/conf.d/anima.conf \
  | grep -q 'max-age=63072000\|max-age=31536000' \
  && echo "✅ 通过" || echo "⚠️  HSTS 存在但需确认 max-age 值"

# PCI-DSS 6.4.1/6.4.2: WAF 部署
echo -n "[PCI 6.4.1] WAF 部署: "
grep 'modsecurity on' /opt/nginx/conf/conf.d/anima.conf &>/dev/null \
  && echo "✅ 通过" || echo "❌ 失败"

echo -n "[PCI 6.4.2] WAF 拦截模式 (SecRuleEngine On): "
grep '^SecRuleEngine' /opt/nginx/src/ModSecurity/modsecurity.conf \
  | grep -q 'On$' \
  && echo "✅ 通过" || echo "⚠️  当前为 DetectionOnly 模式（仅检测，不拦截）"

# PCI-DSS 2.2: 版本信息隐藏
echo -n "[PCI 2.2.7] 隐藏服务版本号: "
grep -q 'server_tokens off' /opt/nginx/conf/conf.d/anima.conf \
  && echo "✅ 通过" || echo "❌ 失败"

# PCI-DSS 6.4.x: 安全响应头
echo -n "[PCI 6.4.x] X-Frame-Options: "
grep 'X-Frame-Options' /opt/nginx/conf/conf.d/anima.conf &>/dev/null \
  && echo "✅ 通过" || echo "❌ 失败"

echo -n "[PCI 6.4.x] Content-Security-Policy: "
grep 'Content-Security-Policy' /opt/nginx/conf/conf.d/anima.conf &>/dev/null \
  && echo "✅ 通过" || echo "❌ 失败"

echo -n "[PCI 6.4.x] X-Content-Type-Options: "
grep 'X-Content-Type-Options' /opt/nginx/conf/conf.d/anima.conf &>/dev/null \
  && echo "✅ 通过" || echo "❌ 失败"

# PCI-DSS 8.3.x: 速率限制
echo -n "[PCI 8.3.x] API 速率限制配置: "
grep 'limit_req_zone' /opt/nginx/conf/conf.d/anima.conf &>/dev/null \
  && echo "✅ 通过" || echo "❌ 失败"

# PCI-DSS 10.x: 日志记录
echo -n "[PCI 10.x] Nginx 访问日志已启用: "
grep -q 'access_log' /opt/nginx/conf/conf.d/anima.conf 2>/dev/null \
  || grep -q 'access_log' /opt/nginx/conf/nginx.conf \
  && echo "✅ 通过" || echo "⚠️  请确认访问日志已启用"

# PCI-DSS 10.4.1: 时间同步
echo -n "[PCI 10.4.1] NTP 时间同步: "
chronyc tracking &>/dev/null && echo "✅ 通过" || echo "❌ 失败"

# SSL 证书有效期
echo -n "[PCI 4.2.1] SSL 证书有效: "
EXPIRY=$(openssl x509 -noout -enddate \
  -in /etc/letsencrypt/live/${DOMAIN}/fullchain.pem 2>/dev/null \
  | cut -d= -f2)
[ -n "${EXPIRY}" ] \
  && echo "✅ 通过（到期：${EXPIRY}）" \
  || echo "❌ 证书文件不存在"
```

---

## 12. 功能测试

### 12.1 HTTPS 基础测试

```bash
DOMAIN="ai.example.com"
echo "=== Nginx / WAF 功能测试 ==="

# HTTPS 主页
echo -n "[测试 1] HTTPS 主页 HTTP 200: "
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://${DOMAIN}/")
[ "${HTTP_CODE}" = "200" ] && echo "✅ 通过" || echo "❌ 失败 (HTTP ${HTTP_CODE})"

# HTTP → HTTPS 301 跳转
echo -n "[测试 2] HTTP→HTTPS 301 跳转: "
HTTP_CODE=$(curl -s -o /dev/null -w "%{http_code}" "http://${DOMAIN}/")
[ "${HTTP_CODE}" = "301" ] && echo "✅ 通过" || echo "❌ 失败 (HTTP ${HTTP_CODE})"
```

### 12.2 TLS 配置测试

```bash
# TLS 版本测试（TLSv1.0/1.1 应被拒绝）
echo -n "[测试 3] TLSv1.0 被拒绝: "
openssl s_client -connect "${DOMAIN}:443" -tls1 </dev/null 2>&1 \
  | grep -qi 'handshake failure\|tlsv1 alert\|error' \
  && echo "✅ 通过（TLSv1.0 被拒绝）" \
  || echo "⚠️  TLSv1.0 可能被接受，请核查 ssl_protocols 配置"

echo -n "[测试 4] TLSv1.2 被接受: "
openssl s_client -connect "${DOMAIN}:443" -tls1_2 </dev/null 2>&1 \
  | grep -q 'Cipher is' \
  && echo "✅ 通过（TLSv1.2 正常）" \
  || echo "❌ 失败（TLSv1.2 不可用）"

echo -n "[测试 5] TLSv1.3 被接受: "
openssl s_client -connect "${DOMAIN}:443" -tls1_3 </dev/null 2>&1 \
  | grep -q 'Cipher is' \
  && echo "✅ 通过（TLSv1.3 正常）" \
  || echo "⚠️  TLSv1.3 不可用（可能由 OpenSSL 版本限制）"
```

### 12.3 安全响应头测试（PCI-DSS 6.4.x）

```bash
echo "[测试 6] 安全响应头检查:"
HEADERS=$(curl -sI "https://${DOMAIN}/")

for header in "Strict-Transport-Security" "X-Frame-Options" "X-Content-Type-Options" \
              "Content-Security-Policy" "Referrer-Policy"; do
  echo -n "  ${header}: "
  echo "${HEADERS}" | grep -qi "${header}" \
    && echo "✅ 存在 → $(echo "${HEADERS}" | grep -i "${header}" | head -1 | tr -d '\r')" \
    || echo "❌ 缺失"
done

# 确认 Server 头不含版本信息
echo -n "  Server 头（应无版本）: "
echo "${HEADERS}" | grep -i '^Server:' | grep -qi 'nginx/[0-9]' \
  && echo "❌ 失败（版本信息泄露）" \
  || echo "✅ 通过"

# 确认 X-Powered-By 已移除
echo -n "  X-Powered-By（应不存在）: "
echo "${HEADERS}" | grep -qi 'X-Powered-By' \
  && echo "❌ 失败（存在 X-Powered-By 头）" \
  || echo "✅ 通过"
```

### 12.4 WAF 功能测试（PCI-DSS 6.4.1/6.4.2）

```bash
echo "[测试 7] WAF 拦截测试（应返回 403）:"

# XSS 攻击拦截
echo -n "  XSS 攻击: "
CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  "https://${DOMAIN}/?q=<script>alert(1)</script>")
[ "${CODE}" = "403" ] && echo "✅ 通过（HTTP 403）" || echo "HTTP ${CODE}"

# SQL 注入拦截
echo -n "  SQL 注入: "
CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  "https://${DOMAIN}/?id=1' OR '1'='1")
[ "${CODE}" = "403" ] && echo "✅ 通过（HTTP 403）" || echo "HTTP ${CODE}"

# 路径遍历拦截
echo -n "  路径遍历: "
CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  "https://${DOMAIN}/?file=../../../etc/passwd")
[ "${CODE}" = "403" ] && echo "✅ 通过（HTTP 403）" || echo "HTTP ${CODE}"

# 命令注入拦截
echo -n "  命令注入: "
CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  "https://${DOMAIN}/?cmd=ls;cat%20/etc/passwd")
[ "${CODE}" = "403" ] && echo "✅ 通过（HTTP 403）" || echo "HTTP ${CODE}"

# 验证 WAF 审计日志有记录
echo -n "  WAF 审计日志写入: "
sleep 1
AUDIT_SIZE=$(wc -c < /www/wwwlogs/owasp/modsec_audit.log 2>/dev/null || echo 0)
[ "${AUDIT_SIZE}" -gt 0 ] \
  && echo "✅ 通过（日志文件大小: ${AUDIT_SIZE} bytes）" \
  || echo "⚠️  审计日志为空（检查日志路径配置）"
```

### 12.5 速率限制测试（PCI-DSS 8.3）

```bash
echo -n "[测试 8] 登录接口速率限制: "
BLOCKED=false
for i in $(seq 1 10); do
  CODE=$(curl -s -o /dev/null -w "%{http_code}" \
    -X POST "https://${DOMAIN}/api/auth/login" \
    -H "Content-Type: application/json" \
    -d '{"email":"rate@test.com","password":"wrong"}')
  if [ "${CODE}" = "429" ]; then
    BLOCKED=true
    echo "✅ 通过（第 ${i} 次触发限速 HTTP 429）"
    break
  fi
done
${BLOCKED} || echo "⚠️  未在 10 次内触发限速（检查 limit_req 配置）"
```

### 12.6 反向代理路径测试

```bash
echo "[测试 9] 反向代理路径测试:"

# LibreChat 根路径
echo -n "  / → LibreChat (172.16.1.3:3080): "
CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://${DOMAIN}/")
[ "${CODE}" = "200" ] && echo "✅ 通过" || echo "HTTP ${CODE}"

# Webhook 激活接口
echo -n "  /activate → Webhook (172.16.1.5:3002): "
CODE=$(curl -s -o /dev/null -w "%{http_code}" \
  -X POST "https://${DOMAIN}/activate" \
  -H "Content-Type: application/json" \
  -d '{"cardKey":"INVALID-TEST","userEmail":"test@test.com"}')
# 无效卡密应返回 200（业务拒绝）或 400，不应返回 502/504
[ "${CODE}" = "200" ] || [ "${CODE}" = "400" ] \
  && echo "✅ 通过（HTTP ${CODE}，Webhook 可达）" \
  || echo "HTTP ${CODE}（502/504 表示 Webhook 不可达）"
```

### 12.7 敏感路径拦截测试

```bash
echo "[测试 10] 敏感路径拦截测试（应返回 403/404）:"

# PHP 文件（应被 Nginx 直接拒绝）
echo -n "  .php 文件访问: "
CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://${DOMAIN}/shell.php")
[ "${CODE}" = "403" ] || [ "${CODE}" = "404" ] \
  && echo "✅ 通过 (HTTP ${CODE})" || echo "HTTP ${CODE}"

# 隐藏文件访问（.git/.env 等）
echo -n "  隐藏目录 .git 访问: "
CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://${DOMAIN}/.git/")
[ "${CODE}" = "403" ] || [ "${CODE}" = "404" ] \
  && echo "✅ 通过 (HTTP ${CODE})" || echo "HTTP ${CODE}"

# Admin Webhook 接口（外网不可直接访问）
echo -n "  /admin/models 外网不可访问: "
CODE=$(curl -s -o /dev/null -w "%{http_code}" "https://${DOMAIN}/admin/models")
[ "${CODE}" = "403" ] || [ "${CODE}" = "404" ] \
  && echo "✅ 通过 (HTTP ${CODE})" || echo "⚠️  HTTP ${CODE}（admin 接口可能被暴露）"
```

---

## 13. 日常运维

### Nginx 常用命令

```bash
# 测试配置
/opt/nginx/sbin/nginx -t

# 重载配置（不中断连接）
/opt/nginx/sbin/nginx -s reload

# 停止
systemctl stop nginx

# 查看进程
ps aux | grep nginx

# 查看错误日志
tail -100 /opt/nginx/logs/error.log

# 查看访问日志
tail -100 /opt/nginx/logs/access.log

# WAF 审计日志
tail -50 /www/wwwlogs/owasp/modsec_audit.log
```

### WAF 误报处理

```bash
# 查看最近触发规则
tail -200 /www/wwwlogs/owasp/modsec_audit.log | grep '"id"'

# 若合法请求被误拦截（如 AI 对话内容触发 SQLi 规则）：
# 1. 找到规则 ID（如 942100）
# 2. 在排除规则文件中添加排除：
cat >> /opt/owasp/owasp-rules/rules/REQUEST-900-EXCLUSION-RULES-BEFORE-CRS.conf <<'EOF'
# 排除 AI 对话 text 字段的 SQLi 规则（合法的 SQL 讨论文本）
SecRuleUpdateTargetById 942100 "!REQUEST_BODY:text"
SecRuleUpdateTargetById 942100 "!REQUEST_BODY:message"
EOF
/opt/nginx/sbin/nginx -s reload
```

---

## 14. 故障排查

### Nginx 配置测试失败

```bash
/opt/nginx/sbin/nginx -t

# 错误 1：unknown directive http2
# 解决：旧版 Nginx 使用 listen 443 ssl http2 而非 http2 on
sed -i 's/^\s*http2\s*on;//' /opt/nginx/conf/conf.d/anima.conf
sed -i 's/listen 443 ssl;/listen 443 ssl http2;/' /opt/nginx/conf/conf.d/anima.conf

# 错误 2：unknown directive modsecurity
# 解决：ModSecurity 模块未正确编译，重新运行安装脚本

# 错误 3：证书路径错误
ls /etc/letsencrypt/live/
```

### 代理 502/504 错误

```bash
# 检查内网连通性
ping -c 2 172.16.1.3   # LibreChat
ping -c 2 172.16.1.2   # OpenClaw
ping -c 2 172.16.1.5   # Webhook

# 检查对应服务状态
curl -sf http://172.16.1.3:3080/health
curl -sf http://172.16.1.2:3000/health
curl -sf http://172.16.1.5:3002/health

# WireGuard 状态
wg show wg0
```

### WAF 阻断了正常请求

```bash
# 临时切换为检测模式（排查期间不拦截请求）
sed -i 's/^SecRuleEngine.*/SecRuleEngine DetectionOnly/' \
  /opt/nginx/src/ModSecurity/modsecurity.conf
/opt/nginx/sbin/nginx -s reload

# 查看日志找到触发规则 ID
tail -500 /www/wwwlogs/owasp/modsec_audit.log | python3 -c "
import sys, json, re
for block in sys.stdin.read().split('---'):
    m = re.search(r'\"id\":\"(\d+)\"', block)
    if m: print(m.group(1))
" | sort | uniq -c | sort -rn

# 排查完成后恢复拦截模式
sed -i 's/^SecRuleEngine.*/SecRuleEngine On/' \
  /opt/nginx/src/ModSecurity/modsecurity.conf
/opt/nginx/sbin/nginx -s reload
```

### SSL 证书续期失败

```bash
# 手动续期测试
certbot renew --dry-run --verbose

# 确认 80 端口可达（续期需要 ACME 验证）
curl http://${DOMAIN}/.well-known/acme-challenge/test

# 确认 certbot hook 正确
certbot renew --deploy-hook '/opt/nginx/sbin/nginx -s reload'
```
