-- Plano de control de SOLO LECTURA: MATI Admin (vía MATI API) consulta el estado de seguridad de Kawiil.
-- Idempotente: se puede ejecutar más de una vez.
--
--  · control_nonces        nonce de un solo uso de las peticiones firmadas (anti repetición).
--  · security_posture()    estado de las protecciones de la base (RLS, políticas abiertas, privilegios de anon,
--                          funciones SECURITY DEFINER expuestas, buckets públicos, extensiones en public).
--  · security_users_snapshot()  usuarios con correo ENMASCARADO, roles, último acceso, MFA y bloqueo.
--  · security_auth_activity()   eventos de autenticación por acción en una ventana (sin IPs ni usuarios).
--
-- Las tres funciones solo leen, tienen search_path fijo y solo las puede ejecutar `service_role`
-- (la Edge Function `seguridad-control`). Nadie desde el navegador.

-- ── Nonces ──────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.control_nonces (
  nonce     text        PRIMARY KEY,
  client_id text        NOT NULL,
  at        timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_control_nonces_at ON public.control_nonces (at);
ALTER TABLE public.control_nonces ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.control_nonces FROM PUBLIC, anon, authenticated;

-- ── Estado de las protecciones ──────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.security_posture()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  buckets jsonb := '[]'::jsonb;
  result  jsonb;
BEGIN
  IF to_regclass('storage.buckets') IS NOT NULL THEN
    EXECUTE 'SELECT coalesce(jsonb_agg(name ORDER BY name), ''[]''::jsonb) FROM storage.buckets WHERE public'
      INTO buckets;
  END IF;

  SELECT jsonb_build_object(
    'generated_at', now(),
    'tables', jsonb_build_object(
      'total', (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')),
      'rls_enabled', (SELECT count(*) FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relrowsecurity),
      'without_rls', coalesce((SELECT jsonb_agg(c.relname ORDER BY c.relname)
                               FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                               WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND NOT c.relrowsecurity), '[]'::jsonb),
      'rls_without_policies', coalesce((SELECT jsonb_agg(c.relname ORDER BY c.relname)
                               FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
                               WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p') AND c.relrowsecurity
                                 AND NOT EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid)), '[]'::jsonb)
    ),
    'policies', jsonb_build_object(
      'total', (SELECT count(*) FROM pg_policies WHERE schemaname = 'public'),
      'open_to_public', coalesce((SELECT jsonb_agg(jsonb_build_object('table', tablename, 'policy', policyname, 'cmd', cmd)
                                                  ORDER BY tablename, policyname)
                                  FROM pg_policies
                                  WHERE schemaname = 'public'
                                    AND roles && ARRAY['public', 'anon']::name[]
                                    AND (qual = 'true' OR with_check = 'true')), '[]'::jsonb)
    ),
    'anon', jsonb_build_object(
      'tables_with_write_grants', (SELECT count(DISTINCT table_name) FROM information_schema.role_table_grants
                                   WHERE grantee = 'anon' AND table_schema = 'public'
                                     AND privilege_type IN ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE')),
      'tables_with_select_grant', (SELECT count(DISTINCT table_name) FROM information_schema.role_table_grants
                                   WHERE grantee = 'anon' AND table_schema = 'public' AND privilege_type = 'SELECT')
    ),
    'functions', jsonb_build_object(
      'security_definer_total', (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                                 WHERE n.nspname = 'public' AND p.prosecdef),
      'executable_by_anon', coalesce((SELECT jsonb_agg(p.proname ORDER BY p.proname)
                                      FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                                      WHERE n.nspname = 'public' AND p.prosecdef
                                        AND has_function_privilege('anon', p.oid, 'EXECUTE')), '[]'::jsonb),
      'executable_by_authenticated_count', (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                                            WHERE n.nspname = 'public' AND p.prosecdef
                                              AND has_function_privilege('authenticated', p.oid, 'EXECUTE')),
      'without_fixed_search_path', (SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
                                    WHERE n.nspname = 'public' AND p.prosecdef
                                      AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}'::text[])) cfg
                                                      WHERE cfg LIKE 'search_path=%'))
    ),
    'extensions_in_public', coalesce((SELECT jsonb_agg(e.extname ORDER BY e.extname)
                                      FROM pg_extension e JOIN pg_namespace n ON n.oid = e.extnamespace
                                      WHERE n.nspname = 'public'), '[]'::jsonb),
    'storage', jsonb_build_object('public_buckets', buckets)
  ) INTO result;

  RETURN result;
END;
$$;

-- ── Usuarios (correo enmascarado) ───────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.security_users_snapshot(p_limit integer DEFAULT 500)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  mfa_expr text := CASE WHEN to_regclass('auth.mfa_factors') IS NOT NULL
    THEN 'EXISTS (SELECT 1 FROM auth.mfa_factors f WHERE f.user_id = au.id AND f.status = ''verified'')'
    ELSE 'false' END;
  result jsonb;
BEGIN
  EXECUTE format($q$
    SELECT coalesce(jsonb_agg(t.u ORDER BY t.u->>'created_at'), '[]'::jsonb) FROM (
      SELECT jsonb_build_object(
        'id', au.id,
        'email', CASE WHEN au.email IS NULL THEN NULL
                      ELSE left(au.email, 1) || '***@' || split_part(au.email, '@', 2) END,
        'full_name', p.full_name,
        'roles', coalesce((SELECT jsonb_agg(ur.role ORDER BY ur.role) FROM public.user_roles ur WHERE ur.user_id = au.id), '[]'::jsonb),
        'created_at', au.created_at,
        'last_sign_in_at', au.last_sign_in_at,
        'email_confirmed', au.email_confirmed_at IS NOT NULL,
        'banned', (au.banned_until IS NOT NULL AND au.banned_until > now()),
        'mfa_enabled', %s
      ) AS u
      FROM auth.users au
      LEFT JOIN public.profiles p ON p.user_id = au.id
      ORDER BY au.created_at
      LIMIT %s
    ) t
  $q$, mfa_expr, greatest(1, least(coalesce(p_limit, 500), 1000)))
  INTO result;
  RETURN result;
END;
$$;

-- ── Actividad de autenticación (agregada, sin datos personales) ─────────────
CREATE OR REPLACE FUNCTION public.security_auth_activity(p_hours integer DEFAULT 24)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  h        integer := greatest(1, least(coalesce(p_hours, 24), 168));
  by_action jsonb;
  ips      bigint;
BEGIN
  IF to_regclass('auth.audit_log_entries') IS NULL THEN
    RETURN jsonb_build_object('available', false);
  END IF;
  EXECUTE format($q$
    SELECT coalesce(jsonb_object_agg(a, n), '{}'::jsonb)
    FROM (SELECT payload->>'action' AS a, count(*) AS n
          FROM auth.audit_log_entries
          WHERE created_at >= now() - make_interval(hours => %s)
          GROUP BY 1) t
  $q$, h) INTO by_action;
  EXECUTE format($q$
    SELECT count(DISTINCT ip_address) FROM auth.audit_log_entries
    WHERE created_at >= now() - make_interval(hours => %s)
  $q$, h) INTO ips;
  RETURN jsonb_build_object('available', true, 'window_hours', h, 'events_by_action', by_action, 'distinct_ips', ips);
END;
$$;

-- ── Solo la Edge Function (service_role) las ejecuta ────────────────────────
REVOKE ALL ON FUNCTION public.security_posture()               FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.security_users_snapshot(integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.security_auth_activity(integer)  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.security_posture()               TO service_role;
GRANT EXECUTE ON FUNCTION public.security_users_snapshot(integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.security_auth_activity(integer)  TO service_role;
