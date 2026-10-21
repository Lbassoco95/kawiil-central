-- Kawiilito · cierre del día: 17:00 Ciudad de México (UTC-6 fijo, sin horario de verano) = 23:00 UTC, lun-vie.
CREATE OR REPLACE FUNCTION public.invoke_kawiilito_cierre_cron()
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
    RAISE NOTICE 'kawiilito-cierre cron: app.pipeline_cron_secret no configurado';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://qppfampapbxdgednkofc.supabase.co/functions/v1/kawiilito-cierre',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_kawiilito_cierre_cron() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoke_kawiilito_cierre_cron() TO postgres;

DO $$
DECLARE
  j record;
BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'kawiilito-cierre-1700-cdmx'
  LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
EXCEPTION
  WHEN undefined_table THEN
    NULL;
END $$;

SELECT cron.schedule(
  'kawiilito-cierre-1700-cdmx',
  '0 23 * * 1-5',
  $$SELECT public.invoke_kawiilito_cierre_cron()$$
);
