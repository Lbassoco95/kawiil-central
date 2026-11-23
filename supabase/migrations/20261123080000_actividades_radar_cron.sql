-- Radar de actividades: lun-vie 08:37 Ciudad de México (UTC-6 fijo, sin horario de verano) = 14:37 UTC.
-- Mismo patrón que kawiilito-cierre: la función llama a la edge function con el secreto del cron.
CREATE OR REPLACE FUNCTION public.invoke_actividades_radar_cron()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret text;
BEGIN
  v_secret := NULL;
  BEGIN
    v_secret := current_setting('app.pipeline_cron_secret', true);
  EXCEPTION WHEN OTHERS THEN
    v_secret := NULL;
  END;

  IF v_secret IS NULL OR btrim(v_secret) = '' THEN
    RAISE NOTICE 'actividades-radar cron: app.pipeline_cron_secret no configurado';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://qppfampapbxdgednkofc.supabase.co/functions/v1/actividades-radar',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_actividades_radar_cron() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoke_actividades_radar_cron() TO postgres;

DO $$
DECLARE
  j record;
BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'actividades-radar-0837-cdmx'
  LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
EXCEPTION
  WHEN undefined_table THEN
    NULL;
END $$;

SELECT cron.schedule(
  'actividades-radar-0837-cdmx',
  '37 14 * * 1-5',
  $$SELECT public.invoke_actividades_radar_cron()$$
);
