# 文件分析模块

## 概述

AI 驱动的文件分析能力，支持上传文档、图片、代码文件并由 AI 进行分析。

## 功能

- 文档分析（PDF、Word、TXT、Markdown）
- 图片分析（OCR 文字提取、图片描述）
- 代码审查（代码文件分析、Bug 检测）
- 表格数据分析（CSV、Excel）
- 文件摘要生成

## 当前状态

✅ **已启用** — LibreChat 原生支持文件上传和分析：

- 单文件大小限制：50MB（可在 librechat/.env 中调整 `FILE_SIZE_LIMIT`）
- 上传目录：`librechat/uploads/`
- 支持拖拽上传

## 使用方式

1. 在 LibreChat Web UI 对话框中点击 📎 附件图标
2. 选择文件上传
3. 输入分析指令，如："请总结这份文档"、"这段代码有什么问题？"

## 支持的文件格式

| 类型 | 格式 |
|------|------|
| 文档 | PDF, DOCX, TXT, MD, RTF |
| 表格 | CSV, XLSX, TSV |
| 图片 | PNG, JPG, GIF, WebP |
| 代码 | JS, PY, GO, Java, C, 等 |

## 配置

在 `librechat/.env` 中：

```bash
# 单文件大小限制（字节）
FILE_SIZE_LIMIT=52428800   # 50 MB
```

## 依赖

- LibreChat（核心模块）
- AI 模型需支持文件/图片分析（如 Claude、GPT-4o）
