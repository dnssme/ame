-- =============================================================
-- Migration 009: ClawBot v2.1 模板消息日志表
-- 适配 v2.1 模板消息发送功能
--
-- 变更：
--   1. 新增 clawbot_template_log 表，记录模板消息发送历史
--   2. 索引优化：按用户 + 时间范围查询
--
-- PCI-DSS 合规：
--   - 10.2.2  管理操作审计（模板消息发送记录）
--   - 10.7    日志保留策略（与审计日志保留策略一致）
--
-- CIS 合规：
--   - 8.2     数据完整性（发送状态追踪）
-- =============================================================

-- 模板消息发送日志表
CREATE TABLE IF NOT EXISTS clawbot_template_log (
    id              BIGSERIAL PRIMARY KEY,
    open_id         VARCHAR(128) NOT NULL,
    channel         VARCHAR(32) DEFAULT 'wechat',
    template_id     VARCHAR(128) NOT NULL,
    msgid           BIGINT,
    status          VARCHAR(16) DEFAULT 'sent',
    detail          TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_template_log_status CHECK (status IN ('sent', 'failed', 'delivered')),
    CONSTRAINT chk_template_log_channel CHECK (channel IN ('wechat', 'wecom'))
);

-- 索引：按用户查询模板消息历史
CREATE INDEX IF NOT EXISTS idx_clawbot_template_log_openid
    ON clawbot_template_log(open_id, created_at DESC);

-- 索引：按模板 ID 查询发送统计
CREATE INDEX IF NOT EXISTS idx_clawbot_template_log_template
    ON clawbot_template_log(template_id, created_at DESC);

-- 索引：按状态筛选
CREATE INDEX IF NOT EXISTS idx_clawbot_template_log_status
    ON clawbot_template_log(status)
    WHERE status = 'failed';

-- 更新注释
COMMENT ON TABLE clawbot_template_log IS 'ClawBot v2.1 template message send log (PCI-DSS 10.2.2)';
COMMENT ON COLUMN clawbot_template_log.status IS 'Message delivery status: sent, failed, delivered';
