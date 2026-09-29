-- 2026-09-28 · qppfampapbxdgednkofc
-- Rollback de supabase/migrations/20260929110500_portal_isolation_guard.sql
-- Quita el cerco de aislamiento del portal. Correr ANTES que los demás rollback del portal.
-- ¡Con esto cualquier cuenta del portal vuelve a alcanzar las rutas abiertas del back-office!
-- Solo tiene sentido si también se revierten las demás migraciones del portal.
DO $$
DECLARE t record; v_cur text;
BEGIN
  FOR t IN SELECT tablename FROM pg_policies WHERE schemaname = 'public' AND policyname = 'portal_deny_portal_accounts' LOOP
    EXECUTE format('DROP POLICY IF EXISTS portal_deny_portal_accounts ON public.%I', t.tablename);
  END LOOP;
  DROP POLICY IF EXISTS "Portal accounts only portal buckets" ON storage.objects;
  SELECT (regexp_match(array_to_string(s.setconfig, ','), 'pgrst\.db_pre_request=([^,]+)'))[1] INTO v_cur
    FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole WHERE r.rolname = 'authenticator';
  IF v_cur = 'public.portal_pre_request' THEN
    EXECUTE 'ALTER ROLE authenticator RESET pgrst.db_pre_request';
    PERFORM pg_notify('pgrst', 'reload config');
  END IF;
EXCEPTION WHEN insufficient_privilege OR undefined_object THEN
  RAISE WARNING 'Revise a mano pgrst.db_pre_request de authenticator: %', SQLERRM;
END $$;
DROP FUNCTION IF EXISTS public.portal_pre_request();
DROP FUNCTION IF EXISTS public.portal_apply_isolation_guard();
DROP FUNCTION IF EXISTS public.portal_caller_is_portal();
DROP FUNCTION IF EXISTS public.portal_table_allowlist();
