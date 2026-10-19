#!/bin/sh
# Apply pending migrations, then start the server (or whatever command was given).
set -e
node /app/migrate.cjs
exec "$@"
