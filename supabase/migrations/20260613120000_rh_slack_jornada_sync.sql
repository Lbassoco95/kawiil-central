-- =============================================================
-- RH — Sincronización automática del estado de Slack con la jornada y el
-- calendario (🗓️ en reunión). Cron cada 10 min llama a la edge function
-- slack-jornada-sync, que fija el estado de cada persona en jornada activa.
-- =============================================================

-- Señal de "en trayecto" (🚗) para que el cron respete el botón manual.
ALTER TABLE public.rh_attendance
  ADD COLUMN IF NOT EXISTS in_transit boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.invoke_slack_jornada_sync_cron()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret text;
BEGIN
  BEGIN
    v_secret := current_setting('app.pipeline_cron_secret', true);
  EXCEPTION WHEN OTHERS THEN
    v_secret := NULL;
  END;
  IF v_secret IS NULL OR btrim(v_secret) = '' THEN
    RAISE NOTICE 'slack-jornada-sync: app.pipeline_cron_secret no configurado';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://qppfampapbxdgednkofc.supabase.co/functions/v1/slack-jornada-sync',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-cron-secret', v_secret),
    body := '{}'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_slack_jornada_sync_cron() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoke_slack_jornada_sync_cron() TO postgres;

-- Reprograma de forma idempotente.
DO $$
DECLARE j record;
BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'slack-jornada-sync' LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
EXCEPTION WHEN undefined_table THEN
  NULL;
END $$;

DO $$
BEGIN
  PERFORM cron.schedule('slack-jornada-sync', '*/10 * * * *',
    $cron$SELECT public.invoke_slack_jornada_sync_cron()$cron$);
EXCEPTION
  WHEN undefined_function THEN RAISE NOTICE 'pg_cron no disponible; omito slack-jornada-sync';
  WHEN undefined_table THEN RAISE NOTICE 'pg_cron no disponible; omito slack-jornada-sync';
END $$;
