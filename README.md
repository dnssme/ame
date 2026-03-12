# Anima · 灵枢 私有 AI 手机助理

> 完整生产级部署 · 按模型按量计费 · 安全加固

## 目录结构

```
.
├── db/
│   └── schema.sql           # PostgreSQL Schema（api_models 定价表、用户余额、计费流水）
├── webhook/
│   ├── package.json         # Node.js 依赖
│   └── server.js            # Webhook 计费服务
├── nginx/
│   └── anima.conf           # Nginx 反向代理（HTTPS / 安全头 / 限速）
├── librechat/
│   ├── .env.example         # LibreChat 环境变量模板
│   └── docker-compose.yml   # LibreChat Docker Compose
├── openclaw/
│   ├── config.yml           # OpenClaw Agent 配置（多 provider / billing webhook）
│   └── docker-compose.yml   # OpenClaw Docker Compose
├── scripts/
│   └── setup.sh             # CXI4 一键初始化脚本
└── Anima灵枢_*.docx          # 完整部署教程文档
```

---

## 计费规则

### 核心设计

| 规则 | 说明 |
|------|------|
| **按模型独立定价** | 每个 API 模型在 `api_models` 表中单独设定价格，管理员可随时添加/修改 |
| **免费模型** | `is_free=true` 的模型（如 `claude-haiku-4-5-20251001`）永久免费，不扣余额 |
| **付费模型** | 仅在用户实际使用时扣费：`⌈(输入字数/1000 × 输入价) + (输出字数/1000 × 输出价)⌉` 分 |
| **预付费余额** | 用户充值后使用，余额不足时系统返回 HTTP 402 并拒绝调用 |
| **本地模型** | Ollama 模型保留接口定义（`is_active=false`），当前不参与计费与推理 |

### 添加/修改模型定价

通过管理员接口，可在运行时动态添加任意模型及自定义价格：

```bash
# 添加一个免费模型
curl -X POST http://172.16.1.5:3002/admin/models \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"provider":"anthropic","modelName":"claude-haiku-4-5-20251001",
       "displayName":"Claude Haiku 4.5","isFree":true}'

# 添加一个付费模型（¥0.03/1k输入，¥0.06/1k输出）
curl -X POST http://172.16.1.5:3002/admin/models \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"provider":"anthropic","modelName":"claude-sonnet-4-5",
       "displayName":"Claude Sonnet 4.5","isFree":false,
       "priceInput":0.03,"priceOutput":0.06}'

# 修改已有模型价格
curl -X PUT http://172.16.1.5:3002/admin/models/2 \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"priceInput":0.025,"priceOutput":0.05}'
```

也可直接在数据库中操作：
```sql
-- 查看所有模型定价
SELECT model_name, is_free, price_input_per_1k_chars, price_output_per_1k_chars, is_active
FROM api_models ORDER BY provider, model_name;

-- 修改价格
UPDATE api_models
SET price_input_per_1k_chars=0.025, price_output_per_1k_chars=0.050
WHERE model_name='claude-sonnet-4-5';

-- 启用本地 Ollama 模型（如需）
UPDATE api_models SET is_active=true WHERE provider='ollama';
```

---

## 快速部署

### 前提条件

- 已按教程文档完成 Wireguard 组网（所有节点内网互通）
- Azure PostgreSQL 已创建并初始化三个数据库（librechat / openclaw / nextcloud）
- 所有节点已完成 UFW / fail2ban 基础安全加固

### 1. CXI4 — 初始化 Webhook 服务

```bash
git clone https://github.com/dnssme/ame.git /opt/ai/repo
cd /opt/ai/repo

# 一键初始化（替换为实际密码）
bash scripts/setup.sh '<animaapp数据库密码>' '<Redis密码>'
```

设置管理员 Token（用于模型管理接口）：
```bash
echo 'ADMIN_TOKEN=<强随机字符串>' >> /opt/ai/webhook/.env
systemctl restart anima-webhook
```

