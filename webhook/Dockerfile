FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY server.js ./
COPY public/ ./public/
USER node
EXPOSE 3002
# FIX-5.21-3: CIS Docker 5.6——容器级健康检查
HEALTHCHECK --interval=30s --timeout=10s --start-period=15s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3002/health',r=>{process.exit(r.statusCode===200?0:1)}).on('error',()=>process.exit(1))"
CMD ["node", "server.js"]
