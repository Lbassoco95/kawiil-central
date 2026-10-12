-- Varias grabaciones por junta (misma reunión, varias tomas) con registro propio.
-- mtg_meetings.recording_path sigue apuntando a la más reciente (compatibilidad).

CREATE TABLE IF NOT EXISTS public.mtg_meeting_recordings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  meeting_id uuid NOT NULL REFERENCES public.mtg_meetings(id) ON DELETE CASCADE,
  path text NOT NULL,
  file_name text,
  bytes bigint,
  origin text,
  saved_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid,
  -- Transcripción por toma (cache para no pagar Whisper dos veces).
  transcript_segments jsonb,
  duration_sec numeric,
  language text,
  transcribed_at timestamptz,
  UNIQUE (meeting_id, path)
);

CREATE INDEX IF NOT EXISTS mtg_meeting_recordings_meeting_idx
  ON public.mtg_meeting_recordings (meeting_id, saved_at);

ALTER TABLE public.mtg_meeting_recordings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS mtg_meeting_recordings_select ON public.mtg_meeting_recordings;
CREATE POLICY mtg_meeting_recordings_select ON public.mtg_meeting_recordings
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS mtg_meeting_recordings_insert ON public.mtg_meeting_recordings;
CREATE POLICY mtg_meeting_recordings_insert ON public.mtg_meeting_recordings
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));

-- Respaldo: grabaciones ya existentes pasan al registro.
INSERT INTO public.mtg_meeting_recordings (organization_id, meeting_id, path, bytes, saved_at, origin)
SELECT organization_id, id, recording_path, recording_bytes, COALESCE(recording_saved_at, updated_at), 'legacy'
FROM public.mtg_meetings
WHERE recording_path IS NOT NULL
ON CONFLICT (meeting_id, path) DO NOTHING;

-- Equipo por junta (también para juntas sin serie, p. ej. reuniones que surgen en el momento).
ALTER TABLE public.mtg_meetings
  ADD COLUMN IF NOT EXISTS attendees_internal uuid[] NOT NULL DEFAULT '{}';
