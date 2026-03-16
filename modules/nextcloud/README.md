# Nextcloud 基础设施模块（必选）

## 概述

Nextcloud 是 Anima 灵枢的私有云平台基础设施，**必须部署**，为以下两个功能模块提供底层支撑：

| 功能模块 | 依赖协议 | 说明 |
|----------|----------|------|
| 日历管理（calendar） | CalDAV | AI 驱动的日程管理，多端同步 |
| 用户网盘（cloud-storage） | WebDAV | 私有文件存储，多设备同步 |

CalDAV 与 WebDAV 均为 Nextcloud 内置协议，无需额外安装插件。

## 快速部署

```bash
cd modules/nextcloud
cp .env.example .env
vim .env        # 填写数据库密码、Nextcloud 管理员密码
chmod 600 .env
docker compose up -d
```

部署完成后访问 `http://172.16.1.5:8090` 确认 Nextcloud 已正常启动。

## 访问地址

| 协议 | 地址 | 用途 |
|------|------|------|
| Web UI | `https://<域名>/nextcloud/` | 网盘管理、日历查看 |
| CalDAV | `https://<域名>/nextcloud/remote.php/dav/calendars/admin/` | iOS / Android / Thunderbird 同步 |
| WebDAV | `https://<域名>/nextcloud/remote.php/dav/files/admin/` | 桌面客户端 / 手机 APP 同步 |

## 数据卷说明

| 卷名 | 挂载路径 | 用途 |
|------|----------|------|
| `nextcloud_data` | `/var/www/html` | Nextcloud 应用程序数据 |
| `nextcloud_files` | `/var/www/html/data` | 用户上传文件（CalDAV 日历 + WebDAV 网盘共用） |

## Nginx 反向代理配置

在 `nginx/anima.conf` 中添加以下 location 块：

```nginx
location /nextcloud/ {
    proxy_pass         http://172.16.1.5:8090/;
    proxy_set_header   Host              $host;
    proxy_set_header   X-Real-IP         $remote_addr;
    proxy_set_header   X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header   X-Forwarded-Proto $scheme;
    client_max_body_size 1g;   # 支持大文件上传
    proxy_read_timeout 300s;
    proxy_hide_header  X-Powered-By;
}
```

## 部署顺序

```
1. 部署 Nextcloud（本模块）
      ↓
2. 部署 calendar 和/或 cloud-storage（可选功能模块）
      ↓
3. 在 openclaw/config.yml 中配置 tools.calendar 指向本模块地址
```

## 注意事项

- calendar 模块与 cloud-storage 模块**共用同一个 Nextcloud 实例**，无需重复部署
- 若 calendar 或 cloud-storage 中有旧版 Nextcloud 容器，请先 `docker compose down` 再启动本模块
- 数据迁移：将旧 `nextcloud_data` / `nextcloud_files` 卷挂载到本模块即可
