-- =============================================================
-- Anima 灵枢 · 数据库 Schema v5.2
-- 数据库: librechat (Azure PostgreSQL)
-- 变更记录（v5.2）：
--   · 将 Migration 004 (idempotency_key) 合并进基础 Schema，
--     确保新部署无需额外执行迁移文件即可具备幂等计费防护。
--     新增 api_usage.idempotency_key VARCHAR(128)（可 NULL，向后兼容）
--     新增部分唯一索引 idx_api_usage_idempotency（仅对非 NULL 值生效）
-- 变更记录（v5.1）：
--   · BUG-NEW-2：v_today_model_usage 视图改用上海时区
--   · BUG-NEW-5：api_usage.input_tokens/output_tokens 改为 BIGINT
-- =============================================================

-- ─── 启用必要扩展 ──────────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_stat_statements";

-- =============================================================
-- 1. API 模型定价表
-- =============================================================
CREATE TABLE IF NOT EXISTS api_models (
    id           SERIAL       PRIMARY KEY,
    provider     VARCHAR(32)  NOT NULL,
    model_name   VARCHAR(128) NOT NULL UNIQUE,
    display_name VARCHAR(128) NOT NULL,
    is_free                    BOOLEAN      NOT NULL DEFAULT false,
    price_input_per_1k_tokens  NUMERIC(10,6) NOT NULL DEFAULT 0 CHECK (price_input_per_1k_tokens >= 0),
    price_output_per_1k_tokens NUMERIC(10,6) NOT NULL DEFAULT 0 CHECK (price_output_per_1k_tokens >= 0),
    currency                   VARCHAR(3)   NOT NULL DEFAULT 'CNY',
    supports_cache BOOLEAN    NOT NULL DEFAULT false,
    is_active    BOOLEAN      NOT NULL DEFAULT true,
    description  TEXT,
    created_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_models_active
    ON api_models(is_active, provider);

-- 预置模型
INSERT INTO api_models
    (provider, model_name, display_name, is_free,
     price_input_per_1k_tokens, price_output_per_1k_tokens, currency, is_active, supports_cache, description)
VALUES
    -- ══════════════════════════════════════════════════════════════════════
    -- ── 免费模型 ───────────────────────────────────────────────────────────
    -- ══════════════════════════════════════════════════════════════════════
    ('zhipu',     'glm-4-flash',                    'GLM-4-Flash（★默认免费）',
     true, 0, 0, 'CNY', true, false,
     '★ 系统默认免费模型 ★ 智谱官方免费提供，0 成本运营。速度快（~1s），128k 上下文，适合日常对话。openclaw 默认路由此模型。'),

    ('anthropic', 'claude-haiku-4-5-20251001',      'Claude Haiku 4.5（免费）',
     true, 0, 0, 'USD', true, false,
     '管理员标记为用户免费；Anthropic 实际收费约 $0.0008/$0.004 per 1K token（USD），成本由运营商承担'),

    ('zhipu',     'glm-z1-flash',                   'GLM-Z1-Flash 推理（免费）',
     true, 0, 0, 'CNY', true, false,
     '智谱推理轻量版，有官方免费配额，用户免费使用'),

    ('groq',      'llama-3.1-8b-instant',           'Llama 3.1 8B Instant（免费）',
     true, 0, 0, 'USD', true, false,
     'Groq 免费层，速度极快（500+ tokens/s），适合快速问答'),

    -- ══════════════════════════════════════════════════════════════════════
    -- ── 全球 Top 10 提供商 · 付费模型 ─────────────────────────────────────
    -- ══════════════════════════════════════════════════════════════════════

    ('anthropic', 'claude-opus-4-0',                'Claude Opus 4',
     false, 0.015000, 0.075000, 'USD', true, true,
     'Anthropic 旗舰，最强推理，supports Prompt Caching；$15/$75 per 1M token（USD）'),

    ('anthropic', 'claude-sonnet-4-5',              'Claude Sonnet 4.5',
     false, 0.003000, 0.015000, 'USD', true, true,
     '主力付费模型，均衡性能，supports Prompt Caching；$3/$15 per 1M token（USD）'),

    ('anthropic', 'claude-3-7-sonnet-20250219',     'Claude 3.7 Sonnet',
     false, 0.003000, 0.015000, 'USD', true, true,
     '支持 Extended Thinking（扩展思维），supports Prompt Caching；$3/$15 per 1M token（USD）'),

    ('anthropic', 'claude-3-5-sonnet-20241022',     'Claude 3.5 Sonnet',
     false, 0.003000, 0.015000, 'USD', true, true,
     '上一代稳定主力，supports Prompt Caching；$3/$15 per 1M token（USD）'),

    ('anthropic', 'claude-3-5-haiku-20241022',      'Claude 3.5 Haiku',
     false, 0.000800, 0.004000, 'USD', true, false,
     '快速轻量，高性价比；$0.8/$4 per 1M token（USD）'),

    ('openai',    'gpt-4.1',                        'GPT-4.1',
     false, 0.002000, 0.008000, 'USD', true, true,
     'GPT-4.1 旗舰，128k 上下文，supports Prompt Caching；$2/$8 per 1M token（USD）'),

    ('openai',    'gpt-4.1-mini',                   'GPT-4.1 Mini',
     false, 0.000400, 0.001600, 'USD', true, true,
     'GPT-4.1 高性价比版，supports Prompt Caching；$0.4/$1.6 per 1M token（USD）'),

    ('openai',    'gpt-4.1-nano',                   'GPT-4.1 Nano',
     false, 0.000100, 0.000400, 'USD', true, false,
     'GPT-4.1 最低成本版；$0.1/$0.4 per 1M token（USD）'),

    ('openai',    'gpt-4o',                         'GPT-4o',
     false, 0.002500, 0.010000, 'USD', true, true,
     '多模态旗舰，supports Prompt Caching；$2.5/$10 per 1M token（USD）'),

    ('openai',    'gpt-4o-mini',                    'GPT-4o Mini',
     false, 0.000150, 0.000600, 'USD', true, false,
     '轻量多模态，高性价比；$0.15/$0.6 per 1M token（USD）'),

    ('openai',    'o4-mini',                        'o4-mini',
     false, 0.001100, 0.004400, 'USD', true, false,
     '最新推理模型，高性价比推理；$1.1/$4.4 per 1M token（USD）'),

    ('openai',    'o3',                             'o3',
     false, 0.010000, 0.040000, 'USD', true, false,
     '最强推理旗舰；$10/$40 per 1M token（USD）'),

    ('openai',    'o3-mini',                        'o3-mini',
     false, 0.001100, 0.004400, 'USD', true, false,
     '推理轻量版；$1.1/$4.4 per 1M token（USD）'),

    ('openai',    'o1',                             'o1',
     false, 0.015000, 0.060000, 'USD', true, false,
     '首代推理旗舰；$15/$60 per 1M token（USD）'),

    ('openai',    'o1-mini',                        'o1-mini',
     false, 0.003000, 0.012000, 'USD', true, false,
     '推理入门版；$3/$12 per 1M token（USD）'),

    ('google',    'gemini-2.5-pro-preview-05-06',   'Gemini 2.5 Pro',
     false, 0.001250, 0.010000, 'USD', true, false,
     'Google 旗舰推理模型；$1.25/$10 per 1M token（USD）'),

    ('google',    'gemini-2.5-flash-preview-04-17', 'Gemini 2.5 Flash',
     false, 0.000150, 0.000600, 'USD', true, false,
     '速度与质量均衡，高性价比；$0.15/$0.6 per 1M token（USD）'),

    ('google',    'gemini-2.0-flash',               'Gemini 2.0 Flash',
     false, 0.000100, 0.000400, 'USD', true, false,
     '稳定快速，有免费配额；$0.1/$0.4 per 1M token（USD）'),

    ('google',    'gemini-2.0-flash-lite',          'Gemini 2.0 Flash Lite',
     false, 0.000075, 0.000300, 'USD', true, false,
     '极低成本，适合高频调用；$0.075/$0.3 per 1M token（USD）'),

    ('google',    'gemini-1.5-pro',                 'Gemini 1.5 Pro',
     false, 0.001250, 0.005000, 'USD', true, false,
     '超长上下文（2M token），稳定版；$1.25/$5 per 1M token（USD）'),

    ('google',    'gemini-1.5-flash',               'Gemini 1.5 Flash',
     false, 0.000075, 0.000300, 'USD', true, false,
     '快速低成本，稳定版；$0.075/$0.3 per 1M token（USD）'),

    ('google',    'gemini-1.5-flash-8b',            'Gemini 1.5 Flash 8B',
     false, 0.000038, 0.000150, 'USD', true, false,
     '最轻量版，极低延迟；$0.0375/$0.15 per 1M token（USD）'),

    ('xai',       'grok-3',                         'Grok-3',
     false, 0.003000, 0.015000, 'USD', true, false,
     'xAI 旗舰模型；$3/$15 per 1M token（USD）'),

    ('xai',       'grok-3-mini',                    'Grok-3 Mini',
     false, 0.000300, 0.000500, 'USD', true, false,
     '轻量推理版；$0.3/$0.5 per 1M token（USD）'),

    ('xai',       'grok-3-fast',                    'Grok-3 Fast',
     false, 0.005000, 0.025000, 'USD', true, false,
     '高速响应版；$5/$25 per 1M token（USD）'),

    ('xai',       'grok-2-latest',                  'Grok-2',
     false, 0.002000, 0.010000, 'USD', true, false,
     '上一代稳定版；$2/$10 per 1M token（USD）'),

    ('mistral',   'mistral-large-latest',           'Mistral Large',
     false, 0.002000, 0.006000, 'USD', true, false,
     '旗舰综合模型；$2/$6 per 1M token（USD）'),

    ('mistral',   'mistral-medium-latest',          'Mistral Medium',
     false, 0.000400, 0.002000, 'USD', true, false,
     '均衡性能；$0.4/$2 per 1M token（USD）'),

    ('mistral',   'mistral-small-latest',           'Mistral Small',
     false, 0.000100, 0.000300, 'USD', true, false,
     '轻量高效；$0.1/$0.3 per 1M token（USD）'),

    ('mistral',   'codestral-latest',               'Codestral',
     false, 0.000200, 0.000600, 'USD', true, false,
     '代码专用模型；$0.2/$0.6 per 1M token（USD）'),

    ('mistral',   'open-mistral-7b',                'Mistral 7B',
     false, 0.000250, 0.000250, 'USD', true, false,
     '开源 7B 模型，价格极低；$0.25/$0.25 per 1M token（USD）'),

    ('cohere',    'command-r-plus-08-2024',         'Command R+',
     false, 0.002500, 0.010000, 'USD', true, false,
     '旗舰 RAG 模型，适合企业知识库；$2.5/$10 per 1M token（USD）'),

    ('cohere',    'command-r-08-2024',              'Command R',
     false, 0.000150, 0.000600, 'USD', true, false,
     '均衡 RAG 模型；$0.15/$0.6 per 1M token（USD）'),

    ('cohere',    'command-r7b-12-2024',            'Command R 7B',
     false, 0.000038, 0.000150, 'USD', true, false,
     '轻量快速 RAG；$0.0375/$0.15 per 1M token（USD）'),

    ('groq',      'meta-llama/llama-4-scout-17b-16e-instruct', 'Llama 4 Scout 17B (Groq)',
     false, 0.000110, 0.000340, 'USD', true, false,
     'Groq 托管 Llama 4 Scout，速度极快；$0.11/$0.34 per 1M token（USD）'),

    ('groq',      'meta-llama/llama-4-maverick-17b-128e-instruct-fp8', 'Llama 4 Maverick 17B (Groq)',
     false, 0.000500, 0.000770, 'USD', true, false,
     'Groq 托管 Llama 4 Maverick；$0.5/$0.77 per 1M token（USD）'),

    ('groq',      'llama-3.3-70b-versatile',        'Llama 3.3 70B (Groq)',
     false, 0.000590, 0.000790, 'USD', true, false,
     'Groq 托管强力开源模型；$0.59/$0.79 per 1M token（USD）'),

    ('groq',      'mixtral-8x7b-32768',             'Mixtral 8x7B (Groq)',
     false, 0.000240, 0.000240, 'USD', true, false,
     'Groq 托管 Mixtral；$0.24/$0.24 per 1M token（USD）'),

    ('groq',      'gemma2-9b-it',                   'Gemma2 9B IT (Groq)',
     false, 0.000200, 0.000200, 'USD', true, false,
     'Groq 托管 Google Gemma2；$0.2/$0.2 per 1M token（USD）'),

    ('perplexity', 'sonar-pro',                     'Sonar Pro（联网旗舰）',
     false, 0.003000, 0.015000, 'USD', true, false,
     '联网搜索旗舰，实时信息；$3/$15 per 1M token（USD）'),

    ('perplexity', 'sonar',                         'Sonar（联网标准）',
     false, 0.001000, 0.001000, 'USD', true, false,
     '联网搜索标准版；$1/$1 per 1M token（USD）'),

    ('perplexity', 'sonar-reasoning-pro',           'Sonar Reasoning Pro',
     false, 0.002000, 0.008000, 'USD', true, false,
     '推理+联网旗舰；$2/$8 per 1M token（USD）'),

    ('perplexity', 'sonar-reasoning',               'Sonar Reasoning',
     false, 0.001000, 0.005000, 'USD', true, false,
     '推理+联网标准版；$1/$5 per 1M token（USD）'),

    -- ══════════════════════════════════════════════════════════════════════
    -- ── 中国 Top 5 提供商 · 付费模型 ──────────────────────────────────────
    -- ══════════════════════════════════════════════════════════════════════

    ('deepseek',  'deepseek-chat',                  'DeepSeek-V3（通用旗舰）',
     false, 0.001000, 0.002000, 'CNY', true, true,
     'DeepSeek-V3，综合能力最强，价格极低，supports Prefix Caching；¥0.001/¥0.002 per 1K token（CNY）'),

    ('deepseek',  'deepseek-reasoner',              'DeepSeek-R1（推理）',
     false, 0.004000, 0.016000, 'CNY', true, true,
     'DeepSeek-R1，深度推理，supports Prefix Caching；¥0.004/¥0.016 per 1K token（CNY）'),

    ('qwen',      'qwen3-235b-a22b',                'Qwen3-235B MoE（旗舰）',
     false, 0.002000, 0.006000, 'CNY', true, false,
     'Qwen3 旗舰 MoE 模型；¥0.002/¥0.006 per 1K token（CNY）'),

    ('qwen',      'qwen3-32b',                      'Qwen3-32B（旗舰）',
     false, 0.001200, 0.006000, 'CNY', true, false,
     'Qwen3 Dense 旗舰；¥0.0012/¥0.006 per 1K token（CNY）'),

    ('qwen',      'qwen3-14b',                      'Qwen3-14B',
     false, 0.000800, 0.003000, 'CNY', true, false,
     'Qwen3 均衡版；¥0.0008/¥0.003 per 1K token（CNY）'),

    ('qwen',      'qwq-32b',                        'QwQ-32B（推理）',
     false, 0.001200, 0.006000, 'CNY', true, false,
     'Qwen 推理专用模型（类 o1）；¥0.0012/¥0.006 per 1K token（CNY）'),

    ('qwen',      'qwen-max',                       'Qwen-Max（综合旗舰）',
     false, 0.002400, 0.009600, 'CNY', true, false,
     '通义千问旗舰，最强综合能力；¥0.0024/¥0.0096 per 1K token（CNY）'),

    ('qwen',      'qwen-plus',                      'Qwen-Plus（均衡）',
     false, 0.000800, 0.002000, 'CNY', true, false,
     '均衡型，性价比高；¥0.0008/¥0.002 per 1K token（CNY）'),

    ('qwen',      'qwen-turbo',                     'Qwen-Turbo（快速）',
     false, 0.000300, 0.000600, 'CNY', true, false,
     '速度最快，价格最低；¥0.0003/¥0.0006 per 1K token（CNY）'),

    ('qwen',      'qwen-long',                      'Qwen-Long（超长上下文）',
     false, 0.000500, 0.002000, 'CNY', true, false,
     '超长上下文（1M token），长文档处理；¥0.0005/¥0.002 per 1K token（CNY）'),

    ('qwen',      'qwen-coder-plus',                'Qwen-Coder-Plus（代码）',
     false, 0.003500, 0.007000, 'CNY', true, false,
     '代码专用，指令跟随强；¥0.0035/¥0.007 per 1K token（CNY）'),

    ('moonshot',  'kimi-latest',                    'Kimi Latest（自动跟最新）',
     false, 0.012000, 0.012000, 'CNY', true, false,
     'Kimi 最新版，自动跟踪；¥0.012/¥0.012 per 1K token（CNY）'),

    ('moonshot',  'moonshot-v1-8k',                 'Moonshot V1 8K',
     false, 0.012000, 0.012000, 'CNY', true, false,
     '8k 上下文；¥0.012/¥0.012 per 1K token（CNY）'),

    ('moonshot',  'moonshot-v1-32k',                'Moonshot V1 32K',
     false, 0.024000, 0.024000, 'CNY', true, false,
     '32k 长上下文；¥0.024/¥0.024 per 1K token（CNY）'),

    ('moonshot',  'moonshot-v1-128k',               'Moonshot V1 128K',
     false, 0.060000, 0.060000, 'CNY', true, false,
     '128k 超长上下文；¥0.06/¥0.06 per 1K token（CNY）'),

    ('zhipu',     'glm-z1-plus',                    'GLM-Z1-Plus（推理旗舰）',
     false, 0.010000, 0.010000, 'CNY', true, false,
     'GLM 推理旗舰；¥0.01/¥0.01 per 1K token（CNY）'),

    ('zhipu',     'glm-4-plus',                     'GLM-4-Plus（对话旗舰）',
     false, 0.050000, 0.050000, 'CNY', true, false,
     'GLM-4 旗舰，最强对话能力；¥0.05/¥0.05 per 1K token（CNY）'),

    ('zhipu',     'glm-4-air',                      'GLM-4-Air（高性价比）',
     false, 0.001000, 0.001000, 'CNY', true, false,
     '高性价比，均衡性能；¥0.001/¥0.001 per 1K token（CNY）'),

    ('zhipu',     'glm-4-long',                     'GLM-4-Long（超长上下文）',
     false, 0.001000, 0.001000, 'CNY', true, false,
     '超长上下文版；¥0.001/¥0.001 per 1K token（CNY）'),

    ('doubao',    'doubao-pro-32k',                 '豆包 Pro 32K',
     false, 0.000800, 0.002000, 'CNY', true, false,
     '字节旗舰，32k 上下文；¥0.0008/¥0.002 per 1K token（CNY）'),

    ('doubao',    'doubao-pro-128k',                '豆包 Pro 128K',
     false, 0.005000, 0.009000, 'CNY', true, false,
     '旗舰长上下文，128k；¥0.005/¥0.009 per 1K token（CNY）'),

    ('doubao',    'doubao-lite-32k',                '豆包 Lite 32K',
     false, 0.000300, 0.000600, 'CNY', true, false,
     '轻量低成本，32k；¥0.0003/¥0.0006 per 1K token（CNY）'),

    ('doubao',    'doubao-lite-128k',               '豆包 Lite 128K',
     false, 0.000800, 0.001000, 'CNY', true, false,
     '轻量长上下文；¥0.0008/¥0.001 per 1K token（CNY）'),

    ('baidu',     'ernie-4.5-turbo-preview',        'ERNIE 4.5 Turbo（旗舰）',
     false, 0.004000, 0.016000, 'CNY', true, false,
     '百度 ERNIE 4.5 旗舰；¥0.004/¥0.016 per 1K token（CNY）'),

    ('baidu',     'ernie-4.0-turbo-8k',             'ERNIE 4.0 Turbo 8K',
     false, 0.012000, 0.012000, 'CNY', true, false,
     'ERNIE 4.0 稳定版；¥0.012/¥0.012 per 1K token（CNY）'),

    ('baidu',     'ernie-speed-pro-128k',           'ERNIE Speed Pro 128K',
     false, 0.000400, 0.000800, 'CNY', true, false,
     '高速长上下文，适合 RAG；¥0.0004/¥0.0008 per 1K token（CNY）'),

    ('baidu',     'ernie-lite-8k',                  'ERNIE Lite 8K',
     false, 0.000300, 0.000600, 'CNY', true, false,
     '轻量版，低成本；¥0.0003/¥0.0006 per 1K token（CNY）'),

    -- ══════════════════════════════════════════════════════════════════════
    -- ── 本地模型（保留接口，默认不启用） ──────────────────────────────────
    -- ══════════════════════════════════════════════════════════════════════
    ('ollama', 'qwen2.5:7b-instruct-q4_K_M', 'Qwen 2.5 7B (本地)',
     true, 0, 0, 'CNY', false, false, '本地 Ollama 模型，保留接口定义，如需启用请设 is_active=true'),
    ('ollama', 'llama3.2:3b',                'LLaMA 3.2 3B (本地)',
     true, 0, 0, 'USD', false, false, '本地 Ollama 模型，保留接口定义')
ON CONFLICT (model_name) DO NOTHING;

-- =============================================================
-- 2. 用户账户表
-- =============================================================
CREATE TABLE IF NOT EXISTS user_billing (
    id                BIGSERIAL    PRIMARY KEY,
    user_email        VARCHAR(254) NOT NULL UNIQUE,
    balance_fen       NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (balance_fen >= 0),
    total_charged_fen NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total_charged_fen >= 0),
    is_suspended      BOOLEAN       NOT NULL DEFAULT false,
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_billing_email
    ON user_billing(user_email);

-- =============================================================
-- 3. 充值卡密表
-- =============================================================
CREATE TABLE IF NOT EXISTS recharge_cards (
    id          BIGSERIAL     PRIMARY KEY,
    key         VARCHAR(64)   NOT NULL UNIQUE,
    credit_fen  NUMERIC(12,2) NOT NULL CHECK (credit_fen > 0),
    label       VARCHAR(128),
    used        BOOLEAN       NOT NULL DEFAULT false,
    used_at     TIMESTAMPTZ,
    used_by     VARCHAR(254),
    created_at  TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_recharge_cards_key
    ON recharge_cards(key);
CREATE INDEX IF NOT EXISTS idx_recharge_cards_unused
    ON recharge_cards(used) WHERE used = false;

-- =============================================================
-- 4. API 调用记录（计费核心）
-- v5.2 新增 idempotency_key：防止网络重试重复计费
--   · 调用方（OpenClaw）生成，格式建议：<conv_id>:<msg_id>:<model>
--   · 相同 key 的第二次请求，webhook 返回第一次结果，不重复扣费
--   · NULL 表示调用方未提供（兼容旧版 OpenClaw）
-- =============================================================
CREATE TABLE IF NOT EXISTS api_usage (
    id              BIGSERIAL     PRIMARY KEY,
    user_email      VARCHAR(254)  NOT NULL,
    api_model_id    INT           REFERENCES api_models(id) ON DELETE SET NULL,
    api_provider    VARCHAR(32)   NOT NULL,
    model_name      VARCHAR(128)  NOT NULL,
    is_free         BOOLEAN       NOT NULL,
    input_tokens    BIGINT        NOT NULL DEFAULT 0,
    output_tokens   BIGINT        NOT NULL DEFAULT 0,
    charged_fen     NUMERIC(10,4) NOT NULL DEFAULT 0,
    status          VARCHAR(16)   NOT NULL DEFAULT 'ok',
    error_msg       TEXT,
    -- v5.2: 幂等键，仅对非 NULL 值强制唯一
    idempotency_key VARCHAR(128),
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_usage_user_date
    ON api_usage(user_email, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_api_usage_model
    ON api_usage(api_model_id, created_at DESC);

-- 部分唯一索引：仅对非 NULL 的 idempotency_key 强制唯一
-- NULL != NULL，故多个 NULL 不会触发冲突（兼容旧版调用方）
CREATE UNIQUE INDEX IF NOT EXISTS idx_api_usage_idempotency
    ON api_usage(idempotency_key)
    WHERE idempotency_key IS NOT NULL;

COMMENT ON COLUMN api_usage.idempotency_key IS
  '调用方提供的幂等键（如 <conv_id>:<msg_id>:<model>）。
   用于防止网络重试重复扣费。NULL 兼容未提供幂等键的旧版调用方。';

-- =============================================================
-- 5. 充值/扣费流水
-- =============================================================
CREATE TABLE IF NOT EXISTS billing_transactions (
    id                BIGSERIAL     PRIMARY KEY,
    user_email        VARCHAR(254)  NOT NULL,
    type              VARCHAR(16)   NOT NULL CHECK (type IN ('charge','recharge','refund','admin_adjust')),
    amount_fen        NUMERIC(12,4) NOT NULL,
    balance_after_fen NUMERIC(12,2) NOT NULL CHECK (balance_after_fen >= 0),
    description       TEXT,
    ref_id            VARCHAR(128),
    created_at        TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_billing_txn_user
    ON billing_transactions(user_email, created_at DESC);

-- =============================================================
-- 6. 触发器：自动更新 updated_at
-- =============================================================
CREATE OR REPLACE FUNCTION set_updated_at()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_user_billing_updated ON user_billing;
CREATE TRIGGER trg_user_billing_updated
    BEFORE UPDATE ON user_billing
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

DROP TRIGGER IF EXISTS trg_api_models_updated ON api_models;
CREATE TRIGGER trg_api_models_updated
    BEFORE UPDATE ON api_models
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =============================================================
-- 7. 辅助视图
-- =============================================================

CREATE OR REPLACE VIEW v_user_balance AS
SELECT
    user_email,
    balance_fen,
    total_charged_fen,
    is_suspended,
    created_at
FROM user_billing;

-- 当日（北京时间）各模型调用量汇总
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
  '当日（北京时间）各模型调用量汇总。使用 Asia/Shanghai 时区，
   避免 Azure PostgreSQL 默认 UTC 导致北京时间午夜前 8 小时统计前一天数据。';

-- =============================================================
-- 8. 最小权限角色
-- =============================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'billing_svc') THEN
    CREATE ROLE billing_svc NOLOGIN;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE librechat TO billing_svc;
GRANT USAGE ON SCHEMA public TO billing_svc;
GRANT SELECT, INSERT, UPDATE ON TABLE user_billing, recharge_cards, api_usage, billing_transactions TO billing_svc;
GRANT SELECT ON TABLE api_models TO billing_svc;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO billing_svc;

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'agent_svc') THEN
    CREATE ROLE agent_svc NOLOGIN;
  END IF;
END
$$;

GRANT CONNECT ON DATABASE librechat TO agent_svc;
GRANT USAGE ON SCHEMA public TO agent_svc;
GRANT SELECT ON TABLE api_models TO agent_svc;
GRANT SELECT, INSERT ON TABLE api_usage TO agent_svc;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO agent_svc;

-- =============================================================
-- 完成
-- =============================================================
