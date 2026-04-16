-- Sonido específico para avisos de mensajería Slack (independiente del pitido global).
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS slack_message_sound_enabled boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.profiles.slack_message_sound_enabled IS
  'Si true, pitido al llegar notificación slack_message/slack_mention cuando hay toast o aviso de sistema.';
