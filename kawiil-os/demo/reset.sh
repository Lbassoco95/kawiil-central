#!/usr/bin/env bash
# Reinicio exacto del entorno de demostración del espejo fiscal (Corte 4).
# Uso:
#   PORTAL_DEMO_ALLOW_RESET=1 PGHOST=… PGPORT=… PGUSER=… PGPASSWORD=… \
#     npm run portal:demo-reset
#   # o: bash kawiil-os/demo/reset.sh
#
# Requiere PORTAL_DEMO_ALLOW_RESET=1. Rechaza el project_id de central.
# Opcional: DATABASE_URL o variables PG*.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SEED="$ROOT/kawiil-os/demo/seed.sql"
VERIFY="$ROOT/kawiil-os/demo/verify.sql"
CENTRAL_REF="qppfampapbxdgednkofc"

if [[ "${PORTAL_DEMO_ALLOW_RESET:-}" != "1" ]]; then
  echo "ABORT: defina PORTAL_DEMO_ALLOW_RESET=1 para confirmar el reinicio del entorno demo."
  exit 1
fi

if [[ ! -f "$SEED" ]]; then
  echo "ABORT: no está $SEED"
  exit 1
fi

# Rechazar URLs/hosts que apunten al proyecto de central.
COMBO="${DATABASE_URL:-} ${SUPABASE_URL:-} ${VITE_PORTAL_SUPABASE_URL:-} ${PGHOST:-}"
if grep -F "$CENTRAL_REF" <<<"$COMBO" >/dev/null 2>&1; then
  echo "ABORT: la conexión parece apuntar al proyecto de central ($CENTRAL_REF)."
  exit 1
fi

psql_args=()
if [[ -n "${DATABASE_URL:-}" ]]; then
  psql_args+=("$DATABASE_URL")
else
  : "${PGDATABASE:=postgres}"
  psql_args+=(-d "$PGDATABASE")
fi

echo "==> Aplicando semilla exacta del espejo demo…"
psql -X -v ON_ERROR_STOP=1 "${psql_args[@]}" -f "$SEED"
echo "==> Verificando conteos canónicos…"
psql -X -v ON_ERROR_STOP=1 "${psql_args[@]}" -f "$VERIFY"
echo "OK: reinicio exacto del demo espejo aplicado."
