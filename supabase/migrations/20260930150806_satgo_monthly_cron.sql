-- Cron mensual CSF/32D vía SATgo (satgo-monthly) en lugar de moffin-monthly-sat.
-- Mismo patrón que moffin_monthly_sat_cron: cron_secret en Vault + URL fija del proyecto.
-- Horario: 07:00 UTC, días 1-5 (idempotente en la Edge).

CREATE OR REPLACE FUNCTION public.invoke_satgo_monthly_cron()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret text;
BEGIN
  SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
   WHERE name = 'cron_secret'
   LIMIT 1;

  IF v_secret IS NULL OR btrim(v_secret) = '' THEN
    RAISE NOTICE 'satgo-monthly cron: cron_secret not found in vault';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://qppfampapbxdgednkofc.supabase.co/functions/v1/satgo-monthly',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_satgo_monthly_cron() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoke_satgo_monthly_cron() TO postgres;

DO $$
DECLARE
  j record;
BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname IN ('moffin-monthly-sat', 'moffin_monthly_sat', 'satgo-monthly-sat')
  LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
EXCEPTION
  WHEN undefined_table THEN
    NULL;
END $$;

SELECT cron.schedule(
  'satgo-monthly-sat',
  '0 7 1-5 * *',
  $$SELECT public.invoke_satgo_monthly_cron()$$
);
