-- =============================================================
-- Migration 011: ClawBot v2.3 插件生命周期日志表
-- 适配 v2.3 官方 ClawBot 插件发布后的生命周期事件追踪
--
-- 变更：
--   1. 新增 clawbot_plugin_log 表，记录插件生命周期事件
--      （activate / deactivate / update）
--   2. 索引优化：按用户 + 时间查询、按事件类型筛选
--
-- PCI-DSS 合规：
--   - 10.2.2  管理操作审计（插件激活/停用状态追踪）
--   - 10.7    日志保留策略（与审计日志保留策略一致）
--   - 3.4     静态数据保护（v2.3 会话加密记录）
--
-- CIS 合规：
--   - 8.2     数据完整性（插件生命周期状态追踪）
--   - 6.x     访问控制（插件激活状态管理）
-- =============================================================

-- 插件生命周期日志表
CREATE TABLE IF NOT EXISTS clawbot_plugin_log (
    id              BIGSERIAL PRIMARY KEY,
    open_id         VARCHAR(128) NOT NULL,
    channel         VARCHAR(16) NOT NULL DEFAULT 'wechat',
    event           VARCHAR(32) NOT NULL,
    detail          TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_plugin_log_channel CHECK (channel IN ('wechat', 'wecom')),
    CONSTRAINT chk_plugin_log_event CHECK (event IN ('activate', 'deactivate', 'update'))
);

-- 索引：按用户 + 时间查询插件生命周期
CREATE INDEX IF NOT EXISTS idx_clawbot_plugin_log_openid_created
    ON clawbot_plugin_log(open_id, created_at DESC);

-- 索引：按事件类型筛选
CREATE INDEX IF NOT EXISTS idx_clawbot_plugin_log_event
    ON clawbot_plugin_log(event);

-- 索引：按时间范围查询
CREATE INDEX IF NOT EXISTS idx_clawbot_plugin_log_created
    ON clawbot_plugin_log(created_at DESC);

-- 更新注释
COMMENT ON TABLE clawbot_plugin_log IS 'ClawBot v2.3 plugin lifecycle event log (PCI-DSS 10.2.2)';
COMMENT ON COLUMN clawbot_plugin_log.event IS 'Plugin lifecycle event: activate, deactivate, update';
COMMENT ON COLUMN clawbot_plugin_log.channel IS 'Channel: wechat or wecom';
