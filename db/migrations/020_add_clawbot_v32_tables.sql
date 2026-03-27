-- ============================================================
-- Migration 020: ClawBot v3.2 — 微信官方开放平台接入 / 强制认证网关 / 强隔离增强 / CIS 合规
-- ============================================================
-- #ENT-3.2-1  微信开放平台第三方授权（WeChat Open Platform Component Auth）
-- #ENT-3.2-2  强制认证网关中间件（Mandatory Auth Gateway）
-- #ENT-3.2-3  强隔离增强（Enhanced Tenant Isolation）
-- #ENT-3.2-4  Web 唯一管理面（Web-Only Management Surface）
-- #ENT-3.2-5  CIS Controls v8 合规基线（CIS Compliance Baseline）
-- ============================================================

BEGIN;

-- ── 微信开放平台配置（ENT-3.2-1）──────────────────────────────────
-- 存储微信开放平台第三方平台授权配置（仅 Web 管理面可编辑）
CREATE TABLE IF NOT EXISTS clawbot_wechat_component_config (
    id              SERIAL PRIMARY KEY,
    tenant_id       VARCHAR(64)  NOT NULL DEFAULT 'default',
    component_appid VARCHAR(64)  NOT NULL,
    component_secret VARCHAR(128),
    component_verify_ticket TEXT,
    component_access_token TEXT,
    token_expires_at TIMESTAMPTZ,
    auth_type       VARCHAR(32)  NOT NULL DEFAULT 'official_component',
    status          VARCHAR(16)  NOT NULL DEFAULT 'active',
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    created_by      VARCHAR(64)  NOT NULL DEFAULT 'admin',
    CONSTRAINT uq_component_tenant UNIQUE (tenant_id, component_appid)
);

CREATE INDEX IF NOT EXISTS idx_wcc_tenant ON clawbot_wechat_component_config (tenant_id);
CREATE INDEX IF NOT EXISTS idx_wcc_status ON clawbot_wechat_component_config (status);

-- ── 微信开放平台授权方信息（ENT-3.2-1）────────────────────────────
-- 记录通过第三方平台授权的公众号/小程序信息
CREATE TABLE IF NOT EXISTS clawbot_wechat_authorizers (
    id                   SERIAL PRIMARY KEY,
    tenant_id            VARCHAR(64)  NOT NULL DEFAULT 'default',
    component_appid      VARCHAR(64)  NOT NULL,
    authorizer_appid     VARCHAR(64)  NOT NULL,
    authorizer_name      VARCHAR(128),
    authorizer_type      VARCHAR(16)  NOT NULL DEFAULT 'mp',
    authorization_code   VARCHAR(256),
    authorizer_access_token TEXT,
    authorizer_refresh_token TEXT,
    token_expires_at     TIMESTAMPTZ,
    func_info            TEXT,
    status               VARCHAR(16)  NOT NULL DEFAULT 'active',
    authorized_at        TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_authorizer UNIQUE (tenant_id, component_appid, authorizer_appid)
);

CREATE INDEX IF NOT EXISTS idx_wa_tenant     ON clawbot_wechat_authorizers (tenant_id);
CREATE INDEX IF NOT EXISTS idx_wa_component  ON clawbot_wechat_authorizers (component_appid);
CREATE INDEX IF NOT EXISTS idx_wa_authorizer ON clawbot_wechat_authorizers (authorizer_appid);
CREATE INDEX IF NOT EXISTS idx_wa_status     ON clawbot_wechat_authorizers (status);

-- ── 强制认证会话追踪（ENT-3.2-2）──────────────────────────────────
-- 增强版认证会话，记录每次请求的认证状态
CREATE TABLE IF NOT EXISTS clawbot_auth_enforcement_log (
    id              SERIAL PRIMARY KEY,
    open_id         VARCHAR(64),
    endpoint        VARCHAR(256) NOT NULL,
    method          VARCHAR(8)   NOT NULL,
    auth_result     VARCHAR(16)  NOT NULL,
    auth_method     VARCHAR(32),
    tenant_id       VARCHAR(64)  DEFAULT 'default',
    ip_address      VARCHAR(45),
    user_agent      VARCHAR(256),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ael_openid    ON clawbot_auth_enforcement_log (open_id);
CREATE INDEX IF NOT EXISTS idx_ael_result    ON clawbot_auth_enforcement_log (auth_result);
CREATE INDEX IF NOT EXISTS idx_ael_created   ON clawbot_auth_enforcement_log (created_at);

-- ── 数据隔离边界审计（ENT-3.2-3）───────────────────────────────────
-- 记录跨租户数据访问尝试（含成功和失败）
CREATE TABLE IF NOT EXISTS clawbot_isolation_audit (
    id              SERIAL PRIMARY KEY,
    requestor_id    VARCHAR(64)  NOT NULL,
    requestor_tenant VARCHAR(64) NOT NULL DEFAULT 'default',
    target_tenant   VARCHAR(64)  NOT NULL DEFAULT 'default',
    resource_type   VARCHAR(64),
    resource_id     VARCHAR(128),
    action          VARCHAR(32)  NOT NULL,
    result          VARCHAR(16)  NOT NULL,
    boundary_key_hash VARCHAR(64),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_ia_requestor  ON clawbot_isolation_audit (requestor_id);
CREATE INDEX IF NOT EXISTS idx_ia_result     ON clawbot_isolation_audit (result);
CREATE INDEX IF NOT EXISTS idx_ia_created    ON clawbot_isolation_audit (created_at);

-- ── CIS Controls v8 合规基线追踪（ENT-3.2-5）──────────────────────
CREATE TABLE IF NOT EXISTS clawbot_cis_controls (
    id              SERIAL PRIMARY KEY,
    control_id      VARCHAR(16)  NOT NULL,
    control_name    VARCHAR(128) NOT NULL,
    category        VARCHAR(64)  NOT NULL,
    status          VARCHAR(16)  NOT NULL DEFAULT 'not_assessed',
    evidence        TEXT,
    last_assessed   TIMESTAMPTZ,
    assessed_by     VARCHAR(64),
    tenant_id       VARCHAR(64)  NOT NULL DEFAULT 'default',
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    CONSTRAINT uq_cis_control UNIQUE (tenant_id, control_id)
);

CREATE INDEX IF NOT EXISTS idx_cis_status   ON clawbot_cis_controls (status);
CREATE INDEX IF NOT EXISTS idx_cis_tenant   ON clawbot_cis_controls (tenant_id);
CREATE INDEX IF NOT EXISTS idx_cis_category ON clawbot_cis_controls (category);

COMMIT;
