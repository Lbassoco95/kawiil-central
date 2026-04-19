-- Cron diario para refrescar la "frase del día" en dos franjas (CDMX, lun-vie):
--   - 08:00 CDMX (≈14:00 UTC, México sin DST permanente desde 2022) → time_of_day=morning
--   - 15:00 CDMX (≈21:00 UTC) → time_of_day=afternoon
-- La Edge Function `refresh-weekday-phrases` decide morning/afternoon según
-- la hora local CDMX en el momento de ejecución, así que basta con el cron
-- en UTC y la propia función filtra fines de semana / fuera de ventana.

CREATE OR REPLACE FUNCTION public.invoke_refresh_weekday_phrases_cron()
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
    RAISE NOTICE 'refresh-weekday-phrases cron: app.pipeline_cron_secret no configurado';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://qppfampapbxdgednkofc.supabase.co/functions/v1/refresh-weekday-phrases',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_refresh_weekday_phrases_cron() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoke_refresh_weekday_phrases_cron() TO postgres;

-- Limpia jobs previos con el mismo nombre antes de re-agendar (idempotente).
DO $$
DECLARE
  j record;
BEGIN
  FOR j IN
    SELECT jobid FROM cron.job
    WHERE jobname IN (
      'refresh-weekday-phrases-morning',
      'refresh-weekday-phrases-afternoon'
    )
  LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
EXCEPTION
  WHEN undefined_table THEN
    NULL;
END $$;

-- 08:00 CDMX = 14:00 UTC, lun-vie
SELECT cron.schedule(
  'refresh-weekday-phrases-morning',
  '0 14 * * 1-5',
  $$SELECT public.invoke_refresh_weekday_phrases_cron()$$
);

-- 15:00 CDMX = 21:00 UTC, lun-vie
SELECT cron.schedule(
  'refresh-weekday-phrases-afternoon',
  '0 21 * * 1-5',
  $$SELECT public.invoke_refresh_weekday_phrases_cron()$$
);
