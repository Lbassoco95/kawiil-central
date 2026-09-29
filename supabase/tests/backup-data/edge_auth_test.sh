#!/usr/bin/env bash
# A7 · backup-data (verify_jwt = false) rechaza sin credencial válida.
# Se levanta la función REAL con Deno local, apuntando SUPABASE_URL a un puerto cerrado:
# ninguna credencial falsa puede «validarse» y cualquier lectura de tabla fallaría.
# Nunca se invoca un entorno real.
# Uso: DENO=/ruta/a/deno bash supabase/tests/backup-data/edge_auth_test.sh
set -uo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
DENO="${DENO:-deno}"
export SUPABASE_URL=http://127.0.0.1:9 SUPABASE_SERVICE_ROLE_KEY=service-de-prueba
export BACKUP_CRON_SECRET="$(printf 's%.0s' {1..40})-secreto-de-prueba" BACKUP_ORGANIZATION_ID=a0000000-0000-0000-0000-000000000001
fails=0
check() { if [[ "$3" =~ ^($2)$ ]]; then echo "  OK  $1 → $3"; else echo "  FALLA $1 → $3 (esperado $2)"; fails=$((fails+1)); fi; }
"$DENO" run --quiet --allow-net --allow-env --allow-read --config "$ROOT/supabase/functions/backup-data/deno.test.json" \
  "$ROOT/supabase/functions/backup-data/index.ts" >/tmp/edge_backup_data.log 2>&1 &
PID=$!
trap 'kill $PID 2>/dev/null' EXIT
for _ in $(seq 1 90); do (echo > /dev/tcp/127.0.0.1/8000) 2>/dev/null && break; sleep 1; done
code() { curl -s --max-time 15 -o /tmp/edge_backup_body.json -w "%{http_code}" -X "$1" http://127.0.0.1:8000/backup-data -H "Content-Type: application/json" "${@:3}" -d "$2"; }

echo "== backup-data (verify_jwt = false)"
check "sin credencial" 401 "$(code POST '{"include_data":true}')"
check "secreto equivocado" 401 "$(code POST '{"include_data":true}' -H 'x-backup-secret: equivocado')"
check "secreto vacío" 401 "$(code POST '{}' -H 'x-backup-secret: ')"
check "JWT falso" 401 "$(code POST '{"include_data":true}' -H 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ4In0.falso')"
check "llave anónima como JWT" 401 "$(code POST '{}' -H 'Authorization: Bearer anon-de-prueba')"
check "GET" 405 "$(code GET '' -H "x-backup-secret: $BACKUP_CRON_SECRET")"
check "respuesta sin datos" '\{"error":"no_autorizado"\}' "$(code POST '{}' >/dev/null; cat /tmp/edge_backup_body.json)"
# Ninguna llamada rechazada intentó leer tablas: solo aparecen intentos de escribir la bitácora.
reads="$(grep -c 'Backup completed' /tmp/edge_backup_data.log || true)"
check "ningún volcado iniciado" 0 "$reads"
[[ $fails -eq 0 ]] && echo "TODO VERDE: backup-data no responde sin credencial." || { echo "$fails FALLAS"; cat /tmp/edge_backup_data.log | tail -20; exit 1; }
