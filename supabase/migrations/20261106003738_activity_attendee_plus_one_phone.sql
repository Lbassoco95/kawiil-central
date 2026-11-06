-- Teléfono (WhatsApp) del acompañante (+1) del asistente, para enviarle el mensaje directo.
ALTER TABLE public.activity_attendees
  ADD COLUMN IF NOT EXISTS plus_one_phone text;
