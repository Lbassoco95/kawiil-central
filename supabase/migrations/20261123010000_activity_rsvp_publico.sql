-- Confirmación pública de asistencia (RSVP) con enlace personal por asistente.
--   rsvp_token            → enlace único e impredecible: /invitacion/<token>
--   plus_one_status       → solicitud de +1: none | solicitado | aprobado | rechazado
--   rsvp_responded_at     → cuándo respondió el invitado desde el enlace
--   activities.invite_image_url → imagen que se usa como invitación
-- La página pública no toca las tablas directo: pasa por la función `activity-rsvp` (service role).

ALTER TABLE public.activity_attendees
  ADD COLUMN IF NOT EXISTS rsvp_token uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS plus_one_status text NOT NULL DEFAULT 'none',
  ADD COLUMN IF NOT EXISTS rsvp_responded_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS idx_activity_attendees_rsvp_token
  ON public.activity_attendees (rsvp_token);

ALTER TABLE public.activity_attendees
  DROP CONSTRAINT IF EXISTS activity_attendees_plus_one_status_check;
ALTER TABLE public.activity_attendees
  ADD CONSTRAINT activity_attendees_plus_one_status_check
  CHECK (plus_one_status IN ('none', 'solicitado', 'aprobado', 'rechazado'));

-- Quienes ya tenían acompañante quedan como aprobados.
UPDATE public.activity_attendees
   SET plus_one_status = 'aprobado'
 WHERE has_plus_one = true AND plus_one_status = 'none';

ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS invite_image_url text;

UPDATE public.activities
   SET invite_image_url = '/images/invitacion-navidad-kawiil-2026.jpg'
 WHERE name = 'Fin de Año 2026' AND invite_image_url IS NULL;
