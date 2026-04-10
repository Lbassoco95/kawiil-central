-- Preferencia: aviso horario de recordatorios pendientes (digest vía Edge + notifications).
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS reminders_hourly_digest boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.profiles.reminders_hourly_digest IS
  'Si true, el job horario puede crear una notificación cuando el usuario tiene recordatorios no completados.';
