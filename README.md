# Anima · 灵枢 私有 AI 手机助理

> 完整生产级部署 · API 计费 · 安全加固

## 目录结构

```
.
├── db/
│   └── schema.sql           # PostgreSQL 数据库 Schema（订阅、计费、配额）
├── webhook/
│   ├── package.json         # Node.js 依赖
│   └── server.js            # Webhook 计费服务（卡密激活 + API 计费）
├── nginx/
│   └── anima.conf           # Nginx 反向代理配置（HTTPS / 安全头 / 限速）
├── librechat/
│   ├── .env.example         # LibreChat 环境变量模板
│   └── docker-compose.yml   # LibreChat Docker Compose
├── openclaw/
│   ├── config.yml           # OpenClaw Agent 配置
│   └── docker-compose.yml   # OpenClaw Docker Compose
├── scripts/
│   └── setup.sh             # CXI4 一键初始化脚本
├── Anima灵枢_完整部署教程_172.16.1.0_24.docx        # 完整部署教程（章节指南）
└── Anima灵枢_网络架构与工作原理 - ....docx           # 网络架构详解
```

---

## 计费规则

| 模型类型 | 判断依据 | 每日免费额度 | 超出后计费 |
|----------|----------|-------------|-----------|
| **本地免费**（Ollama：Qwen、LLaMA、Gemma 等） | `provider=ollama` 或模型名匹配白名单 | **永久免费** | 不计费 |
| **付费云端**（Claude、Mistral、GPT-4 等） | provider≠ollama 且不在白名单 | **20 次/天**（所有套餐相同） | 按字数计费 |

### 付费套餐定价

| 套餐 | 输入价格 | 输出价格 | 月余额上限 |
|------|---------|---------|-----------|
| 免费版 | ¥0 | ¥0 | 无 |
| 基础版 | ¥0.01 / 1000字 | ¥0.02 / 1000字 | ¥100 |
| 专业版 | ¥0.008 / 1000字 | ¥0.016 / 1000字 | ¥500 |

> 每日 20 次免费额度跨套餐相同；超出后按字数从用户余额扣除；余额不足时返回 HTTP 402。

---

## 快速部署

### 前提条件

- 已按教程文档完成 Wireguard 组网（所有节点内网互通）
- Azure PostgreSQL 已创建并初始化三个数据库（librechat / openclaw / nextcloud）
- 所有节点已完成 UFW / fail2ban 基础安全加固

### 1. CXI4 — 初始化 Webhook 服务

```bash
# 克隆仓库
git clone https://github.com/dnssme/ame.git /opt/ai/repo
cd /opt/ai/repo

# 一键初始化（替换为实际密码）
bash scripts/setup.sh '<animaapp数据库密码>' '<Redis密码>'
```

> 脚本会自动安装 Node.js 20、初始化数据库 Schema、启动 systemd 服务。

验证：
```bash
curl http://172.16.1.5:3002/health
# 期望：{"status":"ok","db":"ok","ts":"..."}
```

### 2. VPS C — 部署 LibreChat

```bash
cd /opt/ai/repo/librechat
cp .env.example .env
vim .env  # 填入所有 <占位符>
chmod 600 .env
docker compose up -d
```

验证：
```bash
curl http://172.16.1.3:3080/health
```

### 3. VPS B — 部署 OpenClaw

```bash
cd /opt/ai/repo/openclaw
vim config.yml  # 填入密码、Token 等
mkdir -p data
docker compose up -d
```

### 4. VPS A — 配置 Nginx

```bash
# 替换域名后复制
sed 's/<你的域名>/ai.yourdomain.com/g' nginx/anima.conf \
  > /etc/nginx/sites-available/anima
ln -sf /etc/nginx/sites-available/anima /etc/nginx/sites-enabled/
nginx -t && systemctl reload nginx
```

---

## API 接口

### 卡密激活
```
POST /activate
Content-Type: application/json

{"cardKey":"ANIMA-BASIC-XXXX","userEmail":"user@example.com","plan":"basic"}
```

### 查询用户今日配额
```
GET /billing/quota/user@example.com
```

### 记录 API 调用（由 OpenClaw 自动调用）
```
POST /billing/record
Content-Type: application/json

{
  "userEmail": "user@example.com",
  "apiProvider": "anthropic",
  "modelName": "claude-haiku-4-5-20251001",
  "inputChars": 500,
  "outputChars": 200
}
```

---

## 安全说明

- **Nginx**：强制 HTTPS（TLS 1.2/1.3）、HSTS、CSP、X-Frame-Options 等安全响应头，限速防暴力枚举
- **Webhook**：仅绑定内网 `172.16.1.5`，`helmet` 安全头，全局 60 req/min 限速，激活接口 5 req/10min
- **数据库**：全部参数化查询防 SQL 注入，卡密激活使用事务+行锁防并发重复使用，连接字符串中 `sslmode=require`
- **Docker**：`no-new-privileges:true`，仅监听内网 IP，内存限制
- **密钥管理**：所有密码通过环境变量（`.env`）注入，不写入代码；`.env` 文件权限 `600`

---

## 常见问题

### 余额不足时会怎样？
Webhook 返回 HTTP 402，OpenClaw 会提示用户充值，不会调用付费 API。

### 如何生成卡密？
在 PostgreSQL 中执行：
```sql
INSERT INTO subscription_cards (key, plan, valid_days, credit_fen)
VALUES ('ANIMA-BASIC-' || upper(encode(gen_random_bytes(8),'hex')), 'basic', 30, 2000);
```

### 如何查看用户消费情况？
```sql
SELECT user_email, type, amount_fen, description, created_at
FROM billing_transactions
WHERE user_email='user@example.com'
ORDER BY created_at DESC
LIMIT 20;
```

### 修改计费价格？
```sql
UPDATE subscription_plans
SET price_input_per_1k_chars=0.008, price_output_per_1k_chars=0.016
WHERE name='basic';
```

---

> 完整部署步骤请参阅 `Anima灵枢_完整部署教程_172.16.1.0_24.docx`