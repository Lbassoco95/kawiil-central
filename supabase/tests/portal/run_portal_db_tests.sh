#!/usr/bin/env bash
# Pruebas de base del portal del cliente en un Postgres LOCAL (nunca en producción).
#
#   1. Base vacía: stub de Supabase + todas las migraciones → pruebas.
#   2. Rollback de las 6 migraciones del portal → no queda nada del portal y
#      handle_new_user vuelve a su versión previa → reaplicar → pruebas otra vez.
#   3. Base con datos: migraciones hasta antes del portal + datos sintéticos
#      previos → portal → pruebas → rollback → los datos previos siguen intactos.
#   4. Idempotencia: aplicar dos veces las migraciones del portal no falla.
#
# Uso:
#   PGHOST=/var/tmp/pgk PGPORT=54329 PGUSER=postgres supabase/tests/portal/run_portal_db_tests.sh
# Requiere Postgres 15+ con un superusuario (el stub crea roles y esquemas de Supabase).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
T="$ROOT/supabase/tests/portal"
PORTAL_MIGS=(
  20260928140000_portal_core
  20260928140100_portal_messaging
  20260928140200_portal_documents
  20260928140300_portal_cfdi
  20260928140400_portal_tickets
  20260928140500_portal_isolation_guard
  20260928150000_portal_csd_authorization
  20260928150100_portal_rate_limits
  20260928150200_portal_account_deletion
  20260928150300_portal_route_guard_health
)
ROLLBACKS=(
  2026-09-28_portal_route_guard_health
  2026-09-28_portal_account_deletion
  2026-09-28_portal_rate_limits
  2026-09-28_portal_csd_authorization
  2026-09-28_portal_isolation_guard
  2026-09-28_portal_tickets
  2026-09-28_portal_cfdi
  2026-09-28_portal_documents
  2026-09-28_portal_messaging
  2026-09-28_portal_core
)
FIRST_PORTAL="${PORTAL_MIGS[0]:0:14}"

q() { psql -X -v ON_ERROR_STOP=1 -q -d "$1" "${@:2}"; }

