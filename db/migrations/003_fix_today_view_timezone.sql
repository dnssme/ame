-- =============================================================
-- Anima 灵枢 · 数据库补丁 — v_today_model_usage 时区修复
-- 修复：原视图使用 CURRENT_DATE（UTC），导致北京时间 00:00-08:00
--       期间统计的仍是"昨天"的数据，运营监控有 8 小时误差窗口。
--
-- 运行方式（在 schema.sql 初始化之后执行）：
--   psql -U animaapp -d librechat -f db/migrations/003_fix_today_view_timezone.sql
--
-- 或在 schema.sql 中直接替换 v_today_model_usage 视图定义。
-- =============================================================

-- 修复 v_today_model_usage：使用北京时间作为"今天"的起始时刻
CREATE OR REPLACE VIEW v_today_model_usage AS
SELECT
    am.provider,
    am.model_name,
    am.display_name,
    COUNT(*)                AS calls_today,
    SUM(au.input_tokens)    AS total_input_tokens,
    SUM(au.output_tokens)   AS total_output_tokens,
    SUM(au.charged_fen)     AS total_charged_fen
FROM api_usage au
JOIN api_models am ON am.id = au.api_model_id
WHERE au.created_at >= DATE_TRUNC('day', NOW() AT TIME ZONE 'Asia/Shanghai') AT TIME ZONE 'Asia/Shanghai'
GROUP BY am.provider, am.model_name, am.display_name;

COMMENT ON VIEW v_today_model_usage IS
  '当日（北京时间）各模型调用量汇总。使用 Asia/Shanghai 时区计算"今天"起始点，
   避免 Azure PostgreSQL 默认 UTC 时区导致北京时间午夜前 8 小时统计数据错误。';
