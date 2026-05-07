#!/bin/sh
set -e

# Start Next.js frontend on port 3000 (PORT env is 8080 for the Go backend — override here)
PORT=3000 HOSTNAME=0.0.0.0 node /app/frontend/server.js &

# Start nginx reverse proxy on port 80
nginx -g "daemon off;" &

# Run Go backend in foreground — container lives as long as this does
exec /app/scout
