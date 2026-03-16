# Cloudflare Tunnel 配置指南

> 隐藏源站 IP，所有流量经 Cloudflare 边缘网络中转，防止 DDoS 直连攻击

---

## 前置条件

- Cloudflare 账户（免费版即可）
- 域名已托管到 Cloudflare DNS
- VPS A (172.16.1.1) 上已部署 Nginx 反向代理

## 1. 安装 cloudflared

```bash
# Debian/Ubuntu
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
  | sudo tee /usr/share/keyrings/cloudflare-main.gpg >/dev/null
echo "deb [signed-by=/usr/share/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared $(lsb_release -cs) main" \
  | sudo tee /etc/apt/sources.list.d/cloudflared.list
sudo apt-get update && sudo apt-get install -y cloudflared
```

## 2. 登录并创建 Tunnel

```bash
# 浏览器授权（会在 ~/.cloudflared/ 生成 cert.pem）
cloudflared tunnel login

# 创建隧道
cloudflared tunnel create anima

# 记录隧道 ID（后续配置需要）
# 输出示例：Created tunnel anima with id xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
```

## 3. 配置 Tunnel

在 VPS A 上创建配置文件：

```bash
sudo mkdir -p /etc/cloudflared
sudo tee /etc/cloudflared/config.yml <<'EOF'
tunnel: <TUNNEL_ID>
credentials-file: /root/.cloudflared/<TUNNEL_ID>.json

ingress:
  # LibreChat Web UI
  - hostname: chat.yourdomain.com
    service: http://172.16.1.1:80
    originRequest:
      noTLSVerify: false

  # 其他子域名按需添加
  # - hostname: api.yourdomain.com
  #   service: http://172.16.1.1:80

  # 兜底规则（必须在最后）
  - service: http_status:404
EOF
```

> 将 `<TUNNEL_ID>` 替换为步骤 2 中的隧道 ID，`yourdomain.com` 替换为实际域名。

## 4. 配置 DNS

```bash
# 为每个域名创建 CNAME 记录指向 Tunnel
cloudflared tunnel route dns anima chat.yourdomain.com
```

## 5. 部署为 systemd 服务

```bash
sudo cloudflared service install
sudo systemctl enable --now cloudflared
```

验证：

```bash
sudo systemctl status cloudflared
curl -I https://chat.yourdomain.com
```

## 6. 安全加固

### 6.1 隐藏源站 IP

- 在 Cloudflare Dashboard → DNS 中确认所有 A/AAAA 记录的 **Proxy status** 为 🟠（已代理）
- 删除任何直接暴露 VPS IP 的 DNS 记录
- 在 VPS A 防火墙中仅允许 Cloudflare IP 段访问 80/443 端口：

```bash
# 获取 Cloudflare IP 列表
curl -s https://www.cloudflare.com/ips-v4 -o /tmp/cf-ips-v4.txt
curl -s https://www.cloudflare.com/ips-v6 -o /tmp/cf-ips-v6.txt

# UFW 规则（仅允许 Cloudflare 访问 Web 端口）
sudo ufw default deny incoming
while IFS= read -r ip; do
  sudo ufw allow from "$ip" to any port 80,443 proto tcp
done < /tmp/cf-ips-v4.txt
while IFS= read -r ip; do
  sudo ufw allow from "$ip" to any port 80,443 proto tcp
done < /tmp/cf-ips-v6.txt
sudo ufw reload
```

### 6.2 Cloudflare 安全设置（Dashboard）

| 设置 | 推荐值 | 路径 |
|------|--------|------|
| SSL/TLS 模式 | Full (Strict) | SSL/TLS → Overview |
| Minimum TLS Version | TLS 1.2 | SSL/TLS → Edge Certificates |
| Always Use HTTPS | ON | SSL/TLS → Edge Certificates |
| HTTP Strict Transport Security | 启用 (max-age=31536000) | SSL/TLS → Edge Certificates |
| Bot Fight Mode | ON | Security → Bots |
| Browser Integrity Check | ON | Security → Settings |

## 7. 验证隧道状态

```bash
# 查看隧道连接
cloudflared tunnel info anima

# 查看日志
journalctl -u cloudflared -f

# 测试连通性
curl -sf https://chat.yourdomain.com/health
```

## 8. 与现有架构集成

```
用户 → Cloudflare Edge → Tunnel → VPS A (Nginx+WAF)
                                      ↓ WireGuard
                              VPS B (OpenClaw)
                              VPS C (LibreChat)
                              CXI4  (Webhook)
```

Cloudflare Tunnel 替代了直接暴露 VPS A 的公网 IP，所有入站流量通过 Cloudflare 网络中转。内网通信（WireGuard 172.16.1.0/24）不受影响。
