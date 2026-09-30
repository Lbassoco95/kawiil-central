#!/usr/bin/env bash
# Prueba de separación (Corte 0 / S1-S2-S6): aplica el baseline de Kawiil OS en una
# base Postgres efímera vacía. Demuestra que:
#   1) el baseline aplica sin la cadena de migraciones de central;
#   2) ninguna tabla de central aparece en el esquema resultante;
#   3) el árbol kawiil-os no embebe host ni JWT/llaves de central;
#   4) RLS aísla empresas; el rollback deja cero objetos portal_*.
# Corre en CI (job base-y-api de portal-tests.yml) contra el servicio Postgres.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
STUB="$ROOT/supabase/tests/portal/00_supabase_stub.sql"
MIG="$ROOT/kawiil-os/supabase/migrations/20260929000100_kawiil_os_baseline.sql"
ROLLBACK="$ROOT/kawiil-os/supabase/rollbacks/20260929000100_kawiil_os_baseline.rollback.sql"
DB=kawiil_os_standalone_test
q() { psql -X -v ON_ERROR_STOP=1 -q -d "$DB" "$@"; }

# El conjunto de Kawiil OS no puede conocer el host de central ni ninguna credencial suya.
if grep -rEn "qppfampapbxdgednkofc|eyJhbGciOiJIUzI1Ni" "$ROOT/kawiil-os" >/dev/null 2>&1; then
  echo "FALLA: el conjunto standalone referencia el proyecto o llaves de central"
  exit 1
fi
# El project_id local de Kawiil OS no puede ser el de central.
if grep -E '^\s*project_id\s*=\s*"qppfampapbxdgednkofc"' "$ROOT/kawiil-os/supabase/config.toml" >/dev/null 2>&1; then
  echo "FALLA: kawiil-os/supabase/config.toml apunta al project_id de central"
  exit 1
fi

psql -X -q -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" >/dev/null
q -f "$STUB" >/dev/null 2>&1
q --single-transaction -f "$MIG" >/dev/null
FORBIDDEN="profiles|user_roles|rh_attendance|rh_employee_profile|expenses|slack_messages|linked_accounts|client_sat_certificates|documents|clients|fis_receipts"
FOUND="$(q -At -c "SELECT string_agg(tablename, ',') FROM pg_tables WHERE schemaname='public' AND tablename ~ '^($FORBIDDEN)$'")"
[[ -z "$FOUND" ]] || { echo "FALLA: tablas de central presentes: $FOUND"; exit 1; }
PORTAL_TABLES="$(q -At -c "SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename LIKE 'portal_%'")"
[[ "$PORTAL_TABLES" -gt 0 ]] || { echo "FALLA: el baseline no creó tablas portal_*"; exit 1; }
q -c "
INSERT INTO auth.users(id,email) VALUES
 ('10000000-0000-0000-0000-000000000001','admin-a@demo.invalid'),
 ('10000000-0000-0000-0000-000000000002','employee-a@demo.invalid'),
 ('20000000-0000-0000-0000-000000000001','admin-b@demo.invalid');
INSERT INTO public.portal_companies(id,external_ref,name) VALUES
 ('a0000000-0000-0000-0000-000000000001','demo-a','DEMO A'),
 ('b0000000-0000-0000-0000-000000000001','demo-b','DEMO B');
INSERT INTO public.portal_accounts(user_id,email,status) SELECT id,email,'activa' FROM auth.users;
INSERT INTO public.portal_memberships(user_id,client_id,role) VALUES
 ('10000000-0000-0000-0000-000000000001','a0000000-0000-0000-0000-000000000001','administrador'),
 ('10000000-0000-0000-0000-000000000002','a0000000-0000-0000-0000-000000000001','empleado'),
 ('20000000-0000-0000-0000-000000000001','b0000000-0000-0000-0000-000000000001','administrador');
INSERT INTO public.portal_client_settings(client_id) VALUES
 ('a0000000-0000-0000-0000-000000000001'),('b0000000-0000-0000-0000-000000000001');
" >/dev/null
q -c "SELECT set_config('request.jwt.claims','{\"sub\":\"10000000-0000-0000-0000-000000000001\",\"role\":\"authenticated\"}',false); SET ROLE authenticated; DO \$\$ BEGIN IF (SELECT count(*) FROM public.portal_companies) <> 1 THEN RAISE EXCEPTION 'cross-company isolation failed'; END IF; END \$\$; RESET ROLE;" >/dev/null
q --single-transaction -f "$ROLLBACK" >/dev/null
LEFT="$(q -At -c "SELECT count(*) FROM pg_class WHERE relnamespace='public'::regnamespace AND relname LIKE 'portal_%'")"
[[ "$LEFT" == "0" ]] || { echo "FALLA: rollback dejó $LEFT objetos"; exit 1; }
echo "TODO VERDE: Kawiil OS nace en base vacía, aísla empresas y no contiene tablas de central."
