-- Fix: usar service_role_key (siempre disponible en Supabase) en vez de
-- app.pipeline_cron_secret (requiere ALTER DATABASE que no se puede ejecutar).
-- La Edge Function valida que el Bearer sea el service_role_key.

CREATE OR REPLACE FUNCTION public.invoke_moffin_refresh_pending_cron()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
BEGIN
  v_key := NULL;
  BEGIN
    v_key := current_setting('app.settings.service_role_key', true);
  EXCEPTION WHEN OTHERS THEN
    v_key := NULL;
  END;

  IF v_key IS NULL OR btrim(v_key) = '' THEN
    RAISE NOTICE 'moffin-refresh-pending cron: app.settings.service_role_key not available';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://qppfampapbxdgednkofc.supabase.co/functions/v1/moffin-query',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer ' || v_key
    ),
    body := '{"refreshAllPending": true}'::jsonb
  );
END;
$$;
