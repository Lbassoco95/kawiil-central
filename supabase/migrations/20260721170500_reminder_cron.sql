-- Cron: recordatorios de cobranza (RF-03). Corre diario a las 13:00 UTC (~07:00
-- CDMX). La Edge Function reminder-cron respeta REMINDERS_ENABLED (dry-run si no
-- está activo), la pausa por cliente y el dedupe por día, así que correr a diario
-- es seguro.
--
-- Requiere CRON_SECRET en Edge Functions → Secrets y en Vault (cron_secret).

CREATE OR REPLACE FUNCTION public.invoke_reminder_cron()
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
    RAISE NOTICE 'reminder cron: cron_secret not found in vault';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://qppfampapbxdgednkofc.supabase.co/functions/v1/reminder-cron',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_reminder_cron() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoke_reminder_cron() TO postgres;

DO $$
DECLARE
  j record;
BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'reminder-cron'
  LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
EXCEPTION
  WHEN undefined_table THEN
    NULL;
END $$;

SELECT cron.schedule(
  'reminder-cron',
  '0 13 * * *',
  $$SELECT public.invoke_reminder_cron()$$
);
