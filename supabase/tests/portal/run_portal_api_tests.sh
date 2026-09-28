#!/usr/bin/env bash
# Pruebas del portal por HTTP con PostgREST real (Docker) sobre Postgres LOCAL.
#   · api_isolation.mjs      — criterio 1 por la API (cuenta del portal A contra B y el back-office)
#   · staff_regression.mjs   — V2: el equipo lee/escribe igual con y sin las migraciones del portal
#   · verify-route-guard.mjs — V1: script de verificación post-despliegue (debe pasar)
#   · negativo V1            — PostgREST SIN pre-request: el script FALLA y la vinculación se bloquea
# Uso: PGHOST=/var/tmp/pgk PGPORT=54329 PGUSER=postgres PG_TCP_HOST=127.0.0.1 bash supabase/tests/portal/run_portal_api_tests.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
T="$ROOT/supabase/tests/portal"
SECRET="${PGRST_JWT_SECRET:-secreto-local-de-prueba-de-32-caracteres-min}"
export PGRST_JWT_SECRET="$SECRET"
TCP="${PG_TCP_HOST:-127.0.0.1}"
FIRST_PORTAL=20260928140000

q() { psql -X -v ON_ERROR_STOP=1 -q -d "$1" "${@:2}"; }
fresh() { docker rm -f pgrst_portal pgrst_base pgrst_sin_cerco >/dev/null 2>&1 || true; psql -X -q -d postgres -c "DROP DATABASE IF EXISTS $1 WITH (FORCE)" -c "CREATE DATABASE $1" >/dev/null; }
migrate() { # $1 db, $2 = all | pre
  q "$1" -f "$T/00_supabase_stub.sql" >/dev/null 2>&1 || true
  for f in "$ROOT"/supabase/migrations/*.sql; do
    v="$(basename "$f" | cut -c1-14)"
    if [[ "$2" == pre && ! "$v" < "$FIRST_PORTAL" ]]; then continue; fi
    sed -E 's/CREATE EXTENSION IF NOT EXISTS (pg_net|pg_cron)[^;]*;/SELECT 1;/I' "$f" | psql -X -q -d "$1" --single-transaction >/dev/null 2>&1 || true
  done
}
pgrst() { # $1 nombre, $2 db, $3 puerto, $4 db-config
  docker rm -f "$1" >/dev/null 2>&1 || true
  docker run -d --name "$1" --network host \
    -e PGRST_DB_URI="postgres://authenticator@$TCP:${PGPORT:-5432}/$2" -e PGRST_DB_SCHEMAS=public -e PGRST_DB_ANON_ROLE=anon \
    -e PGRST_JWT_SECRET="$SECRET" -e PGRST_SERVER_PORT="$3" -e PGRST_DB_CONFIG="$4" postgrest/postgrest:v12.2.3 >/dev/null
  for _ in $(seq 1 30); do curl -s -o /dev/null "http://localhost:$3/" && return 0; sleep 1; done
  echo "PostgREST $1 no arrancó"; docker logs "$1"; exit 1
}
mint() { node -e '
const {createHmac}=require("node:crypto");const b=o=>Buffer.from(JSON.stringify(o)).toString("base64url");
const h=b({alg:"HS256",typ:"JWT"}),p=b({sub:process.argv[1],role:"authenticated",aud:"authenticated",exp:Math.floor(Date.now()/1000)+600});
console.log(`${h}.${p}.${createHmac("sha256",process.env.PGRST_JWT_SECRET).update(`${h}.${p}`).digest("base64url")}`)' "$1"; }

echo "== Bases"
fresh portal_api; migrate portal_api all
q portal_api -f "$T/10_isolation_test.sql" >/dev/null 2>&1
q portal_api -c "DROP SCHEMA IF EXISTS portal_test CASCADE" >/dev/null
q portal_api -f "$T/06_seed_staff_regression.sql" >/dev/null
fresh portal_base; migrate portal_base pre
q portal_base -f "$T/06_seed_staff_regression.sql" >/dev/null
echo "  portal_api (con portal) y portal_base (sin portal) listas"

echo "== PostgREST"
pgrst pgrst_portal portal_api 3055 true
pgrst pgrst_base portal_base 3056 false

echo "== Criterio 1 por la API"
PGRST_URL=http://localhost:3055 node "$T/api_isolation.mjs" | tail -1
echo "== V2 regresión del equipo"
PGRST_BASE=http://localhost:3056 PGRST_PORTAL=http://localhost:3055 DB_BASE=portal_base DB_PORTAL=portal_api node "$T/staff_regression.mjs" | tail -1
echo "== V1 verificación post-despliegue (cerco activo: debe pasar)"
UA_JWT="$(mint 22222222-0000-0000-0000-00000000000a)"
REST_URL=http://localhost:3055 PORTAL_TEST_JWT="$UA_JWT" node "$ROOT/tools/portal/verify-route-guard.mjs" | tail -1

echo "== V1 negativo: PostgREST sin pre-request"
pgrst pgrst_sin_cerco portal_api 3057 false
if REST_URL=http://localhost:3057 PORTAL_TEST_JWT="$UA_JWT" node "$ROOT/tools/portal/verify-route-guard.mjs" >/tmp/portal_v1_neg.log; then
  echo "FALLA: el script no detectó el cerco inactivo"; exit 1
fi
echo "  OK  el script de verificación FALLA con el cerco inactivo ($(grep -c FALLA /tmp/portal_v1_neg.log) rutas/diagnóstico en falla)"
STAFF_JWT="$(mint 11111111-0000-0000-0000-000000000001)"
q portal_api -c "INSERT INTO auth.users (id, email, raw_user_meta_data) VALUES ('22222222-0000-0000-0000-0000000000d9','nueva.http@prueba.invalid','{\"kawiil_portal\":true}') ON CONFLICT DO NOTHING" >/dev/null
link() { curl -s -o /dev/null -w "%{http_code}" -X POST "http://localhost:$1/rpc/portal_staff_link_account" \
  -H "Authorization: Bearer $STAFF_JWT" -H "Content-Type: application/json" \
  -d '{"_user_id":"22222222-0000-0000-0000-0000000000d9","_client_id":"bbbbbbbb-0000-0000-0000-00000000000b","_role":"consulta","_tier":"premier"}'; }
S1="$(link 3057)"
[[ "$S1" == 403 ]] && echo "  OK  sin cerco: vincular por HTTP → $S1 (bloqueado)" || { echo "FALLA: sin cerco se pudo vincular ($S1)"; exit 1; }
G="$(curl -s -X POST http://localhost:3057/rpc/portal_route_guard_status -H 'Content-Type: application/json' -d '{}')"
echo "$G" | grep -q '"ok" *: *false' && echo "  OK  sin cerco: diagnóstico público → $G" || { echo "FALLA diagnóstico: $G"; exit 1; }
S2="$(link 3055)"
[[ "$S2" == 200 ]] && echo "  OK  con cerco: vincular por HTTP → $S2" || { echo "FALLA: con cerco no se pudo vincular ($S2)"; exit 1; }
docker rm -f pgrst_sin_cerco >/dev/null
echo
echo "TODO VERDE: API, regresión del equipo y cerco de rutas verificados por HTTP."
