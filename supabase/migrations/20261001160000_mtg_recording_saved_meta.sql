-- Metadatos de grabación guardada: tamaño y timestamp para auditar Storage.
ALTER TABLE public.mtg_meetings
  ADD COLUMN IF NOT EXISTS recording_bytes bigint,
  ADD COLUMN IF NOT EXISTS recording_saved_at timestamptz;

COMMENT ON COLUMN public.mtg_meetings.recording_bytes IS
  'Tamaño en bytes del archivo en Storage (mtg/.../recordings/...).';
COMMENT ON COLUMN public.mtg_meetings.recording_saved_at IS
  'Momento en que recording_path quedó confirmado en Storage.';
