#!/bin/sh
set -e

echo "[ENTRYPOINT] Esperando a PostgreSQL..."
until pg_isready -h "$(echo $DATABASE_URL | sed -n 's/.*@\([^:]*\).*/\1/p')" -U pliegonaut 2>/dev/null; do
  sleep 1
done
echo "[ENTRYPOINT] PostgreSQL listo."

echo "[ENTRYPOINT] Ejecutando migraciones..."
npx prisma migrate deploy --schema=packages/database/prisma/schema.prisma

echo "[ENTRYPOINT] Iniciando aplicación..."
exec "$@"
