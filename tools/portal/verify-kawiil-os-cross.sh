#!/usr/bin/env bash
# Verificador de cruce real central ↔ Kawiil OS.
# Con proyectos ya creados (env local, nunca en el repo):
#
#   CENTRAL_SUPABASE_URL=… CENTRAL_ANON_KEY=… \
#   KAWIIL_OS_SUPABASE_URL=… KAWIIL_OS_ANON_KEY=… \
#   npm run kawiil-os:verify-cross
#
# Sin esas variables: imprime NO VERIFICABLE y sale 0 (no inventa llaves).
# Con variables: exige 401/403 al cruzar Auth/REST; falla (1) si hay acceso indebido.
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
# shellcheck source=tools/portal/kawiil-os-targets.sh
source "$ROOT/tools/portal/kawiil-os-targets.sh"

need=(CENTRAL_SUPABASE_URL CENTRAL_ANON_KEY KAWIIL_OS_SUPABASE_URL KAWIIL_OS_ANON_KEY)
missing=0
for v in "${need[@]}"; do
  if [[ -z "${!v:-}" ]]; then missing=1; fi
done
if [[ "$missing" -eq 1 ]]; then
  echo "NO VERIFICABLE: faltan CENTRAL_SUPABASE_URL, CENTRAL_ANON_KEY, KAWIIL_OS_SUPABASE_URL y/o KAWIIL_OS_ANON_KEY."
  echo "Polo debe crear los proyectos y exportar esas variables locales antes de rerun."
  exit 0
fi

# No imprimir llaves. Solo comprobar forma de URL y cerco de refs.
for url_var in CENTRAL_SUPABASE_URL KAWIIL_OS_SUPABASE_URL; do
  url="${!url_var}"
  if [[ "$url" != https://* ]]; then
    echo "FALLA: $url_var debe ser https://"
    exit 1
  fi
done

if grep -F "$CENTRAL_PROJECT_REF" <<<"$KAWIIL_OS_SUPABASE_URL" >/dev/null 2>&1; then
  echo "FALLA: KAWIIL_OS_SUPABASE_URL apunta a central."
  exit 1
fi
if ! grep -F "$CENTRAL_PROJECT_REF" <<<"$CENTRAL_SUPABASE_URL" >/dev/null 2>&1; then
  echo "AVISO: CENTRAL_SUPABASE_URL no contiene el ref conocido de central; se prueba el cruce igual."
fi
if [[ "$CENTRAL_SUPABASE_URL" == "$KAWIIL_OS_SUPABASE_URL" ]]; then
  echo "FALLA: las dos URLs son iguales."
  exit 1
fi
if [[ "$CENTRAL_ANON_KEY" == "$KAWIIL_OS_ANON_KEY" ]]; then
  echo "FALLA: las llaves anon son idénticas (mismo proyecto o copia incorrecta)."
  exit 1
fi

code_of() {
  local url="$1" key="$2" path="$3"
  curl -sS -o /dev/null -w '%{http_code}' \
    -H "apikey: $key" \
    -H "Authorization: Bearer $key" \
    --max-time 20 \
    "${url}${path}"
}

fail=0
check_cross() {
  local label="$1" url="$2" key="$3" path="$4"
  local code
  code="$(code_of "$url" "$key" "$path" || echo 000)"
  # Esperamos rechazo: 401/403/404 (proyecto/ruta no autorizada). 200/201/204 = fuga.
  if [[ "$code" =~ ^(200|201|204)$ ]]; then
    echo "FALLA: $label → $path respondió $code (no debe leer/escribir en el proyecto contrario)."
    fail=1
  elif [[ "$code" =~ ^(401|403|404)$ ]]; then
    echo "OK: $label → $path = $code (rechazado)"
  else
    echo "FALLA: $label → $path = $code (se esperaba 401/403/404)"
    fail=1
  fi
}

echo "==> Llave OS contra Auth/REST de central"
check_cross "OS→central Auth" "$CENTRAL_SUPABASE_URL" "$KAWIIL_OS_ANON_KEY" "/auth/v1/user"
check_cross "OS→central REST" "$CENTRAL_SUPABASE_URL" "$KAWIIL_OS_ANON_KEY" "/rest/v1/profiles?select=id&limit=1"

echo "==> Llave central contra Auth/REST de Kawiil OS"
check_cross "central→OS Auth" "$KAWIIL_OS_SUPABASE_URL" "$CENTRAL_ANON_KEY" "/auth/v1/user"
check_cross "central→OS REST" "$KAWIIL_OS_SUPABASE_URL" "$CENTRAL_ANON_KEY" "/rest/v1/portal_companies?select=id&limit=1"

if [[ "$fail" -ne 0 ]]; then
  echo "RESULTADO: no cumplido (cruce con acceso indebido o respuesta inesperada)."
  exit 1
fi
echo "RESULTADO: cumplido (ambas direcciones rechazan el cruce)."
exit 0
