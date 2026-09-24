FROM node:22-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg python3 ca-certificates curl \
    && curl -L https://github.com/yt-dlp/yt-dlp/releases/latest/download/yt-dlp -o /usr/local/bin/yt-dlp \
    && chmod a+rx /usr/local/bin/yt-dlp \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY package*.json ./
RUN npm ci

COPY tsconfig*.json ./
COPY src ./src
COPY scripts ./scripts
RUN npm run build

COPY config ./config
COPY samples ./samples

ENV HOST=0.0.0.0 PORT=8787 RTMP_PORT=1935
EXPOSE 8787 1935

HEALTHCHECK --interval=30s --timeout=3s --start-period=10s \
  CMD curl -fs http://localhost:8787/api/health || exit 1

CMD ["node", "dist/src/main.js"]
