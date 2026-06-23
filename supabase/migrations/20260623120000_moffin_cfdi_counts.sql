-- Control (contador) de facturas SAT (CFDI) por cliente vía Moffin Solutions.
-- Solo se persiste el CONTEO de facturas vigentes emitidas/recibidas y montos del periodo,
-- NO el detalle de cada CFDI (privacidad + tamaño). El detalle se muestra en pantalla bajo demanda.
CREATE TABLE public.moffin_cfdi_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  rfc text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  total_cfdi integer NOT NULL DEFAULT 0,
  total_vigentes integer NOT NULL DEFAULT 0,
  total_canceladas integer NOT NULL DEFAULT 0,
  emitidas_vigentes integer NOT NULL DEFAULT 0,
  recibidas_vigentes integer NOT NULL DEFAULT 0,
  emitidas_vigentes_total_mxn numeric(16, 2) NOT NULL DEFAULT 0,
  recibidas_vigentes_total_mxn numeric(16, 2) NOT NULL DEFAULT 0,
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_moffin_cfdi_counts_client_created
  ON public.moffin_cfdi_counts (client_id, created_at DESC);

CREATE INDEX idx_moffin_cfdi_counts_org ON public.moffin_cfdi_counts (organization_id);

ALTER TABLE public.moffin_cfdi_counts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org users see moffin cfdi counts"
  ON public.moffin_cfdi_counts FOR SELECT
  USING (organization_id = get_user_org_id(auth.uid()));

COMMENT ON TABLE public.moffin_cfdi_counts IS
  'Contador de facturas SAT (CFDI) vigentes emitidas/recibidas por cliente/periodo (Moffin Solutions). Solo conteos y montos, sin detalle de CFDI.';
