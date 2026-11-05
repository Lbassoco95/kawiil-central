-- Asistentes con acompañante (+1) y pendientes ligados a un asistente.
ALTER TABLE public.activity_attendees
  ADD COLUMN IF NOT EXISTS has_plus_one boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS plus_one_name text,
  ADD COLUMN IF NOT EXISTS plus_one_confirmed text NOT NULL DEFAULT 'pendiente',
  ADD COLUMN IF NOT EXISTS plus_one_dietary text;

ALTER TABLE public.activity_attendees
  DROP CONSTRAINT IF EXISTS activity_attendees_plus_one_confirmed_check;
ALTER TABLE public.activity_attendees
  ADD CONSTRAINT activity_attendees_plus_one_confirmed_check
  CHECK (plus_one_confirmed IN ('si', 'no', 'pendiente'));

ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS activity_attendee_id uuid
    REFERENCES public.activity_attendees(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_tasks_activity_attendee
  ON public.tasks (activity_attendee_id) WHERE activity_attendee_id IS NOT NULL;
