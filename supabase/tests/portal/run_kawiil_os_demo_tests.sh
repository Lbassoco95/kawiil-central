#!/usr/bin/env bash
# Prueba local/CI del reinicio exacto del demo espejo (Corte 4).
# Aplica baseline+espejo en Postgres efímero, siembra, verifica, vuelve a resetear y compara.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
STUB="$ROOT/supabase/tests/portal/00_supabase_stub.sql"
MIG_DIR="$ROOT/kawiil-os/supabase/migrations"
DEMO_DIR="$ROOT/kawiil-os/demo"
DB=kawiil_os_demo_test

if ! command -v psql >/dev/null; then
  echo "SKIP: psql no disponible en este entorno"
  exit 0
fi
if ! psql -X -q -d postgres -c 'SELECT 1' >/dev/null 2>&1; then
  echo "SKIP: Postgres no alcanzable (defina PGHOST/PGPORT/PGUSER)"
  exit 0
fi

psql -X -q -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" >/dev/null
q() { psql -X -v ON_ERROR_STOP=1 -q -d "$DB" "$@"; }

q -f "$STUB" >/dev/null 2>&1
mapfile -t MIGS < <(ls -1 "$MIG_DIR"/*.sql | sort)
for mig in "${MIGS[@]}"; do
  q --single-transaction -f "$mig" >/dev/null
done

# Primera siembra
PORTAL_DEMO_ALLOW_RESET=1 PGDATABASE="$DB" bash "$DEMO_DIR/reset.sh" >/dev/null
HASH1="$(q -At -c "
SELECT md5(string_agg(row_hash, '|' ORDER BY row_hash)) FROM (
  SELECT md5(c.uuid || c.direction || c.detail_status || c.total::text || c.is_test::text) AS row_hash
  FROM public.portal_cfdi c
  WHERE c.client_id = 'd0000000-0000-4000-8000-000000000001'
) s;
")"

# Mutación deliberada + reinicio exacto
q -c "UPDATE public.portal_cfdi SET total = 1 WHERE client_id = 'd0000000-0000-4000-8000-000000000001'" >/dev/null
PORTAL_DEMO_ALLOW_RESET=1 PGDATABASE="$DB" bash "$DEMO_DIR/reset.sh" >/dev/null
HASH2="$(q -At -c "
SELECT md5(string_agg(row_hash, '|' ORDER BY row_hash)) FROM (
  SELECT md5(c.uuid || c.direction || c.detail_status || c.total::text || c.is_test::text) AS row_hash
  FROM public.portal_cfdi c
  WHERE c.client_id = 'd0000000-0000-4000-8000-000000000001'
) s;
")"

[[ "$HASH1" == "$HASH2" ]] || { echo "FALLA: el reinicio no restauró el dataset exacto ($HASH1 != $HASH2)"; exit 1; }
[[ -n "$HASH1" ]] || { echo "FALLA: hash vacío"; exit 1; }

psql -X -q -d postgres -c "DROP DATABASE IF EXISTS $DB" >/dev/null
echo "TODO VERDE: reinicio exacto del demo espejo verificado."
