FROM node:20-bookworm-slim

RUN apt-get update && \
    apt-get install -y --no-install-recommends \
        ffmpeg \
        ca-certificates \
        tini && \
    rm -rf /var/lib/apt/lists/* && \
    ffmpeg -version | head -1

WORKDIR /app

COPY package.json package-lock.json* ./
RUN npm ci --omit=dev || npm install --omit=dev

COPY tsconfig.json ./
COPY src ./src

RUN npm install --no-save typescript@5.3.3 && \
    npx tsc && \
    npm prune --omit=dev

ENV NODE_ENV=production
ENV PORT=8080
ENV WORK_DIR=/tmp/render-jobs

EXPOSE 8080

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["node", "dist/index.js"]
