#!/bin/sh
set -e

echo "Dishes v${APP_VERSION:-dev} starting..."
echo "Running migrations..."
node /app/migrate/migrate.mjs

echo "Starting server..."
exec node apps/web/server.js
