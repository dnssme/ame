-- =============================================================
-- Anima 灵枢 · 数据库 Schema
-- 数据库: librechat (Azure PostgreSQL)
-- 包含：用户订阅、卡密、API 计费、每日配额
-- =============================================================

-- ─── 启用必要扩展 ──────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";   -- gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements"; -- 慢查询监控

-- =============================================================
-- 1. 订阅套餐定义
-- =============================================================
CREATE TABLE IF NOT EXISTS subscription_plans (
    id           SERIAL PRIMARY KEY,
    name         VARCHAR(32)  NOT NULL UNIQUE, -- 'free' | 'basic' | 'pro'
    display_name VARCHAR(64)  NOT NULL,
    -- 每日免费调用次数（针对付费云端 API）
    daily_free_calls INT NOT NULL DEFAULT 20,
    -- 超出免费额度后的定价（分/1000字）
    price_input_per_1k_chars  NUMERIC(10,4) NOT NULL DEFAULT 0,  -- 输入价格
    price_output_per_1k_chars NUMERIC(10,4) NOT NULL DEFAULT 0,  -- 输出价格
    -- 月度余额上限（分），0 = 不限
    monthly_credit_limit NUMERIC(12,2) NOT NULL DEFAULT 0,
    is_active    BOOLEAN NOT NULL DEFAULT true,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 内置套餐数据
INSERT INTO subscription_plans
    (name, display_name, daily_free_calls,
     price_input_per_1k_chars, price_output_per_1k_chars,
     monthly_credit_limit)
VALUES
    ('free',  '免费版', 20, 0,      0,      0),      -- 每日 20 次付费 API 免费
    ('basic', '基础版', 20, 0.0100, 0.0200, 10000), -- ¥0.01/1k 输入，¥0.02/1k 输出，月限 ¥100
    ('pro',   '专业版', 20, 0.0080, 0.0160, 50000)  -- 专业折扣，月限 ¥500
ON CONFLICT (name) DO NOTHING;

-- =============================================================
-- 2. 用户扩展表（在 LibreChat users 表基础上扩展）
-- =============================================================
CREATE TABLE IF NOT EXISTS user_billing (
    id                  BIGSERIAL    PRIMARY KEY,
    -- LibreChat user email（外部关联，无 FK 保证解耦）
    user_email          VARCHAR(254) NOT NULL UNIQUE,
    subscription_plan   VARCHAR(32)  NOT NULL DEFAULT 'free'
                            REFERENCES subscription_plans(name),
    subscription_expiry TIMESTAMPTZ,        -- NULL = 永久（免费版）
    -- 余额（分），预付费模式
    balance_fen         NUMERIC(12,2) NOT NULL DEFAULT 0,
    -- 总消费统计（分）
    total_charged_fen   NUMERIC(12,2) NOT NULL DEFAULT 0,
    -- 账户状态
    is_suspended        BOOLEAN NOT NULL DEFAULT false,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_billing_email
    ON user_billing(user_email);

-- =============================================================
-- 3. 卡密表
-- =============================================================
CREATE TABLE IF NOT EXISTS subscription_cards (
    id          BIGSERIAL    PRIMARY KEY,
    key         VARCHAR(64)  NOT NULL UNIQUE,
    plan        VARCHAR(32)  NOT NULL REFERENCES subscription_plans(name),
    -- 有效天数（激活后计算到期时间）
    valid_days  INT          NOT NULL DEFAULT 30,
    -- 充值余额（分），0 = 纯套餐卡
    credit_fen  NUMERIC(12,2) NOT NULL DEFAULT 0,
    used        BOOLEAN      NOT NULL DEFAULT false,
    used_at     TIMESTAMPTZ,
    used_by     VARCHAR(254),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_cards_key ON subscription_cards(key);

-- 初始化示例卡密（生产环境请删除或更换）
INSERT INTO subscription_cards (key, plan, valid_days, credit_fen)
VALUES
    ('ANIMA-BASIC-DEMO-0001', 'basic', 30, 2000),  -- ¥20 余额
    ('ANIMA-PRO-DEMO-0001',   'pro',   30, 5000)   -- ¥50 余额
ON CONFLICT (key) DO NOTHING;

-- =============================================================
-- 4. API 调用记录（计费核心）
-- =============================================================
CREATE TABLE IF NOT EXISTS api_usage (
    id              BIGSERIAL    PRIMARY KEY,
    user_email      VARCHAR(254) NOT NULL,
    -- 调用信息
    api_provider    VARCHAR(32)  NOT NULL, -- 'ollama' | 'anthropic' | 'mistral' | 'openai'
    model_name      VARCHAR(128) NOT NULL,
    is_free_model   BOOLEAN      NOT NULL, -- true = 本地/免费模型，不计费
    -- 字数统计
    input_chars     INT          NOT NULL DEFAULT 0,
    output_chars    INT          NOT NULL DEFAULT 0,
    -- 是否消耗每日免费额度
    used_daily_free BOOLEAN      NOT NULL DEFAULT false,
    -- 本次计费金额（分），0 = 免费
    charged_fen     NUMERIC(10,4) NOT NULL DEFAULT 0,
    -- 状态
    status          VARCHAR(16)  NOT NULL DEFAULT 'ok', -- 'ok' | 'quota_exceeded' | 'error'
    error_msg       TEXT,
    -- 时间
    created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

-- 高频查询索引
CREATE INDEX IF NOT EXISTS idx_api_usage_user_date
    ON api_usage(user_email, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_api_usage_daily
    ON api_usage(user_email, (created_at::date), is_free_model);

-- =============================================================
-- 5. 每日配额缓存表（避免每次查 api_usage 全表计数）
-- =============================================================
CREATE TABLE IF NOT EXISTS daily_quota (
    user_email  VARCHAR(254) NOT NULL,
    quota_date  DATE         NOT NULL DEFAULT CURRENT_DATE,
    paid_calls  INT          NOT NULL DEFAULT 0, -- 当日付费API调用次数
    PRIMARY KEY (user_email, quota_date)
);

CREATE INDEX IF NOT EXISTS idx_daily_quota_lookup
    ON daily_quota(user_email, quota_date);

-- =============================================================
-- 6. 充值/扣费流水
-- =============================================================
CREATE TABLE IF NOT EXISTS billing_transactions (
    id          BIGSERIAL    PRIMARY KEY,
    user_email  VARCHAR(254) NOT NULL,
    type        VARCHAR(16)  NOT NULL, -- 'charge' | 'recharge' | 'refund'
    amount_fen  NUMERIC(12,4) NOT NULL,
    balance_after_fen NUMERIC(12,2) NOT NULL,
    description TEXT,
    ref_id      VARCHAR(128), -- 关联 api_usage.id 或 subscription_cards.key
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_transactions_user
    ON billing_transactions(user_email, created_at DESC);

-- =============================================================
-- 7. 触发器：自动更新 user_billing.updated_at
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

-- =============================================================
-- 8. 辅助视图：用户今日使用概览
-- =============================================================
CREATE OR REPLACE VIEW v_user_today_usage AS
SELECT
    ub.user_email,
    ub.subscription_plan,
    ub.balance_fen,
    ub.is_suspended,
    sp.daily_free_calls,
    sp.price_input_per_1k_chars,
    sp.price_output_per_1k_chars,
    COALESCE(dq.paid_calls, 0)            AS today_paid_calls,
    GREATEST(0, sp.daily_free_calls
               - COALESCE(dq.paid_calls, 0)) AS remaining_free_calls
FROM user_billing ub
JOIN subscription_plans sp ON sp.name = ub.subscription_plan
LEFT JOIN daily_quota dq
    ON dq.user_email = ub.user_email
   AND dq.quota_date = CURRENT_DATE;

COMMENT ON VIEW v_user_today_usage IS
    '实时查询用户当日剩余免费次数，供 webhook 计费逻辑使用';

-- =============================================================
-- 完成
-- =============================================================
