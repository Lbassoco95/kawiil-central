#!/usr/bin/env bash
# A4 · El bucket `backups` es privado y ningún rol del navegador lo puede leer.
# Postgres LOCAL (nunca producción): stub mínimo + las dos migraciones históricas del
# bucket + la nueva (dos veces) + su rollback. Datos sintéticos.
# Uso: PGHOST=… PGPORT=… PGUSER=postgres bash supabase/tests/backup-data/run_bucket_test.sh
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

psql -X -q -d postgres -c "DROP DATABASE IF EXISTS $DB WITH (FORCE)" >/dev/null
[[ $fails -eq 0 ]] && echo "TODO VERDE: nadie lee backups desde el navegador." || { echo "$fails FALLAS"; exit 1; }
