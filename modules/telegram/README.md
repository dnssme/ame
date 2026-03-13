# Telegram 接入模块

## 概述

基于 [Telegraf](https://github.com/telegraf/telegraf) 框架，将 Anima 灵枢 AI 助手接入 Telegram。
用户通过 Telegram Bot 与 AI 对话，支持文字、语音、文件发送。

## 功能

- Telegram Bot 接入（通过 BotFather 创建）
- 文字消息 → AI 对话
- 语音消息 → Whisper STT → AI → TTS → 语音回复
- 文件发送 → 文件分析
- 群聊 /ai 命令或 @机器人 触发
- 上下文记忆（Redis 会话缓存）
- /balance 查询余额
- /model 切换模型

## 部署节点

VPS-B (172.16.1.2) 或独立容器

## 快速部署

```bash
cd modules/telegram
cp .env.example .env
vim .env  # 填写 Telegram Bot Token 等
docker compose up -d
```

## 获取 Bot Token

1. 在 Telegram 中搜索 @BotFather
2. 发送 `/newbot` 创建机器人
3. 按提示设置名称，获取 Token
4. 将 Token 填入 `.env` 文件

## 架构

```
Telegram 用户 → Telegraf Bot → OpenClaw Agent API → AI 推理
                                      ↓
                               Webhook 计费
```

## 依赖

- OpenClaw Agent（核心模块）
- Redis（会话缓存）
- Webhook 计费服务（可选）
