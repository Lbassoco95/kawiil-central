-- Métricas de adopción (page_view) solo para usuarios con módulo admin habilitado.
CREATE OR REPLACE FUNCTION public.get_activity_adoption_stats()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  oid uuid;
  is_admin boolean := false;
BEGIN
  SELECT p.organization_id INTO oid FROM public.profiles p WHERE p.user_id = auth.uid();
  IF oid IS NULL THEN RETURN '{}'::jsonb; END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.user_module_permissions u
    WHERE u.user_id = auth.uid()
      AND u.organization_id = oid
      AND u.module_key = 'admin'
      AND u.enabled = true
  ) INTO is_admin;

  IF NOT is_admin THEN RETURN '{}'::jsonb; END IF;

  RETURN jsonb_build_object(
    'top_sections',
    COALESCE(
      (
        SELECT jsonb_agg(jsonb_build_object('section', s.entity_type, 'n', s.n) ORDER BY s.n DESC)
        FROM (
          SELECT a.entity_type, count(*)::int AS n
          FROM public.activity_log a
          WHERE a.organization_id = oid
            AND a.action = 'page_view'
            AND a.created_at > now() - interval '30 days'
          GROUP BY 1
        ) s
      ),
      '[]'::jsonb
    ),
    'active_users_7d',
    (
      SELECT count(DISTINCT a.user_id)::int
      FROM public.activity_log a
      WHERE a.organization_id = oid
        AND a.action = 'page_view'
        AND a.created_at > now() - interval '7 days'
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_activity_adoption_stats() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_activity_adoption_stats() TO authenticated;
