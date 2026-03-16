-- =============================================================
-- Migration 002: 为 api_models 添加 currency 列
-- 解决 USD/CNY 价格混存在同一列、无货币标记的问题
--
-- 运行方式：
--   psql -U animaapp -d librechat -f db/migrations/002_add_currency.sql
-- =============================================================

-- 1. 添加 currency 列（默认 'CNY' 保持向后兼容，但下方 UPDATE 会修正每个提供商）
ALTER TABLE api_models
    ADD COLUMN IF NOT EXISTS currency VARCHAR(3) NOT NULL DEFAULT 'CNY';

-- 2. 为已知使用 USD 定价的提供商更新 currency 字段
UPDATE api_models
   SET currency = 'USD'
 WHERE provider IN ('anthropic', 'openai', 'google', 'xai', 'mistral', 'cohere', 'groq', 'perplexity');

-- 3. 为已知使用 CNY 定价的提供商保持 'CNY'（已是默认值，UPDATE 仅作明确标记）
UPDATE api_models
   SET currency = 'CNY'
 WHERE provider IN ('deepseek', 'qwen', 'moonshot', 'zhipu', 'doubao', 'baidu');

-- 4. 修复两个免费的 anthropic / groq 模型（is_free=true 时 currency 不影响计费，但保持一致性）
UPDATE api_models
   SET currency = 'USD'
 WHERE model_name IN ('claude-haiku-4-5-20251001', 'llama-3.1-8b-instant');

-- 5. 本地 Qwen 模型设为 CNY，LLaMA 设为 USD
UPDATE api_models SET currency = 'CNY' WHERE model_name = 'qwen2.5:7b-instruct-q4_K_M';
UPDATE api_models SET currency = 'USD' WHERE model_name = 'llama3.2:3b';
