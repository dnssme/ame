FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY bot.js ./
USER node
CMD ["node", "bot.js"]
