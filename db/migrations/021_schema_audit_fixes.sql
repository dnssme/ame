-- =============================================================
-- Migration 021: Schema 审计修复
-- Anima 灵枢 · 数据库质量加固
--
-- 修复内容：
--   1. billing_transactions 新增 idempotency_key 列（可 NULL，幂等保护）
--   2. api_models 新增 CHECK 约束：is_free=true 时价格必须为 0
--   3. 新增 billing_transactions(created_at DESC) 索引（时间范围查询）
--   4. 新增 api_models(is_active, is_free) 复合索引（/models 接口过滤）
--
-- 幂等：使用 IF NOT EXISTS / DO $$ 保护，可安全重复执行。
--
-- 运行方式：
--   PGPASSWORD='<密码>' PGSSLMODE=require psql \
--     -h anima-db.postgres.database.azure.com \
--     -U animaapp -d librechat \
--     -f db/migrations/021_schema_audit_fixes.sql
-- =============================================================

-- 1. billing_transactions 新增 idempotency_key 列
--    用于充值/退款等操作的幂等保护，NULL 表示非幂等操作。
ALTER TABLE billing_transactions
    ADD COLUMN IF NOT EXISTS idempotency_key VARCHAR(128);

-- 部分唯一索引：仅对非 NULL 的 idempotency_key 强制唯一（按用户隔离）
CREATE UNIQUE INDEX IF NOT EXISTS idx_billing_txn_idempotency
    ON billing_transactions(idempotency_key, user_email)
    WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN billing_transactions.idempotency_key IS
  '幂等键，防止充值/退款等操作重复执行。
   由调用方提供，相同 (user_email, idempotency_key) 的第二次请求将被忽略。
   NULL 表示非幂等操作（如 admin_adjust）。';

-- 2. api_models 新增 is_free 价格一致性约束
--    当 is_free=true 时，input/output 价格必须为 0，
--    防止管理员误配导致免费模型产生扣费。
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conrelid = 'api_models'::regclass
          AND conname = 'chk_api_models_free_price'
    ) THEN
        ALTER TABLE api_models
            ADD CONSTRAINT chk_api_models_free_price
            CHECK (NOT (is_free = true AND (price_input_per_1k_tokens > 0 OR price_output_per_1k_tokens > 0)));
    END IF;
END;
$$;

-- 3. billing_transactions(created_at DESC) 索引
--    支持跨用户的时间范围查询（如管理员按时间段查看所有流水）。
CREATE INDEX IF NOT EXISTS idx_billing_txn_created
    ON billing_transactions(created_at DESC);

-- 4. api_models(is_active, is_free) 复合索引
--    支持 /models 接口按 is_active + is_free 过滤，
--    取代原有 idx_api_models_active(is_active, provider) 的不足。
CREATE INDEX IF NOT EXISTS idx_api_models_active_free
    ON api_models(is_active, is_free);

-- 完成
SELECT 'Migration 021 完成' AS status;
