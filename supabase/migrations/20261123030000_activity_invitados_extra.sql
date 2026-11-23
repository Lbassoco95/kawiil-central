-- El +1 va incluido en la invitación (se activa en automático y el invitado lo puede apagar).
-- Lo que pasa por aprobación son los invitados EXTRA (más allá del +1).
ALTER TABLE public.activity_attendees
  ADD COLUMN IF NOT EXISTS extra_guests_requested integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS extra_guests_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS extra_guests_note text;

ALTER TABLE public.activity_attendees
  DROP CONSTRAINT IF EXISTS activity_attendees_extra_guests_requested_check;
ALTER TABLE public.activity_attendees
  ADD CONSTRAINT activity_attendees_extra_guests_requested_check
  CHECK (extra_guests_requested BETWEEN 0 AND 10);

ALTER TABLE public.activity_attendees
  DROP CONSTRAINT IF EXISTS activity_attendees_extra_guests_status_check;
ALTER TABLE public.activity_attendees
  ADD CONSTRAINT activity_attendees_extra_guests_status_check
  CHECK (extra_guests_status IN ('none', 'solicitado', 'aprobado', 'rechazado'));

-- Solicitudes de +1 que hubiera (el +1 ya no requiere aprobación): quedan aprobadas.
UPDATE public.activity_attendees
   SET has_plus_one = true, plus_one_status = 'aprobado'
 WHERE plus_one_status = 'solicitado';
