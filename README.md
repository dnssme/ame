# Anima · 灵枢 私有 AI 手机助理

> 完整生产级部署 · 按模型按量计费 · 安全加固

---

## 目录

1. [架构概览](#架构概览)
2. [计费规则](#计费规则)
3. [前置条件](#前置条件)
4. [第一步：CXI4 — 初始化 Webhook 计费服务](#第一步cxi4--初始化-webhook-计费服务)
5. [第二步：VPS C — 部署 LibreChat](#第二步vps-c--部署-librechat)
6. [第三步：VPS B — 部署 OpenClaw](#第三步vps-b--部署-openclaw)
7. [第四步：VPS A — 配置 Nginx](#第四步vps-a--配置-nginx)
8. [第五步：初始化模型定价](#第五步初始化模型定价)
9. [API 接口完整参考](#api-接口完整参考)
10. [常用运维 SQL](#常用运维-sql)
11. [故障排查](#故障排查)

---

## 架构概览

```
互联网用户
    │ HTTPS
    ▼
[VPS A] Nginx 反向代理 (172.16.1.1)
    ├─── /          → [VPS C] LibreChat :3080
    ├─── /api/agent → [VPS B] OpenClaw  :3000
    └─── /activate  → [CXI4] Webhook    :3002

[CXI4] (172.16.1.5)
    ├─── Webhook 计费服务  :3002  ←── OpenClaw / LibreChat 自动调用
    ├─── Redis             :6379  ←── LibreChat / OpenClaw 缓存
    └─── (Whisper STT)     :8080  （可选）

[Azure PostgreSQL]
    ├─── librechat  ←── LibreChat 用户数据 + 计费数据
    └─── openclaw   ←── OpenClaw 记忆数据库
```

所有节点通过 **WireGuard 内网（172.16.1.0/24）** 互通，Webhook 服务和数据库完全不暴露公网。

### 目录结构

```
.
├── db/
│   └── schema.sql           # PostgreSQL Schema（v4）
├── webhook/
│   ├── package.json         # Node.js 依赖
│   └── server.js            # Webhook 计费服务（11 个接口）
├── nginx/
│   └── anima.conf           # Nginx 反向代理配置
├── librechat/
│   ├── .env.example         # LibreChat 环境变量模板
│   └── docker-compose.yml   # LibreChat Docker Compose
├── openclaw/
│   ├── .env.example         # OpenClaw 环境变量模板
│   ├── config.yml           # OpenClaw Agent 配置
│   └── docker-compose.yml   # OpenClaw Docker Compose
└── scripts/
    └── setup.sh             # CXI4 一键初始化脚本
```

---

## 计费规则

| 规则 | 说明 |
|------|------|
| **按模型独立定价** | 每个 API 模型在 `api_models` 表中单独设定价格，无套餐绑定 |
| **免费模型** | `is_free=true` 的模型（如 `claude-haiku-4-5-20251001`）永久免费，不扣余额 |
| **付费模型** | 仅在实际使用时扣费：`⌈(输入字数/1000 × 输入价格) + (输出字数/1000 × 输出价格)⌉` 分 |
| **预付费** | 用户充值后使用；余额不足时系统返回 HTTP 402 拒绝调用 |
| **本地模型** | Ollama 模型 `is_active=false`，接口定义保留但拒绝所有计费请求 |

---

## 前置条件

在开始部署前，请确认以下条件已满足：

- [ ] 所有 VPS 节点已通过 **WireGuard** 组成 `172.16.1.0/24` 内网（各节点互通）
- [ ] **Azure PostgreSQL** 已创建实例，已建 `librechat` 和 `openclaw` 两个数据库
- [ ] 已为 `animaapp` 数据库用户分配两个数据库的所有权限
- [ ] 所有节点已完成基础安全加固（UFW / fail2ban）
- [ ] VPS A 已申请域名 SSL 证书（见[第四步](#第四步vps-a--配置-nginx)）

### 验证 WireGuard 内网互通

```bash
# 在任意节点执行，确认四个 IP 均可达
ping -c 2 172.16.1.1   # VPS A (Nginx)
ping -c 2 172.16.1.2   # VPS B (OpenClaw)
ping -c 2 172.16.1.3   # VPS C (LibreChat)
ping -c 2 172.16.1.4   # VPS D (Nextcloud，如有）
ping -c 2 172.16.1.5   # CXI4 (Webhook/Redis)
```

---

## 第一步：CXI4 — 初始化 Webhook 计费服务

> **执行节点：CXI4 (172.16.1.5)**

### 1.1 安装 Redis

```bash
# 安装 Redis
apt-get update && apt-get install -y redis-server

# 配置 Redis 监听内网、设置密码
REDIS_PASS="<强随机字符串>"   # 记录此密码，后续 LibreChat 和 OpenClaw 需要

sed -i \
  -e 's/^bind 127.0.0.1.*/bind 172.16.1.5 127.0.0.1/' \
  -e "s/^# requirepass .*/requirepass ${REDIS_PASS}/" \
  /etc/redis/redis.conf

systemctl enable --now redis-server
systemctl restart redis-server

# 验证
redis-cli -h 172.16.1.5 -a "${REDIS_PASS}" ping
# 预期输出：PONG
```

### 1.2 克隆仓库

```bash
git clone https://github.com/dnssme/ame.git /opt/ai/repo
```

### 1.3 运行初始化脚本

> 脚本会完成：安装 Node.js 20 → 部署文件 → 初始化 DB Schema → 生成 systemd 服务 → 自动写入 `.env` 并生成 `ADMIN_TOKEN`

```bash
cd /opt/ai/repo
bash scripts/setup.sh '<animaapp数据库密码>' '<Redis密码>' 'anima-db.postgres.database.azure.com'
```

**输出示例（正常）：**
```
✅ Node.js 20 已安装，跳过
✅ Webhook 依赖安装完成
✅ .env 已创建（ADMIN_TOKEN 已自动生成并写入）
⚠  请保存 ADMIN_TOKEN: a3f9e2b1c5d8...
✅ 数据库 Schema 初始化完成
✅ systemd 服务已启动
✅ Webhook 服务运行正常
```

> ⚠️ **请立即保存脚本输出中的 `ADMIN_TOKEN`**，后续模型管理接口需要用到。

### 1.4 验证 Webhook 服务

```bash
# 健康检查
curl http://172.16.1.5:3002/health
# 预期：{"status":"ok","db":"ok","ts":"..."}

# 查看预置模型列表
curl http://172.16.1.5:3002/models
# 预期：返回 5 个已启用模型（含 Claude Haiku 免费模型）

# 查看服务日志
journalctl -u ai-webhook -n 30 --no-pager
```

---

## 第二步：VPS C — 部署 LibreChat

> **执行节点：VPS C (172.16.1.3)**

### 2.1 安装 Docker

```bash
apt-get update
apt-get install -y ca-certificates curl
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg \
  -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] \
  https://download.docker.com/linux/ubuntu $(. /etc/os-release && echo "$VERSION_CODENAME") stable" \
  > /etc/apt/sources.list.d/docker.list
apt-get update
apt-get install -y docker-ce docker-ce-cli containerd.io docker-compose-plugin
```

### 2.2 克隆仓库（如尚未克隆）

```bash
git clone https://github.com/dnssme/ame.git /opt/ai/repo
```

### 2.3 创建 `.env` 配置文件

```bash
cd /opt/ai/repo/librechat
cp .env.example .env
chmod 600 .env
```

用编辑器填写所有 `<占位符>`：

```bash
vim .env
```

需要填写的关键字段：

| 字段 | 说明 | 生成方法 |
|------|------|----------|
| `DOMAIN_CLIENT` | 你的域名，如 `https://ai.example.com` | — |
| `DOMAIN_SERVER` | 同上 | — |
| `JWT_SECRET` | 64 字符随机十六进制 | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `JWT_REFRESH_SECRET` | 另一个 64 字符随机十六进制 | 同上 |
| `POSTGRES_URI` | 替换 `<animaapp密码>` | — |
| `REDIS_URI` | 替换 `<Redis密码>`（与第一步相同） | — |
| `ANTHROPIC_API_KEY` | Claude API Key | — |
| `CREDS_KEY` | 32 字节随机 HEX（64字符） | `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"` |
| `CREDS_IV` | 16 字节随机 HEX（32字符） | `node -e "console.log(require('crypto').randomBytes(16).toString('hex'))"` |

### 2.4 创建必要目录并启动

```bash
cd /opt/ai/repo/librechat
mkdir -p uploads logs
docker compose up -d
```

### 2.5 验证 LibreChat

```bash
# 等待容器启动（约 30 秒）
docker compose ps
# 预期：librechat 状态为 Up (healthy)

# 检查日志
docker compose logs --tail=50 librechat

# 内网连通性测试
curl -sf http://172.16.1.3:3080/health
# 预期：{"status":"ok"} 或 HTTP 200
```

---

## 第三步：VPS B — 部署 OpenClaw

> **执行节点：VPS B (172.16.1.2)**

### 3.1 安装 Docker（同第二步 2.1）

### 3.2 克隆仓库（如尚未克隆）

```bash
git clone https://github.com/dnssme/ame.git /opt/ai/repo
```

### 3.3 创建 `.env` 配置文件

```bash
cd /opt/ai/repo/openclaw
cp .env.example .env
chmod 600 .env
vim .env   # 填入所有 API Key 和密码
```

> ⚠️ **重要**：`docker-compose.yml` 通过 `env_file: .env` 加载变量，不要用 `export` 方式注入（容器重启后失效）。

### 3.4 创建数据目录并启动

```bash
cd /opt/ai/repo/openclaw
mkdir -p data
docker compose up -d
```

### 3.5 验证 OpenClaw

```bash
docker compose ps
# 预期：openclaw 状态为 Up (healthy)

curl -sf http://172.16.1.2:3000/health
# 预期：HTTP 200
```

---

## 第四步：VPS A — 配置 Nginx

> **执行节点：VPS A (172.16.1.1)**

### 4.1 安装 Nginx

```bash
apt-get update && apt-get install -y nginx certbot python3-certbot-nginx
```

### 4.2 申请 SSL 证书（Let's Encrypt）

```bash
DOMAIN="ai.example.com"   # 替换为你的真实域名

# 先确保 80 端口可访问（UFW 允许）
ufw allow 80/tcp
ufw allow 443/tcp

# 申请证书
certbot certonly --nginx -d "${DOMAIN}" --non-interactive --agree-tos \
  --email admin@example.com   # 替换为你的邮箱

# 证书位置
ls /etc/letsencrypt/live/${DOMAIN}/
# 应有：fullchain.pem  privkey.pem
```

### 4.3 部署 Nginx 配置

```bash
DOMAIN="ai.example.com"   # 与上面相同

# 替换域名占位符
sed "s/<你的域名>/${DOMAIN}/g" /opt/ai/repo/nginx/anima.conf \
  > /etc/nginx/sites-available/anima

# 启用并测试
ln -sf /etc/nginx/sites-available/anima /etc/nginx/sites-enabled/
nginx -t
# 预期：configuration file ... syntax is ok
#       configuration file ... test is successful

# 重载
systemctl reload nginx
```

### 4.4 配置证书自动续期

```bash
# 测试续期（不实际续期）
certbot renew --dry-run
# 预期：Congratulations, all simulated renewals succeeded.

# certbot 安装时已自动配置 systemd timer，确认状态
systemctl status certbot.timer
```

### 4.5 验证

```bash
# 测试 HTTPS
curl -sv https://ai.example.com/health 2>&1 | grep -E "HTTP|status"

# 测试 HTTP → HTTPS 跳转
curl -Lv http://ai.example.com/ 2>&1 | grep "Location"
# 预期：Location: https://ai.example.com/

# 检查安全头
curl -sI https://ai.example.com/ | grep -E "Strict|Content-Security|X-Frame"
```

---

## 第五步：初始化模型定价

初始化脚本已通过 `db/schema.sql` 预置了以下模型：

| 模型 | 提供商 | 免费 | 输入价（元/1k字） | 输出价（元/1k字） |
|------|--------|------|-------------------|-------------------|
| `claude-haiku-4-5-20251001` | anthropic | ✅ 是 | 0 | 0 |
| `claude-sonnet-4-5` | anthropic | — | 0.03（示例） | 0.06（示例） |
| `gpt-4o-mini` | openai | — | 0.0015（示例） | 0.003（示例） |
| `gpt-4o` | openai | — | 0.025（示例） | 0.05（示例） |
| `mistral-small-latest` | mistral | — | 0.002（示例） | 0.006（示例） |

> ⚠️ **付费模型价格为示例占位符，请按实际 API 成本调整！**

### 5.1 查看当前所有模型

```bash
ADMIN_TOKEN="$(grep ADMIN_TOKEN /opt/ai/webhook/.env | cut -d= -f2)"

curl http://172.16.1.5:3002/admin/models \
  -H "Authorization: Bearer ${ADMIN_TOKEN}"
```

### 5.2 修改模型价格

```bash
# 先查询模型 ID（从上一步输出中找到对应 id 字段）
MODEL_ID=2   # claude-sonnet-4-5 的 id

curl -X PUT "http://172.16.1.5:3002/admin/models/${MODEL_ID}" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"priceInput": 0.025, "priceOutput": 0.050}'
```

### 5.3 添加新模型

```bash
# 添加付费模型
curl -X POST http://172.16.1.5:3002/admin/models \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "provider":     "openai",
    "modelName":    "gpt-4-turbo",
    "displayName":  "GPT-4 Turbo",
    "isFree":       false,
    "priceInput":   0.04,
    "priceOutput":  0.08,
    "description":  "GPT-4 Turbo 付费模型"
  }'

# 添加免费模型
curl -X POST http://172.16.1.5:3002/admin/models \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "provider":     "anthropic",
    "modelName":    "claude-haiku-4-5-20251001",
    "displayName":  "Claude Haiku 4.5",
    "isFree":       true
  }'
```

### 5.4 停用/启用模型

```bash
# 停用模型（用户将无法选择该模型）
curl -X PUT "http://172.16.1.5:3002/admin/models/${MODEL_ID}" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"isActive": false}'

# 重新启用
curl -X PUT "http://172.16.1.5:3002/admin/models/${MODEL_ID}" \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"isActive": true}'
```

### 5.5 生成充值卡

```bash
# 通过数据库生成充值卡
PGPASSWORD="<animaapp密码>" PGSSLMODE=require psql \
  -h anima-db.postgres.database.azure.com \
  -U animaapp -d librechat \
  -c "INSERT INTO recharge_cards (key, credit_fen, label)
      SELECT 'ANIMA-' || upper(encode(gen_random_bytes(8),'hex')), 2000, '¥20 充值卡'
      FROM generate_series(1,5)   -- 一次生成5张
      RETURNING key, credit_fen, label;"
```

### 5.6 人工为用户充值

```bash
curl -X POST http://172.16.1.5:3002/admin/adjust \
  -H "Authorization: Bearer ${ADMIN_TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{
    "userEmail":   "user@example.com",
    "amount_fen":  2000,
    "type":        "recharge",
    "description": "管理员手动充值 ¥20"
  }'
```

---

## API 接口完整参考

### 公开接口（无需鉴权）

#### `GET /health` — 健康检查

```bash
curl http://172.16.1.5:3002/health
```
```json
{"status":"ok","db":"ok","ts":"2026-01-01T00:00:00.000Z"}
```

---

#### `GET /models` — 查看所有可用模型及定价

```bash
curl http://172.16.1.5:3002/models
```
```json
{
  "success": true,
  "models": [
    {
      "provider": "anthropic",
      "model_name": "claude-haiku-4-5-20251001",
      "display_name": "Claude Haiku 4.5",
      "is_free": true,
      "price_input_per_1k_chars": "0.0000",
      "price_output_per_1k_chars": "0.0000",
      "description": "免费模型"
    }
  ]
}
```

---

#### `POST /activate` — 充值卡激活

```bash
curl -X POST http://172.16.1.5:3002/activate \
  -H "Content-Type: application/json" \
  -d '{"cardKey":"ANIMA-TOP20-DEMO","userEmail":"user@example.com"}'
```
**成功响应：**
```json
{
  "success": true,
  "msg": "充值成功",
  "credit_fen": 2000,
  "balance_fen": 2000,
  "label": "¥20 演示充值卡"
}
```
**失败响应：**
```json
{"success": false, "msg": "卡密无效或已使用"}
```

---

#### `GET /billing/balance/:email` — 查询用户余额

```bash
curl "http://172.16.1.5:3002/billing/balance/user@example.com"
```
```json
{
  "success": true,
  "balance_fen": 1950,
  "total_charged_fen": 50,
  "is_suspended": false
}
```

---

#### `GET /billing/history/:email` — 查询消费历史（支持分页）

```bash
# 第一页（默认20条）
curl "http://172.16.1.5:3002/billing/history/user@example.com"

# 分页
curl "http://172.16.1.5:3002/billing/history/user@example.com?limit=10&offset=10"
```
```json
{
  "success": true,
  "total": 42,
  "records": [
    {
      "type": "charge",
      "amount_fen": "15.0000",
      "balance_after_fen": "1985.00",
      "description": "claude-sonnet-4-5（输入 300 字 / 输出 200 字）",
      "created_at": "2026-01-01T12:00:00.000Z"
    }
  ]
}
```

---

#### `POST /billing/check` — 调用前预检余额（不扣费）

```bash
curl -X POST http://172.16.1.5:3002/billing/check \
  -H "Content-Type: application/json" \
  -d '{
    "userEmail": "user@example.com",
    "modelName": "claude-sonnet-4-5",
    "estimatedInputChars": 2000,
    "estimatedOutputChars": 500
  }'
```
```json
{
  "success": true,
  "can_proceed": true,
  "is_free": false,
  "estimated_fen": 8,
  "balance_fen": 1950,
  "is_suspended": false
}
```

---

#### `POST /billing/record` — 记录 API 调用并计费（由 OpenClaw 自动调用）

```bash
curl -X POST http://172.16.1.5:3002/billing/record \
  -H "Content-Type: application/json" \
  -d '{
    "userEmail":   "user@example.com",
    "apiProvider": "anthropic",
    "modelName":   "claude-sonnet-4-5",
    "inputChars":  500,
    "outputChars": 200
  }'
```
**成功（付费模型）：**
```json
{"success":true,"is_free":false,"charged_fen":3,"balance_fen":1947}
```
**成功（免费模型）：**
```json
{"success":true,"is_free":true,"charged_fen":0,"balance_fen":null}
```
**余额不足（HTTP 402）：**
```json
{"success":false,"msg":"余额不足，请充值后继续使用","balance_fen":0,"required_fen":3}
```
**账户暂停（HTTP 403）：**
```json
{"success":false,"msg":"账户已被暂停"}
```
**模型不存在（HTTP 404）：**
```json
{"success":false,"msg":"模型不存在，请先通过 POST /admin/models 注册"}
```
**模型未启用（HTTP 400）：**
```json
{"success":false,"msg":"该模型当前未启用，无法计费"}
```

---

### 管理员接口（需 `Authorization: Bearer <ADMIN_TOKEN>`）

#### `GET /admin/models` — 查看所有模型（含未启用）

```bash
curl http://172.16.1.5:3002/admin/models \
  -H "Authorization: Bearer ${ADMIN_TOKEN}"
```

---

#### `POST /admin/models` — 添加或更新模型定价

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `provider` | string | ✅ | `anthropic`/`openai`/`mistral` 等 |
| `modelName` | string | ✅ | API 中使用的模型标识符（唯一键） |
| `displayName` | string | ✅ | 界面显示名称 |
| `isFree` | boolean | ✅ | `true` = 免费，`false` = 付费 |
| `priceInput` | number | 付费必填 | 输入价格（元/1000字），必须 ≥ 0 |
| `priceOutput` | number | 付费必填 | 输出价格（元/1000字），必须 ≥ 0 |
| `description` | string | 可选 | 管理员备注 |

> 若 `modelName` 已存在，会自动更新（upsert）并重新激活（`is_active=true`）。

---

#### `PUT /admin/models/:id` — 修改模型定价或启停

| 字段 | 类型 | 说明 |
|------|------|------|
| `isFree` | boolean | 切换免费/付费（切为免费时自动清零价格） |
| `priceInput` | number | 修改输入价，必须 ≥ 0 |
| `priceOutput` | number | 修改输出价，必须 ≥ 0 |
| `isActive` | boolean | `true`=启用，`false`=停用 |
| `displayName` | string | 修改显示名称 |
| `description` | string | 修改备注 |

---

#### `POST /admin/adjust` — 人工调整用户余额

| 字段 | 类型 | 说明 |
|------|------|------|
| `userEmail` | string | 用户邮箱 |
| `amount_fen` | number | 调整金额（分）。正数 = 增加，负数 = 减少 |
| `type` | string | `recharge`/`refund`/`admin_adjust` |
| `description` | string | 操作说明（可选） |

```json
{"success":true,"balance_fen":3000,"actual_applied_fen":500}
```

> `actual_applied_fen`：负数调整时，若余额不足以完全扣减，此字段显示实际扣减金额（余额会被截断到 0，不会出现负余额）。

---

## 常用运维 SQL

```sql
-- ─── 查看余额 ──────────────────────────────────────────────
SELECT user_email, balance_fen, total_charged_fen, is_suspended
FROM user_billing ORDER BY total_charged_fen DESC;

-- ─── 查看近期流水 ──────────────────────────────────────────
SELECT user_email, type, amount_fen, balance_after_fen, description, created_at
FROM billing_transactions ORDER BY created_at DESC LIMIT 20;

-- ─── 今日各模型调用量 ──────────────────────────────────────
SELECT * FROM v_today_model_usage;

-- ─── 查看所有模型定价 ──────────────────────────────────────
SELECT id, provider, model_name, display_name, is_free,
       price_input_per_1k_chars, price_output_per_1k_chars, is_active
FROM api_models ORDER BY provider, model_name;

-- ─── 修改模型价格 ──────────────────────────────────────────
UPDATE api_models
SET price_input_per_1k_chars=0.025, price_output_per_1k_chars=0.050
WHERE model_name='claude-sonnet-4-5';

-- ─── 生成充值卡 ────────────────────────────────────────────
INSERT INTO recharge_cards (key, credit_fen, label)
VALUES ('ANIMA-' || upper(encode(gen_random_bytes(8),'hex')), 2000, '¥20 充值卡');

-- ─── 批量生成充值卡 ────────────────────────────────────────
SELECT 'ANIMA-' || upper(encode(gen_random_bytes(8),'hex')) AS key,
       2000 AS credit_fen,
       '¥20 充值卡' AS label
FROM generate_series(1,10);
-- 将上面输出复制到 INSERT 语句中

-- ─── 暂停/恢复用户 ────────────────────────────────────────
UPDATE user_billing SET is_suspended=true  WHERE user_email='user@example.com';
UPDATE user_billing SET is_suspended=false WHERE user_email='user@example.com';

-- ─── 启用本地 Ollama 模型（如需） ─────────────────────────
UPDATE api_models SET is_active=true WHERE provider='ollama';
```

---

## 故障排查

### Webhook 服务无法启动

```bash
# 查看详细日志
journalctl -u ai-webhook -n 50 --no-pager

# 常见原因：
# 1. .env 中 PG_PASSWORD 错误 → 修改后 systemctl restart ai-webhook
# 2. 数据库连接失败 → 检查 Azure PostgreSQL 防火墙是否允许 172.16.1.5
# 3. 端口已被占用 → ss -tlnp | grep 3002
```

### 数据库 Schema 初始化失败

```bash
# 手动执行 Schema（使用正确的 SSL 参数）
PGPASSWORD="<密码>" PGSSLMODE=require psql \
  -h anima-db.postgres.database.azure.com \
  -U animaapp -d librechat \
  -f /opt/ai/repo/db/schema.sql

# 检查错误（不过滤输出）
PGPASSWORD="<密码>" PGSSLMODE=require psql \
  -h anima-db.postgres.database.azure.com \
  -U animaapp -d librechat \
  -c "\dt"   # 列出所有表
```

### LibreChat 容器启动失败

```bash
cd /opt/ai/repo/librechat
docker compose logs --tail=100 librechat

# 常见原因：
# 1. POSTGRES_URI 密码错误
# 2. JWT_SECRET 太短（需至少 32 字节随机值）
# 3. 内存不足（需 1GB+）
docker stats librechat
```

### OpenClaw 计费 Webhook 失败

```bash
# 测试 Webhook 连通性（在 VPS B 上执行）
curl -X POST http://172.16.1.5:3002/billing/record \
  -H "Content-Type: application/json" \
  -d '{"userEmail":"test@test.com","apiProvider":"anthropic","modelName":"claude-haiku-4-5-20251001","inputChars":100,"outputChars":50}'
# 预期：{"success":true,"is_free":true,...}

# 检查 OpenClaw 日志
cd /opt/ai/repo/openclaw
docker compose logs --tail=50 openclaw
```

### Nginx 配置测试失败

```bash
nginx -t
# 若报错 "unknown directive http2"，说明 Nginx 版本 < 1.25.1
# 解决：编辑 /etc/nginx/sites-available/anima
# 将 "http2 on;" 删除，改为 listen 行改为：
# listen 443 ssl http2;
# listen [::]:443 ssl http2;

# 查看 Nginx 版本
nginx -v
```

### 查询 ADMIN_TOKEN

```bash
grep ADMIN_TOKEN /opt/ai/webhook/.env
```

---

> 完整网络架构与 WireGuard 组网详见 `Anima灵枢_完整部署教程_172.16.1.0_24.docx`
