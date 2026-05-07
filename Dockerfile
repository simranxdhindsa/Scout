# ─────────────────────────────────────────────────────────────
# Stage 1: Build Go backend
# ─────────────────────────────────────────────────────────────
FROM golang:1.22-alpine AS go-builder

RUN apk add --no-cache git ca-certificates tzdata

WORKDIR /app

COPY backend/go.mod backend/go.sum ./
RUN go mod download

COPY backend/ .

RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
    -ldflags="-w -s" \
    -o scout \
    ./cmd/server


# ─────────────────────────────────────────────────────────────
# Stage 2: Build Next.js frontend
# ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

ARG NEXT_PUBLIC_WS_URL=ws://localhost

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ .

ENV DOCKER_BUILD=true \
    NEXT_PUBLIC_API_URL=http://localhost:8080 \
    NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL

RUN npm run build


# ─────────────────────────────────────────────────────────────
# Stage 3: Playwright runtime browsers
# ─────────────────────────────────────────────────────────────
FROM mcr.microsoft.com/playwright:v1.44.0-jammy AS playwright


# ─────────────────────────────────────────────────────────────
# Stage 4: Runtime image
# ─────────────────────────────────────────────────────────────
FROM ubuntu:22.04

# Install all system deps in one layer to keep image size down
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    tzdata \
    nginx \
    && curl -fsSL https://deb.nodesource.com/setup_20.x | bash - \
    && apt-get install -y --no-install-recommends nodejs \
    && rm -rf /var/lib/apt/lists/*

# Playwright browsers
COPY --from=playwright /ms-playwright /ms-playwright
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

WORKDIR /app

RUN mkdir -p /app/data

# Go backend binary
COPY --from=go-builder /app/scout /app/scout

# Next.js standalone output
COPY --from=frontend-builder /app/frontend/.next/standalone /app/frontend
COPY --from=frontend-builder /app/frontend/.next/static     /app/frontend/.next/static
COPY --from=frontend-builder /app/frontend/public           /app/frontend/public

# nginx config and entrypoint
COPY nginx.conf      /etc/nginx/nginx.conf
COPY entrypoint.sh   /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

ENV PORT=8081 \
    ENVIRONMENT=production \
    STORAGE_DRIVER=local \
    STORAGE_LOCAL_DIR=/app/data \
    MAX_CONCURRENT_RUNS=3

EXPOSE 8080

# Health check hits the Go backend directly, bypassing nginx
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -sf http://localhost:8081/health || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
