#!/usr/bin/env bash
# Bootstrap de un proyecto Kawiil OS (ensayo o demo).
# Uso (variables SOLO en el entorno local; nunca en el repositorio):
#
#   KAWIIL_OS_TARGET=kawiil-os-ensayo \
#   KAWIIL_OS_PROJECT_REF=<ref-ensayo> \
#   npm run kawiil-os:bootstrap-ensayo
#
#   KAWIIL_OS_TARGET=kawiil-os-demo \
#   KAWIIL_OS_PROJECT_REF=<ref-demo> \
#   KAWIIL_OS_DB_URL='postgresql://…' \
#   npm run kawiil-os:bootstrap-demo
#
# Ensayo: aplica baseline (+ espejo) con supabase db push --workdir kawiil-os.
# Demo: lo mismo + semilla sintética (reinicio exacto).
# Se niega a correr contra central o contra un destino distinto al declarado.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=tools/portal/kawiil-os-targets.sh
source "$ROOT/tools/portal/kawiil-os-targets.sh"

MODE="${1:-}"
case "$MODE" in
  ensayo) EXPECTED="$KAWIIL_OS_TARGET_ENSAYO" ;;
  demo)   EXPECTED="$KAWIIL_OS_TARGET_DEMO" ;;
  *)
    echo "Uso: $0 ensayo|demo"
    exit 2
    ;;
esac

kawiil_os_require_target "$EXPECTED"

echo "==> Destino: $KAWIIL_OS_TARGET (ref=${KAWIIL_OS_PROJECT_REF:0:4}…)"
echo "==> Cerco: no es central; nombre de destino coincide."

if ! command -v npx >/dev/null; then
  echo "ABORT: falta npx/Node."
  exit 1
fi

echo "==> Enlazando workdir kawiil-os al project ref declarado…"
npx supabase link --workdir "$ROOT/kawiil-os" --project-ref "$KAWIIL_OS_PROJECT_REF"

echo "==> Aplicando migraciones de Kawiil OS (solo kawiil-os/supabase/migrations/)…"
npm --prefix "$ROOT" run kawiil-os:db-push

if [[ "$MODE" == "demo" ]]; then
  DB_URL="${KAWIIL_OS_DB_URL:-${DATABASE_URL:-}}"
  if [[ -z "$DB_URL" ]]; then
    echo "ABORT: para demo defina KAWIIL_OS_DB_URL (o DATABASE_URL) con la cadena Postgres del proyecto demo."
    exit 1
  fi
  if grep -F "$CENTRAL_PROJECT_REF" <<<"$DB_URL" >/dev/null 2>&1; then
    echo "ABORT: KAWIIL_OS_DB_URL apunta a central."
    exit 1
  fi
  echo "==> Sembrando datos sintéticos del espejo (reinicio exacto)…"
  PORTAL_DEMO_ALLOW_RESET=1 DATABASE_URL="$DB_URL" bash "$ROOT/tools/portal/demo-reset.sh"
fi

echo "OK: bootstrap $MODE completado para $KAWIIL_OS_TARGET."
