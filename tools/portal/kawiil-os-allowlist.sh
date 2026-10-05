#!/usr/bin/env bash
# Allowlist estricta de project refs autorizados para scripts de portal OS.
# No contiene secretos. Fuente: docs/portal/PROYECTO-SEPARADO.md / ARRANQUE-POLO.md.
# shellcheck disable=SC2034

KAWIIL_OS_REF_ENSAYO="tglhceuszxcgkxmskdkl"
KAWIIL_OS_REF_DEMO="ehtmlkvmiipmtcidsffk"
CENTRAL_PROJECT_REF_DENY="qppfampapbxdgednkofc"

kawiil_os_assert_authorized_ref() {
  local ref="${1:-}"
  if [[ -z "$ref" ]]; then
    echo "ABORT: falta project-ref." >&2
    exit 1
  fi
  if [[ "$ref" == "$CENTRAL_PROJECT_REF_DENY" ]]; then
    echo "ABORT: ref de producción Central ($CENTRAL_PROJECT_REF_DENY) prohibido." >&2
    exit 1
  fi
  if [[ "$ref" != "$KAWIIL_OS_REF_ENSAYO" && "$ref" != "$KAWIIL_OS_REF_DEMO" ]]; then
    echo "ABORT: project-ref '$ref' no está en la allowlist (ensayo|demo)." >&2
    exit 1
  fi
}

kawiil_os_require_access_token() {
  if [[ -z "${SUPABASE_ACCESS_TOKEN:-}" ]]; then
    echo "ABORT: defina SUPABASE_ACCESS_TOKEN en el entorno (Management API). No se lee de archivos del repo." >&2
    exit 1
  fi
  # Solo metadatos seguros: longitud + hash corto (primeros 6 hex de SHA-256).
  local len hash6
  len="${#SUPABASE_ACCESS_TOKEN}"
  hash6="$(printf '%s' "$SUPABASE_ACCESS_TOKEN" | openssl dgst -sha256 -hex 2>/dev/null | awk '{print substr($NF,1,6)}')"
  echo "SUPABASE_ACCESS_TOKEN: presente len=${len} sha256_6=${hash6}"
}

kawiil_os_secret_meta() {
  # $1 = nombre del secreto, $2 = valor (solo se reporta len + hash6)
  local name="$1" value="$2" len hash6
  len="${#value}"
  hash6="$(printf '%s' "$value" | openssl dgst -sha256 -hex 2>/dev/null | awk '{print substr($NF,1,6)}')"
  echo "${name}: len=${len} sha256_6=${hash6}"
}
