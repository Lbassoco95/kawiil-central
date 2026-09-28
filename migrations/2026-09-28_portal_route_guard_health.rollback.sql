-- 2026-09-28 · qppfampapbxdgednkofc
-- Rollback de supabase/migrations/20260928150300_portal_route_guard_health.sql.
-- Quita el bloqueo por cerco no verificado y restaura portal_pre_request() de 20260928140500.
DROP TRIGGER IF EXISTS trg_portal_memberships_route_guard ON public.portal_memberships;
DROP FUNCTION IF EXISTS public.portal_require_route_guard();
DROP FUNCTION IF EXISTS public.portal_route_guard_status();
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
