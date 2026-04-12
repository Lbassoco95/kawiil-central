-- Cadencia de avisos por recordatorio + registro más claro
ALTER TABLE public.reminders
  ADD COLUMN IF NOT EXISTS repeat_kind text NOT NULL DEFAULT 'hourly_digest';

ALTER TABLE public.reminders
  DROP CONSTRAINT IF EXISTS reminders_repeat_kind_check;

ALTER TABLE public.reminders
  ADD CONSTRAINT reminders_repeat_kind_check
  CHECK (repeat_kind IN ('none', 'hourly_digest', 'daily_digest'));

COMMENT ON COLUMN public.reminders.repeat_kind IS
  'none: solo lista; hourly_digest: incluido en digest horario (si perfil); daily_digest: digest diario (job notification-digest).';

COMMENT ON COLUMN public.reminders.description IS
  'Detalle opcional del recordatorio (contexto, enlaces en texto, etc.).';
