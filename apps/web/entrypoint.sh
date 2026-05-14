#!/bin/sh
set -e

APP_VERSION=$(cat /app/VERSION 2>/dev/null || echo "dev")
echo "Dishes v${APP_VERSION} starting..."
echo "Running migrations..."
node /app/migrate/migrate.mjs

echo "Starting server..."
exec node apps/web/server.js
