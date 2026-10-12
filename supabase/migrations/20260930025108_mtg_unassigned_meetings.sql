-- Juntas sin cliente (prospecto / interna) + título en la instancia.
ALTER TABLE public.mtg_meetings
  ADD COLUMN IF NOT EXISTS title text;

COMMENT ON COLUMN public.mtg_meetings.title IS
  'Título de la junta (ad hoc o desde calendario). Si hay serie, el front puede preferir series.title.';

ALTER TABLE public.mtg_agreements
  ALTER COLUMN client_id DROP NOT NULL;

COMMENT ON COLUMN public.mtg_agreements.client_id IS
  'Cliente del acuerdo. NULL mientras la junta no esté asignada; se rellena al migrar/asignar.';
