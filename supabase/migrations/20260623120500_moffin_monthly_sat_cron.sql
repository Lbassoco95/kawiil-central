-- Cron: descarga mensual automática de CSF + opinión 32D para clientes con CIEC.
-- Corre los primeros 5 días de cada mes (07:00 UTC). La Edge Function es idempotente:
-- si un cliente ya tiene consulta success/pending del tipo en el mes en curso, la omite,
-- por eso correr varios días no genera duplicados (cubre clientes nuevos o reintentos).
--
-- Requiere CRON_SECRET en Edge Functions → Secrets y en Vault:
--   SELECT vault.create_secret('<valor de CRON_SECRET>', 'cron_secret');  -- (ya creado por el cron de refresco)

CREATE OR REPLACE FUNCTION public.invoke_moffin_monthly_sat_cron()
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
    RAISE NOTICE 'moffin-monthly-sat cron: cron_secret not found in vault';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://qppfampapbxdgednkofc.supabase.co/functions/v1/moffin-monthly-sat',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_moffin_monthly_sat_cron() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoke_moffin_monthly_sat_cron() TO postgres;

DO $$
DECLARE
  j record;
BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'moffin-monthly-sat'
  LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
EXCEPTION
  WHEN undefined_table THEN
    NULL;
END $$;

SELECT cron.schedule(
  'moffin-monthly-sat',
  '0 7 1-5 * *',
  $$SELECT public.invoke_moffin_monthly_sat_cron()$$
);
