-- Alias local por usuario para conversaciones de Slack (canales, DMs y grupos).
-- No cambia nada en Slack: es un nombre que solo ve el propio usuario en Kawiil,
-- útil para DMs/grupos que Slack no permite renombrar.
CREATE TABLE IF NOT EXISTS public.slack_conversation_aliases (
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  channel_id text NOT NULL,
  alias text NOT NULL,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_slack_conversation_aliases_user
  ON public.slack_conversation_aliases (user_id);

ALTER TABLE public.slack_conversation_aliases ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own slack conversation aliases" ON public.slack_conversation_aliases;
CREATE POLICY "Users manage own slack conversation aliases"
  ON public.slack_conversation_aliases FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND organization_id = (SELECT p.organization_id FROM public.profiles p WHERE p.user_id = auth.uid() LIMIT 1)
  );

DROP TRIGGER IF EXISTS update_slack_conversation_aliases_updated_at ON public.slack_conversation_aliases;
CREATE TRIGGER update_slack_conversation_aliases_updated_at
  BEFORE UPDATE ON public.slack_conversation_aliases
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
