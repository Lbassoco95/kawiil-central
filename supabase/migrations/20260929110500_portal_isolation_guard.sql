-- =================================================================
-- Portal del cliente — M2: cerco de aislamiento para cuentas del portal.
--
-- Proyecto: qppfampapbxdgednkofc · Fecha: 2026-09-28
-- Rollback (a mano): migrations/2026-09-28_portal_isolation_guard.rollback.sql
--
-- Una cuenta del portal es un usuario `authenticated` más para Postgres. El
-- back-office tiene rutas que cualquier autenticado alcanza sin pasar por la
-- organización (verificado en el reconocimiento):
--   · policies con USING (true): lead_tasks (lectura Y edición),
--     slack_user_profiles, compliance_*; knowledge_insights UPDATE a public.
--   · bucket `documents` con policies `bucket_id = 'documents'` a secas.
--   · funciones SECURITY DEFINER ejecutables por authenticated que reciben el
--     id de organización como parámetro (y ese id es conocido).
-- Este archivo NO cambia nada para el equipo. Para cuentas del portal:
--   Capa 1 (RLS): policy RESTRICTIVE en TODA tabla de `public` que no sea del
--     portal ni de la lista blanca, y en storage.objects fuera de los buckets
--     `portal` y `juun`.
--   Capa 2 (API): `portal_pre_request()` como db_pre_request de PostgREST:
--     lista blanca de rutas (/portal_*, /rpc/portal_*, fis_receipts, fis_cfdi,
--     fis_merchants). Cualquier otra tabla, vista o RPC → 403.
-- Una tabla nueva del back-office creada DESPUÉS de esta migración no tiene la
-- capa 1, pero sí la capa 2; y la prueba supabase/tests/portal lo detecta.
-- =================================================================

-- Tablas del back-office que el portal SÍ lee (con sus policies propias).
CREATE OR REPLACE FUNCTION public.portal_table_allowlist()
RETURNS text[]
LANGUAGE sql IMMUTABLE
AS $$ SELECT ARRAY['fis_receipts', 'fis_cfdi', 'fis_merchants'] $$;

-- Initplan: se evalúa una vez por consulta, no por fila.
CREATE OR REPLACE FUNCTION public.portal_caller_is_portal()
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = pg_temp, public
AS $$ SELECT auth.uid() IS NOT NULL AND EXISTS (SELECT 1 FROM public.portal_accounts WHERE user_id = auth.uid()) $$;
REVOKE ALL ON FUNCTION public.portal_caller_is_portal() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_caller_is_portal() TO anon, authenticated, service_role;

-- Capa 1: policy restrictiva en cada tabla de public fuera del portal.
CREATE OR REPLACE FUNCTION public.portal_apply_isolation_guard()
RETURNS int
LANGUAGE plpgsql
SET search_path = pg_temp, public
AS $$
DECLARE t record; n int := 0;
BEGIN
  FOR t IN
    SELECT c.relname FROM pg_class c
     WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
       AND c.relname !~ '^portal_'
       AND c.relname <> ALL (public.portal_table_allowlist())
  LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = t.relname
                    AND policyname = 'portal_deny_portal_accounts') THEN
      EXECUTE format(
        'CREATE POLICY portal_deny_portal_accounts ON public.%I AS RESTRICTIVE FOR ALL TO authenticated '
        'USING ((SELECT NOT public.portal_caller_is_portal())) '
        'WITH CHECK ((SELECT NOT public.portal_caller_is_portal()))', t.relname);
      n := n + 1;
    END IF;
  END LOOP;
  RETURN n;
END;
$$;
REVOKE ALL ON FUNCTION public.portal_apply_isolation_guard() FROM PUBLIC, anon, authenticated;

SELECT public.portal_apply_isolation_guard();

-- Storage: fuera de `portal` y `juun`, una cuenta del portal no ve ni escribe nada.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'storage' AND tablename = 'objects'
                 AND policyname = 'Portal accounts only portal buckets') THEN
    CREATE POLICY "Portal accounts only portal buckets" ON storage.objects
      AS RESTRICTIVE FOR ALL TO authenticated
      USING ((SELECT NOT public.portal_caller_is_portal()) OR bucket_id IN ('portal', 'juun'))
      WITH CHECK ((SELECT NOT public.portal_caller_is_portal()) OR bucket_id IN ('portal', 'juun'));
  END IF;
END $$;

-- Capa 2: lista blanca de rutas de PostgREST para cuentas del portal.
CREATE OR REPLACE FUNCTION public.portal_pre_request()
RETURNS void
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE
  v_claims jsonb;
  v_sub uuid;
  v_path text;
BEGIN
  v_claims := NULLIF(current_setting('request.jwt.claims', true), '')::jsonb;
  IF v_claims IS NULL OR v_claims->>'role' IS DISTINCT FROM 'authenticated' THEN
    RETURN;
  END IF;
  BEGIN
    v_sub := (v_claims->>'sub')::uuid;
  EXCEPTION WHEN others THEN
    RETURN;
  END;
  IF NOT EXISTS (SELECT 1 FROM public.portal_accounts WHERE user_id = v_sub) THEN
    RETURN;
  END IF;
  v_path := regexp_replace(COALESCE(current_setting('request.path', true), ''), '^.*/rest/v1', '');
  IF v_path ~ '^/(rpc/)?portal_[a-z0-9_]+/?$'
     OR v_path ~ ('^/(' || array_to_string(public.portal_table_allowlist(), '|') || ')/?$') THEN
    RETURN;
  END IF;
  RAISE EXCEPTION 'Ruta no disponible para cuentas del portal: %', v_path
    USING ERRCODE = '42501', HINT = 'portal_pre_request';
END;
$$;
REVOKE ALL ON FUNCTION public.portal_pre_request() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_pre_request() TO anon, authenticated, service_role;

-- Registrar el pre-request en PostgREST (el mismo mecanismo que documenta Supabase).
-- Si ya hubiera otro pre-request configurado, NO se pisa: se avisa y queda como paso manual.
DO $$
DECLARE v_existing text;
BEGIN
  SELECT (regexp_match(array_to_string(s.setconfig, ','), 'pgrst\.db_pre_request=([^,]+)'))[1] INTO v_existing
    FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole
   WHERE r.rolname = 'authenticator';
  IF v_existing IS NOT NULL AND v_existing <> 'public.portal_pre_request' THEN
    RAISE WARNING 'authenticator ya tiene pgrst.db_pre_request=%; combine a mano con public.portal_pre_request', v_existing;
  ELSE
    EXECUTE 'ALTER ROLE authenticator SET pgrst.db_pre_request TO ''public.portal_pre_request''';
    PERFORM pg_notify('pgrst', 'reload config');
  END IF;
EXCEPTION WHEN insufficient_privilege OR undefined_object THEN
  RAISE WARNING 'No se pudo registrar pgrst.db_pre_request (%). Paso manual en RUNBOOK §3.', SQLERRM;
END $$;
