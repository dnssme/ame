-- =============================================================
-- Anima 灵枢 · 数据库 Schema v5
-- 数据库: librechat (Azure PostgreSQL)
-- 设计原则：
--   · 按模型按量计费，无套餐绑定
--   · 每个 API 模型独立定价（管理员可随时添加/修改价格）
--   · 标记为 is_free=true 的模型永久免费
--   · 本地 Ollama 模型保留条目但默认 is_active=false
--   · v5: 按 Token 计费（Tiktoken），替代按字符计费
-- =============================================================

-- ─── 启用必要扩展 ──────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";       -- gen_random_uuid(), gen_random_bytes()
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements"; -- 慢查询监控

-- =============================================================
-- 1. API 模型定价表（核心：管理员按模型设价，用户自选）
-- =============================================================
CREATE TABLE IF NOT EXISTS api_models (
    id           SERIAL       PRIMARY KEY,
    provider     VARCHAR(32)  NOT NULL,            -- 'anthropic' | 'openai' | 'mistral' | 'ollama' 等
    model_name   VARCHAR(128) NOT NULL UNIQUE,     -- API 中使用的模型标识符
    display_name VARCHAR(128) NOT NULL,            -- 界面显示名称
    -- 定价（元/1000 Token）；is_free=true 时忽略这两个字段
    -- v5: 改为按 Token 计费（对齐上游 API 定价），旧按字符计费列保留兼容
    is_free                    BOOLEAN      NOT NULL DEFAULT false,
    price_input_per_1k_tokens  NUMERIC(10,6) NOT NULL DEFAULT 0 CHECK (price_input_per_1k_tokens >= 0),
    price_output_per_1k_tokens NUMERIC(10,6) NOT NULL DEFAULT 0 CHECK (price_output_per_1k_tokens >= 0),
    -- 是否启用（false = 仅保留接口定义，用户不可选）
    is_active    BOOLEAN      NOT NULL DEFAULT true,
    description  TEXT,                             -- 管理员备注
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_models_active
    ON api_models(is_active, provider);

-- 预置模型（管理员可在运行时通过 POST /admin/models 增加更多）
INSERT INTO api_models
    (provider, model_name, display_name, is_free,
     price_input_per_1k_tokens, price_output_per_1k_tokens, is_active, description)
VALUES
    -- ── 免费模型 ──────────────────────────────────────────────
    ('anthropic', 'claude-haiku-4-5-20251001', 'Claude Haiku 4.5',
     true, 0, 0, true, '免费模型'),

    -- ── 付费模型（价格由管理员自行定义，以下仅为示例占位）─
    ('anthropic', 'claude-sonnet-4-5',         'Claude Sonnet 4.5',
     false, 0.0030, 0.0150, true, '付费模型，请在部署后按实际成本调整价格（元/1000 Token）'),
    ('openai',    'gpt-4o-mini',               'GPT-4o Mini',
     false, 0.000150, 0.000600, true, '付费模型，请在部署后按实际成本调整价格（元/1000 Token）'),
    ('openai',    'gpt-4o',                    'GPT-4o',
     false, 0.0025, 0.0100, true, '付费模型，请在部署后按实际成本调整价格（元/1000 Token）'),
    ('mistral',   'mistral-small-latest',      'Mistral Small',
     false, 0.000200, 0.000600, true, '付费模型，请在部署后按实际成本调整价格（元/1000 Token）'),

    -- ── 本地模型（保留接口，默认不启用）─────────────────────
    ('ollama', 'qwen2.5:7b-instruct-q4_K_M', 'Qwen 2.5 7B (本地)',
     true, 0, 0, false, '本地 Ollama 模型，保留接口定义，如需启用请设 is_active=true'),
    ('ollama', 'llama3.2:3b',                'LLaMA 3.2 3B (本地)',
     true, 0, 0, false, '本地 Ollama 模型，保留接口定义')
ON CONFLICT (model_name) DO NOTHING;

-- =============================================================
-- 2. 用户账户表（纯余额，无套餐绑定）
-- =============================================================
CREATE TABLE IF NOT EXISTS user_billing (
    id                BIGSERIAL    PRIMARY KEY,
    -- LibreChat 用户邮箱（外部关联，无 FK 保证解耦）
    user_email        VARCHAR(254) NOT NULL UNIQUE,
    -- 余额（分），预付费模式
    balance_fen       NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (balance_fen >= 0),
    -- 累计消费（分），仅统计用
    total_charged_fen NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total_charged_fen >= 0),
    -- 账户状态（管理员可暂停）
    is_suspended      BOOLEAN       NOT NULL DEFAULT false,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_billing_email
    ON user_billing(user_email);

-- =============================================================
-- 3. 充值卡密表（纯充值卡，无套餐绑定）
-- =============================================================
CREATE TABLE IF NOT EXISTS recharge_cards (
    id          BIGSERIAL     PRIMARY KEY,
    key         VARCHAR(64)   NOT NULL UNIQUE,
    -- 充值金额（分）
    credit_fen  NUMERIC(12,2) NOT NULL CHECK (credit_fen > 0),
    -- 管理员备注（如 "¥20 新用户体验包"）
    label       VARCHAR(128),
    used        BOOLEAN       NOT NULL DEFAULT false,
    used_at     TIMESTAMPTZ,
    used_by     VARCHAR(254),
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recharge_cards_key
    ON recharge_cards(key);
CREATE INDEX IF NOT EXISTS idx_recharge_cards_unused
    ON recharge_cards(used) WHERE used = false;

-- 示例充值卡（生产环境请删除）
INSERT INTO recharge_cards (key, credit_fen, label)
VALUES
    ('ANIMA-TOP20-DEMO', 2000, '¥20 演示充值卡'),
    ('ANIMA-TOP50-DEMO', 5000, '¥50 演示充值卡')
ON CONFLICT (key) DO NOTHING;

-- =============================================================
-- 4. API 调用记录（计费核心）
-- =============================================================
CREATE TABLE IF NOT EXISTS api_usage (
    id              BIGSERIAL     PRIMARY KEY,
    user_email      VARCHAR(254)  NOT NULL,
    -- 关联模型（NULL = 早期兜底记录或模型已被删除）
    api_model_id    INT           REFERENCES api_models(id) ON DELETE SET NULL,
    api_provider    VARCHAR(32)   NOT NULL,
    model_name      VARCHAR(128)  NOT NULL,
    is_free         BOOLEAN       NOT NULL, -- 本次调用是否免费
    -- Token 统计（v5: 使用 Tiktoken 计数，对齐上游 API 定价）
    input_tokens    INT           NOT NULL DEFAULT 0,
    output_tokens   INT           NOT NULL DEFAULT 0,
    -- 本次计费金额（分），0 = 免费
    charged_fen     NUMERIC(10,4) NOT NULL DEFAULT 0,
    -- 状态
    status          VARCHAR(16)   NOT NULL DEFAULT 'ok', -- 'ok' | 'error'
    error_msg       TEXT,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_usage_user_date
    ON api_usage(user_email, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_api_usage_model
    ON api_usage(api_model_id, created_at DESC);

-- =============================================================
-- 5. 充值/扣费流水
-- =============================================================
CREATE TABLE IF NOT EXISTS billing_transactions (
    id                BIGSERIAL     PRIMARY KEY,
    user_email        VARCHAR(254)  NOT NULL,
    type              VARCHAR(16)   NOT NULL CHECK (type IN ('charge','recharge','refund','admin_adjust')),
    amount_fen        NUMERIC(12,4) NOT NULL,
    balance_after_fen NUMERIC(12,2) NOT NULL CHECK (balance_after_fen >= 0),
    description       TEXT,
    ref_id            VARCHAR(128), -- api_usage.id 或 recharge_cards.key
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_txn_user
    ON billing_transactions(user_email, created_at DESC);

-- =============================================================
-- 6. 触发器：自动更新 updated_at
-- =============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_billing_updated ON user_billing;
CREATE TRIGGER trg_user_billing_updated
    BEFORE UPDATE ON user_billing
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_api_models_updated ON api_models;
CREATE TRIGGER trg_api_models_updated
    BEFORE UPDATE ON api_models
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================
-- 7. 辅助视图
-- =============================================================

-- 7-A. 用户账户余额概览
CREATE OR REPLACE VIEW v_user_balance AS
SELECT
    user_email,
    balance_fen,
    total_charged_fen,
    is_suspended,
    created_at
FROM user_billing;

-- 7-B. 当日各模型调用量汇总（用于监控 / 运营）
CREATE OR REPLACE VIEW v_today_model_usage AS
SELECT
    am.provider,
    am.model_name,
    am.display_name,
    COUNT(*)                AS calls_today,
    SUM(au.input_tokens)    AS total_input_tokens,
    SUM(au.output_tokens)   AS total_output_tokens,
    SUM(au.charged_fen)     AS total_charged_fen
FROM api_usage au
JOIN api_models am ON am.id = au.api_model_id
WHERE au.created_at >= CURRENT_DATE
GROUP BY am.provider, am.model_name, am.display_name;

-- =============================================================
-- 8. 最小权限角色（安全加固：服务专用角色）
-- =============================================================

-- 8-A. billing_svc：Webhook 计费服务专用角色
-- 仅可操作计费相关表，不可修改 schema
-- ⚠️ 部署时请通过 ALTER ROLE billing_svc PASSWORD 'xxx' 替换占位密码
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'billing_svc') THEN
    CREATE ROLE billing_svc LOGIN PASSWORD 'CHANGE_ME_billing';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE librechat TO billing_svc;
GRANT USAGE ON SCHEMA public TO billing_svc;
GRANT SELECT, INSERT, UPDATE ON TABLE user_billing, recharge_cards, api_usage, billing_transactions TO billing_svc;
GRANT SELECT ON TABLE api_models TO billing_svc;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO billing_svc;

-- 8-B. agent_svc：OpenClaw Agent 服务专用角色
-- 仅可读取模型列表和写入用量记录，不可操作余额或卡密
-- ⚠️ 部署时请通过 ALTER ROLE agent_svc PASSWORD 'xxx' 替换占位密码
DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'agent_svc') THEN
    CREATE ROLE agent_svc LOGIN PASSWORD 'CHANGE_ME_agent';
  END IF;
END
$$;

GRANT CONNECT ON DATABASE librechat TO agent_svc;
GRANT USAGE ON SCHEMA public TO agent_svc;
GRANT SELECT ON TABLE api_models TO agent_svc;
GRANT SELECT, INSERT ON TABLE api_usage TO agent_svc;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO agent_svc;

-- =============================================================
-- 完成
-- =============================================================
