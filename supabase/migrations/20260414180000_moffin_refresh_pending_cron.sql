-- Cron: refresca consultas Moffin pendientes cada 10 minutos.
-- Usa el mismo secreto que los demás crons del proyecto:
--   ALTER DATABASE postgres SET app.pipeline_cron_secret = '...';
-- y CRON_SECRET en Edge Functions → Secrets.

CREATE OR REPLACE FUNCTION public.invoke_moffin_refresh_pending_cron()
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
    RAISE NOTICE 'moffin-refresh-pending cron: app.pipeline_cron_secret no configurado';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://qppfampapbxdgednkofc.supabase.co/functions/v1/moffin-query',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{"refreshAllPending": true}'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_moffin_refresh_pending_cron() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoke_moffin_refresh_pending_cron() TO postgres;

DO $$
DECLARE
  j record;
BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'moffin-refresh-pending'
  LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
EXCEPTION
  WHEN undefined_table THEN
    NULL;
END $$;

SELECT cron.schedule(
  'moffin-refresh-pending',
  '*/10 * * * *',
  $$SELECT public.invoke_moffin_refresh_pending_cron()$$
);
