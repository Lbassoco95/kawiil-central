#!/usr/bin/env bash
# Punto de entrada bajo kawiil-os/demo/. El cerco y la denylist de central
# viven en tools/portal/ (este árbol no puede embeber el project ref de central).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
exec bash "$ROOT/tools/portal/demo-reset.sh" "$@"
