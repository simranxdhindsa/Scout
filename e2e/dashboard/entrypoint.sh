#!/bin/sh
set -e

# Start Go backend — pin to 8081 so it never conflicts with nginx (8080)
PORT=8081 /app/scout &
SCOUT_PID=$!

echo "[entrypoint] waiting for Go backend on :8081..."
until curl -sf http://localhost:8081/health > /dev/null 2>&1; do sleep 1; done

# Frontend is a static bundle served by nginx — no node process needed
nginx -g "daemon off;" &
NGINX_PID=$!

echo "[entrypoint] all services up"

shutdown() {
    echo "[entrypoint] shutting down..."
    kill "$SCOUT_PID" "$NGINX_PID" 2>/dev/null
    wait "$SCOUT_PID" "$NGINX_PID" 2>/dev/null
    exit 0
}
trap shutdown TERM INT

# Wait indefinitely — exit when any child dies
wait
