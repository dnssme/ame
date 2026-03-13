-- =============================================================
-- Migration 001: Add supports_cache to api_models
-- Anima 灵枢 · 智能分层计费：缓存感知定价
--
-- 功能：为支持 Prompt Caching 的模型启用分层计费折扣
-- 适用模型：gpt-4o, claude-sonnet-4-5, deepseek-chat 等
-- =============================================================

-- 1. 添加 supports_cache 列（默认 FALSE，向后兼容）
ALTER TABLE api_models
    ADD COLUMN IF NOT EXISTS supports_cache BOOLEAN NOT NULL DEFAULT false;

-- 2. 标记已知支持 Prompt Caching 的模型
UPDATE api_models SET supports_cache = TRUE
WHERE model_name IN (
    'gpt-4o',
    'gpt-4o-mini',
    'claude-sonnet-4-5',
    'claude-haiku-4-5-20251001',
    'deepseek-chat'
);
