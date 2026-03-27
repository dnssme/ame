-- Migration 007: ClawBot 用户记录持久化（PCI-DSS 审计 + 企业级用户管理）
--
-- 为 ClawBot 灵枢接入通道创建持久化用户记录表，用于：
--   1. 用户绑定/解绑审计追踪（PCI-DSS 10.2.1 用户活动日志）
--   2. 用户封禁/解封管理（CIS 访问控制）
--   3. 运营分析（活跃用户、用户来源、使用统计）
--
-- 此表与 Redis 配合使用：
--   Redis → 实时状态（认证、会话、速率限制）
--   PostgreSQL → 持久化记录（审计、用户档案、管理操作）

CREATE TABLE IF NOT EXISTS clawbot_users (
    id              SERIAL PRIMARY KEY,
    open_id         VARCHAR(128) NOT NULL,
    channel         VARCHAR(32)  NOT NULL DEFAULT 'wechat',  -- 'wechat' | 'wecom'
    email           VARCHAR(254),
    nickname        VARCHAR(128),
    status          VARCHAR(16)  NOT NULL DEFAULT 'active',   -- 'active' | 'blocked'
    blocked_reason  TEXT,
    bound_at        TIMESTAMPTZ,
    blocked_at      TIMESTAMPTZ,
    last_active_at  TIMESTAMPTZ  DEFAULT NOW(),
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),

    -- 每个通道内 open_id 唯一
    CONSTRAINT uq_clawbot_users_channel_openid UNIQUE (channel, open_id),
    -- status 枚举约束
    CONSTRAINT chk_clawbot_users_status CHECK (status IN ('active', 'blocked')),
    -- channel 枚举约束
    CONSTRAINT chk_clawbot_users_channel CHECK (channel IN ('wechat', 'wecom'))
);

-- 按状态检索（管理端点：查看已封禁用户）
CREATE INDEX IF NOT EXISTS idx_clawbot_users_status ON clawbot_users(status);

-- 按邮箱检索（跨通道邮箱查重）
CREATE INDEX IF NOT EXISTS idx_clawbot_users_email ON clawbot_users(email) WHERE email IS NOT NULL;

-- 按最后活跃时间排序（运营分析）
CREATE INDEX IF NOT EXISTS idx_clawbot_users_last_active ON clawbot_users(last_active_at DESC);

-- ClawBot 审计日志表（PCI-DSS 10.2）
CREATE TABLE IF NOT EXISTS clawbot_audit_log (
    id          BIGSERIAL PRIMARY KEY,
    open_id     VARCHAR(128) NOT NULL,
    channel     VARCHAR(32)  NOT NULL DEFAULT 'wechat',
    action      VARCHAR(64)  NOT NULL,  -- 'bind' | 'unbind' | 'block' | 'unblock' | 'subscribe' | 'unsubscribe' | 'export'
    detail      TEXT,
    ip          VARCHAR(45),
    request_id  VARCHAR(64),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 按用户检索审计记录
CREATE INDEX IF NOT EXISTS idx_clawbot_audit_openid ON clawbot_audit_log(open_id, created_at DESC);

-- 按操作类型检索（合规审计报告）
CREATE INDEX IF NOT EXISTS idx_clawbot_audit_action ON clawbot_audit_log(action, created_at DESC);
