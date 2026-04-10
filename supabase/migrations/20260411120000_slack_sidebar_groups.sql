-- Grupos personalizados en el sidebar de Comunicación (por usuario)
CREATE TABLE public.slack_sidebar_groups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  title text NOT NULL DEFAULT 'Mi grupo',
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_slack_sidebar_groups_user ON public.slack_sidebar_groups (user_id);

ALTER TABLE public.slack_sidebar_groups ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own slack sidebar groups"
  ON public.slack_sidebar_groups FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND organization_id = (SELECT p.organization_id FROM public.profiles p WHERE p.user_id = auth.uid() LIMIT 1)
  );

CREATE TRIGGER update_slack_sidebar_groups_updated_at
  BEFORE UPDATE ON public.slack_sidebar_groups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.slack_sidebar_group_channels (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id uuid NOT NULL REFERENCES public.slack_sidebar_groups(id) ON DELETE CASCADE,
  channel_id text NOT NULL,
  sort_order int NOT NULL DEFAULT 0,
  UNIQUE (group_id, channel_id)
);

CREATE INDEX idx_slack_sidebar_group_channels_group ON public.slack_sidebar_group_channels (group_id);

ALTER TABLE public.slack_sidebar_group_channels ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage channels in own slack sidebar groups"
  ON public.slack_sidebar_group_channels FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.slack_sidebar_groups g
      WHERE g.id = group_id AND g.user_id = auth.uid()
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.slack_sidebar_groups g
      WHERE g.id = group_id AND g.user_id = auth.uid()
    )
  );
