#!/usr/bin/env bash
# Guardias compartidas de Kawiil OS (fuera de kawiil-os/: el cerco de
# test:kawiil-os-db exige que ese árbol no embuta el ref/JWT de central).
# shellcheck disable=SC2034

# Project ref de central — denylist operativa. No es un secreto; es el destino prohibido.
CENTRAL_PROJECT_REF="qppfampapbxdgednkofc"

KAWIIL_OS_TARGET_ENSAYO="kawiil-os-ensayo"
KAWIIL_OS_TARGET_DEMO="kawiil-os-demo"

kawiil_os_connection_blob() {
  printf '%s' "${KAWIIL_OS_PROJECT_REF:-} ${KAWIIL_OS_DB_URL:-} ${DATABASE_URL:-} ${SUPABASE_URL:-} ${VITE_PORTAL_SUPABASE_URL:-} ${VITE_SUPABASE_URL:-} ${PGHOST:-}"
}

kawiil_os_abort_if_central() {
  local blob
  blob="$(kawiil_os_connection_blob)"
  if grep -F "$CENTRAL_PROJECT_REF" <<<"$blob" >/dev/null 2>&1; then
    echo "ABORT: la operación apunta al proyecto de central ($CENTRAL_PROJECT_REF). Use solo kawiil-os-ensayo o kawiil-os-demo."
    exit 1
  fi
  if [[ -n "${VITE_PORTAL_SUPABASE_URL:-}" && -n "${VITE_SUPABASE_URL:-}" ]] \
    && [[ "${VITE_PORTAL_SUPABASE_URL}" == "${VITE_SUPABASE_URL}" ]]; then
    echo "ABORT: VITE_PORTAL_SUPABASE_URL no puede coincidir con VITE_SUPABASE_URL (central)."
    exit 1
  fi
}

# $1 = destino esperado (kawiil-os-ensayo | kawiil-os-demo)
kawiil_os_require_target() {
  local expected="$1"
  local target="${KAWIIL_OS_TARGET:-}"
  local ref="${KAWIIL_OS_PROJECT_REF:-}"

  if [[ -z "$target" ]]; then
    echo "ABORT: defina KAWIIL_OS_TARGET=$expected (solo variables locales; nunca en el repo)."
    exit 1
  fi
  if [[ "$target" != "$expected" ]]; then
    echo "ABORT: KAWIIL_OS_TARGET='$target' no coincide con el destino declarado '$expected'."
    exit 1
  fi
  if [[ -z "$ref" ]]; then
    echo "ABORT: defina KAWIIL_OS_PROJECT_REF con el project ref del destino $expected (solo env local)."
    exit 1
  fi
  if [[ "$ref" == "$CENTRAL_PROJECT_REF" ]]; then
    echo "ABORT: KAWIIL_OS_PROJECT_REF es el de central. Prohibido."
    exit 1
  fi
  if [[ "$ref" == *"/"* || "$ref" == *":"* || "$ref" == *" "* ]]; then
    echo "ABORT: KAWIIL_OS_PROJECT_REF parece inválido."
    exit 1
  fi
  kawiil_os_abort_if_central
  # La URL del portal, si existe, debe ser del mismo ref declarado.
  if [[ -n "${VITE_PORTAL_SUPABASE_URL:-}" ]] \
    && ! grep -F "$ref" <<<"${VITE_PORTAL_SUPABASE_URL}" >/dev/null 2>&1; then
    echo "ABORT: VITE_PORTAL_SUPABASE_URL no contiene KAWIIL_OS_PROJECT_REF ($ref)."
    exit 1
  fi
}
