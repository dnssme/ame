-- =============================================================
-- Migration 010: ClawBot v2.2 群发消息完成回调日志表
-- 适配 v2.2 MASSSENDJOBFINISH 事件回调
--
-- 变更：
--   1. 新增 clawbot_broadcast_log 表，记录群发消息完成回调
--   2. 索引优化：按消息 ID 和状态查询
--
-- PCI-DSS 合规：
--   - 10.2.2  管理操作审计（群发消息完成状态追踪）
--   - 10.7    日志保留策略（与审计日志保留策略一致）
--
-- CIS 合规：
--   - 8.2     数据完整性（群发送达状态追踪）
-- =============================================================

-- 群发消息完成回调日志表
CREATE TABLE IF NOT EXISTS clawbot_broadcast_log (
    id              BIGSERIAL PRIMARY KEY,
    msg_id          BIGINT,
    status          VARCHAR(16) DEFAULT 'unknown',
    total_count     INT DEFAULT 0,
    filter_count    INT DEFAULT 0,
    sent_count      INT DEFAULT 0,
    error_count     INT DEFAULT 0,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_broadcast_log_status CHECK (status IN ('success', 'failed', 'unknown'))
);

-- 索引：按消息 ID 查询群发状态
CREATE INDEX IF NOT EXISTS idx_clawbot_broadcast_log_msgid
    ON clawbot_broadcast_log(msg_id);

-- 索引：按状态筛选失败记录
CREATE INDEX IF NOT EXISTS idx_clawbot_broadcast_log_status
    ON clawbot_broadcast_log(status)
    WHERE status = 'failed';

-- 索引：按时间范围查询
CREATE INDEX IF NOT EXISTS idx_clawbot_broadcast_log_created
    ON clawbot_broadcast_log(created_at DESC);

-- 更新注释
COMMENT ON TABLE clawbot_broadcast_log IS 'ClawBot v2.2 broadcast message completion callback log (PCI-DSS 10.2.2)';
COMMENT ON COLUMN clawbot_broadcast_log.status IS 'Broadcast delivery status: success, failed, unknown';
