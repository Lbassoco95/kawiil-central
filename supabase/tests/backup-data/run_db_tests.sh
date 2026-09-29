#!/usr/bin/env bash
# A4 · El bucket `backups` es privado y ningún rol del navegador lo puede leer.
# A6 · La bitácora de llamadas solo la escribe la función y solo la leen los G4; nadie la modifica.
# Postgres LOCAL (nunca producción): stub mínimo + las dos migraciones históricas del
# bucket + la nueva (dos veces) + su rollback. Datos sintéticos.
# Uso: PGHOST=… PGPORT=… PGUSER=postgres bash supabase/tests/backup-data/run_db_tests.sh
set -euo pipefail
export PGOPTIONS="-c client_min_messages=warning"
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
DB=backup_bucket_test
M="$ROOT/supabase/migrations"
q() { psql -X -v ON_ERROR_STOP=1 -q -At -d "$DB" "$@"; }
fails=0
check() { if [[ "$2" == "$3" ]]; then echo "  OK  $1 → $3"; else echo "  FALLA $1 → $3 (esperado $2)"; fails=$((fails+1)); fi; }
seen() { # $1 rol, $2 uid o vacío
  q -c "SELECT set_config('request.jwt.claims', '$( [[ -n "$2" ]] && echo "{\"sub\":\"$2\"}" )', false);" \
    -c "SET ROLE $1" -c "SELECT count(*) FROM storage.objects WHERE bucket_id = 'backups'" | tail -1; }
G4=11111111-0000-0000-0000-000000000004
G3=11111111-0000-0000-0000-000000000003

psql -X -q -d postgres -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" -c "CREATE DATABASE $DB" >/dev/null
q -f "$(dirname "$0")/00_stub.sql" >/dev/null
q -f "$M/20260308202607_0f127970-d9c2-4990-97ab-d84bcac6850e.sql" >/dev/null
q -f "$M/20260308202914_c7c5c40f-3529-4cc8-bea6-4dfd50a2d773.sql" >/dev/null
q -c "INSERT INTO public.user_roles VALUES ('$G4', 'transformador'), ('$G3', 'referente');
      INSERT INTO storage.objects (bucket_id, name) VALUES ('backups', '2026-09-28/backup-sintetico.json');"

echo "== Antes (control: la prueba sí detecta la lectura)"
check "G4 lee backups desde el navegador" 1 "$(seen authenticated $G4)"

echo "== Con la migración (aplicada dos veces)"
q -f "$M/20260929100000_backup_bucket_no_browser_read.sql" >/dev/null
q -f "$M/20260929100000_backup_bucket_no_browser_read.sql" >/dev/null
check "bucket privado" f "$(q -c "SELECT public FROM storage.buckets WHERE id = 'backups'")"
check "políticas de storage que mencionan backups" 0 "$(q -c "SELECT count(*) FROM pg_policies WHERE schemaname = 'storage' AND (qual ILIKE '%backups%' OR with_check ILIKE '%backups%')")"
check "G4 (authenticated)" 0 "$(seen authenticated $G4)"
check "G3 (authenticated)" 0 "$(seen authenticated $G3)"
check "sin sesión (anon)" 0 "$(seen anon '')"
check "service_role (la función y el Dashboard)" 1 "$(seen service_role '')"

echo "== Rollback y reaplicación"
q -f "$ROOT/migrations/2026-09-29_backup_bucket_no_browser_read.rollback.sql" >/dev/null
check "tras rollback el G4 vuelve a leer (estado anterior)" 1 "$(seen authenticated $G4)"
q -f "$M/20260929100000_backup_bucket_no_browser_read.sql" >/dev/null
check "reaplicada: G4 no lee" 0 "$(seen authenticated $G4)"
check "el archivo sigue en el bucket (no se borró nada)" 1 "$(q -c "SELECT count(*) FROM storage.objects WHERE bucket_id = 'backups'")"

echo "== A6 · bitácora (aplicada dos veces)"
q -f "$M/20260929100100_backup_access_log.sql" >/dev/null
q -f "$M/20260929100100_backup_access_log.sql" >/dev/null
# La función escribe con service_role.
q -c "SET ROLE service_role" -c "INSERT INTO public.backup_access_log (outcome, reason, via, ip) VALUES ('rechazada', 'sin_credencial', NULL, '203.0.113.7')" >/dev/null
check "service_role escribe" 1 "$(q -c "SELECT count(*) FROM public.backup_access_log")"
lee() { q -c "SELECT set_config('request.jwt.claims', '{\"sub\":\"$2\"}', false);" -c "SET ROLE $1" -c "SELECT count(*) FROM public.backup_access_log" 2>/dev/null | tail -1 || echo error; }
check "G4 lee la bitácora" 1 "$(lee authenticated $G4)"
check "G3 no la lee" 0 "$(lee authenticated $G3)"
check "anon no la lee" error "$(q -c "SET ROLE anon" -c "SELECT count(*) FROM public.backup_access_log" 2>/dev/null | tail -1 || echo error)"
check "el navegador no escribe" error "$(q -c "SELECT set_config('request.jwt.claims', '{\"sub\":\"$G4\"}', false);" -c "SET ROLE authenticated" -c "INSERT INTO public.backup_access_log (outcome, reason) VALUES ('aceptada', 'falsa')" >/dev/null 2>&1 && echo escribio || echo error)"
check "nadie la modifica (ni service_role)" error "$(q -c "SET ROLE service_role" -c "UPDATE public.backup_access_log SET reason = 'x'" >/dev/null 2>&1 && echo modifico || echo error)"
check "nadie la borra (ni el dueño)" error "$(q -c "DELETE FROM public.backup_access_log" >/dev/null 2>&1 && echo borro || echo error)"
check "nadie la vacía (TRUNCATE)" error "$(q -c "TRUNCATE public.backup_access_log" >/dev/null 2>&1 && echo vacio || echo error)"
check "no tiene columnas de datos del volcado" 0 "$(q -c "SELECT count(*) FROM information_schema.columns WHERE table_name = 'backup_access_log' AND column_name IN ('data', 'payload', 'rows_json', 'content')")"
q -f "$ROOT/migrations/2026-09-29_backup_access_log.rollback.sql" >/dev/null
check "rollback quita la tabla" "" "$(q -c "SELECT to_regclass('public.backup_access_log')")"
q -f "$M/20260929100100_backup_access_log.sql" >/dev/null

psql -X -q -d postgres -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" >/dev/null
[[ $fails -eq 0 ]] && echo "TODO VERDE: nadie lee backups desde el navegador y la bitácora es de solo lectura para G4." || { echo "$fails FALLAS"; exit 1; }
