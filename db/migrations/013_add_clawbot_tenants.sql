-- =============================================================
-- Migration 013: ClawBot v2.5 多租户隔离 + API 密钥管理
-- 适配 v2.5 企业级商业运维模式：租户级数据隔离与 API 密钥管理
--
-- 变更：
--   1. 新增 clawbot_tenants 表，支持多租户企业级隔离
--      - 每个租户拥有独立的 Redis 键命名空间
--      - 每个租户可配置独立的速率限制和功能开关
--   2. 新增 clawbot_api_keys 表，企业级 API 密钥生命周期管理
--      - 支持密钥创建 / 轮换 / 吊销
--      - 密钥使用审计追踪
--   3. 新增 clawbot_compliance_snapshots 表，合规审计快照
--      - PCI-DSS v4.0 / CIS v8 合规状态持久化
--      - 历史合规趋势追踪
--
-- PCI-DSS 合规：
--   - 3.4     静态数据保护（API 密钥散列存储）
--   - 7.1     访问控制（租户级别权限隔离）
--   - 8.2.3   密钥复杂度（最少 32 字符）
--   - 10.2.2  管理操作审计（密钥生命周期事件追踪）
--   - 10.7    日志保留（合规快照保留策略）
--
-- CIS 合规：
--   - 4.1     WAF / IDS（租户级 IP 白名单）
--   - 6.x     访问控制（租户级速率限制）
--   - 8.2     数据完整性（租户数据完全隔离）
-- =============================================================

-- 租户表（企业级多租户隔离）
CREATE TABLE IF NOT EXISTS clawbot_tenants (
    id              BIGSERIAL PRIMARY KEY,
    tenant_id       VARCHAR(64) NOT NULL UNIQUE,
    tenant_name     VARCHAR(128) NOT NULL,
    channel         VARCHAR(16) NOT NULL DEFAULT 'wechat',
    status          VARCHAR(16) NOT NULL DEFAULT 'active',
    plan            VARCHAR(32) NOT NULL DEFAULT 'free',
    rate_limit      INT NOT NULL DEFAULT 30,
    max_users       INT NOT NULL DEFAULT 100,
    features        JSONB NOT NULL DEFAULT '{}',
    contact_email   VARCHAR(256),
    ip_allowlist    TEXT DEFAULT '',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_tenant_channel CHECK (channel IN ('wechat', 'wecom')),
    CONSTRAINT chk_tenant_status CHECK (status IN ('active', 'suspended', 'archived')),
    CONSTRAINT chk_tenant_plan CHECK (plan IN ('free', 'basic', 'pro', 'enterprise')),
    CONSTRAINT chk_tenant_rate_limit CHECK (rate_limit BETWEEN 1 AND 1000)
);

-- 索引：按状态和计划筛选
CREATE INDEX IF NOT EXISTS idx_clawbot_tenants_status
    ON clawbot_tenants(status);
CREATE INDEX IF NOT EXISTS idx_clawbot_tenants_plan
    ON clawbot_tenants(plan);

-- API 密钥表（企业级密钥生命周期管理）
-- 注意：CASCADE 删除策略 — 租户删除时自动级联删除关联 API 密钥。
-- 设计决策：租户删除表示完全退出，无需保留密钥记录。
-- 审计追踪通过 clawbot_audit_log 独立保存。
CREATE TABLE IF NOT EXISTS clawbot_api_keys (
    id              BIGSERIAL PRIMARY KEY,
    tenant_id       VARCHAR(64) NOT NULL REFERENCES clawbot_tenants(tenant_id) ON DELETE CASCADE,
    key_id          VARCHAR(32) NOT NULL UNIQUE,
    key_hash        VARCHAR(128) NOT NULL,
    key_prefix      VARCHAR(8) NOT NULL,
    label           VARCHAR(128) NOT NULL DEFAULT 'default',
    scopes          JSONB NOT NULL DEFAULT '["read"]',
    status          VARCHAR(16) NOT NULL DEFAULT 'active',
    last_used_at    TIMESTAMPTZ,
    expires_at      TIMESTAMPTZ,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    revoked_at      TIMESTAMPTZ,

    CONSTRAINT chk_apikey_status CHECK (status IN ('active', 'revoked', 'expired'))
);

-- 索引：按租户查询密钥
CREATE INDEX IF NOT EXISTS idx_clawbot_api_keys_tenant
    ON clawbot_api_keys(tenant_id, status);
-- 索引：按前缀快速查找
CREATE INDEX IF NOT EXISTS idx_clawbot_api_keys_prefix
    ON clawbot_api_keys(key_prefix);

-- 合规审计快照表（PCI-DSS v4.0 / CIS v8 合规历史）
CREATE TABLE IF NOT EXISTS clawbot_compliance_snapshots (
    id              BIGSERIAL PRIMARY KEY,
    snapshot_type   VARCHAR(32) NOT NULL DEFAULT 'auto',
    pci_dss_score   SMALLINT NOT NULL DEFAULT 0,
    cis_score       SMALLINT NOT NULL DEFAULT 0,
    total_controls  SMALLINT NOT NULL DEFAULT 0,
    compliant_count SMALLINT NOT NULL DEFAULT 0,
    findings        JSONB NOT NULL DEFAULT '[]',
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_snapshot_type CHECK (snapshot_type IN ('auto', 'manual', 'scheduled'))
);

-- 索引：按时间查询快照
CREATE INDEX IF NOT EXISTS idx_clawbot_compliance_snapshots_time
    ON clawbot_compliance_snapshots(created_at DESC);

-- 更新注释
COMMENT ON TABLE clawbot_tenants IS 'ClawBot v2.5 multi-tenant isolation (PCI-DSS 7.1 / CIS 8.2)';
COMMENT ON COLUMN clawbot_tenants.tenant_id IS 'Unique tenant identifier for namespace isolation';
COMMENT ON COLUMN clawbot_tenants.features IS 'JSON object of enabled features per tenant';
COMMENT ON COLUMN clawbot_tenants.ip_allowlist IS 'Comma-separated IP list for tenant admin access';

COMMENT ON TABLE clawbot_api_keys IS 'ClawBot v2.5 API key lifecycle management (PCI-DSS 8.2.3)';
COMMENT ON COLUMN clawbot_api_keys.key_hash IS 'SHA-256 hash of the API key (PCI-DSS 3.4)';
COMMENT ON COLUMN clawbot_api_keys.key_prefix IS 'First 8 chars of key for identification without exposing full key';
COMMENT ON COLUMN clawbot_api_keys.scopes IS 'JSON array of granted scopes (read, write, admin)';

COMMENT ON TABLE clawbot_compliance_snapshots IS 'ClawBot v2.5 PCI-DSS/CIS compliance audit snapshots';
COMMENT ON COLUMN clawbot_compliance_snapshots.findings IS 'JSON array of non-compliant findings';
