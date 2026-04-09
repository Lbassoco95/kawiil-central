-- Invoca process-scheduled-mail cada 2 minutos (CRON_SECRET en Edge + app.pipeline_cron_secret en DB).

CREATE OR REPLACE FUNCTION public.invoke_process_scheduled_mail_cron()
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
    RAISE NOTICE 'process-scheduled-mail cron: app.pipeline_cron_secret no configurado';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://qppfampapbxdgednkofc.supabase.co/functions/v1/process-scheduled-mail',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_process_scheduled_mail_cron() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoke_process_scheduled_mail_cron() TO postgres;

DO $$
DECLARE
  j record;
BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'process-scheduled-mail-every-2m'
  LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
EXCEPTION
  WHEN undefined_table THEN
    NULL;
END $$;

SELECT cron.schedule(
  'process-scheduled-mail-every-2m',
  '*/2 * * * *',
  $$SELECT public.invoke_process_scheduled_mail_cron()$$
);
