#!/usr/bin/env bash
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"
STUB="$ROOT/supabase/tests/portal/00_supabase_stub.sql"
MIG="$ROOT/.devin/kawiil-os/supabase/migrations/20260929000100_kawiil_os_baseline.sql"
ROLLBACK="$ROOT/.devin/kawiil-os/supabase/rollbacks/20260929000100_kawiil_os_baseline.rollback.sql"
DB=kawiil_os_standalone_test
q() { psql -X -v ON_ERROR_STOP=1 -q -d "$DB" "$@"; }
psql -X -q -d postgres -c "DROP DATABASE IF EXISTS $DB" -c "CREATE DATABASE $DB" >/dev/null
q -f "$STUB" >/dev/null 2>&1
q --single-transaction -f "$MIG" >/dev/null
FORBIDDEN="profiles|user_roles|rh_attendance|rh_employee_profile|expenses|slack_messages|linked_accounts|client_sat_certificates|documents|clients|fis_receipts"
FOUND="$(q -At -c "SELECT string_agg(tablename, ',') FROM pg_tables WHERE schemaname='public' AND tablename ~ '^($FORBIDDEN)$'")"
[[ -z "$FOUND" ]] || { echo "FALLA: tablas de central presentes: $FOUND"; exit 1; }
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
