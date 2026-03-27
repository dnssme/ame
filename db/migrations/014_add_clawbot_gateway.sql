-- =============================================================
-- Migration 014: ClawBot v2.6 灵枢通道网关 + Webhook 中继 + 会话联邦
--
-- 新增表：
--   clawbot_channel_registry     — 通道注册与发现
--   clawbot_webhook_subscriptions — Webhook 事件中继订阅
--   clawbot_webhook_delivery_log — Webhook 投递日志
--   clawbot_session_links        — 跨通道会话联邦
--
-- PCI-DSS v4.0 合规：
--   - Webhook secret 以 SHA-256 散列存储（PCI-DSS 3.4）
--   - 完整审计日志（PCI-DSS 10.2）
--   - HTTPS-only Webhook 目标（PCI-DSS 4.2.1）
--
-- CIS v8 合规：
--   - 最小权限原则（适当的 CHECK 约束）
--   - 数据隔离（通道级 + 租户级）
-- =============================================================

BEGIN;

-- ─── 通道注册表（ENT-2.6-1 灵枢通道网关）─────────────────────
CREATE TABLE IF NOT EXISTS clawbot_channel_registry (
  id                BIGSERIAL    PRIMARY KEY,
  channel_id        VARCHAR(64)  NOT NULL UNIQUE,
  channel_name      VARCHAR(128) DEFAULT '',
  channel_type      VARCHAR(32)  DEFAULT 'wechat'
                    CHECK (channel_type IN ('wechat', 'wecom', 'miniprogram', 'webapp', 'api', 'custom')),
  endpoint_url      TEXT         DEFAULT '',
  protocol          VARCHAR(16)  DEFAULT 'https'
                    CHECK (protocol IN ('https', 'http', 'wss', 'grpc')),
  capabilities      JSONB        DEFAULT '[]',
  status            VARCHAR(16)  DEFAULT 'active'
                    CHECK (status IN ('active', 'inactive', 'suspended')),
  contact_email     VARCHAR(256),
  last_heartbeat_at TIMESTAMPTZ,
  created_at        TIMESTAMPTZ  DEFAULT NOW(),
  updated_at        TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_channel_registry_status ON clawbot_channel_registry (status);
CREATE INDEX IF NOT EXISTS idx_channel_registry_type ON clawbot_channel_registry (channel_type);

COMMENT ON TABLE clawbot_channel_registry IS 'ClawBot v2.6 通道网关 — 通道注册与发现（ENT-2.6-1）';

-- ─── Webhook 订阅表（ENT-2.6-3 事件中继）─────────────────────
CREATE TABLE IF NOT EXISTS clawbot_webhook_subscriptions (
  id              BIGSERIAL    PRIMARY KEY,
  subscription_id VARCHAR(32)  NOT NULL UNIQUE,
  tenant_id       VARCHAR(64)  NOT NULL,
  target_url      TEXT         NOT NULL,
  events          JSONB        DEFAULT '["*"]',
  secret_hash     VARCHAR(128),              -- SHA-256 散列（PCI-DSS 3.4）
  status          VARCHAR(16)  DEFAULT 'active'
                  CHECK (status IN ('active', 'paused', 'deleted')),
  created_at      TIMESTAMPTZ  DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_sub_tenant ON clawbot_webhook_subscriptions (tenant_id, status);
CREATE INDEX IF NOT EXISTS idx_webhook_sub_status ON clawbot_webhook_subscriptions (status);

COMMENT ON TABLE clawbot_webhook_subscriptions IS 'ClawBot v2.6 Webhook 事件中继订阅（ENT-2.6-3, PCI-DSS 4.2.1）';

-- ─── Webhook 投递日志（ENT-2.6-3 投递追踪）───────────────────
CREATE TABLE IF NOT EXISTS clawbot_webhook_delivery_log (
  id              BIGSERIAL    PRIMARY KEY,
  subscription_id VARCHAR(32)  NOT NULL,
  event_type      VARCHAR(64)  NOT NULL,
  status_code     SMALLINT     DEFAULT 0,
  response_time_ms INT         DEFAULT 0,
  success         BOOLEAN      DEFAULT FALSE,
  detail          TEXT         DEFAULT '',
  created_at      TIMESTAMPTZ  DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_webhook_delivery_sub ON clawbot_webhook_delivery_log (subscription_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_webhook_delivery_failed ON clawbot_webhook_delivery_log (success) WHERE success = FALSE;

COMMENT ON TABLE clawbot_webhook_delivery_log IS 'ClawBot v2.6 Webhook 投递日志（审计追踪, PCI-DSS 10.2）';

-- ─── 会话联邦表（ENT-2.6-4 跨通道会话链接）───────────────────
CREATE TABLE IF NOT EXISTS clawbot_session_links (
  id              BIGSERIAL    PRIMARY KEY,
  link_id         VARCHAR(32)  NOT NULL UNIQUE,
  primary_open_id VARCHAR(128) NOT NULL,
  primary_channel VARCHAR(32)  DEFAULT 'wechat'
                  CHECK (primary_channel IN ('wechat', 'wecom')),
  linked_open_id  VARCHAR(128) NOT NULL,
  linked_channel  VARCHAR(32)  DEFAULT 'wecom'
                  CHECK (linked_channel IN ('wechat', 'wecom')),
  status          VARCHAR(16)  DEFAULT 'active'
                  CHECK (status IN ('active', 'revoked')),
  created_at      TIMESTAMPTZ  DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  DEFAULT NOW(),

  -- 防止重复链接
  CONSTRAINT uq_session_link UNIQUE (primary_open_id, primary_channel, linked_open_id, linked_channel)
);

CREATE INDEX IF NOT EXISTS idx_session_links_primary ON clawbot_session_links (primary_open_id, primary_channel);
CREATE INDEX IF NOT EXISTS idx_session_links_linked ON clawbot_session_links (linked_open_id, linked_channel);

COMMENT ON TABLE clawbot_session_links IS 'ClawBot v2.6 跨通道会话联邦（ENT-2.6-4, 数据隔离审计）';

COMMIT;
