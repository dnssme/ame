-- =============================================================
-- Migration 005: v5.3 增量迁移
-- 适用于：已完成 schema.sql v5.2 部署的现有环境
-- 新部署请直接使用 db/schema.sql v5.3，无需执行此迁移文件。
--
-- 变更内容：
--   1. 新增 api_providers 表（数据库统一 provider 配置）
--   2. 修复 billing_transactions.amount_fen 约束（禁止零金额）
--   3. 修复 v_user_balance 视图（移除内部时间戳暴露）
--   4. 新增 api_providers updated_at 触发器
--
-- 运行方式：
--   PGPASSWORD='<密码>' PGSSLMODE=require psql \
--     -h anima-db.postgres.database.azure.com \
--     -U animaapp -d librechat \
--     -f db/migrations/005_add_api_providers.sql
-- =============================================================

-- 1. 新增 api_providers 表
CREATE TABLE IF NOT EXISTS api_providers (
    id            SERIAL       PRIMARY KEY,
    provider_name VARCHAR(32)  NOT NULL UNIQUE,
    display_name  VARCHAR(64)  NOT NULL,
    base_url      VARCHAR(256) NOT NULL,
    is_enabled    BOOLEAN      NOT NULL DEFAULT true,
    description   TEXT,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_providers_enabled
    ON api_providers(is_enabled, provider_name);

-- 2. 预置 provider 配置（仅对新表生效，已存在则跳过）
INSERT INTO api_providers (provider_name, display_name, base_url, is_enabled, description)
VALUES
    ('anthropic',   'Anthropic / Claude',    'https://api.anthropic.com/v1',                                   true,  'Claude 系列'),
    ('openai',      'OpenAI / GPT',          'https://api.openai.com/v1',                                      true,  'GPT / o 系列'),
    ('google',      'Google / Gemini',       'https://generativelanguage.googleapis.com/v1beta/openai',         true,  'Gemini 系列'),
    ('xai',         'xAI / Grok',            'https://api.x.ai/v1',                                            true,  'Grok 系列'),
    ('mistral',     'Mistral AI',            'https://api.mistral.ai/v1',                                      true,  NULL),
    ('cohere',      'Cohere / Command R',    'https://api.cohere.com/compatibility/openai',                    true,  NULL),
    ('groq',        'Groq（超高速推理）',      'https://api.groq.com/openai/v1',                                 true,  NULL),
    ('perplexity',  'Perplexity（联网搜索）', 'https://api.perplexity.ai',                                      true,  NULL),
    ('deepseek',    'DeepSeek（深度求索）',   'https://api.deepseek.com/v1',                                    true,  NULL),
    ('qwen',        'Qwen 通义千问（阿里）',  'https://dashscope.aliyuncs.com/compatible-mode/v1',              true,  NULL),
    ('moonshot',    'Moonshot / Kimi',       'https://api.moonshot.cn/v1',                                     true,  NULL),
    ('zhipu',       'Zhipu AI / GLM（智谱）', 'https://open.bigmodel.cn/api/paas/v4',                           true,  NULL),
    ('doubao',      '豆包（字节跳动火山方舟）', 'https://ark.cn-beijing.volces.com/api/v3',                      true,  NULL),
    ('baidu',       'ERNIE 文心一言（百度）',  'https://qianfan.baidubce.com/v2',                               true,  NULL),
    ('ollama',      'Ollama（本地）',         'http://172.16.1.5:11434/v1',                                     false, '本地 Ollama，默认不启用')
ON CONFLICT (provider_name) DO NOTHING;

-- 3. 为 api_providers 添加 updated_at 触发器
DROP TRIGGER IF EXISTS trg_api_providers_updated ON api_providers;
CREATE TRIGGER trg_api_providers_updated
    BEFORE UPDATE ON api_providers
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- 4. 修复 billing_transactions.amount_fen 约束
--    PostgreSQL 不支持直接修改 CHECK 约束，需要删除旧约束后添加新约束。
--    注意：此操作需要短暂的表锁，建议在低峰期执行。
DO $$
DECLARE
    constraint_name TEXT;
BEGIN
    -- 查找现有 amount_fen 相关约束（如有）
    SELECT conname INTO constraint_name
    FROM pg_constraint
    WHERE conrelid = 'billing_transactions'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) LIKE '%amount_fen%';

    -- 若存在旧约束且不含 != 0，则删除重建
    IF constraint_name IS NOT NULL THEN
        EXECUTE format('ALTER TABLE billing_transactions DROP CONSTRAINT %I', constraint_name);
    END IF;
END;
$$;

-- 添加包含非零检查的新约束
ALTER TABLE billing_transactions
    ADD CONSTRAINT billing_transactions_amount_fen_check
    CHECK (amount_fen != 0);

-- 5. 修复 v_user_balance 视图（移除 created_at，防止内部时间戳泄露）
CREATE OR REPLACE VIEW v_user_balance AS
SELECT
    user_email,
    balance_fen,
    total_charged_fen,
    is_suspended
FROM user_billing;

-- 6. 授予新表权限
GRANT SELECT ON TABLE api_providers TO billing_svc;
GRANT SELECT ON TABLE api_providers TO agent_svc;

-- 完成
SELECT 'Migration 005 完成' AS status;
