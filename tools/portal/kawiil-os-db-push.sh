#!/usr/bin/env bash
# db push de Kawiil OS con cerco: ref solo por env; jamás central.
# Uso:
#   KAWIIL_OS_TARGET=kawiil-os-ensayo|kawiil-os-demo \
#   KAWIIL_OS_PROJECT_REF=<ref> \
#   npm run kawiil-os:db-push
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=tools/portal/kawiil-os-targets.sh
source "$ROOT/tools/portal/kawiil-os-targets.sh"

TARGET="${KAWIIL_OS_TARGET:-}"
case "$TARGET" in
  "$KAWIIL_OS_TARGET_ENSAYO"|"$KAWIIL_OS_TARGET_DEMO")
    kawiil_os_require_target "$TARGET"
    ;;
  *)
    echo "ABORT: defina KAWIIL_OS_TARGET=kawiil-os-ensayo|kawiil-os-demo y KAWIIL_OS_PROJECT_REF (solo env local)."
    exit 1
    ;;
esac

# Si ya hay link en workdir, comprobar que no apunte a central.
CFG="$ROOT/kawiil-os/supabase/.temp/project-ref"
if [[ -f "$CFG" ]]; then
  linked="$(tr -d '[:space:]' <"$CFG" || true)"
  if [[ "$linked" == "$CENTRAL_PROJECT_REF" ]]; then
    echo "ABORT: el link de kawiil-os apunta a central. Relink con el ref del destino."
    exit 1
  fi
  if [[ -n "$linked" && "$linked" != "$KAWIIL_OS_PROJECT_REF" ]]; then
    echo "ABORT: link actual ($linked) ≠ KAWIIL_OS_PROJECT_REF ($KAWIIL_OS_PROJECT_REF)."
    exit 1
  fi
fi

echo "==> db push Kawiil OS → $KAWIIL_OS_TARGET (ref=${KAWIIL_OS_PROJECT_REF:0:4}…)"
npx supabase db push --workdir "$ROOT/kawiil-os"
