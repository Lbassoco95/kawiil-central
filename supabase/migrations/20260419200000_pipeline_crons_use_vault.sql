-- Unifica todos los cron jobs de pipelines para leer el secreto desde Supabase
-- Vault (`vault.decrypted_secrets WHERE name = 'pipeline_cron_secret'`).
--
-- Motivo: en hosted Supabase no se puede ejecutar
--   ALTER DATABASE postgres SET app.pipeline_cron_secret = '...'
-- (permission denied incluso para `postgres`), así que el patrón antiguo
-- basado en `current_setting('app.pipeline_cron_secret', true)` retorna NULL
-- y las funciones salen sin disparar el http_post.
--
-- Las funciones quedan resilientes: leen primero de Vault y, si no existe,
-- caen al GUC viejo (compat con entornos donde sí esté seteado).
--
-- Requisito: existir el secreto en Vault con name='pipeline_cron_secret' y
-- el mismo valor configurado como secret `CRON_SECRET` en Edge Functions.

-- ai-proactive-notifications -----------------------------------------------
CREATE OR REPLACE FUNCTION public.invoke_ai_proactive_notifications_cron()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret text;
BEGIN
  BEGIN
    SELECT decrypted_secret INTO v_secret
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
    RAISE NOTICE 'ai-proactive-notifications cron: pipeline_cron_secret no configurado (vault o GUC)';
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

-- notification-digest ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invoke_notification_digest_cron()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret text;
BEGIN
  BEGIN
    SELECT decrypted_secret INTO v_secret
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
    RAISE NOTICE 'notification-digest cron: pipeline_cron_secret no configurado (vault o GUC)';
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

-- process-email-queue ------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invoke_process_email_queue_cron()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret text;
BEGIN
  BEGIN
    SELECT decrypted_secret INTO v_secret
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
    RAISE NOTICE 'process-email-queue cron: pipeline_cron_secret no configurado (vault o GUC)';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://qppfampapbxdgednkofc.supabase.co/functions/v1/process-email-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb
  );
END;
$$;

-- process-scheduled-mail ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.invoke_process_scheduled_mail_cron()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret text;
BEGIN
  BEGIN
    SELECT decrypted_secret INTO v_secret
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
    RAISE NOTICE 'process-scheduled-mail cron: pipeline_cron_secret no configurado (vault o GUC)';
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

-- reminder-hourly-digest ---------------------------------------------------
CREATE OR REPLACE FUNCTION public.invoke_reminder_hourly_digest_cron()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret text;
BEGIN
  BEGIN
    SELECT decrypted_secret INTO v_secret
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
    RAISE NOTICE 'reminder-hourly-digest cron: pipeline_cron_secret no configurado (vault o GUC)';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://qppfampapbxdgednkofc.supabase.co/functions/v1/reminder-hourly-digest',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb
  );
END;
$$;

-- sync-inbox-emails --------------------------------------------------------
CREATE OR REPLACE FUNCTION public.invoke_sync_inbox_emails_cron()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_secret text;
BEGIN
  BEGIN
    SELECT decrypted_secret INTO v_secret
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
    RAISE NOTICE 'sync-inbox-emails cron: pipeline_cron_secret no configurado (vault o GUC)';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://qppfampapbxdgednkofc.supabase.co/functions/v1/sync-inbox-emails',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := '{}'::jsonb
  );
END;
$$;
