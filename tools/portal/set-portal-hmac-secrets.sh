#!/usr/bin/env bash
# Genera HMAC distintos (openssl rand) y los carga en Edge Function Secrets
# de un proyecto Kawiil OS autorizado. Nunca escribe valores a disco del repo.
#
# Uso:
#   SUPABASE_ACCESS_TOKEN=… ./tools/portal/set-portal-hmac-secrets.sh <project-ref>
#
# Secretos cargados (solo nombres; valores efímeros en memoria):
#   CENTRAL_TO_OS_SIGNING_SECRET
#   OS_TO_CENTRAL_SIGNING_SECRET
#   CRON_SECRET
#   PORTAL_MIRROR_READ_ONLY=true
#
# Opcionales (si existen en el entorno, se reenvían; si no, se reportan pendientes):
#   PORTAL_PUBLIC_URL, PORTAL_ALLOWED_ORIGIN, CENTRAL_SYSTEM_API_URL,
#   TURNSTILE_SECRET_KEY, PORTAL_CSD_KEY_SECRET, PORTAL_CSD_SECRET
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=tools/portal/kawiil-os-allowlist.sh
source "$ROOT/tools/portal/kawiil-os-allowlist.sh"

REF="${1:-}"
kawiil_os_assert_authorized_ref "$REF"
kawiil_os_require_access_token

if ! command -v openssl >/dev/null; then
  echo "ABORT: falta openssl." >&2
  exit 1
fi
if ! command -v npx >/dev/null; then
  echo "ABORT: falta npx/Node." >&2
  exit 1
fi

gen_secret() {
  openssl rand -base64 48 | tr -d '\n'
}

CENTRAL_TO_OS_SIGNING_SECRET="$(gen_secret)"
OS_TO_CENTRAL_SIGNING_SECRET="$(gen_secret)"
CRON_SECRET="$(gen_secret)"

if [[ "$CENTRAL_TO_OS_SIGNING_SECRET" == "$OS_TO_CENTRAL_SIGNING_SECRET" ]]; then
  echo "ABORT: HMAC generados idénticos (improbable); reintente." >&2
  exit 1
fi

echo "==> Generados HMAC/cron (metadatos solos):"
kawiil_os_secret_meta "CENTRAL_TO_OS_SIGNING_SECRET" "$CENTRAL_TO_OS_SIGNING_SECRET"
kawiil_os_secret_meta "OS_TO_CENTRAL_SIGNING_SECRET" "$OS_TO_CENTRAL_SIGNING_SECRET"
kawiil_os_secret_meta "CRON_SECRET" "$CRON_SECRET"

ARGS=(
  "CENTRAL_TO_OS_SIGNING_SECRET=${CENTRAL_TO_OS_SIGNING_SECRET}"
  "OS_TO_CENTRAL_SIGNING_SECRET=${OS_TO_CENTRAL_SIGNING_SECRET}"
  "CRON_SECRET=${CRON_SECRET}"
  "PORTAL_MIRROR_READ_ONLY=true"
)

OPTIONAL_NAMES=(
  PORTAL_PUBLIC_URL
  PORTAL_ALLOWED_ORIGIN
  CENTRAL_SYSTEM_API_URL
  TURNSTILE_SECRET_KEY
  PORTAL_CSD_KEY_SECRET
  PORTAL_CSD_SECRET
)

PENDING=()
for name in "${OPTIONAL_NAMES[@]}"; do
  val="${!name:-}"
  if [[ -n "$val" ]]; then
    ARGS+=("${name}=${val}")
    kawiil_os_secret_meta "$name" "$val"
  else
    PENDING+=("$name")
  fi
done

echo "==> Cargando secretos en project-ref=$REF (CLI secrets set)…"
npx supabase secrets set "${ARGS[@]}" --project-ref "$REF"

META_DIR="${HMAC_EVIDENCE_DIR:-$ROOT/docs/portal/evidencia}"
mkdir -p "$META_DIR"
STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
META_FILE="$META_DIR/secrets-meta-${REF}-${STAMP}.txt"
{
  echo "project_ref=$REF"
  echo "loaded_at_utc=$STAMP"
  echo "names=CENTRAL_TO_OS_SIGNING_SECRET,OS_TO_CENTRAL_SIGNING_SECRET,CRON_SECRET,PORTAL_MIRROR_READ_ONLY"
  kawiil_os_secret_meta "CENTRAL_TO_OS_SIGNING_SECRET" "$CENTRAL_TO_OS_SIGNING_SECRET"
  kawiil_os_secret_meta "OS_TO_CENTRAL_SIGNING_SECRET" "$OS_TO_CENTRAL_SIGNING_SECRET"
  kawiil_os_secret_meta "CRON_SECRET" "$CRON_SECRET"
  if ((${#PENDING[@]})); then
    echo "pending_optional=${PENDING[*]}"
  else
    echo "pending_optional=(none)"
  fi
} >"$META_FILE"
echo "OK: secretos cargados. Metadatos (sin valores): $META_FILE"

if [[ "${HMAC_EXPORT_TO_ENV_FILE:-}" == "1" && -n "${HMAC_ENV_FILE:-}" ]]; then
  case "$HMAC_ENV_FILE" in
    /tmp/*|/dev/shm/*) ;;
    *)
      echo "ABORT: HMAC_ENV_FILE debe estar bajo /tmp o /dev/shm." >&2
      exit 1
      ;;
  esac
  umask 077
  {
    printf 'CENTRAL_TO_OS_SIGNING_SECRET=%s\n' "$CENTRAL_TO_OS_SIGNING_SECRET"
    printf 'OS_TO_CENTRAL_SIGNING_SECRET=%s\n' "$OS_TO_CENTRAL_SIGNING_SECRET"
    printf 'CRON_SECRET=%s\n' "$CRON_SECRET"
  } >"$HMAC_ENV_FILE"
  echo "HMAC_ENV_FILE escrito (efímero, fuera del repo)."
fi

CENTRAL_TO_OS_SIGNING_SECRET=""
OS_TO_CENTRAL_SIGNING_SECRET=""
CRON_SECRET=""
