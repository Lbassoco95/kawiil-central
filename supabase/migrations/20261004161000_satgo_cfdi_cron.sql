-- Cron descarga CFDI SATgo a ventanas UTC que cubren 08/15/21 America/Mexico_City
-- (CST UTC-6 y CDT UTC-5). La Edge satgo-facturas valida la hora local y no-op fuera.
--
-- CDMX 08:00 → 13:00 UTC (CDT) / 14:00 UTC (CST)
-- CDMX 15:00 → 20:00 UTC (CDT) / 21:00 UTC (CST)
-- CDMX 21:00 → 02:00 UTC+1d (CDT) / 03:00 UTC+1d (CST)

CREATE OR REPLACE FUNCTION public.invoke_satgo_facturas_cron()
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
    RAISE NOTICE 'satgo-facturas cron: cron_secret not found in vault';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://qppfampapbxdgednkofc.supabase.co/functions/v1/satgo-facturas',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_satgo_facturas_cron() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoke_satgo_facturas_cron() TO postgres;

DO $$
DECLARE
  j record;
BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname IN ('satgo-facturas-cdmx', 'satgo_facturas_cdmx')
  LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
EXCEPTION
  WHEN undefined_table THEN
    NULL;
END $$;

SELECT cron.schedule(
  'satgo-facturas-cdmx',
  '5 2,3,13,14,20,21 * * *',
  $$SELECT public.invoke_satgo_facturas_cron()$$
);
