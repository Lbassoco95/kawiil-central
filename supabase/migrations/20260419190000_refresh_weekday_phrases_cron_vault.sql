-- Refactor del cron de "frase del día" para leer el secreto desde Supabase Vault
-- en lugar de un GUC `app.pipeline_cron_secret` (no se puede setear en hosted).
--
-- Requisito: insertar el secreto en `vault.secrets` con name = 'pipeline_cron_secret'
-- (mismo valor que el secret `CRON_SECRET` configurado en Edge Functions).

CREATE OR REPLACE FUNCTION public.invoke_refresh_weekday_phrases_cron()
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
    SELECT decrypted_secret
      INTO v_secret
      FROM vault.decrypted_secrets
     WHERE name = 'pipeline_cron_secret'
     LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_secret := NULL;
  END;

  IF v_secret IS NULL OR btrim(v_secret) = '' THEN
    BEGIN
      v_secret := current_setting('app.pipeline_cron_secret', true);
    EXCEPTION WHEN OTHERS THEN
      v_secret := NULL;
    END;
  END IF;

  IF v_secret IS NULL OR btrim(v_secret) = '' THEN
    RAISE NOTICE 'refresh-weekday-phrases cron: pipeline_cron_secret no configurado (vault o GUC)';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://qppfampapbxdgednkofc.supabase.co/functions/v1/refresh-weekday-phrases',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_refresh_weekday_phrases_cron() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoke_refresh_weekday_phrases_cron() TO postgres;
