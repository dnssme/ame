# Anima 灵枢 · 手机 APP 方案

## 概述

提供独立的手机 APP，直接连接 Anima 灵枢后端，不依赖微信/Telegram 等第三方平台。

## 方案对比

| 方案 | 平台 | 技术栈 | 开源协议 | 推荐度 |
|------|------|--------|----------|--------|
| **方案一：Maid** | iOS + Android | Flutter/Dart | MIT | ⭐⭐⭐⭐⭐ |
| **方案二：chatbox** | iOS + Android + 桌面 | React Native | GPL-3.0 | ⭐⭐⭐⭐ |
| **方案三：LibreChat PWA** | 全平台浏览器 | Web PWA | MIT | ⭐⭐⭐⭐ |
| **方案四：自建 Flutter APP** | iOS + Android | Flutter/Dart | 自定义 | ⭐⭐⭐ |

---

## 方案一：Maid（推荐）

### 简介

[Maid](https://github.com/Mobile-Artificial-Intelligence/maid) 是一个跨平台的开源 AI 聊天应用，
基于 Flutter 开发，支持连接自定义 OpenAI 兼容 API 端点。

### 为什么推荐

- ✅ **完全开源**（MIT 协议），可自由修改品牌和功能
- ✅ **Flutter 跨平台**，一套代码同时支持 iOS 和 Android
- ✅ **支持自定义 API 端点**，可直接连接 Anima 后端
- ✅ **支持多模型切换**
- ✅ **本地对话历史**
- ✅ **Material Design 3 UI**，界面美观
- ✅ **活跃维护**

### 适配步骤

#### 1. 克隆并修改

```bash
git clone https://github.com/Mobile-Artificial-Intelligence/maid.git
cd maid
```

#### 2. 修改品牌

编辑 `lib/main.dart` 和相关文件：
- APP 名称改为 "Anima 灵枢"
- 修改图标和启动画面
- 修改默认 API 端点为你的域名

#### 3. 配置 API 连接

在 APP 设置中：
- API Base URL: `https://<你的域名>/api`
- API 类型: OpenAI Compatible
- 无需 API Key（使用 LibreChat JWT 认证）

#### 4. 编译安装

```bash
# Android
flutter build apk --release

# iOS
flutter build ios --release
```

### 自定义开发参考

APP 配置文件 `app_config.json`（放在 APP 资源目录中）：

```json
{
  "appName": "Anima 灵枢",
  "apiBaseUrl": "https://你的域名",
  "defaultModel": "claude-haiku-4-5-20251001",
  "features": {
    "voice": true,
    "fileUpload": true,
    "calendar": true,
    "cloudStorage": true
  },
  "theme": {
    "primaryColor": "#6366F1",
    "darkMode": true
  }
}
```

---

## 方案二：chatbox

### 简介

[Chatbox](https://github.com/Bin-Huang/chatbox) 是一个跨平台 AI 客户端，
支持桌面和移动端，可连接自定义 API。

### 适配方式

1. 下载 Chatbox 源码
2. 修改默认 API 端点为 Anima 后端
3. 自定义品牌（APP 名称、图标）
4. 编译为 APK / IPA

---

## 方案三：LibreChat PWA（零开发）

### 简介

LibreChat 自带 PWA（渐进式 Web 应用）支持，用户无需安装 APP，
直接通过浏览器添加到主屏幕即可获得类似原生 APP 的体验。

### 使用步骤

#### iOS
1. 用 Safari 打开 `https://<你的域名>`
2. 点击分享按钮 → "添加到主屏幕"
3. 主屏幕出现 Anima 图标，点击即可使用

#### Android
1. 用 Chrome 打开 `https://<你的域名>`
2. 点击菜单 → "添加到主屏幕" 或 "安装应用"
3. 主屏幕出现 Anima 图标

### 特点

- ✅ 无需开发和编译
- ✅ 自动更新（跟随 Web 端）
- ✅ 全功能（与 Web 端完全一致）
- ❌ 无法访问原生 API（如推送通知、日历同步）
- ❌ 无法上架应用商店

---

## 方案四：自建 Flutter APP

如需完全自主控制，可基于 Flutter 从头构建。

### 技术栈推荐

```
Flutter 3.x + Dart
├── 状态管理：Riverpod 或 Bloc
├── 网络请求：Dio
├── 本地存储：Hive 或 SQLite
├── 语音：speech_to_text + flutter_tts
├── 日历：device_calendar
└── UI 组件：Material Design 3
```

### 核心功能实现

| 功能 | Flutter 包 | 说明 |
|------|-----------|------|
| AI 对话 | dio | HTTP/SSE 连接 LibreChat API |
| 语音输入 | speech_to_text | 调用系统 STT |
| 语音输出 | flutter_tts | 调用系统 TTS |
| 日历管理 | device_calendar | 读写系统日历 |
| 文件上传 | file_picker + dio | 选文件 + 上传 |
| 推送通知 | firebase_messaging | FCM 推送 |
| 本地存储 | hive | 对话历史缓存 |

### API 对接

APP 通过以下端点与 Anima 后端通信：

```
POST   /api/auth/login          — 用户登录（获取 JWT）
POST   /api/auth/register       — 用户注册
GET    /api/models              — 获取可用模型列表
POST   /api/ask                 — 发送消息（流式响应）
POST   /api/files/upload        — 上传文件
GET    /api/convos              — 获取对话列表
POST   /activate                — 充值卡激活
GET    /billing/balance/:email  — 查询余额（通过 Nginx 代理）
POST   /whisper/transcribe      — 语音转文字
POST   /tts/api/tts             — 文字转语音
```

---

## 推荐方案

### 快速上线（1-2 天）
→ **方案三：PWA**（零开发，立即可用）

### 品牌 APP（1-2 周）
→ **方案一：Maid 适配**（开源 Flutter，修改品牌 + API 端点）

### 完全自主（1-2 月）
→ **方案四：自建 Flutter APP**（最大灵活性）
