-- documents.client_group_id para minutas de grupo (B4)
ALTER TABLE public.documents
  ADD COLUMN IF NOT EXISTS client_group_id uuid REFERENCES public.client_groups(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_documents_client_group
  ON public.documents (client_group_id)
  WHERE client_group_id IS NOT NULL;

COMMENT ON COLUMN public.documents.client_group_id IS
  'Ancla de documento a un client_group (p. ej. minuta Múuch de junta de grupo).';

-- mtg_series.slack_channel_id (B5)
ALTER TABLE public.mtg_series
  ADD COLUMN IF NOT EXISTS slack_channel_id text;

COMMENT ON COLUMN public.mtg_series.slack_channel_id IS
  'Canal Slack opcional para aviso al aprobar minuta (nunca la transcripción).';
