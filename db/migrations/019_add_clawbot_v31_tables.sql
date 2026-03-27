-- ============================================================
-- Migration 019: ClawBot v3.1 — 微信原生登录 / 插件生命周期 / 行级安全策略 / 企业计费
-- ============================================================
-- #ENT-3.1-1  微信原生 OAuth 登录会话（WeChat Login Sessions）
-- #ENT-3.1-2  官方插件生命周期追踪（Plugin Lifecycle）
-- #ENT-3.1-4  行级安全策略追踪（RLS Policies）
-- #ENT-3.1-5  企业计费与用量计量（Billing Records）
-- ============================================================

BEGIN;

-- ── 微信原生 OAuth 登录会话（ENT-3.1-1）─────────────────────────
CREATE TABLE IF NOT EXISTS clawbot_wechat_login_sessions (
    id              SERIAL PRIMARY KEY,
    open_id         VARCHAR(64)  NOT NULL,
    union_id        VARCHAR(64),
    session_token   VARCHAR(128) NOT NULL,
    platform        VARCHAR(32)  NOT NULL DEFAULT 'wechat',
    login_method    VARCHAR(32)  NOT NULL DEFAULT 'wechat_oauth',
    scope           VARCHAR(64)  DEFAULT 'snsapi_userinfo',
    status          VARCHAR(16)  NOT NULL DEFAULT 'active',
    nickname        VARCHAR(128),
    avatar_url      VARCHAR(512),
    ip_address      VARCHAR(45),
    user_agent      VARCHAR(256),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ  NOT NULL DEFAULT (NOW() + INTERVAL '2 hours'),
    last_active_at  TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_wechat_login_openid  ON clawbot_wechat_login_sessions (open_id);
CREATE INDEX IF NOT EXISTS idx_wechat_login_token   ON clawbot_wechat_login_sessions (session_token);
CREATE INDEX IF NOT EXISTS idx_wechat_login_status  ON clawbot_wechat_login_sessions (status);

-- ── 企业计费与用量计量（ENT-3.1-5）──────────────────────────────
CREATE TABLE IF NOT EXISTS clawbot_billing_records (
    id              SERIAL PRIMARY KEY,
    tenant_id       VARCHAR(64)  NOT NULL DEFAULT 'default',
    open_id         VARCHAR(64)  NOT NULL,
    feature_id      VARCHAR(64)  NOT NULL,
    action          VARCHAR(64)  NOT NULL,
    quantity        INTEGER      NOT NULL DEFAULT 1,
    unit_cost       NUMERIC(10,4) DEFAULT 0,
    total_cost      NUMERIC(10,4) DEFAULT 0,
    currency        VARCHAR(8)   NOT NULL DEFAULT 'CNY',
    billing_period  VARCHAR(32),
    status          VARCHAR(16)  NOT NULL DEFAULT 'pending',
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    settled_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_billing_tenant   ON clawbot_billing_records (tenant_id);
CREATE INDEX IF NOT EXISTS idx_billing_openid   ON clawbot_billing_records (open_id);
CREATE INDEX IF NOT EXISTS idx_billing_period   ON clawbot_billing_records (billing_period);
CREATE INDEX IF NOT EXISTS idx_billing_status   ON clawbot_billing_records (status);

-- ── 行级安全策略追踪（ENT-3.1-4）───────────────────────────────
CREATE TABLE IF NOT EXISTS clawbot_rls_policies (
    id              SERIAL PRIMARY KEY,
    policy_name     VARCHAR(128) NOT NULL UNIQUE,
    target_table    VARCHAR(128) NOT NULL,
    tenant_id       VARCHAR(64)  NOT NULL DEFAULT 'default',
    policy_type     VARCHAR(32)  NOT NULL DEFAULT 'permissive',
    condition_expr  TEXT         NOT NULL,
    enforced        BOOLEAN      NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_rls_target_table ON clawbot_rls_policies (target_table);
CREATE INDEX IF NOT EXISTS idx_rls_tenant       ON clawbot_rls_policies (tenant_id);
CREATE INDEX IF NOT EXISTS idx_rls_enforced     ON clawbot_rls_policies (enforced);

-- ── 官方插件生命周期追踪（ENT-3.1-2）────────────────────────────
CREATE TABLE IF NOT EXISTS clawbot_plugin_lifecycle (
    id              SERIAL PRIMARY KEY,
    plugin_id       VARCHAR(64)  NOT NULL,
    open_id         VARCHAR(64)  NOT NULL,
    event_type      VARCHAR(32)  NOT NULL,
    version         VARCHAR(32),
    detail          TEXT,
    callback_url    VARCHAR(512),
    status          VARCHAR(16)  NOT NULL DEFAULT 'received',
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    processed_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_plugin_lc_plugin ON clawbot_plugin_lifecycle (plugin_id);
CREATE INDEX IF NOT EXISTS idx_plugin_lc_openid ON clawbot_plugin_lifecycle (open_id);
CREATE INDEX IF NOT EXISTS idx_plugin_lc_event  ON clawbot_plugin_lifecycle (event_type);

COMMIT;
