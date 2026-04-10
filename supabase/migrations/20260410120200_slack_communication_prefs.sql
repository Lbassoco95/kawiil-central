-- Preferencias por conversación Slack (VIP, destacados, orden) + silenciar solo VIP
CREATE TABLE IF NOT EXISTS public.slack_communication_prefs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  channel_id text NOT NULL,
  is_vip boolean NOT NULL DEFAULT false,
  is_starred boolean NOT NULL DEFAULT false,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, channel_id)
);

CREATE INDEX IF NOT EXISTS idx_slack_comm_prefs_user ON public.slack_communication_prefs (user_id);
CREATE INDEX IF NOT EXISTS idx_slack_comm_prefs_channel_vip ON public.slack_communication_prefs (channel_id) WHERE is_vip = true;

ALTER TABLE public.slack_communication_prefs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users manage own slack communication prefs" ON public.slack_communication_prefs;
CREATE POLICY "Users manage own slack communication prefs"
  ON public.slack_communication_prefs FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND organization_id = (SELECT p.organization_id FROM public.profiles p WHERE p.user_id = auth.uid() LIMIT 1)
  );

DROP TRIGGER IF EXISTS update_slack_communication_prefs_updated_at ON public.slack_communication_prefs;
CREATE TRIGGER update_slack_communication_prefs_updated_at
  BEFORE UPDATE ON public.slack_communication_prefs
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notify_slack_vip boolean NOT NULL DEFAULT true;
