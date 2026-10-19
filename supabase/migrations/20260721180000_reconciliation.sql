-- RF-04: aplicación de pagos a facturas + cola de conciliación.
-- Adaptado a la arquitectura actual: los pagos viven en savio_payments y las
-- facturas en savio_invoices. La junction payment_invoice registra cuánto de cada
-- pago se aplica a cada factura; los pagos ambiguos/sin factura/con sobrepago van
-- a reconciliation_queue para resolución manual desde Finanzas.

-- Origen y tipo de cambio del pago (para multi-fuente y USD — RF-08 / P2.x).
ALTER TABLE public.savio_payments
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'savio',
  ADD COLUMN IF NOT EXISTS fx_rate numeric(14,6);

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'savio_payments_source_check') THEN
    ALTER TABLE public.savio_payments
      ADD CONSTRAINT savio_payments_source_check
      CHECK (source IN ('savio','stripe','dlocal','banco','manual'));
  END IF;
END $$;

-- ── Junction pago ↔ factura ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.payment_invoice (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  payment_id uuid NOT NULL REFERENCES public.savio_payments(id) ON DELETE CASCADE,
  invoice_id uuid NOT NULL REFERENCES public.savio_invoices(id) ON DELETE CASCADE,
  payment_savio_id text,
  invoice_savio_id text,
  monto_aplicado numeric(14,2) NOT NULL,
  concepto text,
  auto boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT payment_invoice_uniq UNIQUE (organization_id, payment_id, invoice_id),
  CONSTRAINT payment_invoice_monto_check CHECK (monto_aplicado > 0)
);
CREATE INDEX IF NOT EXISTS idx_payment_invoice_org ON public.payment_invoice (organization_id);
CREATE INDEX IF NOT EXISTS idx_payment_invoice_payment ON public.payment_invoice (payment_id);
CREATE INDEX IF NOT EXISTS idx_payment_invoice_invoice ON public.payment_invoice (invoice_id);

ALTER TABLE public.payment_invoice ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Finance see payment_invoice" ON public.payment_invoice;
CREATE POLICY "Finance see payment_invoice" ON public.payment_invoice
  FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()) AND has_finance_access(auth.uid()));
DROP POLICY IF EXISTS "Finance manage payment_invoice" ON public.payment_invoice;
CREATE POLICY "Finance manage payment_invoice" ON public.payment_invoice
  FOR ALL TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()) AND has_finance_access(auth.uid()))
  WITH CHECK (organization_id = get_user_org_id(auth.uid()) AND has_finance_access(auth.uid()));

-- ── Cola de conciliación (pagos que no se pudieron aplicar solos) ───────────────
CREATE TABLE IF NOT EXISTS public.reconciliation_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  payment_id uuid NOT NULL REFERENCES public.savio_payments(id) ON DELETE CASCADE,
  payment_savio_id text,
  customer_savio_id text,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  amount numeric(14,2),
  currency text NOT NULL DEFAULT 'MXN',
  -- sin_factura | ambiguo | sobrepago
  reason text NOT NULL,
  candidates jsonb NOT NULL DEFAULT '[]'::jsonb,
  -- pendiente | resuelto | ignorado
  status text NOT NULL DEFAULT 'pendiente',
  resolved_by uuid,
  resolved_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT reconciliation_queue_reason_check CHECK (reason IN ('sin_factura','ambiguo','sobrepago')),
  CONSTRAINT reconciliation_queue_status_check CHECK (status IN ('pendiente','resuelto','ignorado')),
  CONSTRAINT reconciliation_queue_payment_uniq UNIQUE (organization_id, payment_id)
);
CREATE INDEX IF NOT EXISTS idx_reconciliation_queue_org ON public.reconciliation_queue (organization_id, status, created_at DESC);

ALTER TABLE public.reconciliation_queue ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Finance see reconciliation_queue" ON public.reconciliation_queue;
CREATE POLICY "Finance see reconciliation_queue" ON public.reconciliation_queue
  FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()) AND has_finance_access(auth.uid()));
DROP POLICY IF EXISTS "Finance manage reconciliation_queue" ON public.reconciliation_queue;
CREATE POLICY "Finance manage reconciliation_queue" ON public.reconciliation_queue
  FOR ALL TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()) AND has_finance_access(auth.uid()))
  WITH CHECK (organization_id = get_user_org_id(auth.uid()) AND has_finance_access(auth.uid()));

DROP TRIGGER IF EXISTS set_reconciliation_queue_updated_at ON public.reconciliation_queue;
CREATE TRIGGER set_reconciliation_queue_updated_at BEFORE UPDATE ON public.reconciliation_queue
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── Vista: resumen de conciliación por cliente (al día / pendiente) ─────────────
CREATE OR REPLACE VIEW public.v_reconciliation_summary
WITH (security_invoker = true) AS
WITH inv AS (
  SELECT
    i.organization_id,
    i.customer_savio_id,
    i.client_id,
    UPPER(COALESCE(NULLIF(i.currency,''),'MXN')) AS currency,
    COALESCE(i.amount,0) AS amount,
    COALESCE((SELECT SUM(pi.monto_aplicado) FROM public.payment_invoice pi WHERE pi.invoice_id = i.id),0) AS applied,
    LOWER(COALESCE(i.status,'')) AS status
  FROM public.savio_invoices i
)
SELECT
  organization_id,
  customer_savio_id,
  client_id,
  currency,
  COUNT(*)::int AS invoices,
  SUM(amount) AS billed,
  SUM(applied) AS collected,
  SUM(GREATEST(amount - applied, 0)) AS pending
FROM inv
WHERE status NOT IN ('cancelled','canceled','cancelada','void','anulada')
GROUP BY organization_id, customer_savio_id, client_id, currency;

GRANT SELECT ON public.v_reconciliation_summary TO authenticated;
