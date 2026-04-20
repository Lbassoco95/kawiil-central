-- Slack "Save for later" / mensajes guardados estilo Slack nativo.
-- Persistencia de mensajes guardados por usuario con estados En curso / Archivado / Completado.
CREATE TABLE IF NOT EXISTS public.slack_saved_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  channel_id text NOT NULL,
  message_ts text NOT NULL,
  thread_ts text,
  status text NOT NULL DEFAULT 'in_progress'
    CHECK (status IN ('in_progress', 'archived', 'completed')),
  snippet text,
  author_slack_user_id text,
  author_name text,
  channel_name text,
  saved_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, channel_id, message_ts)
);

CREATE INDEX IF NOT EXISTS idx_slack_saved_user_status_saved_at
  ON public.slack_saved_messages (user_id, status, saved_at DESC);
CREATE INDEX IF NOT EXISTS idx_slack_saved_user_channel
  ON public.slack_saved_messages (user_id, channel_id);

ALTER TABLE public.slack_saved_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own slack saved messages" ON public.slack_saved_messages;
CREATE POLICY "Users manage own slack saved messages"
  ON public.slack_saved_messages FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND organization_id = (
      SELECT p.organization_id FROM public.profiles p
      WHERE p.user_id = auth.uid() LIMIT 1
    )
  );

DROP TRIGGER IF EXISTS update_slack_saved_messages_updated_at ON public.slack_saved_messages;
CREATE TRIGGER update_slack_saved_messages_updated_at
  BEFORE UPDATE ON public.slack_saved_messages
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
