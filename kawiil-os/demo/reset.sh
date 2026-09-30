#!/usr/bin/env bash
# Reinicio exacto del entorno de demostración del espejo fiscal (Corte 4).
# Uso:
#   PORTAL_DEMO_ALLOW_RESET=1 PGHOST=… PGPORT=… PGUSER=… PGPASSWORD=… \
#     npm run portal:demo-reset
#   # o: bash kawiil-os/demo/reset.sh
#
# Requiere PORTAL_DEMO_ALLOW_RESET=1.
# Aislamiento: no embebe el project ref de central en este árbol (la suite
# run_kawiil_os_db_tests.sh lo prohíbe). Opcionalmente pase
# PORTAL_DEMO_FORBID_PROJECT_REF=<ref-central> para bloquear esa URL en runtime,
# o configure VITE_SUPABASE_URL + VITE_PORTAL_SUPABASE_URL distintos.
# Opcional: DATABASE_URL o variables PG*.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SEED="$ROOT/kawiil-os/demo/seed.sql"
VERIFY="$ROOT/kawiil-os/demo/verify.sql"

if [[ "${PORTAL_DEMO_ALLOW_RESET:-}" != "1" ]]; then
  echo "ABORT: defina PORTAL_DEMO_ALLOW_RESET=1 para confirmar el reinicio del entorno demo."
  exit 1
fi

if [[ ! -f "$SEED" ]]; then
  echo "ABORT: no está $SEED"
  exit 1
fi

COMBO="${DATABASE_URL:-} ${SUPABASE_URL:-} ${VITE_PORTAL_SUPABASE_URL:-} ${PGHOST:-}"

# Si el llamador declara el ref prohibido (desde fuera de kawiil-os/), rechazarlo.
if [[ -n "${PORTAL_DEMO_FORBID_PROJECT_REF:-}" ]] \
  && grep -F "$PORTAL_DEMO_FORBID_PROJECT_REF" <<<"$COMBO" >/dev/null 2>&1; then
  echo "ABORT: la conexión menciona PORTAL_DEMO_FORBID_PROJECT_REF (proyecto no demo)."
  exit 1
fi

# El portal demo no puede usar la misma URL que central.
if [[ -n "${VITE_PORTAL_SUPABASE_URL:-}" && -n "${VITE_SUPABASE_URL:-}" ]] \
  && [[ "${VITE_PORTAL_SUPABASE_URL}" == "${VITE_SUPABASE_URL}" ]]; then
  echo "ABORT: VITE_PORTAL_SUPABASE_URL no puede coincidir con VITE_SUPABASE_URL."
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
