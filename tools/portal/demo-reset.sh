#!/usr/bin/env bash
# Reinicio exacto del demo espejo con cerco (tools/portal, no relaja denylist).
# Uso:
#   PORTAL_DEMO_ALLOW_RESET=1 KAWIIL_OS_DB_URL='postgresql://…' npm run portal:demo-reset
#   # o DATABASE_URL=…
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=tools/portal/kawiil-os-targets.sh
source "$ROOT/tools/portal/kawiil-os-targets.sh"
SEED="$ROOT/kawiil-os/demo/seed.sql"
VERIFY="$ROOT/kawiil-os/demo/verify.sql"

if [[ "${PORTAL_DEMO_ALLOW_RESET:-}" != "1" ]]; then
  echo "ABORT: defina PORTAL_DEMO_ALLOW_RESET=1 para confirmar el reinicio del entorno demo."
  exit 1
fi

DB_URL="${KAWIIL_OS_DB_URL:-${DATABASE_URL:-}}"
if [[ -z "$DB_URL" && -z "${PGHOST:-}" ]]; then
  echo "ABORT: defina KAWIIL_OS_DB_URL/DATABASE_URL o PGHOST para el Postgres del demo."
  exit 1
fi

# Cerco obligatorio: nunca central.
export DATABASE_URL="${DB_URL:-${DATABASE_URL:-}}"
kawiil_os_abort_if_central
if [[ -n "${KAWIIL_OS_PROJECT_REF:-}" && "$KAWIIL_OS_PROJECT_REF" == "$CENTRAL_PROJECT_REF" ]]; then
  echo "ABORT: KAWIIL_OS_PROJECT_REF es central."
  exit 1
fi
# Si declara destino, debe ser demo.
if [[ -n "${KAWIIL_OS_TARGET:-}" && "${KAWIIL_OS_TARGET}" != "$KAWIIL_OS_TARGET_DEMO" ]]; then
  echo "ABORT: portal:demo-reset solo aplica a KAWIIL_OS_TARGET=$KAWIIL_OS_TARGET_DEMO."
  exit 1
fi

psql_args=()
if [[ -n "${DB_URL:-}" ]]; then
  psql_args+=("$DB_URL")
else
  : "${PGDATABASE:=postgres}"
  psql_args+=(-d "$PGDATABASE")
fi

echo "==> Aplicando semilla del espejo demo (sin CFDI inventados)…"
psql -X -v ON_ERROR_STOP=1 "${psql_args[@]}" -f "$SEED"
if [[ "${PORTAL_DEMO_SEED_DIDACTIC:-}" == "1" ]]; then
  echo "==> Opt-in: sembrando CFDI didácticos (NO usar en prod Bassoco)…"
  psql -X -v ON_ERROR_STOP=1 "${psql_args[@]}" -f "$ROOT/kawiil-os/demo/seed-didactic.sql"
  echo "OK: seed + didactic aplicados. verify.sql (cero is_test) no aplica con didácticos."
else
  echo "==> Verificando conteos canónicos (cero is_test)…"
  psql -X -v ON_ERROR_STOP=1 "${psql_args[@]}" -f "$VERIFY"
  echo "OK: reinicio del demo espejo aplicado (cero CFDI inventados)."
fi
