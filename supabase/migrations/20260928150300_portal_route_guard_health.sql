-- =================================================================
-- Portal del cliente — V1: el cerco de rutas (db_pre_request) falla cerrado
-- y se puede verificar.
--
-- Proyecto: qppfampapbxdgednkofc · Fecha: 2026-09-28
-- Rollback (a mano): migrations/2026-09-28_portal_route_guard_health.rollback.sql
--
-- Cómo se sabe que el cerco está ACTIVO (no solo configurado): PostgREST corre el
-- pre-request en la MISMA transacción de cada petición. `portal_pre_request()`
-- ahora marca `portal.pre_request_ran = on` (local a la transacción). Si una
-- función llamada por PostgREST ve esa marca, el cerco corrió en esa petición.
--   · portal_route_guard_status(): diagnóstico (configurado, activo en esta
--     petición, tablas sin policy restrictiva).
--   · Trigger en portal_memberships: sin cerco activo, NO se vincula ni se activa
--     el nivel básico desde el navegador.
--   · portal-api consulta el diagnóstico por PostgREST antes de registrar o invitar.
-- =================================================================

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
  -- Prueba de vida del cerco para esta transacción (ver portal_route_guard_status).
  PERFORM set_config('portal.pre_request_ran', 'on', true);
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

CREATE OR REPLACE FUNCTION public.portal_route_guard_status()
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
DECLARE v_registered boolean; v_active boolean; v_missing int;
BEGIN
  SELECT EXISTS (SELECT 1 FROM pg_db_role_setting s JOIN pg_roles r ON r.oid = s.setrole
                  WHERE r.rolname = 'authenticator'
                    AND array_to_string(s.setconfig, ',') ~ 'pgrst\.db_pre_request=public\.portal_pre_request')
    INTO v_registered;
  v_active := COALESCE(current_setting('portal.pre_request_ran', true), '') = 'on';
  SELECT count(*) INTO v_missing FROM pg_class c
   WHERE c.relnamespace = 'public'::regnamespace AND c.relkind IN ('r', 'p')
     AND c.relname !~ '^portal_' AND c.relname <> ALL (public.portal_table_allowlist())
     AND NOT EXISTS (SELECT 1 FROM pg_policies p WHERE p.schemaname = 'public' AND p.tablename = c.relname
                      AND p.policyname = 'portal_deny_portal_accounts');
  RETURN jsonb_build_object(
    'pre_request_registrado', v_registered,
    'pre_request_activo', v_active,
    'tablas_sin_cerco', v_missing,
    'ok', v_registered AND v_active AND v_missing = 0);
END;
$$;
REVOKE ALL ON FUNCTION public.portal_route_guard_status() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.portal_route_guard_status() TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.portal_require_route_guard()
RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = pg_temp, public
AS $$
BEGIN
  -- Solo aplica a peticiones con usuario (PostgREST). service_role y migraciones no traen auth.uid().
  IF auth.uid() IS NOT NULL AND NOT (public.portal_route_guard_status()->>'ok')::boolean THEN
    RAISE EXCEPTION 'El cerco de rutas del portal no está verificado; la vinculación de cuentas está bloqueada. Avise a Kawiil.'
      USING ERRCODE = 'insufficient_privilege';
  END IF;
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.portal_require_route_guard() FROM PUBLIC;
DROP TRIGGER IF EXISTS trg_portal_memberships_route_guard ON public.portal_memberships;
CREATE TRIGGER trg_portal_memberships_route_guard
  BEFORE INSERT OR UPDATE OF role, status ON public.portal_memberships
  FOR EACH ROW EXECUTE FUNCTION public.portal_require_route_guard();
