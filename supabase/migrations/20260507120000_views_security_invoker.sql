-- ---------------------------------------------------------------------------
-- Fix: Supabase Advisor "SECURITY DEFINER View" warnings.
--
-- Contexto:
--   En Postgres, una VIEW se evalua por defecto con los privilegios y
--   politicas RLS del rol que la CREO (comportamiento SECURITY DEFINER).
--   En una base con RLS activo eso puede exponer filas que el usuario
--   actual no deberia ver, por lo que Supabase Advisor lo reporta.
--
-- Solucion (Postgres 15+):
--   Marcar las vistas con WITH (security_invoker = true) para que hereden
--   los permisos y RLS del rol que consulta, no del creador.
--
-- Vistas afectadas:
--   - public.v_task_all_assignees  (ver 20260329130000_fix_document_types_and_task_model.sql)
--   - public.moffin_client_fiel    (ver 20260505120000_client_sat_certificates.sql)
-- ---------------------------------------------------------------------------

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_views
    WHERE schemaname = 'public' AND viewname = 'v_task_all_assignees'
  ) THEN
    EXECUTE 'ALTER VIEW public.v_task_all_assignees SET (security_invoker = true)';
  END IF;

  IF EXISTS (
    SELECT 1 FROM pg_views
    WHERE schemaname = 'public' AND viewname = 'moffin_client_fiel'
  ) THEN
    EXECUTE 'ALTER VIEW public.moffin_client_fiel SET (security_invoker = true)';
  END IF;
END $$;

COMMENT ON VIEW public.v_task_all_assignees IS
  'Vista unificada de asignaciones de tasks (primary + co-assignees). security_invoker=true: respeta RLS del usuario que consulta.';

COMMENT ON VIEW public.moffin_client_fiel IS
  'VIEW de compatibilidad sobre client_sat_certificates (cert_type=fiel). security_invoker=true: respeta RLS del usuario que consulta.';
