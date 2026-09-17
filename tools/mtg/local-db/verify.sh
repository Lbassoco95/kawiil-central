#!/usr/bin/env bash
# =================================================================
# Verificación local de las migraciones de Múuch' (Bloque 1).
#
# Levanta un Postgres temporal en /tmp/mtg-pg (puerto 54329, socket en el
# mismo dir), aplica stub → migración de esquema → migración de bucket,
# corre checks.sql, luego rollback bucket → rollback esquema → re-aplica
# ambas migraciones (idempotencia) y apaga el cluster.
#
# Salida completa en /tmp/mtg-verify.log.
# =================================================================
set -euo pipefail

# /opt/homebrew/bin solo trae libpq (cliente); el binario `postgres` vive en el
# keg de postgresql@NN. Se respeta PGBIN si el caller lo fija.
if [ -z "${PGBIN:-}" ]; then
  PGBIN="$(ls -d /opt/homebrew/Cellar/postgresql@*/*/bin 2>/dev/null | sort -V | tail -1)"
  PGBIN="${PGBIN:-/opt/homebrew/bin}"
fi
PGDATA=/tmp/mtg-pg/data
PGSOCK=/tmp/mtg-pg
PGPORT=54329
LOG=/tmp/mtg-verify.log
REPO_ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
PSQL="$PGBIN/psql -h $PGSOCK -p $PGPORT -U postgres -d postgres -v ON_ERROR_STOP=1 -q"

exec > >(tee "$LOG") 2>&1

cleanup() {
  "$PGBIN/pg_ctl" -D "$PGDATA" -m fast stop >/dev/null 2>&1 || true
}
trap cleanup EXIT

echo "== verify mtg: init cluster =="
rm -rf /tmp/mtg-pg
mkdir -p "$PGDATA"
# Con brew postgresql@NN (keg-only) initdb no encuentra postgres.bki solo:
# hay que pasarle -L al directorio share del paquete.
PGSHARE="$(cd "$PGBIN/../share/postgresql" 2>/dev/null && pwd || true)"
INITDB_L=()
if [ -n "$PGSHARE" ] && [ -f "$PGSHARE/postgres.bki" ]; then
  INITDB_L=(-L "$PGSHARE")
fi
"$PGBIN/initdb" -D "$PGDATA" -U postgres -E UTF8 "${INITDB_L[@]}" >/dev/null
"$PGBIN/pg_ctl" -D "$PGDATA" -l /tmp/mtg-pg/postgres.log \
  -o "-p $PGPORT -k $PGSOCK -c listen_addresses=''" start >/dev/null

echo "== 1. stub =="
$PSQL -f "$REPO_ROOT/tools/mtg/local-db/schema-stub.sql"

echo "== 2. migración esquema (20260917120000) =="
$PSQL -f "$REPO_ROOT/supabase/migrations/20260917120000_mtg_juntas_schema.sql"

echo "== 3. migración bucket (20260917120100) =="
$PSQL -f "$REPO_ROOT/supabase/migrations/20260917120100_mtg_storage_bucket.sql"

echo "== 4. checks =="
$PSQL -f "$REPO_ROOT/tools/mtg/local-db/checks.sql"

echo "== 5. rollback bucket =="
$PSQL -f "$REPO_ROOT/migrations/2026-09-17_mtg_storage_bucket.rollback.sql"

echo "== 6. rollback esquema =="
$PSQL -f "$REPO_ROOT/migrations/2026-09-17_mtg_juntas_schema.rollback.sql"

echo "== 7. re-aplicar ambas migraciones (idempotencia tras reversión) =="
$PSQL -f "$REPO_ROOT/supabase/migrations/20260917120000_mtg_juntas_schema.sql"
$PSQL -f "$REPO_ROOT/supabase/migrations/20260917120100_mtg_storage_bucket.sql"

echo "== 8. re-correr checks sobre el esquema re-aplicado =="
$PSQL -f "$REPO_ROOT/tools/mtg/local-db/checks.sql"

echo "== verify mtg: OK =="
