-- =============================================================
-- Migration 004: 为 api_usage 添加幂等键，防止网络重试导致重复计费
-- Anima 灵枢 · 计费安全加固
--
-- 背景：
--   OpenClaw 调用 /billing/record 时，若因网络抖动超时重试，
--   同一笔 AI 调用可能被记录两次并重复扣费。
--   幂等键由调用方（OpenClaw）生成，格式建议为：
--     <conversation_id>:<message_id>:<model_name>
--   相同 idempotency_key 的第二次请求，webhook 服务器返回第一次的结果。
--
-- 运行方式：
--   PGPASSWORD='<密码>' PGSSLMODE=require psql \
--     -h anima-db.postgres.database.azure.com \
--     -U animaapp -d librechat \
--     -f db/migrations/004_add_idempotency.sql
--
-- 向后兼容：
--   idempotency_key 列可为 NULL（已有调用方不受影响）。
--   仅在非 NULL 时强制唯一，存量数据无需迁移。
-- =============================================================

-- 1. 添加 idempotency_key 列（可为 NULL，向后兼容）
ALTER TABLE api_usage
    ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(128);

-- 2. 创建部分唯一索引（仅对非 NULL 值生效，避免 NULL != NULL 的逻辑混淆）
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_usage_idempotency
    ON api_usage(idempotency_key)
    WHERE idempotency_key IS NOT NULL;

-- 3. 添加字段注释
COMMENT ON COLUMN api_usage.idempotency_key IS
  '调用方提供的幂等键（如 <conversation_id>:<message_id>:<model_name>），
   用于防止网络重试导致重复扣费。
   由 OpenClaw 在调用 POST /billing/record 时通过请求体传入。
   相同 key 的第二次请求，webhook 返回第一次记录的结果而不重复扣费。
   NULL 表示调用方未提供幂等键（兼容旧版 OpenClaw）。';
