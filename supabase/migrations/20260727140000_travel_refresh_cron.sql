-- Fase 2 del bloque de traslado: recálculo con tráfico + avisos a 2 h y 1 h antes
-- de la hora de salida. Agrega banderas de control y programa un cron cada 15 min
-- que invoca la edge function `travel-refresh` (idempotente por las banderas).
--
-- Requiere CRON_SECRET en Edge Functions → Secrets y en Vault (name 'cron_secret').
-- Deploy: supabase db push

ALTER TABLE public.event_travel
  ADD COLUMN IF NOT EXISTS notified_2h boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS notified_1h boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.invoke_travel_refresh_cron()
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
    RAISE NOTICE 'travel-refresh cron: cron_secret not found in vault';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://qppfampapbxdgednkofc.supabase.co/functions/v1/travel-refresh',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_travel_refresh_cron() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoke_travel_refresh_cron() TO postgres;

DO $$
DECLARE
  j record;
BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'travel-refresh'
  LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
EXCEPTION
  WHEN undefined_table THEN
    NULL;
END $$;

SELECT cron.schedule(
  'travel-refresh',
  '*/15 * * * *',
  $$SELECT public.invoke_travel_refresh_cron()$$
);
