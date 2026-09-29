#!/usr/bin/env bash
# V3 · Las funciones del portal con verify_jwt = false se autentican solas.
# Se levantan localmente con Deno (sin Supabase: SUPABASE_URL apunta a un puerto
# cerrado, así que ninguna credencial falsa puede «validarse») y se llaman SIN
# credenciales, con credenciales falsas y con un secreto de cron equivocado.
# Uso: DENO=/ruta/a/deno bash supabase/tests/portal/edge_auth_test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
DENO="${DENO:-deno}"
FN="$ROOT/supabase/functions"
export SUPABASE_URL=http://127.0.0.1:9 SUPABASE_ANON_KEY=anon-de-prueba SUPABASE_SERVICE_ROLE_KEY=service-de-prueba CRON_SECRET=cron-de-prueba
fails=0
check() { # desc, esperado(regex), obtenido
  if [[ "$3" =~ ^($2)$ ]]; then echo "  OK  $1 → $3"; else echo "  FALLA $1 → $3 (esperado $2)"; fails=$((fails+1)); fi
}
serve() {
  "$DENO" run --quiet --allow-net --allow-env --allow-read --config "$ROOT/supabase/tests/portal/deno.test.json" "$FN/$1/index.ts" >/tmp/edge_$1.log 2>&1 &
  PID=$!
  for _ in $(seq 1 90); do curl -s -o /dev/null http://127.0.0.1:8000/ && return 0; sleep 1; done
  echo "no arrancó $1"; cat /tmp/edge_$1.log; exit 1
}
code() { curl -s -o /dev/null -w "%{http_code}" -X POST "http://127.0.0.1:8000$1" -H "Content-Type: application/json" "${@:3}" -d "$2"; }

echo "== portal-api (verify_jwt = false)"
serve portal-api
for op in facturas.cargar facturas.crear csd.cargar csd.estado cuenta.eliminar archivos.enlace central/invitar central/cliente.baja central/tickets.facturar central/avisar; do
  check "sin JWT $op" 401 "$(code /portal-api/v1/$op '{}')"
  check "JWT falso $op" 401 "$(code /portal-api/v1/$op '{}' -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.falso')"
done
check "versión desconocida" 404 "$(code /portal-api/v2/csd.estado '{}')"
check "registro sin captcha configurado → cerrado" 503 "$(code /portal-api/v1/cuenta.registrar '{"email":"a@prueba.invalid","password":"xxxxxxxxxxxx","full_name":"A","acepta_aviso":true,"acepta_terminos":true}')"
check "recuperación sin captcha configurado → cerrado" 503 "$(code /portal-api/v1/cuenta.recuperar '{"email":"a@prueba.invalid"}')"
kill $PID; wait $PID 2>/dev/null
TURNSTILE_SECRET_KEY=2x0000000000000000000000000000000AA serve portal-api
check "registro con captcha pero cerco no verificable → cerrado" 503 "$(code /portal-api/v1/cuenta.registrar '{"email":"a@prueba.invalid","password":"xxxxxxxxxxxx","full_name":"A","acepta_aviso":true,"acepta_terminos":true,"captcha_token":"x"}')"
kill $PID; wait $PID 2>/dev/null

echo "== portal-notify (verify_jwt = false; solo cron o service_role)"
serve portal-notify
check "sin credencial" 401 "$(code / '{}')"
check "secreto de cron equivocado" 401 "$(code / '{}' -H 'x-cron-secret: otro')"
check "Bearer que no es service_role" 401 "$(code / '{}' -H 'Authorization: Bearer anon-de-prueba')"
kill $PID; wait $PID 2>/dev/null

echo "== portal-dropbox-sync (verify_jwt = false; cron, service_role o G3/G4)"
serve portal-dropbox-sync
check "sin credencial" 401 "$(code / '{"action":"sincronizar"}')"
check "secreto de cron equivocado" 401 "$(code / '{"action":"descubrir"}' -H 'x-cron-secret: otro')"
check "JWT falso" 401 "$(code / '{"action":"descubrir"}' -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.falso')"
kill $PID; wait $PID 2>/dev/null

echo
[[ $fails -eq 0 ]] && echo "TODO VERDE: ninguna función abierta responde sin credencial." || { echo "$fails FALLAS"; exit 1; }
