# 语音交互模块

## 概述

提供完整的语音输入（STT）和语音输出（TTS）能力，
支持用户通过语音与 AI 对话。

## 组件

| 组件 | 技术 | 部署节点 | 端口 |
|------|------|----------|------|
| 语音识别 (STT) | OpenAI Whisper | CXI4 (172.16.1.5) | 8080 |
| 语音合成 (TTS) | Coqui TTS | VPS-A (127.0.0.1) | 8082 |

## 功能

- 语音转文字（Whisper，支持中英文）
- 文字转语音（Coqui TTS，支持多语言多声音）
- 实时语音对话（STT → AI → TTS）
- 语音消息处理（微信/Telegram 语音消息自动转文字）

## 快速部署

### Whisper STT（CXI4）

```bash
cd modules/voice
docker compose -f docker-compose.whisper.yml up -d
```

### Coqui TTS（VPS-A 或本地）

```bash
cd modules/voice
docker compose -f docker-compose.tts.yml up -d
```

## API 接口

### STT（语音转文字）
```bash
curl -X POST http://172.16.1.5:8080/transcribe \
  -F "file=@audio.wav" \
  -F "language=zh"
```

### TTS（文字转语音）
```bash
curl -X POST http://172.16.1.1:8082/api/tts \
  -H "Content-Type: application/json" \
  -d '{"text": "你好，我是 Anima", "language": "zh"}' \
  --output output.wav
```

## 架构

```
用户语音 → Whisper STT → 文字 → AI 推理 → 文字 → Coqui TTS → 语音回复
```

## 当前状态

- ✅ Whisper STT：已在 nginx/anima.conf 中配置路由（/whisper/）
- ✅ Coqui TTS：已在 nginx/anima.conf 中配置路由（/tts/）
- ✅ OpenClaw config.yml 已配置 voice.recognition 和 voice.synthesis URL

## 依赖

- CXI4 节点（GPU 推荐，CPU 也可运行，但速度较慢）
- 约 2GB 内存（Whisper base 模型）
