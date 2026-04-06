-- Pipeline correos: hilos, inbound, sync state, tracking events, cron sync inbox

-- ---------------------------------------------------------------------------
-- email_log: nuevas columnas y status "received"
-- ---------------------------------------------------------------------------

ALTER TABLE public.email_log DROP CONSTRAINT IF EXISTS email_log_status_check;

-- Normalizar filas legacy antes del CHECK (evita fallo si hay status fuera de la lista)
UPDATE public.email_log
SET status = 'failed'
WHERE status IS NULL
   OR btrim(status) = ''
   OR status NOT IN (
     'queued', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'failed', 'cancelled', 'received'
   );

ALTER TABLE public.email_log ADD CONSTRAINT email_log_status_check
  CHECK (status IN (
    'queued', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'failed', 'cancelled', 'received'
  ));

ALTER TABLE public.email_log
  ADD COLUMN IF NOT EXISTS body_html text,
  ADD COLUMN IF NOT EXISTS body_text text,
  ADD COLUMN IF NOT EXISTS direction text NOT NULL DEFAULT 'outbound'
    CHECK (direction IN ('outbound', 'inbound')),
  ADD COLUMN IF NOT EXISTS from_email text,
  ADD COLUMN IF NOT EXISTS from_name text,
  ADD COLUMN IF NOT EXISTS thread_id text,
  ADD COLUMN IF NOT EXISTS conversation_id text,
  ADD COLUMN IF NOT EXISTS in_reply_to text,
  ADD COLUMN IF NOT EXISTS is_read boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS has_attachments boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS attachments jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS received_at timestamptz,
  ADD COLUMN IF NOT EXISTS headers jsonb NOT NULL DEFAULT '{}'::jsonb;

CREATE INDEX IF NOT EXISTS idx_email_log_lead_direction ON public.email_log(lead_id, direction);
CREATE INDEX IF NOT EXISTS idx_email_log_thread ON public.email_log(thread_id) WHERE thread_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_log_conversation ON public.email_log(conversation_id) WHERE conversation_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_log_graph_id ON public.email_log(graph_message_id) WHERE graph_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_email_log_received ON public.email_log(received_at DESC NULLS LAST);
CREATE INDEX IF NOT EXISTS idx_email_log_from ON public.email_log(from_email) WHERE from_email IS NOT NULL;

-- ---------------------------------------------------------------------------
-- email_sync_state
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.email_sync_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  mailbox_email text NOT NULL DEFAULT 'contacto@kawiil.mx',
  last_sync_at timestamptz,
  delta_link text,
  next_sync_at timestamptz,
  sync_status text NOT NULL DEFAULT 'idle'
    CHECK (sync_status IN ('idle', 'syncing', 'error')),
  error_message text,
  total_synced integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, mailbox_email)
);

CREATE INDEX IF NOT EXISTS idx_email_sync_org ON public.email_sync_state(organization_id);

CREATE TRIGGER update_email_sync_state_updated_at
  BEFORE UPDATE ON public.email_sync_state
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.email_sync_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_sync_state_select"
  ON public.email_sync_state FOR SELECT TO authenticated
  USING (organization_id = public.user_pipeline_org_id());

-- ---------------------------------------------------------------------------
-- email_tracking_events
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.email_tracking_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_log_id uuid NOT NULL REFERENCES public.email_log(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  event_type text NOT NULL
    CHECK (event_type IN ('open', 'click', 'reply', 'bounce', 'unsubscribe')),
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tracking_email ON public.email_tracking_events(email_log_id);
CREATE INDEX IF NOT EXISTS idx_tracking_lead ON public.email_tracking_events(lead_id);
CREATE INDEX IF NOT EXISTS idx_tracking_type ON public.email_tracking_events(event_type);

ALTER TABLE public.email_tracking_events ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_tracking_events_select"
  ON public.email_tracking_events FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.leads l
      WHERE l.id = email_tracking_events.lead_id
        AND l.organization_id = public.user_pipeline_org_id()
    )
  );

-- Seed sync state por organización (buzón por defecto; ajustar en UI/admin si aplica)
INSERT INTO public.email_sync_state (organization_id, mailbox_email)
SELECT o.id, 'contacto@kawiil.mx'
FROM public.organizations o
ON CONFLICT (organization_id, mailbox_email) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Cron: sync-inbox-emails (mismo secreto que process-email-queue)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.invoke_sync_inbox_emails_cron()
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
    RAISE NOTICE 'sync-inbox-emails cron: app.pipeline_cron_secret no configurado';
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

REVOKE ALL ON FUNCTION public.invoke_sync_inbox_emails_cron() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.invoke_sync_inbox_emails_cron() TO postgres;

DO $$
DECLARE
  j record;
BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'pipeline-sync-inbox-emails'
  LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
EXCEPTION
  WHEN undefined_table THEN
    NULL;
END $$;

SELECT cron.schedule(
  'pipeline-sync-inbox-emails',
  '*/5 * * * *',
  $$SELECT public.invoke_sync_inbox_emails_cron()$$
);