apply_repo_migrations_before_portal() {
  local db="$1"
  q "$db" -f "$T/00_supabase_stub.sql" >/dev/null 2>&1
  local pre_fail=0
  for f in "$ROOT"/supabase/migrations/*.sql; do
    local v; v="$(basename "$f" | cut -c1-14)"
    [[ "$v" < "$FIRST_PORTAL" ]] || continue
    if ! sed -E 's/CREATE EXTENSION IF NOT EXISTS (pg_net|pg_cron)[^;]*;/SELECT 1;/I' "$f" \
        | psql -X -v ON_ERROR_STOP=1 -q -d "$db" --single-transaction >/dev/null 2>&1; then
      pre_fail=$((pre_fail + 1))
      echo "  (preexistente) falla en base vacía: $(basename "$f")"
    fi
  done
  echo "  migraciones previas al portal con error preexistente: $pre_fail"
}

apply_portal() {
  local db="$1"
  for m in "${PORTAL_MIGS[@]}"; do
    q "$db" --single-transaction -f "$ROOT/supabase/migrations/$m.sql" >/dev/null 2>"/tmp/portal_mig_$m.err" \
      || { echo "FALLA aplicando $m"; cat "/tmp/portal_mig_$m.err"; exit 1; }
  done
  echo "  migraciones del portal aplicadas: ${#PORTAL_MIGS[@]}"
}

rollback_portal() {
  local db="$1"
  for r in "${ROLLBACKS[@]}"; do
    q "$db" --single-transaction -f "$ROOT/migrations/$r.rollback.sql" >/dev/null 2>"/tmp/portal_rb_$r.err" \
      || { echo "FALLA en rollback $r"; cat "/tmp/portal_rb_$r.err"; exit 1; }
  done
  echo "  rollback del portal aplicado: ${#ROLLBACKS[@]}"
}

assert_no_portal_left() {
  local db="$1" left
  left="$(psql -X -At -d "$db" -c "
    SELECT string_agg(x, ', ') FROM (
      SELECT 'tabla/vista '||relname AS x FROM pg_class WHERE relnamespace='public'::regnamespace AND relname ~ '^portal_'
      UNION ALL SELECT 'función '||proname FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname ~ '^portal_'
      UNION ALL SELECT 'policy '||tablename||'.'||policyname FROM pg_policies WHERE policyname ~* 'portal'
      UNION ALL SELECT 'trigger '||tgname FROM pg_trigger WHERE tgname ~ 'portal'
      UNION ALL SELECT 'cron '||jobname FROM cron.job WHERE jobname ~ 'portal'
      UNION ALL SELECT 'bucket portal vacío' FROM storage.buckets WHERE id='portal'
                 AND NOT EXISTS (SELECT 1 FROM storage.objects WHERE bucket_id='portal')
      UNION ALL SELECT 'pre_request' FROM pg_db_role_setting s JOIN pg_roles r ON r.oid=s.setrole
                 WHERE r.rolname='authenticator' AND array_to_string(s.setconfig, ',') ~ 'portal_pre_request'
    ) s")"
  if [[ -n "$left" ]]; then echo "FALLA: el rollback dejó: $left"; exit 1; fi
  echo "  OK  el rollback no deja objetos del portal"
}

fn_hash() { psql -X -At -d "$1" -c "SELECT md5(pg_get_functiondef('public.handle_new_user()'::regprocedure))"; }

run_tests() {
  local db="$1"
  if ! cat "$T/10_isolation_test.sql" "$T/20_corrections_test.sql" | q "$db" > "/tmp/portal_test_$db.log" 2>&1; then
    grep -E "FALLA|ERROR" "/tmp/portal_test_$db.log" | head -20
    echo "FALLA: pruebas en $db (log: /tmp/portal_test_$db.log)"; exit 1
  fi
  local n; n="$(grep -c 'NOTICE:  OK' "/tmp/portal_test_$db.log" || true)"
  echo "  OK  $n verificaciones de aislamiento y flujo en $db"
}

fresh_db() { psql -X -q -d postgres -c "DROP DATABASE IF EXISTS $1" -c "CREATE DATABASE $1" >/dev/null; }

echo "== 1. Base vacía"
fresh_db portal_vacia
apply_repo_migrations_before_portal portal_vacia
H0="$(fn_hash portal_vacia)"
apply_portal portal_vacia
echo "== 4. Idempotencia (segunda aplicación)"
apply_portal portal_vacia
run_tests portal_vacia

echo "== 2. Rollback y reaplicación (base vacía)"
rollback_portal portal_vacia
assert_no_portal_left portal_vacia
[[ "$(fn_hash portal_vacia)" == "$H0" ]] && echo "  OK  handle_new_user restaurada exactamente" \
  || { echo "FALLA: handle_new_user no quedó como antes"; exit 1; }
apply_portal portal_vacia
fresh_db portal_vacia2
apply_repo_migrations_before_portal portal_vacia2 >/dev/null
apply_portal portal_vacia2
run_tests portal_vacia2

echo "== 3. Base con datos"
fresh_db portal_con_datos
apply_repo_migrations_before_portal portal_con_datos >/dev/null
q portal_con_datos -f "$T/05_seed_preexisting.sql" >/dev/null
# Huella SOLO de las filas previas (ids de la semilla empiezan con e0 / f0; objetos con «previo/»).
SNAP_SQL="SELECT md5(string_agg(t || ':' || COALESCE(h, '-'), ',' ORDER BY t)) FROM (
  SELECT 'clients' t, md5(string_agg(row_to_json(c)::text, '' ORDER BY id)) h FROM public.clients c WHERE id::text LIKE 'e0%'
  UNION ALL SELECT 'profiles', md5(string_agg(row_to_json(p)::text, '' ORDER BY id)) FROM public.profiles p WHERE user_id::text LIKE 'f0%'
  UNION ALL SELECT 'user_roles', md5(string_agg(row_to_json(r)::text, '' ORDER BY id)) FROM public.user_roles r WHERE user_id::text LIKE 'f0%'
  UNION ALL SELECT 'fis_receipts', md5(string_agg(row_to_json(f)::text, '' ORDER BY id)) FROM public.fis_receipts f WHERE id::text LIKE 'e0%'
  UNION ALL SELECT 'fis_merchants', md5(string_agg(row_to_json(m)::text, '' ORDER BY id)) FROM public.fis_merchants m
  UNION ALL SELECT 'client_sat_certificates', md5(string_agg(row_to_json(s)::text, '' ORDER BY id)) FROM public.client_sat_certificates s WHERE id::text LIKE 'e0%'
  UNION ALL SELECT 'documents', md5(string_agg(row_to_json(d)::text, '' ORDER BY id)) FROM public.documents d WHERE id::text LIKE 'e0%'
  UNION ALL SELECT 'handle_new_user', md5(pg_get_functiondef('public.handle_new_user()'::regprocedure))
  UNION ALL SELECT 'storage', md5(string_agg(bucket_id || name, '' ORDER BY bucket_id, name)) FROM storage.objects WHERE name LIKE 'previo/%'
) x"
DATA_SQL="$(echo "$SNAP_SQL" | sed "s/UNION ALL SELECT 'handle_new_user'.*$//")"
S0="$(psql -X -At -d portal_con_datos -c "$SNAP_SQL")"
S0_DATA="$(psql -X -At -d portal_con_datos -c "$DATA_SQL")"
apply_portal portal_con_datos
# handle_new_user cambia a propósito al aplicar; se compara el resto.
S1_DATA="$(psql -X -At -d portal_con_datos -c "$DATA_SQL")"
[[ "$S0_DATA" == "$S1_DATA" ]] && echo "  OK  aplicar el portal no altera datos previos" \
  || { echo "FALLA: aplicar alteró datos previos"; exit 1; }
run_tests portal_con_datos
rollback_portal portal_con_datos
assert_no_portal_left portal_con_datos
S2="$(psql -X -At -d portal_con_datos -c "$SNAP_SQL")"
[[ "$S2" == "$S0" ]] && echo "  OK  tras rollback los datos previos (y handle_new_user) quedan idénticos" \
  || { echo "FALLA: el rollback alteró datos previos"; exit 1; }
apply_portal portal_con_datos
echo "  OK  reaplicación sobre la base con datos"

echo
echo "TODO VERDE: migraciones del portal probadas en base vacía y con datos (ida, vuelta e idempotencia)."
