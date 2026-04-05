-- Invocar Edge notification-digest diariamente (mismo secreto que process-email-queue: CRON_SECRET / app.pipeline_cron_secret).
CREATE OR REPLACE FUNCTION public.invoke_notification_digest_cron()
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
    RAISE NOTICE 'notification-digest cron: app.pipeline_cron_secret no configurado';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://qppfampapbxdgednkofc.supabase.co/functions/v1/notification-digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_notification_digest_cron() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoke_notification_digest_cron() TO postgres;

DO $$
DECLARE
  j record;
BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'notification-digest-daily'
  LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
EXCEPTION
  WHEN undefined_table THEN
    NULL;
END $$;

SELECT cron.schedule(
  'notification-digest-daily',
  '15 7 * * *',
  $$SELECT public.invoke_notification_digest_cron()$$
);
