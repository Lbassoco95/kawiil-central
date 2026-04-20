-- Cron diario 09:00 America/Mexico_City (= 15:00 UTC en horario estandar; el cron usa UTC):
-- revisa client_sat_certificates y dispara cert-expiry-notifier con CRON_SECRET (vault.cron_secret).

CREATE OR REPLACE FUNCTION public.invoke_cert_expiry_notifier_cron()
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
    RAISE NOTICE 'cert-expiry-notifier cron: cron_secret not found in vault';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://qppfampapbxdgednkofc.supabase.co/functions/v1/cert-expiry-notifier',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_cert_expiry_notifier_cron() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoke_cert_expiry_notifier_cron() TO postgres;

DO $$
DECLARE
  j record;
BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'cert-expiry-notifier'
  LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
EXCEPTION
  WHEN undefined_table THEN
    NULL;
END $$;

-- 15:00 UTC = 09:00 CDMX (estandar) / 10:00 CDMX (horario de verano).
SELECT cron.schedule(
  'cert-expiry-notifier',
  '0 15 * * *',
  $$SELECT public.invoke_cert_expiry_notifier_cron()$$
);
