-- savio-sync: tablas espejo locales de Savio (facturas, pagos, clientes) para
-- habilitar due_date obligatorio, aging, recordatorios y conciliación (Fase 1),
-- que requieren consultar/derivar datos que hoy solo existen en vivo en Savio.
--
-- Aditivo: los dashboards en vivo actuales siguen leyendo de la API; estas
-- tablas se pueblan por la Edge Function `savio-sync` (service-role) y por cron.
-- Idempotente por (organization_id, savio_id): re-sincronizar hace UPSERT.

-- ── Clientes Savio ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.savio_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  savio_id text NOT NULL,
  name text,
  email text,
  phone text,
  rfc text,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  raw jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT savio_customers_org_savio_uniq UNIQUE (organization_id, savio_id)
);
CREATE INDEX IF NOT EXISTS idx_savio_customers_org ON public.savio_customers (organization_id);
CREATE INDEX IF NOT EXISTS idx_savio_customers_client ON public.savio_customers (client_id);

-- ── Facturas / cargos Savio ───────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.savio_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  savio_id text NOT NULL,
  folio text,
  customer_savio_id text,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  status text,
  amount numeric(14,2),
  currency text NOT NULL DEFAULT 'MXN',
  invoice_date date,
  due_date date,
  raw jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT savio_invoices_org_savio_uniq UNIQUE (organization_id, savio_id)
);
CREATE INDEX IF NOT EXISTS idx_savio_invoices_org ON public.savio_invoices (organization_id);
CREATE INDEX IF NOT EXISTS idx_savio_invoices_client ON public.savio_invoices (client_id);
CREATE INDEX IF NOT EXISTS idx_savio_invoices_due ON public.savio_invoices (organization_id, due_date);
CREATE INDEX IF NOT EXISTS idx_savio_invoices_status ON public.savio_invoices (organization_id, status);
CREATE INDEX IF NOT EXISTS idx_savio_invoices_customer ON public.savio_invoices (organization_id, customer_savio_id);

-- ── Pagos Savio ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.savio_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  savio_id text NOT NULL,
  reference text,
  invoice_savio_id text,
  customer_savio_id text,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  amount numeric(14,2),
  currency text NOT NULL DEFAULT 'MXN',
  payment_date date,
  raw jsonb,
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT savio_payments_org_savio_uniq UNIQUE (organization_id, savio_id)
);
CREATE INDEX IF NOT EXISTS idx_savio_payments_org ON public.savio_payments (organization_id);
CREATE INDEX IF NOT EXISTS idx_savio_payments_client ON public.savio_payments (client_id);
CREATE INDEX IF NOT EXISTS idx_savio_payments_invoice ON public.savio_payments (organization_id, invoice_savio_id);
CREATE INDEX IF NOT EXISTS idx_savio_payments_date ON public.savio_payments (organization_id, payment_date);

-- ── Bitácora de sincronizaciones (incluye verificación de conteos, RF-07) ──────
CREATE TABLE IF NOT EXISTS public.savio_sync_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  resource text NOT NULL,
  -- ok | error | partial
  status text NOT NULL DEFAULT 'ok',
  fetched int NOT NULL DEFAULT 0,
  upserted int NOT NULL DEFAULT 0,
  -- total reportado por Savio si lo expone (para comparar contra lo traído)
  savio_reported_total int,
  truncated boolean NOT NULL DEFAULT false,
  -- true si truncated o si fetched != savio_reported_total
  discrepancy boolean NOT NULL DEFAULT false,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT savio_sync_runs_resource_check CHECK (resource IN ('invoices','payments','customers')),
  CONSTRAINT savio_sync_runs_status_check CHECK (status IN ('ok','error','partial'))
);
CREATE INDEX IF NOT EXISTS idx_savio_sync_runs_org ON public.savio_sync_runs (organization_id, created_at DESC);

-- ── updated_at triggers ────────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS set_savio_customers_updated_at ON public.savio_customers;
CREATE TRIGGER set_savio_customers_updated_at BEFORE UPDATE ON public.savio_customers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS set_savio_invoices_updated_at ON public.savio_invoices;
CREATE TRIGGER set_savio_invoices_updated_at BEFORE UPDATE ON public.savio_invoices
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
DROP TRIGGER IF EXISTS set_savio_payments_updated_at ON public.savio_payments;
CREATE TRIGGER set_savio_payments_updated_at BEFORE UPDATE ON public.savio_payments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ── RLS: lectura para Finanzas; la escritura la hace la Edge Function (service-role) ──
ALTER TABLE public.savio_customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.savio_invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.savio_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.savio_sync_runs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Finance see savio customers" ON public.savio_customers;
CREATE POLICY "Finance see savio customers" ON public.savio_customers
  FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()) AND has_finance_access(auth.uid()));

DROP POLICY IF EXISTS "Finance see savio invoices" ON public.savio_invoices;
CREATE POLICY "Finance see savio invoices" ON public.savio_invoices
  FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()) AND has_finance_access(auth.uid()));

DROP POLICY IF EXISTS "Finance see savio payments" ON public.savio_payments;
CREATE POLICY "Finance see savio payments" ON public.savio_payments
  FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()) AND has_finance_access(auth.uid()));

DROP POLICY IF EXISTS "Finance see savio sync runs" ON public.savio_sync_runs;
CREATE POLICY "Finance see savio sync runs" ON public.savio_sync_runs
  FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()) AND has_finance_access(auth.uid()));
