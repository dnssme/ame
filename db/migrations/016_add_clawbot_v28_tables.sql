-- ============================================================
-- Migration 016: ClawBot v2.8 — 客服系统 / 内容生命周期 / 订阅消息
-- ============================================================
-- #ENT-2.8-1  完整客服系统
-- #ENT-2.8-2  内容生命周期管理
-- #ENT-2.8-3  订阅消息管理
-- ============================================================

BEGIN;

-- ── 客服账号管理 ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clawbot_kf_accounts (
    id            SERIAL PRIMARY KEY,
    kf_account    VARCHAR(64)  NOT NULL UNIQUE,
    nickname      VARCHAR(32)  NOT NULL,
    status        VARCHAR(16)  NOT NULL DEFAULT 'active',  -- active / deleted
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_kf_accounts_status ON clawbot_kf_accounts (status);

-- ── 客服会话查询日志（PCI-DSS 10.2 审计追踪）────────────────
CREATE TABLE IF NOT EXISTS clawbot_kf_sessions (
    id            SERIAL PRIMARY KEY,
    query_type    VARCHAR(32)  NOT NULL,   -- waitcase / session / record
    result_count  INTEGER      NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_kf_sessions_created ON clawbot_kf_sessions (created_at);

-- ── 草稿管理 ────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clawbot_drafts (
    id            SERIAL PRIMARY KEY,
    media_id      VARCHAR(128) NOT NULL,
    article_count INTEGER      NOT NULL DEFAULT 1,
    status        VARCHAR(16)  NOT NULL DEFAULT 'draft',  -- draft / published / deleted
    publish_id    VARCHAR(128),
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_drafts_status   ON clawbot_drafts (status);
CREATE INDEX IF NOT EXISTS idx_drafts_media_id ON clawbot_drafts (media_id);

-- ── 评论管理日志（PCI-DSS 10.2 审计追踪）────────────────────
CREATE TABLE IF NOT EXISTS clawbot_comment_log (
    id              SERIAL PRIMARY KEY,
    msg_data_id     VARCHAR(128) NOT NULL,
    comment_id      VARCHAR(64)  NOT NULL,
    action          VARCHAR(16)  NOT NULL,  -- reply / delete / mark_elect
    content         TEXT,
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_comment_log_article ON clawbot_comment_log (msg_data_id);
CREATE INDEX IF NOT EXISTS idx_comment_log_created ON clawbot_comment_log (created_at);

-- ── 订阅消息发送记录 ────────────────────────────────────────
CREATE TABLE IF NOT EXISTS clawbot_subscription_messages (
    id            SERIAL PRIMARY KEY,
    open_id       VARCHAR(64)  NOT NULL,
    template_id   VARCHAR(128) NOT NULL,
    status        VARCHAR(16)  NOT NULL DEFAULT 'sent',  -- sent / delivered / failed
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_sub_msg_openid  ON clawbot_subscription_messages (open_id);
CREATE INDEX IF NOT EXISTS idx_sub_msg_created ON clawbot_subscription_messages (created_at);

-- ── 数据保留策略（PCI-DSS 10.7 / GDPR）─────────────────────
-- 客服会话日志保留 365 天
-- 评论日志保留 365 天
-- 订阅消息记录保留 365 天
-- （由应用层 auditCleanupTimer 统一管理）

COMMIT;
