-- ============================================================================
-- Anima 灵枢 · ClawBot v2.7 – Web 管理后台会话表
-- ============================================================================
-- 为 Web 管理后台提供安全的会话管理：
--   - 管理员登录会话持久化
--   - CSRF token 关联
--   - 会话过期与审计
--
-- 合规对齐：
--   PCI-DSS 4.0  8.2.8  会话超时 ≤15 分钟空闲
--   PCI-DSS 4.0 10.2.2  审计特权用户操作
--   CIS v8       5.2    管理会话独立追踪
-- ============================================================================

BEGIN;

-- 管理后台会话表
CREATE TABLE IF NOT EXISTS clawbot_admin_sessions (
    id              SERIAL PRIMARY KEY,
    session_id      VARCHAR(128)  NOT NULL UNIQUE,       -- 随机会话 token (hex)
    csrf_token      VARCHAR(128)  NOT NULL,              -- 绑定 CSRF token
    ip_address      VARCHAR(45),                          -- 登录 IP (IPv4/IPv6)
    user_agent      TEXT,                                  -- 浏览器 UA
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    last_active_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    expires_at      TIMESTAMPTZ   NOT NULL,               -- 硬过期时间
    is_revoked      BOOLEAN       NOT NULL DEFAULT FALSE   -- 软注销标记
);

-- 索引：按 session_id 快速查找（登录校验）
CREATE INDEX IF NOT EXISTS idx_clawbot_admin_sessions_session_id
    ON clawbot_admin_sessions (session_id) WHERE is_revoked = FALSE;

-- 索引：按过期时间清理（定时任务）
CREATE INDEX IF NOT EXISTS idx_clawbot_admin_sessions_expires
    ON clawbot_admin_sessions (expires_at) WHERE is_revoked = FALSE;

-- 审计日志：记录迁移执行（PCI-DSS 10.2.2）
INSERT INTO clawbot_audit_log (open_id, action, detail, ip, request_id)
VALUES (
    'system',
    'migration_015',
    'Added clawbot_admin_sessions table for web admin dashboard (v2.7)',
    '127.0.0.1',
    'migration-015'
);

COMMIT;
