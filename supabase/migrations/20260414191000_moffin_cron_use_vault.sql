-- Fix: leer el service_role_key desde Supabase Vault (siempre disponible,
-- no requiere ALTER DATABASE ni ALTER ROLE).
--
-- Paso unico manual (SQL Editor):
--   SELECT vault.create_secret('<tu service_role_key>', 'service_role_key');

CREATE OR REPLACE FUNCTION public.invoke_moffin_refresh_pending_cron()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_key text;
BEGIN
  SELECT decrypted_secret INTO v_key
    FROM vault.decrypted_secrets
   WHERE name = 'service_role_key'
   LIMIT 1;

  IF v_key IS NULL OR btrim(v_key) = '' THEN
    RAISE NOTICE 'moffin-refresh-pending cron: service_role_key not found in vault';
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
