-- Fix: usar cron_secret desde Vault + x-cron-secret header.
-- verify_jwt = false en moffin-query, asi pg_cron no necesita JWT.
-- La Edge Function valida x-cron-secret internamente.
--
-- Paso unico manual (SQL Editor):
--   DELETE FROM vault.secrets WHERE name = 'service_role_key';  -- limpieza
--   SELECT vault.create_secret('<valor de CRON_SECRET>', 'cron_secret');

CREATE OR REPLACE FUNCTION public.invoke_moffin_refresh_pending_cron()
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
    RAISE NOTICE 'moffin-refresh-pending cron: cron_secret not found in vault';
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
