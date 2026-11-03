-- Función de LECTURA para la vista «Agentes» de Marketing: estado de los trabajos programados de Marketing.
-- Devuelve solo nombre, horario, si está activo y su última ejecución (fecha y estado). NO devuelve el texto del comando
-- (que contiene la forma de leer secretos), ni el mensaje de retorno, ni trabajos de otros módulos.
-- No escribe nada. Solo responde a quien tiene el permiso de ver Marketing (mk_can_view()); a cualquier otro le devuelve vacío.
CREATE OR REPLACE FUNCTION public.mk_agentes_estado()
RETURNS TABLE(trabajo text, horario text, activo boolean, ultima_ejecucion timestamptz, ultima_estado text)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
BEGIN
  IF NOT COALESCE(public.mk_can_view(), false) THEN
    RETURN;
  END IF;
  RETURN QUERY
  SELECT j.jobname::text, j.schedule::text, j.active, d.start_time, d.status::text
  FROM cron.job j
  LEFT JOIN LATERAL (
    SELECT r.start_time, r.status FROM cron.job_run_details r WHERE r.jobid = j.jobid ORDER BY r.start_time DESC LIMIT 1
  ) d ON true
  WHERE j.jobname LIKE 'marketing-%'
  ORDER BY j.jobname;
END;
$$;

-- La puede llamar la aplicación con sesión iniciada (la propia función comprueba el permiso); nunca anon.
REVOKE ALL ON FUNCTION public.mk_agentes_estado() FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.mk_agentes_estado() TO authenticated, service_role;
