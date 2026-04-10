-- Slack user OAuth tokens (writes only via service role / Edge Functions)
CREATE TABLE public.user_slack_connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  slack_team_id text NOT NULL,
  slack_user_id text NOT NULL,
  access_token text NOT NULL,
  refresh_token text,
  token_expires_at timestamptz,
  scopes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, slack_team_id)
);

CREATE INDEX idx_user_slack_connections_team ON public.user_slack_connections (slack_team_id);
CREATE INDEX idx_user_slack_connections_slack_user ON public.user_slack_connections (slack_user_id);

ALTER TABLE public.user_slack_connections ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users select own slack connection"
  ON public.user_slack_connections FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE TRIGGER update_user_slack_connections_updated_at
  BEFORE UPDATE ON public.user_slack_connections
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Canales que el usuario sigue para recibir avisos de mensajes sin @mención
CREATE TABLE public.slack_channel_watches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  channel_id text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, channel_id)
);

CREATE INDEX idx_slack_channel_watches_channel ON public.slack_channel_watches (channel_id);

ALTER TABLE public.slack_channel_watches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own slack channel watches"
  ON public.slack_channel_watches FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (
    user_id = auth.uid()
    AND organization_id = (SELECT p.organization_id FROM public.profiles p WHERE p.user_id = auth.uid() LIMIT 1)
  );

-- Web Push (VAPID) subscriptions
CREATE TABLE public.push_subscriptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  endpoint text NOT NULL,
  p256dh text NOT NULL,
  auth text NOT NULL,
  user_agent text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(endpoint)
);

CREATE INDEX idx_push_subscriptions_user ON public.push_subscriptions (user_id);

ALTER TABLE public.push_subscriptions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users manage own push subscriptions"
  ON public.push_subscriptions FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Preferencias de notificación (alineadas con proactive_ai_notifications)
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS desktop_browser_notifications boolean NOT NULL DEFAULT true;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS desktop_push_notifications boolean NOT NULL DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS notify_slack_mentions boolean NOT NULL DEFAULT true;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS notify_slack_channel_watch boolean NOT NULL DEFAULT true;
