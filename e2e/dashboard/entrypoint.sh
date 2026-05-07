#!/bin/sh
set -e

# Gracefully stop background processes when the container receives SIGTERM/SIGINT
shutdown() {
    echo "[entrypoint] shutting down..."
    kill "$NEXT_PID" "$NGINX_PID" 2>/dev/null
    wait "$NEXT_PID" "$NGINX_PID" 2>/dev/null
    exit 0
}
trap shutdown TERM INT

# Next.js standalone server — must override PORT since Go backend owns $PORT (8081)
PORT=3000 HOSTNAME=0.0.0.0 node /app/frontend/server.js &
NEXT_PID=$!

# nginx reverse proxy — listens on 8080, routes /api/* → 8081, /* → 3000
nginx -g "daemon off;" &
NGINX_PID=$!

# Go backend in foreground — container exits when this process exits
exec /app/scout
