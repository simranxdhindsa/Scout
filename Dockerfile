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
# Stage 2: Build Vite frontend
# ─────────────────────────────────────────────────────────────
FROM node:20-alpine AS frontend-builder

WORKDIR /app/frontend

# Empty default → bundle calls /api/v1/... on the same origin (nginx proxies it)
ARG VITE_SCOUT_API_URL=

COPY frontend/package*.json ./
RUN npm ci

COPY frontend/ .

ENV VITE_SCOUT_API_URL=$VITE_SCOUT_API_URL

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

# Playwright npm package. The runner generates playwright.config.ts files in
# /tmp scratch dirs that `import { defineConfig } from '@playwright/test'`,
# so it needs a resolvable @playwright/test on disk. We install it into a
# stable path and point the runner at it via SCOUT_PLAYWRIGHT_PROJECT_DIR.
RUN mkdir -p /opt/scout-playwright \
    && cd /opt/scout-playwright \
    && npm init -y >/dev/null \
    && npm install --no-save --omit=dev @playwright/test@1.44.0 \
    # Browser binaries are copied from the playwright image above, but this
    # ubuntu base lacks the shared libs Chromium needs (libnss3, libgbm1, …).
    # install-deps apt-installs exactly the right set for this PW version.
    && npx playwright install-deps \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

RUN mkdir -p /app/data

# Go backend binary
COPY --from=go-builder /app/scout /app/scout

# Vite static bundle (served directly by nginx)
COPY --from=frontend-builder /app/frontend/dist /app/frontend/dist

# nginx config and entrypoint
COPY nginx.conf      /etc/nginx/nginx.conf
COPY entrypoint.sh   /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

ENV PORT=8081 \
    ENVIRONMENT=production \
    STORAGE_DRIVER=local \
    STORAGE_LOCAL_DIR=/app/data \
    MAX_CONCURRENT_RUNS=3 \
    SCOUT_PLAYWRIGHT_PROJECT_DIR=/opt/scout-playwright

EXPOSE 8080

# Health check hits the Go backend directly, bypassing nginx
HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD curl -sf http://localhost:8081/health || exit 1

ENTRYPOINT ["/app/entrypoint.sh"]
