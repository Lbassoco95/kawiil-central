-- Corte 3: espejo fiscal (solo lectura publicada desde central).
-- No introduce e.firma, CIEC ni SatGo. Idempotencia vía portal_system_inbox.

BEGIN;

ALTER TABLE public.portal_cfdi
  ADD COLUMN IF NOT EXISTS external_ref text,
  ADD COLUMN IF NOT EXISTS flags jsonb NOT NULL DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS category_name text,
  ADD COLUMN IF NOT EXISTS category_status text NOT NULL DEFAULT 'por_confirmar';

CREATE UNIQUE INDEX IF NOT EXISTS portal_cfdi_client_external_ref_uidx
  ON public.portal_cfdi (client_id, external_ref)
  WHERE external_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.portal_fiscal_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.portal_companies(id) ON DELETE CASCADE,
  external_ref text NOT NULL,
  period_year integer NOT NULL,
  period_month integer NOT NULL CHECK (period_month BETWEEN 1 AND 12),
  iva_basis text NOT NULL DEFAULT 'cash_flow' CHECK (iva_basis IN ('cash_flow','issuance')),
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  quality jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, external_ref),
  UNIQUE (client_id, period_year, period_month)
);

CREATE TABLE IF NOT EXISTS public.portal_fiscal_alerts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.portal_companies(id) ON DELETE CASCADE,
  external_ref text NOT NULL,
  alert_type text NOT NULL CHECK (alert_type IN ('efos','cancelacion','lista_69b','otro')),
  severity text NOT NULL DEFAULT 'info' CHECK (severity IN ('info','warn','critical')),
  title text NOT NULL,
  detail text,
  related_uuid text,
  detected_at timestamptz,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, external_ref)
);

CREATE TABLE IF NOT EXISTS public.portal_sat_notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.portal_companies(id) ON DELETE CASCADE,
  external_ref text NOT NULL,
  title text NOT NULL,
  body text,
  notification_type text NOT NULL DEFAULT 'sat',
  notified_at timestamptz,
  obtained_at timestamptz,
  storage_path text,
  file_name text,
  published_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, external_ref)
);

CREATE TABLE IF NOT EXISTS public.portal_system_inbox (
  idempotency_key text PRIMARY KEY,
  operation text NOT NULL,
  client_id uuid REFERENCES public.portal_companies(id) ON DELETE SET NULL,
  request_hash text NOT NULL,
  response jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS portal_fiscal_alerts_client_idx
  ON public.portal_fiscal_alerts (client_id, published_at DESC);
CREATE INDEX IF NOT EXISTS portal_sat_notifications_client_idx
  ON public.portal_sat_notifications (client_id, published_at DESC);
CREATE INDEX IF NOT EXISTS portal_fiscal_summaries_period_idx
  ON public.portal_fiscal_summaries (client_id, period_year, period_month);

ALTER TABLE public.portal_fiscal_summaries ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_fiscal_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.portal_sat_notifications ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS fiscal_summaries_authorized ON public.portal_fiscal_summaries;
CREATE POLICY fiscal_summaries_authorized ON public.portal_fiscal_summaries
  FOR SELECT TO authenticated
  USING (public.portal_has_company_role(client_id, ARRAY['administrador','operativo','consulta']::public.portal_role[]));

DROP POLICY IF EXISTS fiscal_alerts_authorized ON public.portal_fiscal_alerts;
CREATE POLICY fiscal_alerts_authorized ON public.portal_fiscal_alerts
  FOR SELECT TO authenticated
  USING (public.portal_has_company_role(client_id, ARRAY['administrador','operativo','consulta']::public.portal_role[]));

DROP POLICY IF EXISTS sat_notifications_authorized ON public.portal_sat_notifications;
CREATE POLICY sat_notifications_authorized ON public.portal_sat_notifications
  FOR SELECT TO authenticated
  USING (public.portal_has_company_role(client_id, ARRAY['administrador','operativo','consulta']::public.portal_role[]));

REVOKE ALL ON public.portal_system_inbox FROM anon, authenticated;

CREATE OR REPLACE VIEW public.portal_cfdi_v
WITH (security_invoker = true) AS
SELECT
  c.id,
  c.client_id,
  c.uuid,
  c.direction,
  c.source,
  c.detail_status,
  c.issued_at AS fecha,
  c.issuer_rfc AS rfc_emisor,
  c.issuer_name AS nombre_emisor,
  c.receiver_rfc AS rfc_receptor,
  c.receiver_name AS nombre_receptor,
  c.payment_form AS forma_pago,
  c.payment_method AS metodo_pago,
  c.subtotal,
  c.vat_transferred,
  c.vat_withheld,
  c.income_tax_withheld,
  c.total,
  c.sat_status,
  c.xml_path,
  c.pdf_path,
  c.is_test,
  c.flags,
  c.category_name,
  c.category_status,
  c.external_ref,
  c.created_at
FROM public.portal_cfdi c;

GRANT SELECT ON public.portal_cfdi_v TO authenticated, service_role;

COMMENT ON TABLE public.portal_fiscal_summaries IS
  'Resumen fiscal por periodo publicado por central (espejo). Sin credenciales SAT.';
COMMENT ON TABLE public.portal_fiscal_alerts IS
  'Alertas fiscales (EFOS, cancelaciones, 69-B) publicadas por central. Espejo de solo lectura.';
COMMENT ON TABLE public.portal_sat_notifications IS
  'Notificaciones del SAT publicadas por central. Sin e.firma/CIEC/SatGo en OS.';
COMMENT ON TABLE public.portal_system_inbox IS
  'Idempotencia de operaciones firmadas central→OS. Solo service_role.';

COMMIT;
