-- ============================================================
-- Migration 017: ClawBot v2.9 — 灵枢统一通道 / 数据边界 / 用量指标
-- ============================================================
-- #ENT-2.9-1  灵枢统一通道（Unified Lingshu Channel）
-- #ENT-2.9-3  用户数据强隔离增强（Data Boundaries）
-- #ENT-2.9-5  企业商业运维（Usage Metrics）
-- ============================================================

BEGIN;

-- ── 灵枢统一通道会话 ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clawbot_lingshu_sessions (
    id              SERIAL PRIMARY KEY,
    open_id         VARCHAR(64)  NOT NULL,
    platform        VARCHAR(32)  NOT NULL DEFAULT 'wechat',  -- wechat / wecom / miniprogram / h5 / app
    session_token   VARCHAR(128) NOT NULL,
    channel_id      VARCHAR(64),
    status          VARCHAR(16)  NOT NULL DEFAULT 'active',   -- active / expired / revoked
    connected_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    last_active_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_lingshu_sessions_openid   ON clawbot_lingshu_sessions (open_id);
CREATE INDEX IF NOT EXISTS idx_lingshu_sessions_token    ON clawbot_lingshu_sessions (session_token);
CREATE INDEX IF NOT EXISTS idx_lingshu_sessions_platform ON clawbot_lingshu_sessions (platform);
CREATE INDEX IF NOT EXISTS idx_lingshu_sessions_status   ON clawbot_lingshu_sessions (status);

-- ── 数据边界校验日志（PCI-DSS 7.1 / 10.2 审计追踪）─────────
CREATE TABLE IF NOT EXISTS clawbot_data_boundaries (
    id              SERIAL PRIMARY KEY,
    requestor_id    VARCHAR(64)  NOT NULL,
    target_id       VARCHAR(64)  NOT NULL,
    operation       VARCHAR(64)  NOT NULL,
    check_result    VARCHAR(16)  NOT NULL DEFAULT 'denied',   -- allowed / denied
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_data_boundaries_requestor ON clawbot_data_boundaries (requestor_id);
CREATE INDEX IF NOT EXISTS idx_data_boundaries_target    ON clawbot_data_boundaries (target_id);
CREATE INDEX IF NOT EXISTS idx_data_boundaries_created   ON clawbot_data_boundaries (created_at);

-- ── 用量指标（ENT-2.9-5 企业商业运维）───────────────────────
CREATE TABLE IF NOT EXISTS clawbot_usage_metrics (
    id              SERIAL PRIMARY KEY,
    tenant_id       VARCHAR(64)  NOT NULL DEFAULT 'default',
    metric_name     VARCHAR(64)  NOT NULL,
    metric_value    BIGINT       NOT NULL DEFAULT 0,
    period_start    DATE         NOT NULL DEFAULT CURRENT_DATE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ,
    UNIQUE (tenant_id, metric_name, period_start)
);

CREATE INDEX IF NOT EXISTS idx_usage_metrics_tenant ON clawbot_usage_metrics (tenant_id);
CREATE INDEX IF NOT EXISTS idx_usage_metrics_period ON clawbot_usage_metrics (period_start);
CREATE INDEX IF NOT EXISTS idx_usage_metrics_name   ON clawbot_usage_metrics (metric_name);

-- ── 数据保留策略（PCI-DSS 10.7 / GDPR）─────────────────────
-- 灵枢通道会话保留 365 天
-- 数据边界校验日志保留 365 天
-- 用量指标保留 365 天
-- （由应用层 auditCleanupTimer 统一管理）

COMMIT;
