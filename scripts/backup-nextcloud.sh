#!/usr/bin/env bash
# =============================================================
# Anima 灵枢 · Nextcloud 文件卷每日冷备
# 部署节点：VPS D (172.16.1.4)
#
# 功能：将 nextcloud_files Docker 卷打包压缩为 tar.gz，
#       保留最近 N 天备份，超期自动删除。
#
# 用法：
#   bash scripts/backup-nextcloud.sh
#
# 配置 cron（在 VPS D 上执行，与 PostgreSQL 冷备错开 30 分钟）：
#   30 2 * * * /opt/ai/scripts/backup-nextcloud.sh >> /var/log/anima-backup-nc.log 2>&1
#
# 注意：
#   · 备份期间 Nextcloud 保持运行，使用只读挂载降低风险
#   · 若需严格一致性备份，建议先将 Nextcloud 切换为维护模式：
#     docker exec -u www-data anima-nextcloud php occ maintenance:mode --on
#     ... 备份 ...
#     docker exec -u www-data anima-nextcloud php occ maintenance:mode --off
# =============================================================
set -euo pipefail

# ─── 配置（可通过环境变量覆盖）─────────────────────────────────
BACKUP_DIR="${BACKUP_DIR:-/opt/ai/backup}"
RETENTION_DAYS="${RETENTION_DAYS:-7}"
VOLUME_NAME="${VOLUME_NAME:-nextcloud_files}"
TIMESTAMP="$(date +%Y%m%d_%H%M%S)"
BACKUP_FILE="${BACKUP_DIR}/${VOLUME_NAME}_${TIMESTAMP}.tar.gz"

echo "[INFO]  $(date '+%F %T') ── Nextcloud 文件卷备份开始 ──────────────────"

# ─── 前置检查 ────────────────────────────────────────────────
if ! command -v docker &>/dev/null; then
  echo "[ERROR] $(date '+%F %T') docker 未安装或不在 PATH 中" >&2
  exit 1
fi

if ! docker volume inspect "${VOLUME_NAME}" &>/dev/null; then
  echo "[ERROR] $(date '+%F %T') Docker 卷 '${VOLUME_NAME}' 不存在，请确认 Nextcloud 已部署" >&2
  exit 1
fi

# ─── 创建备份目录 ────────────────────────────────────────────
mkdir -p "${BACKUP_DIR}"

# ─── 执行备份 ────────────────────────────────────────────────
echo "[INFO]  $(date '+%F %T') 开始备份卷: ${VOLUME_NAME} → ${BACKUP_FILE}"

if docker run --rm \
    -v "${VOLUME_NAME}":/source:ro \
    -v "${BACKUP_DIR}":/backup \
    alpine tar czf "/backup/${VOLUME_NAME}_${TIMESTAMP}.tar.gz" \
      -C /source .; then
  chmod 600 "${BACKUP_FILE}"
  SIZE=$(du -h "${BACKUP_FILE}" | cut -f1)
  echo "[INFO]  $(date '+%F %T') 备份完成 (${SIZE}): ${BACKUP_FILE}"
else
  echo "[ERROR] $(date '+%F %T') 备份失败，清理不完整文件" >&2
  rm -f "${BACKUP_FILE}"
  exit 1
fi

# ─── 清理超期旧备份 ──────────────────────────────────────────
echo "[INFO]  $(date '+%F %T') 清理 ${RETENTION_DAYS} 天前的旧备份..."
CLEANED=$(find "${BACKUP_DIR}" \
    -name "${VOLUME_NAME}_*.tar.gz" \
    -mtime +"${RETENTION_DAYS}" \
    -print -delete | wc -l)
echo "[INFO]  $(date '+%F %T') 已清理 ${CLEANED} 个旧备份文件"

# ─── 统计 ────────────────────────────────────────────────────
TOTAL=$(find "${BACKUP_DIR}" -name "${VOLUME_NAME}_*.tar.gz" | wc -l)
TOTAL_SIZE=$(du -sh "${BACKUP_DIR}" 2>/dev/null | cut -f1)
echo "[INFO]  $(date '+%F %T') 备份目录: ${BACKUP_DIR} (${TOTAL} 个文件卷备份, 总大小 ${TOTAL_SIZE})"
echo "[INFO]  $(date '+%F %T') ── Nextcloud 文件卷备份完成 ──────────────────"
