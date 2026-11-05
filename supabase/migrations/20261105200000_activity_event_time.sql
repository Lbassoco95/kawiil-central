-- Hora del evento de una actividad (opcional). La fecha sigue en event_date.
ALTER TABLE public.activities
  ADD COLUMN IF NOT EXISTS event_time time;
