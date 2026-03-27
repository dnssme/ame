-- =============================================================
-- Migration 008: ClawBot OAuth2.0 网页授权支持
-- 适配 v1.9 微信 OAuth2.0 网页授权功能
--
-- 变更：
--   1. clawbot_audit_log.action 新增 'oauth_bind' / 'oauth_state_invalid' 值
--      （无需 DDL 变更，action 列为 VARCHAR(64) 自由文本）
--   2. clawbot_users 新增 oauth_scope 列，记录用户授权方式
--
-- PCI-DSS 合规：
--   - 10.2.1  用户 OAuth 授权事件记录
--   - 6.5     CSRF state 防护审计
-- =============================================================

-- 新增 oauth_scope 列：记录用户通过何种方式完成授权
-- 'email' = 传统 /bind 邮箱绑定
-- 'snsapi_base' = OAuth 静默授权
-- 'snsapi_userinfo' = OAuth 显式授权（获取昵称头像）
ALTER TABLE clawbot_users
  ADD COLUMN IF NOT EXISTS oauth_scope VARCHAR(32) DEFAULT 'email';

-- 更新注释说明
COMMENT ON COLUMN clawbot_users.oauth_scope IS 'User authorization method: email (bind command), snsapi_base (silent OAuth), snsapi_userinfo (explicit OAuth)';
