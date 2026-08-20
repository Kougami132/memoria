# Stage 1: Build frontend
FROM node:20-alpine AS frontend-builder
WORKDIR /app/web
COPY web/package*.json ./
RUN npm ci
COPY web/ ./
RUN npm run build

# Stage 2: Application runtime
FROM python:3.11-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    DB_PATH=/app/data/memoria.db \
    CHROMA_PATH=/app/data/chroma \
    UPLOAD_DIR=/app/data/uploads \
    LOG_PATH=/app/data/memoria.log

WORKDIR /app

RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

COPY pyproject.toml ./
COPY memoria/ ./memoria/
COPY --from=frontend-builder /app/memoria/static ./memoria/static

RUN pip install --no-cache-dir --upgrade pip \
    && pip install --no-cache-dir .

RUN mkdir -p /app/data

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD curl -f http://localhost:8000/api/health || exit 1

CMD ["memoria", "serve", "--host", "0.0.0.0", "--port", "8000"]
