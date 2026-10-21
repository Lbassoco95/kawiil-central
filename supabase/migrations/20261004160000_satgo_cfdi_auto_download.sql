-- Descarga automática CFDI (SATgo facfiel) + gate FIEL + espejo OS (company_ref).
-- Horario: 08:00, 15:00, 21:00 America/Mexico_City (validado en Edge).

-- Referencia de empresa en Kawiil OS (external_ref / company_ref) para invoice.publish
ALTER TABLE public.clients
  ADD COLUMN IF NOT EXISTS portal_company_ref text;

COMMENT ON COLUMN public.clients.portal_company_ref IS
  'external_ref de portal_companies en Kawiil OS. Sin este valor no se publica invoice.publish al espejo.';

CREATE UNIQUE INDEX IF NOT EXISTS uq_clients_portal_company_ref
  ON public.clients (portal_company_ref)
  WHERE portal_company_ref IS NOT NULL AND btrim(portal_company_ref) <> '';

-- Historial: tipo de consulta CFDI auto
ALTER TABLE public.moffin_consults
  DROP CONSTRAINT IF EXISTS moffin_consults_consult_type_check;

ALTER TABLE public.moffin_consults
  ADD CONSTRAINT moffin_consults_consult_type_check
  CHECK (consult_type = ANY (ARRAY[
    'lista_69b'::text,
    'constancia_situacion_fiscal'::text,
    'opinion_cumplimiento'::text,
    'buzon_comunicados'::text,
    'buzon_notificaciones'::text,
    'satgo_cfdi_download'::text
  ]));

COMMENT ON TABLE public.moffin_consults IS
  'Historial de consultas SAT (69-B, CSF, 32D, buzón, descarga CFDI SATgo). Proveedor principal: SATgo.';

-- Runs (una fila por cliente / ciclo)
CREATE TABLE IF NOT EXISTS public.satgo_cfdi_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  rfc text NOT NULL,
  period_start date NOT NULL,
  period_end date NOT NULL,
  status text NOT NULL DEFAULT 'running'
    CHECK (status IN ('running', 'success', 'error', 'skipped')),
  trigger text NOT NULL DEFAULT 'cron'
    CHECK (trigger IN ('cron', 'manual')),
  local_hour_cdmx smallint,
  emitidas_count integer NOT NULL DEFAULT 0,
  recibidas_count integer NOT NULL DEFAULT 0,
  error_message text,
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_satgo_cfdi_runs_client_created
  ON public.satgo_cfdi_runs (client_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_satgo_cfdi_runs_org
  ON public.satgo_cfdi_runs (organization_id);

ALTER TABLE public.satgo_cfdi_runs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org users see satgo cfdi runs"
  ON public.satgo_cfdi_runs FOR SELECT
  USING (organization_id = get_user_org_id(auth.uid()));

COMMENT ON TABLE public.satgo_cfdi_runs IS
  'Ciclos de descarga automática CFDI vía SATgo facfiel (gate: e.firma JWE).';

-- Items (metadatos UUID; sin XML/PDF ni secretos)
CREATE TABLE IF NOT EXISTS public.satgo_cfdi_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  rfc text NOT NULL,
  uuid text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('emitida', 'recibida')),
  issued_at text,
  issuer_rfc text,
  issuer_name text,
  receiver_rfc text,
  receiver_name text,
  total numeric(16, 2) NOT NULL DEFAULT 0,
  subtotal numeric(16, 2) NOT NULL DEFAULT 0,
  sat_status text,
  payment_method text,
  payment_form text,
  currency text DEFAULT 'MXN',
  voucher_type text,
  last_run_id uuid REFERENCES public.satgo_cfdi_runs(id) ON DELETE SET NULL,
  raw_meta jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, uuid, direction)
);

CREATE INDEX IF NOT EXISTS idx_satgo_cfdi_items_client_issued
  ON public.satgo_cfdi_items (client_id, issued_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_satgo_cfdi_items_org
  ON public.satgo_cfdi_items (organization_id);

ALTER TABLE public.satgo_cfdi_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org users see satgo cfdi items"
  ON public.satgo_cfdi_items FOR SELECT
  USING (organization_id = get_user_org_id(auth.uid()));

COMMENT ON TABLE public.satgo_cfdi_items IS
  'Metadatos CFDI descargados por SATgo (sin XML/e.firma). Fuente para espejo OS.';
