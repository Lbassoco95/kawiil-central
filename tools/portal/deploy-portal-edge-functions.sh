#!/usr/bin/env bash
# Despliega Edge Functions del portal a un proyecto Kawiil OS autorizado.
#
# Uso:
#   SUPABASE_ACCESS_TOKEN=… ./tools/portal/deploy-portal-edge-functions.sh <project-ref>
#
# project-ref debe ser exactamente uno de:
#   tglhceuszxcgkxmskdkl  (kawiil-os-ensayo)
#   ehtmlkvmiipmtcidsffk  (kawiil-os-demo)
#
# No embebe tokens ni refs de producción. Lee SUPABASE_ACCESS_TOKEN solo del entorno.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=tools/portal/kawiil-os-allowlist.sh
source "$ROOT/tools/portal/kawiil-os-allowlist.sh"

REF="${1:-}"
kawiil_os_assert_authorized_ref "$REF"
kawiil_os_require_access_token

FUNCTIONS=(portal-api portal-system-api portal-system-dispatch portal-notify)

echo "==> Destino autorizado: $REF"
echo "==> Funciones: ${FUNCTIONS[*]}"
echo "==> Workdir: $ROOT (supabase/functions + config.toml raíz)"

if ! command -v npx >/dev/null; then
  echo "ABORT: falta npx/Node." >&2
  exit 1
fi

cd "$ROOT"
for fn in "${FUNCTIONS[@]}"; do
  echo "==> Deploy $fn --project-ref $REF --no-verify-jwt"
  npx supabase functions deploy "$fn" \
    --project-ref "$REF" \
    --no-verify-jwt
done

echo "OK: desplegadas ${#FUNCTIONS[@]} funciones en $REF"
