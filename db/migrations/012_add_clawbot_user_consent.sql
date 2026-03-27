-- =============================================================
-- Migration 012: ClawBot v2.4 用户同意记录 + 用户设置表
-- 适配 v2.4 合规增强：用户隐私同意跟踪 + 个性化设置
--
-- 变更：
--   1. 新增 clawbot_user_consent 表，记录用户隐私同意状态
--      （data_processing / privacy_policy / terms_of_service）
--   2. 新增 clawbot_user_settings 表，存储用户个性化偏好
--   3. 索引优化：按用户 + 同意类型查询
--
-- PCI-DSS 合规：
--   - 3.4     静态数据保护（用户同意状态持久化）
--   - 7.1     访问控制（同意状态影响功能可用性）
--   - 10.2.2  管理操作审计（同意变更追踪）
--
-- CIS 合规：
--   - 8.2     数据完整性（用户同意状态不可篡改）
--   - 14.x    隐私保护（合规同意管理）
-- =============================================================

-- 用户隐私同意记录表
CREATE TABLE IF NOT EXISTS clawbot_user_consent (
    id              BIGSERIAL PRIMARY KEY,
    open_id         VARCHAR(128) NOT NULL,
    channel         VARCHAR(16) NOT NULL DEFAULT 'wechat',
    consent_type    VARCHAR(64) NOT NULL,
    consent_version VARCHAR(32) NOT NULL DEFAULT '1.0',
    granted         BOOLEAN NOT NULL DEFAULT FALSE,
    granted_at      TIMESTAMPTZ,
    revoked_at      TIMESTAMPTZ,
    ip              VARCHAR(45),
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_consent_channel CHECK (channel IN ('wechat', 'wecom')),
    CONSTRAINT chk_consent_type CHECK (consent_type IN (
        'data_processing', 'privacy_policy', 'terms_of_service'
    )),
    CONSTRAINT uq_user_consent UNIQUE (channel, open_id, consent_type)
);

-- 索引：按用户查询同意状态
CREATE INDEX IF NOT EXISTS idx_clawbot_user_consent_openid
    ON clawbot_user_consent(open_id, channel);

-- 索引：按同意类型筛选
CREATE INDEX IF NOT EXISTS idx_clawbot_user_consent_type
    ON clawbot_user_consent(consent_type, granted);

-- 用户设置表（个性化偏好）
CREATE TABLE IF NOT EXISTS clawbot_user_settings (
    id              BIGSERIAL PRIMARY KEY,
    open_id         VARCHAR(128) NOT NULL,
    channel         VARCHAR(16) NOT NULL DEFAULT 'wechat',
    language        VARCHAR(8) NOT NULL DEFAULT 'zh',
    notify_template BOOLEAN NOT NULL DEFAULT TRUE,
    notify_broadcast BOOLEAN NOT NULL DEFAULT TRUE,
    auto_tts        BOOLEAN NOT NULL DEFAULT FALSE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_settings_channel CHECK (channel IN ('wechat', 'wecom')),
    CONSTRAINT chk_settings_language CHECK (language IN ('zh', 'en')),
    CONSTRAINT uq_user_settings UNIQUE (channel, open_id)
);

-- 索引：按用户查询设置
CREATE INDEX IF NOT EXISTS idx_clawbot_user_settings_openid
    ON clawbot_user_settings(open_id, channel);

-- 更新注释
COMMENT ON TABLE clawbot_user_consent IS 'ClawBot v2.4 user consent tracking (PCI-DSS 7.1 / GDPR)';
COMMENT ON COLUMN clawbot_user_consent.consent_type IS 'Consent type: data_processing, privacy_policy, terms_of_service';
COMMENT ON COLUMN clawbot_user_consent.consent_version IS 'Version of the consent policy accepted';
COMMENT ON COLUMN clawbot_user_consent.granted IS 'Whether consent was granted (true) or revoked (false)';

COMMENT ON TABLE clawbot_user_settings IS 'ClawBot v2.4 per-user settings and preferences';
COMMENT ON COLUMN clawbot_user_settings.language IS 'User preferred language: zh or en';
COMMENT ON COLUMN clawbot_user_settings.notify_template IS 'Whether to receive template message notifications';
COMMENT ON COLUMN clawbot_user_settings.auto_tts IS 'Whether to automatically convert text replies to voice';
