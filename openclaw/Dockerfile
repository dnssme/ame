# =============================================================
# Anima 灵枢 · OpenClaw Agent Dockerfile
# 部署节点：VPS B (172.16.1.2)
#
# ⚠️ OpenClaw 应用源码不包含在本仓库中。
#    构建前请将 OpenClaw 源码（含 package.json 和 server.js）
#    放入本目录（openclaw/），然后执行：
#      docker compose build openclaw
#
#    或从私有镜像仓库拉取预构建镜像：
#      将下方 FROM 改为你的私有镜像地址，并删除 COPY/RUN 指令
# =============================================================

FROM node:20-slim

WORKDIR /app

COPY package*.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY . .

EXPOSE 3000

CMD ["node", "server.js"]
