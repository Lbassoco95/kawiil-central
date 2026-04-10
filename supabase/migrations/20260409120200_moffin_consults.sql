-- Consultas Moffin (SAT) por proyecto: 69-B, constancia/opinión vía certificados SAT (sat_rfc)
CREATE TABLE public.moffin_consults (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  rfc text NOT NULL,
  consult_type text NOT NULL CHECK (consult_type IN (
    'lista_69b',
    'constancia_situacion_fiscal',
    'opinion_cumplimiento'
  )),
  moffin_service text,
  status text NOT NULL CHECK (status IN ('success', 'fail', 'pending', 'error')),
  error_message text,
  summary text,
  raw_response jsonb NOT NULL DEFAULT '{}'::jsonb,
  moffin_query_id text,
  moffin_uuid text,
  document_id uuid REFERENCES public.documents(id) ON DELETE SET NULL,
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_moffin_consults_project_type_created
  ON public.moffin_consults (project_id, consult_type, created_at DESC);

CREATE INDEX idx_moffin_consults_org ON public.moffin_consults (organization_id);

ALTER TABLE public.moffin_consults ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org users see moffin consults"
  ON public.moffin_consults FOR SELECT
  USING (organization_id = get_user_org_id(auth.uid()));

COMMENT ON TABLE public.moffin_consults IS 'Historial de consultas Moffin (lista 69-B, certificados SAT). Secretos MOFFIN_API_KEY en Edge Functions.';
