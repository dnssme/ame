FROM node:20-slim
WORKDIR /app
COPY package*.json ./
RUN npm install --omit=dev && npm cache clean --force
COPY processor.js ./
USER node
CMD ["node", "processor.js"]
