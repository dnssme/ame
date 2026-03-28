# Anima 灵枢 · Webhook 计费服务 v5.28

## 概述

Anima 灵枢的订阅激活与 API 计费 Webhook 服务，负责用户余额管理、充值卡激活、API 调用计费、模型/供应商管理等核心业务功能。

- **部署节点**：VPS E (172.16.1.6)
- **默认端口**：3002
- **运行时**：Node.js ≥ 20.0.0
- **数据库**：PostgreSQL（Azure 托管）
- **缓存**：Redis（用于限速和缓存）
- **安全标准**：PCI-DSS v4.0 / CIS v8 合规

## 快速启动

```bash
# 安装依赖
npm install

# 复制环境变量模板
cp .env.example .env
# 编辑 .env 配置数据库、Redis、Token 等参数

# 开发模式（自动重启）
npm run dev

# 生产模式
npm start
```

## 部署方式

### systemd 服务（推荐）

```bash
sudo tee /etc/systemd/system/ai-webhook.service > /dev/null <<'EOF'
[Unit]
Description=Anima Webhook Service
After=network.target

[Service]
Type=simple
User=ai
WorkingDirectory=/opt/ai/webhook
ExecStart=/usr/bin/node server.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
Environment=NODE_OPTIONS=--max-old-space-size=256

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now ai-webhook
```

### Docker（通过主 docker-compose.yml）

```bash
docker compose up -d webhook
```

## API 端点

### 公开端点（无需认证）

| 端点 | 方法 | 说明 |
|------|------|------|
| `/health` | GET | 健康检查（验证 DB 和 Redis 连通性） |
| `/models` | GET | 获取可用 AI 模型列表（缓存 30s） |
| `/providers` | GET | 获取 API 供应商列表（缓存 30s） |
| `/activate` | POST | 激活充值卡（需 cardKey + userEmail） |

### 计费端点（需 SERVICE_TOKEN）

| 端点 | 方法 | 说明 |
|------|------|------|
| `/billing/balance/:email` | GET | 查询用户余额和停用状态 |
| `/billing/history/:email` | GET | 查询用户计费历史（分页） |
| `/billing/check` | POST | 预检用户余额（估算 API 调用费用） |
| `/billing/record` | POST | 记录 API 使用并扣费（仅内部服务调用） |

### 管理端点（需 ADMIN_TOKEN）

| 端点 | 方法 | 说明 |
|------|------|------|
| `/admin/dashboard` | GET | 管理后台页面 |
| `/admin/modules` | GET | 模块状态查询 |
| `/admin/models` | GET | 列出所有 AI 模型（含未激活） |
| `/admin/models` | POST | 创建 AI 模型 |
| `/admin/models/:id` | PUT | 更新 AI 模型 |
| `/admin/models/:id` | DELETE | 停用 AI 模型 |
| `/admin/providers` | GET | 列出 API 供应商 |
| `/admin/providers` | POST | 创建 API 供应商 |
| `/admin/providers/:id` | PUT | 更新 API 供应商 |
| `/admin/providers/:id` | DELETE | 停用 API 供应商 |
| `/admin/adjust` | POST | 调整用户余额（支持加/减，含审计日志） |
| `/admin/users` | GET | 列出所有用户（分页） |
| `/admin/users/:email/suspend` | PUT | 停用用户账号 |
| `/admin/users/:email/unsuspend` | PUT | 恢复用户账号 |
| `/admin/cards` | POST | 批量创建充值卡（最多 100 张/次） |
| `/admin/cards` | GET | 列出充值卡（支持按状态筛选） |

## 安全特性

- **TOKEN 对比**：使用 `crypto.timingSafeEqual` 防止时序攻击
- **SQL 注入防护**：所有查询参数化
- **事务与行锁**：关键金融操作（激活、扣费、调整）使用 `FOR UPDATE` 行锁
- **余额防护**：扣费 SQL 附加 `WHERE balance_fen >= $amount` 防止超额扣费
- **请求限速**：基于 Redis 的接口级限速
- **安全头**：Helmet 安全头配置
- **连接限制**：`maxRequestsPerSocket` 限制单连接请求数

## 依赖

- PostgreSQL（Azure 托管，用于用户数据、计费记录、模型/供应商配置）
- Redis（用于限速和缓存）

## 端口

- `3002` — Webhook 服务 + 健康检查
