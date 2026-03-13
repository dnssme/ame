FROM node:20-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    chromium \
    && rm -rf /var/lib/apt/lists/*

ENV CHROME_BIN=/usr/bin/chromium
ENV PUPPETEER_SKIP_DOWNLOAD=true

WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev
COPY bot.js ./

USER node
EXPOSE 3001
CMD ["node", "bot.js"]
