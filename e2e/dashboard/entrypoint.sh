#!/bin/sh
set -e

# Start Next.js standalone server — override PORT since Go backend owns $PORT (8081)
PORT=3000 HOSTNAME=0.0.0.0 node /app/frontend/server.js &
NEXT_PID=$!

# Start Go backend
/app/scout &
SCOUT_PID=$!

# Wait for both upstreams to be ready before starting nginx
echo "[entrypoint] waiting for Go backend on :8081..."
until curl -sf http://localhost:8081/health > /dev/null 2>&1; do sleep 1; done
echo "[entrypoint] waiting for Next.js on :3000..."
until curl -sf http://localhost:3000 > /dev/null 2>&1; do sleep 1; done

# Now start nginx — both upstreams are ready
nginx -g "daemon off;" &
NGINX_PID=$!

echo "[entrypoint] all services up"

# Forward SIGTERM/SIGINT to all background processes
shutdown() {
    echo "[entrypoint] shutting down..."
    kill "$SCOUT_PID" "$NEXT_PID" "$NGINX_PID" 2>/dev/null
    wait "$SCOUT_PID" "$NEXT_PID" "$NGINX_PID" 2>/dev/null
    exit 0
}
trap shutdown TERM INT

# Wait indefinitely — exit when any child dies
wait
