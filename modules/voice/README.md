# 语音交互模块

## 概述

提供完整的语音输入（STT）和语音输出（TTS）能力，
支持用户通过语音与 AI 对话。

## 组件

| 组件 | 技术 | 部署节点 | 端口 |
|------|------|----------|------|
| 语音识别 (STT) | OpenAI Whisper Small (CPU int8) | CXI4 (172.16.1.5) | 8080 |
| 语音合成 (TTS) | Coqui TTS 中文 Baker | CXI4 (172.16.1.5) | 8082 |

## 功能

- 语音转文字（Whisper Small，中文优先，10 秒音频 ≈ 3 秒识别）
- 文字转语音（Coqui TTS 中文 Baker 模型，延迟 <100ms）
- 实时语音对话（STT → AI → TTS）
- 语音消息处理（微信/Telegram 语音消息自动转文字）

## 快速部署

### Whisper STT（CXI4）

```bash
cd modules/voice
docker compose -f docker-compose.whisper.yml up -d
```

### Coqui TTS（CXI4）

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
curl -X POST http://172.16.1.5:8082/api/tts \
  -H "Content-Type: application/json" \
  -d '{"text": "你好，我是 Anima", "language": "zh"}' \
  --output output.wav
```

## 架构

```
用户语音 → Whisper STT (CXI4) → 文字 → AI 推理 → 文字 → Coqui TTS (CXI4) → 语音回复
```

## 资源分配

STT 和 TTS 均部署在 CXI4（i7-10610U / 8GB），充分利用其大内存：
- Whisper Small: 2GB 内存，2 核 CPU
- Coqui TTS Baker: 768MB 内存，1 核 CPU
- 总计约 2.8GB，CXI4 还余 ~4GB 供其他服务使用

## 当前状态

- ✅ Whisper STT：已在 nginx/anima.conf 中配置路由（/whisper/ → CXI4）
- ✅ Coqui TTS：已在 nginx/anima.conf 中配置路由（/tts/ → CXI4）
- ✅ OpenClaw config.yml 已配置 voice.recognition 和 voice.synthesis URL

## 依赖

- CXI4 节点（CPU 运行 Whisper Small int8 量化，无需 GPU）
- 约 2.8GB 内存（Whisper Small + Coqui TTS Baker）
