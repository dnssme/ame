-- ============================================================
-- Migration 018: ClawBot v3.0 — 自助接入 / 统一登录 / 功能门户 / 租户密钥 / 运维告警
-- ============================================================
-- #ENT-3.0-1  用户自助接入门户（Onboarding Progress）
-- #ENT-3.0-2  统一登录网关（Auth Sessions）
-- #ENT-3.0-4  租户级加密命名空间（Tenant Keys）
-- #ENT-3.0-6  企业运维增强（Ops Alerts）
-- ============================================================

BEGIN;

-- ── 用户自助接入进度（ENT-3.0-1）───────────────────────────────
CREATE TABLE IF NOT EXISTS clawbot_onboarding_progress (
    id              SERIAL PRIMARY KEY,
    open_id         VARCHAR(64)  NOT NULL UNIQUE,
    current_step    VARCHAR(32)  NOT NULL DEFAULT 'register',
    status          VARCHAR(16)  NOT NULL DEFAULT 'in_progress',
    detail          TEXT,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_onboarding_openid ON clawbot_onboarding_progress (open_id);
CREATE INDEX IF NOT EXISTS idx_onboarding_status ON clawbot_onboarding_progress (status);

-- ── 统一登录会话（ENT-3.0-2 PCI-DSS 8.2）───────────────────────
CREATE TABLE IF NOT EXISTS clawbot_auth_sessions (
    id              SERIAL PRIMARY KEY,
    open_id         VARCHAR(64)  NOT NULL,
    session_token   VARCHAR(128) NOT NULL,
    platform        VARCHAR(32)  NOT NULL DEFAULT 'wechat',
    status          VARCHAR(16)  NOT NULL DEFAULT 'active',
    ip_address      VARCHAR(45),
    user_agent      VARCHAR(256),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ  NOT NULL DEFAULT (NOW() + INTERVAL '2 hours'),
    last_active_at  TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_auth_session_token ON clawbot_auth_sessions (session_token);
CREATE INDEX IF NOT EXISTS idx_auth_session_openid ON clawbot_auth_sessions (open_id);
CREATE INDEX IF NOT EXISTS idx_auth_session_status ON clawbot_auth_sessions (status);

-- ── 租户级加密密钥（ENT-3.0-4 PCI-DSS 3.5 + 7.1）───────────────
CREATE TABLE IF NOT EXISTS clawbot_tenant_keys (
    id              SERIAL PRIMARY KEY,
    tenant_id       VARCHAR(64)  NOT NULL,
    key_hash        VARCHAR(128) NOT NULL,
    purpose         VARCHAR(64)  NOT NULL DEFAULT 'data_encryption',
    status          VARCHAR(16)  NOT NULL DEFAULT 'active',
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    rotated_at      TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_tenant_keys_tenant ON clawbot_tenant_keys (tenant_id);
CREATE INDEX IF NOT EXISTS idx_tenant_keys_status ON clawbot_tenant_keys (status);

-- ── 运维告警（ENT-3.0-6 企业运维增强）───────────────────────────
CREATE TABLE IF NOT EXISTS clawbot_ops_alerts (
    id              SERIAL PRIMARY KEY,
    alert_id        VARCHAR(32)  NOT NULL UNIQUE,
    tenant_id       VARCHAR(64)  NOT NULL DEFAULT 'default',
    alert_type      VARCHAR(64)  NOT NULL,
    severity        VARCHAR(16)  NOT NULL DEFAULT 'warning',
    message         TEXT,
    status          VARCHAR(16)  NOT NULL DEFAULT 'active',
    threshold_value NUMERIC,
    current_value   NUMERIC,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    resolved_at     TIMESTAMPTZ,
    updated_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_ops_alerts_tenant ON clawbot_ops_alerts (tenant_id);
CREATE INDEX IF NOT EXISTS idx_ops_alerts_status ON clawbot_ops_alerts (status);
CREATE INDEX IF NOT EXISTS idx_ops_alerts_severity ON clawbot_ops_alerts (severity);

COMMIT;
