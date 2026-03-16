#!/usr/bin/env bash
# =============================================================
# Anima 灵枢 · auditd 操作审计统一配置
# 适用节点：全部（VPS A/B/C/D + CXI4）
#
# 功能：
#   - 安装 auditd 并配置审计规则
#   - 监控 Docker 操作、敏感文件访问、提权行为
#   - 满足 PCI-DSS 10.1 / 10.2 / 10.5 要求
#
# 用法：
#   sudo bash scripts/audit-setup.sh
#
# 规则说明：
#   - docker_cmd    : Docker 命令执行
#   - secrets_access: .env / 密钥文件访问
#   - privilege_escalation: sudo / su 提权
#   - user_accounts : 用户账户变更
#   - firewall_changes: 防火墙规则变更
#   - cron_changes  : 定时任务变更
#   - sshd_config   : SSH 配置变更
# =============================================================
set -euo pipefail

echo "[INFO] $(date '+%F %T') 安装 auditd..."
apt-get update -qq
apt-get install -y -qq auditd audispd-plugins

echo "[INFO] $(date '+%F %T') 写入审计规则..."
cat > /etc/audit/rules.d/anima.rules <<'EOF'
# =============================================================
# Anima 灵枢 · auditd 审计规则
# PCI-DSS 10.1 / 10.2 合规
# =============================================================

# ─── Docker 容器操作 ─────────────────────────────────────────
-w /usr/bin/docker -p x -k docker_cmd
-w /usr/bin/containerd -p x -k container_runtime

# ─── 敏感文件访问 ────────────────────────────────────────────
-w /opt/ai/ -p wa -k anima_config

# ─── 用户认证与账户变更 ──────────────────────────────────────
-w /etc/passwd -p wa -k user_accounts
-w /etc/shadow -p rwa -k user_passwords
-w /etc/group -p wa -k user_accounts

# ─── SSH 配置变更 ────────────────────────────────────────────
-w /etc/ssh/sshd_config -p wa -k sshd_config

# ─── 提权操作 ────────────────────────────────────────────────
-w /usr/bin/sudo -p x -k privilege_escalation
-w /usr/bin/su -p x -k privilege_escalation

# ─── 防火墙变更 ──────────────────────────────────────────────
-w /usr/sbin/ufw -p x -k firewall_changes
-w /usr/sbin/iptables -p x -k firewall_changes

# ─── 定时任务变更 ────────────────────────────────────────────
-w /etc/crontab -p wa -k cron_changes
-w /etc/cron.d/ -p wa -k cron_changes
-w /var/spool/cron/ -p wa -k cron_changes

# ─── WireGuard VPN 配置 ──────────────────────────────────────
-w /etc/wireguard/ -p wa -k vpn_config
EOF

echo "[INFO] $(date '+%F %T') 加载审计规则..."
systemctl enable --now auditd
augenrules --load

RULE_COUNT=$(auditctl -l 2>/dev/null | wc -l)
echo "[INFO] $(date '+%F %T') auditd 已启动，已加载 ${RULE_COUNT} 条规则"
echo "[INFO] $(date '+%F %T') 查看审计日志: ausearch -ts today"
echo "[INFO] $(date '+%F %T') 搜索可疑操作: ausearch -k privilege_escalation -ts today"
