# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: Build Go backend
# ─────────────────────────────────────────────────────────────────────────────
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

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: Build Next.js frontend
# ─────────────────────────────────────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

# NEXT_PUBLIC_WS_URL must point to your server's public host with ws:// scheme.
# e.g. --build-arg NEXT_PUBLIC_WS_URL=ws://your-ec2-ip
# or   --build-arg NEXT_PUBLIC_WS_URL=wss://scout.yourdomain.com  (if behind TLS)
ARG NEXT_PUBLIC_WS_URL=ws://localhost

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ .

ENV DOCKER_BUILD=true
ENV NEXT_PUBLIC_API_URL=http://localhost:8080
ENV NEXT_PUBLIC_WS_URL=$NEXT_PUBLIC_WS_URL

RUN npm run build

# ─────────────────────────────────────────────────────────────────────────────
# Stage 3: Playwright browser binaries
# ─────────────────────────────────────────────────────────────────────────────
FROM mcr.microsoft.com/playwright:v1.44.0-jammy AS playwright

# ─────────────────────────────────────────────────────────────────────────────
# Stage 4: Final runtime image
# ─────────────────────────────────────────────────────────────────────────────
FROM ubuntu:22.04

# Node.js 20 (LTS) via NodeSource — needed for Next.js standalone server
RUN apt-get update && apt-get install -y --no-install-recommends curl ca-certificates && \
    curl -fsSL https://deb.nodesource.com/setup_20.x | bash - && \
    apt-get install -y --no-install-recommends \
        nodejs \
        nginx \
        supervisor \
        tzdata \
    && rm -rf /var/lib/apt/lists/*

# Playwright CLI (for npx playwright test used by the runner)
RUN npm install -g @playwright/test@1.44.0

# Playwright browser binaries from stage 3
COPY --from=playwright /ms-playwright /ms-playwright
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# TLS certs + timezone data
COPY --from=go-builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=go-builder /usr/share/zoneinfo /usr/share/zoneinfo

WORKDIR /app

RUN mkdir -p /app/data

# Go binary
COPY --from=go-builder /app/scout /app/scout
RUN chmod +x /app/scout

# Next.js standalone build
COPY --from=frontend-builder /app/frontend/.next/standalone /app/frontend
COPY --from=frontend-builder /app/frontend/.next/static     /app/frontend/.next/static
COPY --from=frontend-builder /app/frontend/public           /app/frontend/public

# nginx + supervisor config
COPY nginx.conf       /etc/nginx/nginx.conf
COPY supervisord.conf /etc/supervisor/conf.d/scout.conf

EXPOSE 80

# Runtime defaults — override all via --env-file or ECS task definition env vars
ENV PORT=8080 \
    ENVIRONMENT=production \
    STORAGE_DRIVER=local \
    STORAGE_LOCAL_DIR=/app/data \
    MAX_CONCURRENT_RUNS=3

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -sf http://localhost/api/v1/auth/me || exit 1

CMD ["/usr/bin/supervisord", "-n", "-c", "/etc/supervisor/supervisord.conf"]
