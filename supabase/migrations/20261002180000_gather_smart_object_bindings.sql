-- Gather Smart Object bindings (por persona). Secrets cifrados; acceso solo vía Edge (service role).
-- Propósitos MVP: inbox_tasks_slack_mail | lightbulb_reminders

CREATE TABLE IF NOT EXISTS public.gather_smart_object_bindings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('inbox_tasks_slack_mail', 'lightbulb_reminders')),
  label text,
  webhook_url_ciphertext text NOT NULL,
  webhook_secret_ciphertext text NOT NULL,
  webhook_host text,
  enabled boolean NOT NULL DEFAULT true,
  last_ping_at timestamptz,
  last_sync_at timestamptz,
  last_error text,
  last_snapshot jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_gather_bindings_user
  ON public.gather_smart_object_bindings (user_id);

CREATE INDEX IF NOT EXISTS idx_gather_bindings_org_enabled
  ON public.gather_smart_object_bindings (organization_id)
  WHERE enabled = true;

CREATE INDEX IF NOT EXISTS idx_gather_bindings_sync
  ON public.gather_smart_object_bindings (enabled, last_sync_at);

COMMENT ON TABLE public.gather_smart_object_bindings IS
  'Bindings Kawiil→Gather Smart Objects por usuario. URL/secret cifrados (AES-GCM) vía Edge gather-sync. Sin acceso directo del cliente.';

COMMENT ON COLUMN public.gather_smart_object_bindings.purpose IS
  'inbox_tasks_slack_mail: Inbox tasks+Slack+mail counts; lightbulb_reminders: urgencias on/off.';

ALTER TABLE public.gather_smart_object_bindings ENABLE ROW LEVEL SECURITY;

-- Defense in depth: sin policies para authenticated/anon → solo service_role (bypass RLS).
REVOKE ALL ON public.gather_smart_object_bindings FROM PUBLIC;
REVOKE ALL ON public.gather_smart_object_bindings FROM anon, authenticated;
GRANT ALL ON public.gather_smart_object_bindings TO service_role;
GRANT ALL ON public.gather_smart_object_bindings TO postgres;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    WHERE n.nspname = 'public' AND p.proname = 'update_updated_at_column'
  ) THEN
    DROP TRIGGER IF EXISTS update_gather_smart_object_bindings_updated_at
      ON public.gather_smart_object_bindings;
    CREATE TRIGGER update_gather_smart_object_bindings_updated_at
      BEFORE UPDATE ON public.gather_smart_object_bindings
      FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
  END IF;
END $$;

-- Cron periódico (cada 30 min) además del hook post notification-digest.
CREATE OR REPLACE FUNCTION public.invoke_gather_sync_cron()
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
    SELECT decrypted_secret INTO v_secret
    FROM vault.decrypted_secrets
    WHERE name = 'cron_secret'
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
    RAISE NOTICE 'gather-sync cron: cron_secret no configurado (vault o GUC)';
    RETURN;
  END IF;

  PERFORM net.http_post(
    url := 'https://qppfampapbxdgednkofc.supabase.co/functions/v1/gather-sync',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-cron-secret', v_secret
    ),
    body := jsonb_build_object('action', 'sync_all')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.invoke_gather_sync_cron() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoke_gather_sync_cron() TO postgres;

DO $$
DECLARE
  j record;
BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'gather-sync-half-hourly'
  LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
EXCEPTION
  WHEN undefined_table THEN
    NULL;
END $$;

SELECT cron.schedule(
  'gather-sync-half-hourly',
  '*/30 * * * *',
  $$SELECT public.invoke_gather_sync_cron()$$
);
