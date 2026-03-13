#!/usr/bin/env bash
# =============================================================
# Anima 灵枢 · 一键初始化脚本
# 在 CXI4 (172.16.1.5) 上执行，完成：
#   1. 安装 Node.js 20
#   2. 部署 Webhook 服务目录
#   3. 初始化数据库 Schema
#   4. 创建 systemd 服务
#   5. 验证服务运行状态
# =============================================================
set -euo pipefail

# 颜色
GREEN='\033[0;32m'; YELLOW='\033[1;33m'; RED='\033[0;31m'; NC='\033[0m'
ok()   { echo -e "${GREEN}✅ $*${NC}"; }
warn() { echo -e "${YELLOW}⚠  $*${NC}"; }
die()  { echo -e "${RED}❌ $*${NC}"; exit 1; }

# ─── 参数检查 ─────────────────────────────────────────────────
if [[ $# -lt 2 ]]; then
  cat <<'USAGE'
用法：
  bash setup.sh <animaapp数据库密码> <Redis密码> [PG主机]

示例：
  bash setup.sh 'MyDB@Pass123' 'Redis@Secret' 'anima-db.postgres.database.azure.com'
USAGE
  exit 1
fi

PG_PASSWORD="$1"
# REDIS_PASSWORD 在此接受但 Webhook 服务本身不使用 Redis（Redis 由 LibreChat/OpenClaw 直接连接）。
# 仍保留此参数以便在同一命令中记录两个密码，方便用户统一管理。
REDIS_PASSWORD="$2"
PG_HOST="${3:-anima-db.postgres.database.azure.com}"

echo "================================================="
echo " Anima 灵枢 · 初始化脚本"
echo "================================================="

# ─── 1. 安装 Node.js 20 ──────────────────────────────────────
echo ""
echo "▶ 1/5 安装 Node.js 20..."
if command -v node &>/dev/null && [[ "$(node -p 'process.versions.node.split(".")[0]')" == "20" ]]; then
  ok "Node.js 20 已安装，跳过"
else
  apt-get update -qq
  apt-get install -y ca-certificates curl gnupg
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
  ok "Node.js $(node --version) 安装完成"
fi

# ─── 2. 部署 Webhook 服务目录 ─────────────────────────────────
echo ""
echo "▶ 2/5 部署 Webhook 服务..."
WEBHOOK_DIR="/opt/ai/webhook"
mkdir -p "${WEBHOOK_DIR}"

# 复制文件（假设脚本在仓库根目录执行）
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "${SCRIPT_DIR}/.." && pwd)"

cp "${REPO_ROOT}/webhook/server.js"    "${WEBHOOK_DIR}/server.js"
cp "${REPO_ROOT}/webhook/package.json" "${WEBHOOK_DIR}/package.json"

cd "${WEBHOOK_DIR}"
npm install --omit=dev --silent
ok "Webhook 依赖安装完成"

# 创建 .env（仅在不存在时创建）
ENV_FILE="${WEBHOOK_DIR}/.env"
if [[ ! -f "${ENV_FILE}" ]]; then
  # 生成随机 ADMIN_TOKEN（32字节 = 64个十六进制字符）
  ADMIN_TOKEN_VAL="$(openssl rand -hex 32)"
  cat > "${ENV_FILE}" <<ENV
PG_HOST=${PG_HOST}
PG_PORT=5432
PG_USER=animaapp
PG_PASSWORD=${PG_PASSWORD}
PG_DATABASE=librechat
PORT=3002
HOST=172.16.1.5
LOG_LEVEL=info
# 管理员接口令牌（已自动生成，请妥善保管）
ADMIN_TOKEN=${ADMIN_TOKEN_VAL}
ENV
  chmod 600 "${ENV_FILE}"
  ok ".env 已创建（ADMIN_TOKEN 已自动生成并写入）"
  warn "请保存 ADMIN_TOKEN: ${ADMIN_TOKEN_VAL}"
else
  warn ".env 已存在，跳过（如需更新请手动编辑 ${ENV_FILE}）"
fi

# ─── 3. 初始化数据库 Schema ───────────────────────────────────
echo ""
echo "▶ 3/5 初始化数据库 Schema..."
if ! command -v psql &>/dev/null; then
  apt-get install -y postgresql-client
fi

# --quiet 抑制 CREATE TABLE / INSERT 等成功提示；ERROR 级别消息仍会输出到 stderr
PGPASSWORD="${PG_PASSWORD}" PGSSLMODE=require psql \
  --quiet \
  -h "${PG_HOST}" \
  -U animaapp \
  -d librechat \
  -f "${REPO_ROOT}/db/schema.sql" \
  -v ON_ERROR_STOP=1 \
  || die "数据库 Schema 初始化失败，请检查 PG_PASSWORD / PG_HOST 及 Azure PostgreSQL 防火墙规则"

ok "数据库 Schema 初始化完成"

# ─── 4. 创建 systemd 服务 ────────────────────────────────────
echo ""
echo "▶ 4/5 创建 systemd 服务..."
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
ok "systemd 服务已创建并启动（ai-webhook）"

# ─── 5. 验证 ──────────────────────────────────────────────────
echo ""
echo "▶ 5/5 验证服务..."
if curl -sf http://172.16.1.5:3002/health | grep -q '"db":"ok"'; then
  ok "Webhook 服务运行正常"
else
  warn "Webhook 服务可能未完全启动，查看日志："
  echo "  journalctl -u ai-webhook -n 30 --no-pager"
fi

echo ""
echo "================================================="
ok "初始化完成！"
echo ""
echo "常用命令："
echo "  状态：systemctl status ai-webhook"
echo "  日志：journalctl -u ai-webhook -f"
echo "  测试：curl http://172.16.1.5:3002/health"
echo ""
echo "下一步："
echo "  1. 部署 LibreChat（VPS C）：cd /path/to/repo/librechat && docker compose up -d"
echo "  2. 部署 OpenClaw（VPS B）：cd /path/to/repo/openclaw && docker compose up -d"
echo "  3. 配置 Nginx（VPS A）：参考 nginx/anima.conf"
echo "================================================="
