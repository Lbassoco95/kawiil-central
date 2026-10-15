-- Archivar juntas terminadas: se ocultan de la vista general sin perder historial.
ALTER TABLE public.mtg_meetings
  ADD COLUMN IF NOT EXISTS archived_at timestamptz;

COMMENT ON COLUMN public.mtg_meetings.archived_at IS
  'Cuándo se archivó la junta (NULL = visible). No cambia status ni borra contenido.';
