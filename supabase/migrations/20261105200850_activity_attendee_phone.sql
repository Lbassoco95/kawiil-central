-- Teléfono (WhatsApp) del asistente, para enviarle el mensaje de la actividad directo.
ALTER TABLE public.activity_attendees
  ADD COLUMN IF NOT EXISTS phone text;
