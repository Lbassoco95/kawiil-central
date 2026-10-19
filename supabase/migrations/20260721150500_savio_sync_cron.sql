-- Cron: sincroniza Savio (facturas, pagos, clientes) a las tablas locales cada
-- día a las 06:00 UTC. La Edge Function `savio-sync` es idempotente por
-- (organization_id, savio_id), así que reintentar no duplica.
--
-- Requiere CRON_SECRET en Edge Functions → Secrets y en Vault:
--   SELECT vault.create_secret('<valor de CRON_SECRET>', 'cron_secret');  -- (ya creado por otros crons)

CREATE OR REPLACE FUNCTION public.invoke_savio_sync_cron()
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
    RAISE NOTICE 'savio-sync cron: cron_secret not found in vault';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://qppfampapbxdgednkofc.supabase.co/functions/v1/savio-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_savio_sync_cron() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoke_savio_sync_cron() TO postgres;

DO $$
DECLARE
  j record;
BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'savio-sync'
  LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
EXCEPTION
  WHEN undefined_table THEN
    NULL;
END $$;

SELECT cron.schedule(
  'savio-sync',
  '0 6 * * *',
  $$SELECT public.invoke_savio_sync_cron()$$
);
