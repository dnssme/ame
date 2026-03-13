# 微信接入模块

## 概述

基于 [Wechaty](https://github.com/wechaty/wechaty) 开源框架，将 Anima 灵枢 AI 助手接入微信。
用户在微信中直接与 AI 对话，支持文字、语音、文件发送。

## 功能

- 微信个人号/企业微信接入
- 文字消息 → AI 对话
- 语音消息 → Whisper STT → AI → TTS → 语音回复
- 文件发送 → 文件分析
- 群聊 @机器人 触发 AI 回复
- 上下文记忆（Redis 会话缓存）

## 部署节点

VPS-B (172.16.1.2) 或独立容器

## 快速部署

```bash
cd modules/wechat
cp .env.example .env
vim .env  # 填写配置
docker compose up -d
```

## 架构

```
微信用户 → Wechaty Bot → OpenClaw Agent API → AI 推理
                                  ↓
                           Webhook 计费
```

## 依赖

- OpenClaw Agent（核心模块）
- Redis（会话缓存）
- Webhook 计费服务（可选，用于计费）
