# ─────────────────────────────────────────────────────────────────────────────
# Stage 1: Build
# ─────────────────────────────────────────────────────────────────────────────
FROM golang:1.22-alpine AS builder

# Install build dependencies
RUN apk add --no-cache git ca-certificates tzdata

WORKDIR /app

# Copy dependency files first for better layer caching
COPY go.mod go.sum ./
RUN go mod download

# Copy source
COPY . .

# Build the binary — statically linked, no CGO required
RUN CGO_ENABLED=0 GOOS=linux GOARCH=amd64 go build \
    -ldflags="-w -s -X main.version=$(git describe --tags --always --dirty 2>/dev/null || echo dev)" \
    -o scout \
    ./cmd/server

# ─────────────────────────────────────────────────────────────────────────────
# Stage 2: Install Playwright + Chromium
# ─────────────────────────────────────────────────────────────────────────────
FROM mcr.microsoft.com/playwright:v1.44.0-jammy AS playwright

# ─────────────────────────────────────────────────────────────────────────────
# Stage 3: Final runtime image
# ─────────────────────────────────────────────────────────────────────────────
FROM ubuntu:22.04

# Install Node.js (required for npx playwright) and runtime libs
RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates \
    tzdata \
    curl \
    nodejs \
    npm \
    && rm -rf /var/lib/apt/lists/*

# Install Playwright globally and its browser dependencies
RUN npm install -g @playwright/test@1.44.0

# Copy Playwright browser binaries from the playwright stage
COPY --from=playwright /ms-playwright /ms-playwright

# Set Playwright to use the pre-installed browsers
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright

# Create non-root user for security
RUN groupadd -r scout && useradd -r -g scout -d /app scout

WORKDIR /app

# Create data directory for local storage (bind-mount in production)
RUN mkdir -p /app/data && chown -R scout:scout /app

# Copy compiled binary from builder
COPY --from=builder /app/scout /app/scout
RUN chown scout:scout /app/scout && chmod +x /app/scout

# Copy CA certs and timezone data from builder
COPY --from=builder /etc/ssl/certs/ca-certificates.crt /etc/ssl/certs/
COPY --from=builder /usr/share/zoneinfo /usr/share/zoneinfo

USER scout

# Default environment — override all of these at runtime
ENV PORT=8080 \
    ENVIRONMENT=production \
    STORAGE_DRIVER=local \
    STORAGE_LOCAL_DIR=/app/data \
    MAX_CONCURRENT_RUNS=3

EXPOSE 8080

# Health check — hits the auth/me endpoint which requires no body
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
    CMD curl -sf http://localhost:8080/api/v1/auth/me || exit 1

ENTRYPOINT ["/app/scout"]
