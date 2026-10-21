-- Solicitudes de descarga/consulta CFDI por periodo (Ingresos / Egresos).
-- Fase 1: OS persiste la petición y consulta portal_cfdi ya publicado;
-- no llama SatGo. Central descarga y publica vía invoice.publish.

CREATE TABLE IF NOT EXISTS public.portal_cfdi_period_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.portal_companies(id) ON DELETE CASCADE,
  direction text NOT NULL CHECK (direction IN ('emitida', 'recibida')),
  period_kind text NOT NULL CHECK (period_kind IN ('mes', 'semana', 'rango')),
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL DEFAULT 'solicitada'
    CHECK (status IN ('solicitada', 'en_proceso', 'lista', 'error')),
  requested_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT portal_cfdi_period_requests_range CHECK (period_end >= period_start)
);

CREATE INDEX IF NOT EXISTS portal_cfdi_period_requests_client_idx
  ON public.portal_cfdi_period_requests (client_id, direction, period_start DESC);

CREATE INDEX IF NOT EXISTS portal_cfdi_period_requests_status_idx
  ON public.portal_cfdi_period_requests (client_id, status, created_at DESC);

COMMENT ON TABLE public.portal_cfdi_period_requests IS
  'Peticiones de descarga/consulta CFDI por mes, semana o rango. Persistidas en OS; Central las atiende y publica.';

ALTER TABLE public.portal_cfdi_period_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY period_requests_select ON public.portal_cfdi_period_requests
  FOR SELECT TO authenticated
  USING (
    public.portal_has_company_role(
      client_id,
      ARRAY['administrador', 'operativo', 'consulta']::public.portal_role[]
    )
  );

CREATE POLICY period_requests_insert ON public.portal_cfdi_period_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    public.portal_has_company_role(
      client_id,
      ARRAY['administrador', 'operativo']::public.portal_role[]
    )
  );

GRANT SELECT, INSERT ON public.portal_cfdi_period_requests TO authenticated;
GRANT ALL ON public.portal_cfdi_period_requests TO service_role;
