-- Idempotente: columnas de entrega de notificaciones en profiles (Notificaciones.tsx, slack-events).
-- Ejecutar en SQL Editor si ves "column profiles.slack_message_sound_enabled does not exist"
-- u otra columna de esta lista tras un deploy sin migraciones completas.
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS desktop_browser_notifications boolean NOT NULL DEFAULT true;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS desktop_push_notifications boolean NOT NULL DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS in_app_toast_notifications boolean NOT NULL DEFAULT true;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS notification_sound_enabled boolean NOT NULL DEFAULT false;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS slack_message_sound_enabled boolean NOT NULL DEFAULT true;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS notify_slack_mentions boolean NOT NULL DEFAULT true;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS notify_slack_channel_watch boolean NOT NULL DEFAULT true;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS notify_slack_vip boolean NOT NULL DEFAULT true;
ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS notify_slack_dm boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.profiles.slack_message_sound_enabled IS
  'Si true, pitido al llegar notificación slack_message/slack_mention cuando hay toast o aviso de sistema.';
