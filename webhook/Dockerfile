FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY server.js ./
COPY public/ ./public/
USER node
EXPOSE 3002
CMD ["node", "server.js"]