验证：
```bash
curl http://172.16.1.5:3002/health
# {"status":"ok","db":"ok","ts":"..."}

curl http://172.16.1.5:3002/models
# 返回所有已启用模型及定价
```

### 2. VPS C — 部署 LibreChat

```bash
cd /opt/ai/repo/librechat
cp .env.example .env
vim .env  # 填入所有 <占位符>
chmod 600 .env
docker compose up -d
```

### 3. VPS B — 部署 OpenClaw

```bash
cd /opt/ai/repo/openclaw
# 通过环境变量注入 API Key，不写入 config.yml
export ANTHROPIC_API_KEY=<Claude API Key>
export OPENAI_API_KEY=<OpenAI API Key>
export MISTRAL_API_KEY=<Mistral API Key>
export PG_PASSWORD=<数据库密码>
export REDIS_PASSWORD=<Redis密码>
export NEXTCLOUD_PASSWORD=<Nextcloud密码>
export HA_TOKEN=<HA令牌>

mkdir -p data
docker compose up -d
```

### 4. VPS A — 配置 Nginx

```bash
sed 's/<你的域名>/ai.yourdomain.com/g' nginx/anima.conf \
  > /etc/nginx/sites-available/anima
ln -sf /etc/nginx/sites-available/anima /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

---

## API 接口

### 公开接口

```
GET  /health                        服务健康检查
GET  /models                        查看所有可用模型及定价
POST /activate                      充值卡激活
GET  /billing/balance/:email        查询用户余额
GET  /billing/history/:email        查询消费历史（?limit=20&offset=0）
POST /billing/record                记录 API 调用并计费（由 OpenClaw 自动调用）
```

### 管理员接口（需 Authorization: Bearer $ADMIN_TOKEN）

```
POST /admin/models                  新增或更新模型定价
PUT  /admin/models/:id              修改已有模型定价/启停
POST /admin/adjust                  人工调整用户余额（充值/退款/调整）
```

#### 充值卡激活

```json
POST /activate
{"cardKey":"ANIMA-TOP20-DEMO","userEmail":"user@example.com"}
```

#### 记录 API 调用

```json
POST /billing/record
{
  "userEmail":   "user@example.com",
  "apiProvider": "anthropic",
  "modelName":   "claude-sonnet-4-5",
  "inputChars":  500,
  "outputChars": 200
}
```

---

## 安全说明

- **Nginx**：强制 HTTPS（TLS 1.2/1.3）、HSTS、CSP、X-Frame-Options 等安全响应头，分级限速
- **Webhook**：仅绑定内网 `172.16.1.5`，`helmet` 安全头，全局 60 req/min / 激活 5 req/10min
- **数据库**：全参数化查询防 SQL 注入，充值激活使用事务+行锁防并发重复使用
- **管理员接口**：通过 `ADMIN_TOKEN` 环境变量保护，未设置时接口自动禁用
- **密钥管理**：所有密码通过环境变量注入，不写入代码；`.env` 文件权限 `600`

---

## 常见运维 SQL

```sql
-- 查看用户余额
SELECT user_email, balance_fen, total_charged_fen, is_suspended
FROM user_billing ORDER BY total_charged_fen DESC;

-- 查看近期消费记录
SELECT user_email, type, amount_fen, description, created_at
FROM billing_transactions ORDER BY created_at DESC LIMIT 20;

-- 查看今日各模型调用量
SELECT * FROM v_today_model_usage;

-- 生成充值卡（¥20）
INSERT INTO recharge_cards (key, credit_fen, label)
VALUES ('ANIMA-' || upper(encode(gen_random_bytes(8),'hex')), 2000, '¥20 充值卡');

-- 暂停/恢复用户
UPDATE user_billing SET is_suspended=true  WHERE user_email='user@example.com';
UPDATE user_billing SET is_suspended=false WHERE user_email='user@example.com';
```

---

> 完整部署步骤请参阅 `Anima灵枢_完整部署教程_172.16.1.0_24.docx`