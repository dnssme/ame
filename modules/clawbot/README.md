# 微信 ClawBot 插件接入模块

## 概述

基于微信官方 ClawBot 插件 API，将 Anima 灵枢 AI 助手接入微信。
用户通过微信 ClawBot 插件与 AI 对话，支持文字、语音、图片/文件发送。

## 功能

### ClawBot 核心功能
- 文字消息 → AI 对话（支持 70+ 模型）
- 语音消息 → Whisper STT → AI → TTS → 语音回复
- 图片/文件 → 文件分析
- 消息分段发送（适配微信 2000 字符上限）
- 长耗时任务异步回复（通过客服消息接口）

### 安全与认证
- 微信签名验证（token + timestamp + nonce SHA1）
- **强制登录认证**：用户必须绑定邮箱后才可使用 AI 功能
- **用户强隔离**：独立 Redis 键空间、独立会话、独立计费

### 整合功能
- /bind <邮箱> — 绑定计费邮箱（必须，首次使用前完成认证）
- /balance — 查询账户余额
- /model <模型名> — 切换 AI 模型
- /clear — 清除对话上下文
- /help — 查看帮助

## 部署节点

VPS-B (172.16.1.2) 或独立容器

## 快速部署

```bash
cd modules/clawbot
cp .env.example .env
vim .env  # 填写 ClawBot Token、AppID、AppSecret 等
docker compose up -d
```

## 获取 ClawBot 配置

1. 登录 [微信公众平台](https://mp.weixin.qq.com/)
2. 在「设置与开发 → 基本配置」中获取 AppID 和 AppSecret
3. 在「设置与开发 → 基本配置 → 服务器配置」中：
   - 设置服务器 URL 为 `https://your-domain/clawbot/webhook`
   - 设置 Token（自定义，与 .env 中 CLAWBOT_TOKEN 一致）
   - 设置 EncodingAESKey（可自动生成）
   - 选择消息加解密方式：明文模式
4. 将以上信息填入 `.env` 文件

## 架构

```
微信用户 → ClawBot 插件 → 微信服务器 → HTTP Webhook → 灵枢 ClawBot Bot
                                                        ↓
                                              OpenClaw Agent API → AI 推理
                                                        ↓
                                                  Webhook 计费
```

## 用户使用流程

1. 用户在微信中打开 ClawBot 插件
2. 首次使用发送 `/bind 邮箱@example.com` 完成认证
3. 认证后直接发送消息即可与 AI 对话
4. 使用 `/model` 切换模型、`/balance` 查询余额

## 依赖

- OpenClaw Agent（核心模块）
- Redis（会话缓存 + 用户认证）
- Webhook 计费服务（余额查询/计费）

## 端口

- `3004` — ClawBot Webhook 服务 + 健康检查
