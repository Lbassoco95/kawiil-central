-- Cron: conciliación pago→factura (RF-04). Corre diario a las 06:30 UTC, justo
-- después de savio-sync (06:00). La Edge Function reconcile-payments es idempotente
-- (payment_invoice único, cola única por pago), así que reintentar no duplica.
--
-- Requiere CRON_SECRET en Edge Functions → Secrets y en Vault (cron_secret).

CREATE OR REPLACE FUNCTION public.invoke_reconcile_payments_cron()
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
    RAISE NOTICE 'reconcile-payments cron: cron_secret not found in vault';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://qppfampapbxdgednkofc.supabase.co/functions/v1/reconcile-payments',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_reconcile_payments_cron() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoke_reconcile_payments_cron() TO postgres;

DO $$
DECLARE
  j record;
BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'reconcile-payments'
  LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
EXCEPTION
  WHEN undefined_table THEN
    NULL;
END $$;

SELECT cron.schedule(
  'reconcile-payments',
  '30 6 * * *',
  $$SELECT public.invoke_reconcile_payments_cron()$$
);
