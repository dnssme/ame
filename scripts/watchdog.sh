#!/usr/bin/env bash
# =============================================================
# Anima 灵枢 · Webhook 健康检查看门狗
# 监控 /health 端点，连续失败时自动重启 systemd 服务
#
# 用法：
#   bash scripts/watchdog.sh                    # 使用默认值
#   HEALTH_URL=http://172.16.1.5:3002/health \
#   SERVICE_NAME=ai-webhook \
#   MAX_FAILURES=3 \
#   CHECK_INTERVAL=30 \
#     bash scripts/watchdog.sh
#
# 建议通过 cron 或 systemd timer 运行（持续后台模式）：
#   * * * * * /opt/ai/scripts/watchdog.sh --once   # 每分钟检查一次
#   或作为守护进程持续运行（默认模式）
# =============================================================
set -euo pipefail

# ─── 配置（可通过环境变量覆盖）─────────────────────────────────
HEALTH_URL="${HEALTH_URL:-http://172.16.1.5:3002/health}"
SERVICE_NAME="${SERVICE_NAME:-ai-webhook}"
MAX_FAILURES="${MAX_FAILURES:-3}"
CHECK_INTERVAL="${CHECK_INTERVAL:-30}"
CURL_TIMEOUT="${CURL_TIMEOUT:-10}"
LOG_TAG="anima-watchdog"

# ─── 日志函数 ─────────────────────────────────────────────────
log_info()  { logger -t "${LOG_TAG}" -p user.info  "$*" 2>/dev/null || echo "[INFO]  $(date '+%Y-%m-%d %H:%M:%S') $*"; }
log_warn()  { logger -t "${LOG_TAG}" -p user.warning "$*" 2>/dev/null || echo "[WARN]  $(date '+%Y-%m-%d %H:%M:%S') $*"; }
log_error() { logger -t "${LOG_TAG}" -p user.err    "$*" 2>/dev/null || echo "[ERROR] $(date '+%Y-%m-%d %H:%M:%S') $*"; }

# ─── 健康检查函数 ─────────────────────────────────────────────
check_health() {
  local http_code
  http_code=$(curl -sf -o /dev/null -w '%{http_code}' \
    --max-time "${CURL_TIMEOUT}" \
    "${HEALTH_URL}" 2>/dev/null) || http_code="000"

  if [[ "${http_code}" == "200" ]]; then
    return 0
  else
    return 1
  fi
}

# ─── 重启服务函数 ─────────────────────────────────────────────
restart_service() {
  log_warn "${SERVICE_NAME} 连续 ${MAX_FAILURES} 次健康检查失败，正在重启..."
  if systemctl restart "${SERVICE_NAME}" 2>/dev/null; then
    log_info "${SERVICE_NAME} 重启命令已发送，等待服务恢复..."
    sleep 10
    if check_health; then
      log_info "${SERVICE_NAME} 重启成功，服务已恢复正常"
    else
      log_error "${SERVICE_NAME} 重启后仍无法通过健康检查"
    fi
  else
    log_error "${SERVICE_NAME} 重启失败，请手动检查：journalctl -u ${SERVICE_NAME} -n 50"
  fi
}

# ─── 单次检查模式（适合 cron）─────────────────────────────────
if [[ "${1:-}" == "--once" ]]; then
  FAIL_COUNT_FILE="/tmp/anima-watchdog-failures"
  fail_count=0
  if [[ -f "${FAIL_COUNT_FILE}" ]]; then
    fail_count=$(cat "${FAIL_COUNT_FILE}" 2>/dev/null || echo 0)
  fi

  if check_health; then
    echo 0 > "${FAIL_COUNT_FILE}"
    exit 0
  else
    fail_count=$((fail_count + 1))
    echo "${fail_count}" > "${FAIL_COUNT_FILE}"
    log_warn "健康检查失败 (${fail_count}/${MAX_FAILURES})"
    if [[ ${fail_count} -ge ${MAX_FAILURES} ]]; then
      restart_service
      echo 0 > "${FAIL_COUNT_FILE}"
    fi
    exit 1
  fi
fi

# ─── 持续监控模式（默认）──────────────────────────────────────
log_info "看门狗已启动：URL=${HEALTH_URL} 服务=${SERVICE_NAME} 间隔=${CHECK_INTERVAL}s 阈值=${MAX_FAILURES}"

fail_count=0

while true; do
  if check_health; then
    if [[ ${fail_count} -gt 0 ]]; then
      log_info "健康检查恢复正常（之前连续失败 ${fail_count} 次）"
    fi
    fail_count=0
  else
    fail_count=$((fail_count + 1))
    log_warn "健康检查失败 (${fail_count}/${MAX_FAILURES})"

    if [[ ${fail_count} -ge ${MAX_FAILURES} ]]; then
      restart_service
      fail_count=0
    fi
  fi

  sleep "${CHECK_INTERVAL}"
done
