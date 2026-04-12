-- Realtime: entrega en vivo de INSERT/UPDATE en notifications (useNotificationDelivery, badges Slack).
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'notifications'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.notifications;
  END IF;
END $$;

-- Preferencias de entrega en la app (Sonner) y pitido opcional.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS in_app_toast_notifications boolean NOT NULL DEFAULT true;

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS notification_sound_enabled boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.in_app_toast_notifications IS
  'Si false, no se muestran toasts Sonner ante nuevas filas en notifications.';

COMMENT ON COLUMN public.profiles.notification_sound_enabled IS
  'Si true, se intenta un pitido breve al mostrar un aviso (puede bloquearse por autoplay del navegador).';
