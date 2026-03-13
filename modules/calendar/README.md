# 日历管理模块

## 概述

通过 Nextcloud CalDAV 协议，实现 AI 驱动的日历管理，支持手机/电脑/Web 多端同步。

## 功能

- 自然语言创建日程（"明天下午3点开会"）
- 查询日程安排（"今天有什么安排？"）
- 修改/取消日程
- 日程提醒推送（通过 Telegram/微信通知）
- CalDAV 协议同步：iOS 日历、Google Calendar、Thunderbird 等客户端
- Web 端日历视图（通过 Nextcloud Web UI）

## 手机同步设置

### iOS
1. 设置 → 日历 → 账户 → 添加账户 → 其他 → CalDAV
2. 服务器：`https://<你的域名>/nextcloud/remote.php/dav`
3. 用户名/密码：Nextcloud 账号

### Android
1. 安装 DAVx⁵ 应用（开源，F-Droid 可下载）
2. 添加账户 → 输入 Nextcloud CalDAV 地址
3. 自动同步到系统日历

### 电脑端
- Nextcloud Web UI：`https://<你的域名>/nextcloud/`
- Thunderbird：CalDAV 账户同步

## 部署节点

VPS-B (172.16.1.2)（Nextcloud 已在 OpenClaw config.yml 中配置）

## 快速部署

```bash
cd modules/calendar
cp .env.example .env
vim .env  # 填写 Nextcloud 配置
docker compose up -d
```

## 架构

```
用户 → AI 对话 "明天下午开会"
         ↓
   OpenClaw Agent → CalDAV API → Nextcloud
         ↓                          ↓
   确认回复              iOS/Android/Web 同步
```

## 依赖

- Nextcloud 服务（CalDAV 后端）
- OpenClaw Agent（AI 自然语言解析）
