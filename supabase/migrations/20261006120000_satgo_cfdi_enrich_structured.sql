-- Enriquecimiento CFDI SatGo: columnas queryables + partidas + vínculos de pago/NC.
-- Fuente: XML parseado en satgo-facturas (no blobs opacos como única representación).

ALTER TABLE public.satgo_cfdi_items
  ADD COLUMN IF NOT EXISTS detail_status text NOT NULL DEFAULT 'metadata'
    CHECK (detail_status IN ('metadata', 'complete')),
  ADD COLUMN IF NOT EXISTS discount numeric(16, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vat_transferred numeric(16, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS vat_withheld numeric(16, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS income_tax_withheld numeric(16, 2) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS exchange_rate numeric(18, 8),
  ADD COLUMN IF NOT EXISTS cfdi_version text,
  ADD COLUMN IF NOT EXISTS related_uuid text,
  ADD COLUMN IF NOT EXISTS source_xml boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.satgo_cfdi_items.detail_status IS
  'metadata = listado facfiel incompleto; complete = montos/método/partidas desde XML.';
COMMENT ON COLUMN public.satgo_cfdi_items.source_xml IS
  'true si el detalle se obtuvo parseando XML SATgo (descargaComprobantes).';
COMMENT ON COLUMN public.satgo_cfdi_items.related_uuid IS
  'UUID de CFDI relacionado (nota de crédito / TipoRelacion).';

CREATE INDEX IF NOT EXISTS idx_satgo_cfdi_items_client_detail
  ON public.satgo_cfdi_items (client_id, detail_status);

CREATE INDEX IF NOT EXISTS idx_satgo_cfdi_items_client_method_issued
  ON public.satgo_cfdi_items (client_id, payment_method, issued_at DESC NULLS LAST);

CREATE INDEX IF NOT EXISTS idx_satgo_cfdi_items_client_voucher
  ON public.satgo_cfdi_items (client_id, voucher_type);

CREATE INDEX IF NOT EXISTS idx_satgo_cfdi_items_related_uuid
  ON public.satgo_cfdi_items (related_uuid)
  WHERE related_uuid IS NOT NULL;

-- Partidas (ClaveProdServ + concepto) para análisis
CREATE TABLE IF NOT EXISTS public.satgo_cfdi_concepts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  item_id uuid NOT NULL REFERENCES public.satgo_cfdi_items(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  line_no integer NOT NULL DEFAULT 1,
  product_service_key text,
  description text NOT NULL,
  quantity numeric(18, 6) NOT NULL DEFAULT 1,
  unit_value numeric(16, 6) NOT NULL DEFAULT 0,
  amount numeric(16, 2) NOT NULL DEFAULT 0,
  discount numeric(16, 2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (item_id, line_no)
);

CREATE INDEX IF NOT EXISTS idx_satgo_cfdi_concepts_client_key
  ON public.satgo_cfdi_concepts (client_id, product_service_key);

CREATE INDEX IF NOT EXISTS idx_satgo_cfdi_concepts_item
  ON public.satgo_cfdi_concepts (item_id);

ALTER TABLE public.satgo_cfdi_concepts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org users see satgo cfdi concepts"
  ON public.satgo_cfdi_concepts FOR SELECT
  USING (organization_id = get_user_org_id(auth.uid()));

COMMENT ON TABLE public.satgo_cfdi_concepts IS
  'Partidas CFDI (concepto + ClaveProdServ) extraídas del XML SatGo.';

-- Complementos de pago (tipo P → factura PPD)
CREATE TABLE IF NOT EXISTS public.satgo_cfdi_payment_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  payment_item_id uuid NOT NULL REFERENCES public.satgo_cfdi_items(id) ON DELETE CASCADE,
  related_uuid text NOT NULL,
  paid_at timestamptz,
  paid_amount numeric(16, 2) NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (payment_item_id, related_uuid, paid_at)
);

CREATE INDEX IF NOT EXISTS idx_satgo_cfdi_payment_links_client_related
  ON public.satgo_cfdi_payment_links (client_id, related_uuid);

CREATE INDEX IF NOT EXISTS idx_satgo_cfdi_payment_links_paid_at
  ON public.satgo_cfdi_payment_links (client_id, paid_at DESC NULLS LAST);

ALTER TABLE public.satgo_cfdi_payment_links ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org users see satgo cfdi payment links"
  ON public.satgo_cfdi_payment_links FOR SELECT
  USING (organization_id = get_user_org_id(auth.uid()));

COMMENT ON TABLE public.satgo_cfdi_payment_links IS
  'Vínculos complemento de pago (CFDI P) → factura PPD; montos por fecha de pago.';
