-- Notificaciones estilo Slack: todos los canales donde participas (por defecto) + silenciar por conversación.

ALTER TABLE public.slack_communication_prefs
  ADD COLUMN IF NOT EXISTS notifications_muted boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.slack_communication_prefs.notifications_muted IS
  'Si true, no notificar en Kawiil por mensajes en este canal (siguen las @menciones).';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notify_slack_all_channels boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.profiles.notify_slack_all_channels IS
  'Si true, notificar cada mensaje en canales/grupos donde el usuario participa (salvo conversaciones silenciadas).';
