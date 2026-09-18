-- mtg_unmatched_transcripts + bandera MTG (B3)
CREATE TABLE IF NOT EXISTS public.mtg_unmatched_transcripts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  resource text NOT NULL,
  organizer_id text,
  received_at timestamptz NOT NULL DEFAULT now(),
  resolved_meeting_id uuid REFERENCES public.mtg_meetings(id) ON DELETE SET NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb
);

ALTER TABLE public.mtg_unmatched_transcripts ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "mtg_unmatched_service" ON public.mtg_unmatched_transcripts;
CREATE POLICY "mtg_unmatched_service"
  ON public.mtg_unmatched_transcripts FOR ALL TO service_role
  USING (true) WITH CHECK (true);

GRANT ALL ON public.mtg_unmatched_transcripts TO service_role;
