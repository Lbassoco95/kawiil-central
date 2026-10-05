#!/usr/bin/env bash
# Orquesta secretos HMAC + deploy + batería para un destino autorizado.
# Genera secretos, los carga, despliega funciones y corre la batería sin
# escribir valores secretos al repo.
#
# Uso:
#   SUPABASE_ACCESS_TOKEN=… ./tools/portal/run-portal-hmac-pipeline.sh ensayo
#   SUPABASE_ACCESS_TOKEN=… ./tools/portal/run-portal-hmac-pipeline.sh demo
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=tools/portal/kawiil-os-allowlist.sh
source "$ROOT/tools/portal/kawiil-os-allowlist.sh"

MODE="${1:-}"
case "$MODE" in
  ensayo) REF="$KAWIIL_OS_REF_ENSAYO" ;;
  demo)   REF="$KAWIIL_OS_REF_DEMO" ;;
  *)
    echo "Uso: $0 ensayo|demo" >&2
    exit 2
    ;;
esac

kawiil_os_assert_authorized_ref "$REF"
kawiil_os_require_access_token

TMP_ENV="$(mktemp /tmp/kawiil-hmac-XXXXXX.env)"
cleanup() {
  rm -f "$TMP_ENV"
}
trap cleanup EXIT

echo "==> [$MODE] secretos HMAC → $REF"
HMAC_EXPORT_TO_ENV_FILE=1 HMAC_ENV_FILE="$TMP_ENV" \
  bash "$ROOT/tools/portal/set-portal-hmac-secrets.sh" "$REF"

# shellcheck disable=SC1090
set -a
# shellcheck source=/dev/null
source "$TMP_ENV"
set +a
rm -f "$TMP_ENV"
trap - EXIT

echo "==> [$MODE] deploy edges → $REF"
bash "$ROOT/tools/portal/deploy-portal-edge-functions.sh" "$REF"

echo "==> [$MODE] batería HMAC → $REF"
bash "$ROOT/tools/portal/hmac-battery-portal-system.sh" "$REF"

echo "OK: pipeline $MODE completo en $REF"
