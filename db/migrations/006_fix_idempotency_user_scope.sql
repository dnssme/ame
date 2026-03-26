-- Migration 006: 幂等键唯一索引改为 (idempotency_key, user_email) 复合索引
-- FIX-5.12-3: 防止不同用户使用相同 idempotency_key 时发生跨用户碰撞
--
-- 原索引仅按 idempotency_key 全局唯一，虽然概率极低但理论上
-- 两个不同用户使用相同 key 会导致其中一个 INSERT 被忽略，
-- 计费请求被静默丢弃。改为按 (key, user_email) 复合唯一后，
-- 每个用户独立使用自己的幂等键空间。

-- 1. 删除旧的全局唯一索引
DROP INDEX IF EXISTS idx_api_usage_idempotency;

-- 2. 创建新的复合唯一索引（按用户隔离）
CREATE UNIQUE INDEX idx_api_usage_idempotency
    ON api_usage(idempotency_key, user_email)
    WHERE idempotency_key IS NOT NULL;
