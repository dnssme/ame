# 网页搜索模块

## 概述

AI 代理的网页搜索能力，支持在对话中自动检索互联网信息。

## 功能

- DuckDuckGo 搜索（默认，无需 API Key）
- 搜索结果摘要（AI 自动总结搜索内容）
- 多搜索引擎支持（可扩展 Google、Bing）
- 搜索结果限制（默认 5 条，可配置）

## 当前状态

✅ **已启用** — 在 OpenClaw config.yml 中预配置：

```yaml
tools:
  search:
    enabled: true
    provider: duckduckgo
    maxResults: 5
```

## 使用方式

在 AI 对话中直接提问需要搜索的问题：

- "今天的新闻头条是什么？"
- "Python 3.12 有什么新特性？"
- "搜索一下最近的 AI 论文"

AI Agent 会自动判断是否需要搜索，并整合搜索结果回答。

## 扩展

如需使用 Google Custom Search 或 Bing API：

1. 修改 `openclaw/config.yml` 中的 `tools.search.provider`
2. 添加对应 API Key 到 `openclaw/.env`

## 依赖

- OpenClaw Agent（核心模块）
- 互联网访问（VPS-B 需要外网连接）
