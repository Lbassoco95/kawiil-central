-- Bot de Recall.ai por junta: estado del bot y asistentes reales de la llamada.
ALTER TABLE public.mtg_meetings
  ADD COLUMN IF NOT EXISTS recall_bot_id text,
  ADD COLUMN IF NOT EXISTS recall_bot_status text,
  ADD COLUMN IF NOT EXISTS recall_participants jsonb;

CREATE INDEX IF NOT EXISTS idx_mtg_meetings_recall_bot
  ON public.mtg_meetings (recall_bot_id)
  WHERE recall_bot_id IS NOT NULL;

COMMENT ON COLUMN public.mtg_meetings.recall_participants IS
  'Asistentes reportados por Recall: [{id,name,is_host,email}].';
