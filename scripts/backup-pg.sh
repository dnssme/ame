#!/usr/bin/env bash
# =============================================================
# Anima 灵枢 · PostgreSQL 每日冷备脚本
# 部署节点：CXI4 (172.16.1.5)
#
# 功能：
#   - 备份 Azure PostgreSQL 的 librechat / openclaw / nextcloud 数据库
#   - gzip 压缩存储到本地磁盘
#   - 自动清理超过保留天数的旧备份
#   - 支持通过环境变量自定义配置
#
# 用法：
#   # 手动执行
#   bash scripts/backup-pg.sh
#
#   # 配置 cron 每日凌晨 2 点自动执行
#   0 2 * * * /opt/ai/scripts/backup-pg.sh >> /var/log/anima-backup.log 2>&1
#
# 环境变量：
#   PGHOST         - PostgreSQL 主机（默认 anima-db.postgres.database.azure.com）
#   PGUSER         - 数据库用户（默认 animaapp）
#   PGPASSWORD     - 数据库密码（必填）
#   BACKUP_DIR     - 备份目录（默认 /opt/ai/backup）
#   RETENTION_DAYS - 备份保留天数（默认 7）
#   DATABASES      - 空格分隔的数据库列表（默认包含全部三个库）
# =============================================================
set -euo pipefail

# ─── 配置（可通过环境变量覆盖）─────────────────────────────────
PGHOST="${PGHOST:-anima-db.postgres.database.azure.com}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-animaapp}"
PGSSLMODE="${PGSSLMODE:-require}"
BACKUP_DIR="${BACKUP_DIR:-/opt/ai/backup}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
# FIX Bug-1: 补充 nextcloud 数据库，三个库全量备份
DATABASES="${DATABASES:-librechat openclaw nextcloud}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"

# ─── 检查必要条件 ───────────────────────────────────────────
# PGPASSWORD 未设置时尝试从 webhook/.env 自动加载（cron 环境无 shell 变量）
if [ -z "${PGPASSWORD:-}" ]; then
  ENV_FILE="${ENV_FILE:-/opt/ai/webhook/.env}"
  if [ -f "${ENV_FILE}" ]; then
    # 使用 Python 解析 .env（比 grep+cut 更安全，正确处理引号和等号）
    PGPASSWORD="$(python3 -c "
import re, sys
with open('${ENV_FILE}') as f:
    for line in f:
        m = re.match(r'^PGPASSWORD=(.*)$', line.rstrip())
        if m:
            v = m.group(1).strip().strip(\"'\").strip('\"')
            print(v, end='')
            sys.exit(0)
" 2>/dev/null || true)"
    if [ -z "${PGPASSWORD:-}" ]; then
      PGPASSWORD="$(python3 -c "
import re, sys
with open('${ENV_FILE}') as f:
    for line in f:
        m = re.match(r'^PG_PASSWORD=(.*)$', line.rstrip())
        if m:
            v = m.group(1).strip().strip(\"'\").strip('\"')
            print(v, end='')
            sys.exit(0)
" 2>/dev/null || true)"
    fi
    [ -n "${PGPASSWORD:-}" ] && export PGPASSWORD
  fi
fi

if [ -z "${PGPASSWORD:-}" ]; then
  echo "[ERROR] $(date '+%F %T') PGPASSWORD 环境变量未设置，且无法从 ${ENV_FILE:-/opt/ai/webhook/.env} 加载" >&2
  exit 1
fi

if ! command -v pg_dump &>/dev/null; then
  echo "[ERROR] $(date '+%F %T') pg_dump 未安装，请执行: apt-get install -y postgresql-client" >&2
  exit 1
fi

# ─── 创建备份目录 ───────────────────────────────────────────
mkdir -p "${BACKUP_DIR}"

# ─── 逐库备份 ───────────────────────────────────────────────
FAIL=0
for DB in ${DATABASES}; do
  BACKUP_FILE="${BACKUP_DIR}/${DB}_${TIMESTAMP}.sql.gz"
  echo "[INFO]  $(date '+%F %T') 开始备份: ${DB} → ${BACKUP_FILE}"

  if PGPASSWORD="${PGPASSWORD}" PGSSLMODE="${PGSSLMODE}" pg_dump \
    -h "${PGHOST}" -p "${PGPORT}" -U "${PGUSER}" -d "${DB}" \
    --no-owner --no-privileges \
    | gzip > "${BACKUP_FILE}"; then
    chmod 600 "${BACKUP_FILE}"
    SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
    echo "[INFO]  $(date '+%F %T') 备份完成: ${DB} (${SIZE})"
  else
    echo "[ERROR] $(date '+%F %T') 备份失败: ${DB}" >&2
    rm -f "${BACKUP_FILE}"
    FAIL=1
  fi
done

# ─── 清理旧备份 ──────────────────────────────────────────────
echo "[INFO]  $(date '+%F %T') 清理 ${RETENTION_DAYS} 天前的旧备份..."
CLEANED=$(find "${BACKUP_DIR}" -name "*.sql.gz" -mtime +"${RETENTION_DAYS}" -print -delete | wc -l)
echo "[INFO]  $(date '+%F %T') 已清理 ${CLEANED} 个旧备份文件"

# ─── 统计 ────────────────────────────────────────────────────
TOTAL=$(find "${BACKUP_DIR}" -name "*.sql.gz" | wc -l)
TOTAL_SIZE=$(du -sh "${BACKUP_DIR}" 2>/dev/null | cut -f1)
echo "[INFO]  $(date '+%F %T') 备份目录: ${BACKUP_DIR} (${TOTAL} 个文件, ${TOTAL_SIZE})"

if [ "${FAIL}" -ne 0 ]; then
  echo "[WARN]  $(date '+%F %T') 部分数据库备份失败，请检查日志" >&2
  exit 1
fi

echo "[INFO]  $(date '+%F %T') 全部备份成功完成"
