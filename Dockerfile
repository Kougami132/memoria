# Stage 1: Build frontend SPA
FROM node:22-alpine AS frontend-builder
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# Stage 2: Node.js 22+ TypeScript runtime (with built-in node:sqlite)
FROM node:22-alpine

ENV NODE_ENV=production \
    DB_PATH=/app/data/memoria.db \
    PORT=8000

WORKDIR /app

RUN apk add --no-cache openssh-client curl

COPY package*.json tsconfig.json ./
RUN npm ci --omit=dev

COPY shared/ ./shared/
COPY src/ ./src/
COPY --from=frontend-builder /app/memoria/static ./memoria/static

RUN mkdir -p /app/data

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8000/api/health || exit 1

CMD ["node", "--experimental-strip-types", "src/index.ts"]
