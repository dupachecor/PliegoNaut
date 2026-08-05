#!/bin/sh
set -e

echo "[ENTRYPOINT] Esperando a PostgreSQL..."
until pg_isready -h "$(echo $DATABASE_URL | sed -n 's/.*@\([^:]*\).*/\1/p')" -U pliegonaut 2>/dev/null; do
  sleep 1
done
echo "[ENTRYPOINT] PostgreSQL listo."

echo "[ENTRYPOINT] Ejecutando migraciones..."
npx prisma db push --schema=packages/database/prisma/schema.prisma --skip-generate --accept-data-loss

echo "[ENTRYPOINT] Iniciando aplicación..."
exec "$@"
