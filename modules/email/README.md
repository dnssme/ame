# 邮件处理模块

## 概述

提供 AI 驱动的邮件处理能力：自动收取邮件、AI 分析/摘要、智能回复建议、邮件发送。

## 功能

- IMAP 轮询收取新邮件
- AI 自动摘要（调用 Agent API）
- 智能回复建议生成
- SMTP 邮件发送
- 邮件分类和标记
- 定时检查新邮件（可配置间隔）

## 部署节点

CXI4 (172.16.1.5) 或独立容器

## 快速部署

```bash
cd modules/email
cp .env.example .env
vim .env  # 填写 IMAP/SMTP 配置
docker compose up -d
```

## 架构

```
邮箱服务器 ←IMAP→ Email 模块 → Agent API → AI 分析/摘要
                      ↓
                   SMTP 发送回复
```

## 依赖

- OpenClaw Agent（AI 分析）
- IMAP/SMTP 邮箱服务（如 Gmail、QQ 邮箱、自建邮箱）
