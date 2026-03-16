# 智能家居控制模块

## 概述

通过 Home Assistant 集成，实现 AI 语音/文字控制智能家居设备。

## 功能

- 自然语言控制设备（"关掉客厅的灯"、"空调设为26度"）
- 查询设备状态（"家里温度多少？"）
- 场景自动化（"我回家了" → 开灯 + 开空调 + 播放音乐）
- 设备列表查询
- 定时任务（"10分钟后关灯"）

## 部署节点

Home Assistant Core 运行在 CXI4 (172.16.1.5:8123)，充分利用 8GB 内存和本地 Zigbee/WiFi/Matter 设备连接。

## 配置

### 1. 获取 Home Assistant 长期访问令牌

1. 打开 Home Assistant Web UI
2. 点击左下角用户头像 → 安全 → 长期访问令牌
3. 创建令牌并保存

### 2. 在 OpenClaw 中启用

已在 `openclaw/config.yml` 中预配置：

```yaml
tools:
  homeassistant:
    enabled: true
    baseUrl: http://172.16.1.5:8123
    token: ${HA_TOKEN}
```

只需在 `openclaw/.env` 中设置 `HA_TOKEN` 即可。

## 支持的设备类型

- 💡 灯光（开/关/调光/调色）
- 🌡 温控（空调/地暖/温度查询）
- 🔌 开关（插座/电器开关）
- 🚪 门锁/窗帘
- 📷 摄像头（查看截图）
- 🔔 传感器（温湿度/门窗/运动检测）

## 架构

```
用户 → AI 对话 "关掉客厅的灯"
         ↓
   OpenClaw Agent → Home Assistant REST API → 设备控制
         ↓
   确认回复 "已为你关闭客厅灯"
```

## 当前状态

- ✅ 已在 OpenClaw config.yml 中配置 Home Assistant 集成
- ✅ AI Agent 可通过自然语言调用 HA API

## 依赖

- Home Assistant 实例
- Home Assistant 长期访问令牌
- OpenClaw Agent（核心模块）
