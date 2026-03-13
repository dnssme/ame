# 用户网盘模块

## 概述

基于 Nextcloud WebDAV，为用户提供私有云存储服务。
用户可通过 Web、手机 APP、桌面客户端同步文件，AI 可分析网盘中的文件。

## 功能

- 文件上传/下载/管理（Web UI）
- 多设备同步（桌面/手机客户端）
- AI 文件分析（通过对话命令分析网盘文件）
- 文件分享（生成分享链接）
- WebDAV 协议（兼容各种客户端）
- 版本管理（文件历史版本）
- 回收站（误删恢复）

## 客户端安装

### 手机端
- **iOS**: App Store 搜索 "Nextcloud"
- **Android**: Google Play / F-Droid 搜索 "Nextcloud"

### 桌面端
- **Windows/macOS/Linux**: https://nextcloud.com/install/#install-clients

### Web 端
- 浏览器访问 `https://<你的域名>/nextcloud/`

## 部署节点

VPS-B (172.16.1.4)（复用日历模块的 Nextcloud 实例）

## 快速部署

如已部署日历模块（Nextcloud），网盘功能自动可用。
如需独立部署：

```bash
cd modules/cloud-storage
cp .env.example .env
vim .env
docker compose up -d
```

## 架构

```
用户手机/电脑 ←WebDAV→ Nextcloud ← AI Agent（文件分析）
                          ↓
                    数据库 + 文件存储
```

## Nginx 路由配置

在 nginx/anima.conf 中添加：

```nginx
location /nextcloud/ {
    proxy_pass         http://172.16.1.4:8090/;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
    client_max_body_size 1g;   # 大文件上传
    proxy_read_timeout 300s;
}
```

## 依赖

- Nextcloud 服务（复用 calendar 模块或独立部署）
- PostgreSQL 数据库
