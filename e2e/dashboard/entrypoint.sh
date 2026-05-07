#!/bin/sh
set -e

# Start Next.js frontend on port 3000
node /app/frontend/server.js &

# Start nginx reverse proxy on port 80
nginx -g "daemon off;" &

# Run Go backend in foreground — container lives as long as this does
exec /app/scout
