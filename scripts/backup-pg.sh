#!/usr/bin/env bash
# =============================================================
# Anima 灵枢 · PostgreSQL 每日冷备脚本
# 部署节点：CXI4 (172.16.1.5)
#
# 修复记录：
#   #FIX-B1  Python3 可用性检查：先尝试 python3，失败则用 grep+sed
#            兜底，确保在 python3 未安装的环境中也能正确读取密码
#   #FIX-B2  明确使用 set -euo pipefail，并增加 PGPASSWORD 来源日志
#
# 用法：
#   bash scripts/backup-pg.sh
#
#   # 配置 cron 每日凌晨 2 点自动执行
#   0 2 * * * /opt/ai/scripts/backup-pg.sh >> /var/log/anima-backup.log 2>&1
# =============================================================
set -euo pipefail

# ─── 配置（可通过环境变量覆盖）─────────────────────────────────
PGHOST="${PGHOST:-anima-db.postgres.database.azure.com}"
PGPORT="${PGPORT:-5432}"
PGUSER="${PGUSER:-animaapp}"
PGSSLMODE="${PGSSLMODE:-require}"
BACKUP_DIR="${BACKUP_DIR:-/opt/ai/backup}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
DATABASES="${DATABASES:-librechat openclaw nextcloud}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"

# ─── FIX-B1：读取 PGPASSWORD —— python3 优先，降级为 grep+sed ──
if [ -z "${PGPASSWORD:-}" ]; then
  ENV_FILE="${ENV_FILE:-/opt/ai/webhook/.env}"
  if [ -f "${ENV_FILE}" ]; then
    # 尝试 python3（最可靠：正确处理引号、等号、多行）
    if command -v python3 &>/dev/null; then
      PGPASSWORD="$(python3 -c "
import re, sys
with open('${ENV_FILE}') as f:
    for line in f:
        # 优先匹配 PGPASSWORD=，其次 PG_PASSWORD=
        for key in ('PGPASSWORD', 'PG_PASSWORD'):
            m = re.match(r'^' + key + r'=(.*)$', line.rstrip())
            if m:
                v = m.group(1).strip().strip(\"'\").strip('\"')
                print(v, end='')
                sys.exit(0)
" 2>/dev/null || true)"
    fi

    # FIX-B1 降级：python3 不可用时使用 grep+sed（不支持值中有引号的情况，但覆盖常见场景）
    if [ -z "${PGPASSWORD:-}" ]; then
      PGPASSWORD="$(grep -E '^(PGPASSWORD|PG_PASSWORD)=' "${ENV_FILE}" | head -1 | sed 's/^[^=]*=//' | sed "s/^['\"]//;s/['\"]$//" || true)"
    fi

    if [ -n "${PGPASSWORD:-}" ]; then
      export PGPASSWORD
      echo "[INFO]  $(date '+%F %T') PGPASSWORD 已从 ${ENV_FILE} 加载"
    fi
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
