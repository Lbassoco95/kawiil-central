-- Cron diario: sugerencias proactivas IA (~8:00 Ciudad de México ≈ 14:00 UTC invierno)
CREATE OR REPLACE FUNCTION public.invoke_ai_proactive_notifications_cron()
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
    RAISE NOTICE 'ai-proactive-notifications cron: app.pipeline_cron_secret no configurado';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://qppfampapbxdgednkofc.supabase.co/functions/v1/ai-proactive-notifications',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_ai_proactive_notifications_cron() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoke_ai_proactive_notifications_cron() TO postgres;

DO $$
DECLARE
  j record;
BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'ai-proactive-notifications-daily'
  LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
EXCEPTION
  WHEN undefined_table THEN
    NULL;
END $$;

SELECT cron.schedule(
  'ai-proactive-notifications-daily',
  '0 14 * * *',
  $$SELECT public.invoke_ai_proactive_notifications_cron()$$
);
