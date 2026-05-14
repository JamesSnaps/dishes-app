#!/bin/sh
set -e

echo "Running migrations..."
node /app/migrate/migrate.mjs

echo "Starting server..."
exec node apps/web/server.js
