-- Avisos por MD y grupos privados en Slack (además de @mención, seguimiento y VIP)
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notify_slack_dm boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.profiles.notify_slack_dm IS
  'Si false, no se crean notificaciones por mensajes en MD/grupo privado donde participas (slack-events).';
