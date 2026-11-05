-- Finanzas: bancos y caja (movimientos importados), clasificación que aprende y planeación.
-- Acceso: mismo criterio que expenses (has_finance_access) dentro de la organización del usuario.

CREATE TABLE IF NOT EXISTS public.finance_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'banco' CHECK (kind IN ('banco', 'efectivo', 'otro')),
  institution text,
  opening_balance numeric(14,2) NOT NULL DEFAULT 0,
  opening_date date,
  -- Si es false, la cuenta guarda dinero de terceros (impuestos de clientes, etc.) y no suma a "disponible".
  counts_as_available boolean NOT NULL DEFAULT true,
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE TABLE IF NOT EXISTS public.finance_import_batches (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  account_id uuid REFERENCES public.finance_accounts(id) ON DELETE SET NULL,
  source text NOT NULL DEFAULT 'excel' CHECK (source IN ('excel', 'pegado', 'manual')),
  filename text,
  rows_total integer NOT NULL DEFAULT 0,
  rows_new integer NOT NULL DEFAULT 0,
  rows_duplicate integer NOT NULL DEFAULT 0,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.finance_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES public.finance_accounts(id) ON DELETE CASCADE,
  batch_id uuid REFERENCES public.finance_import_batches(id) ON DELETE SET NULL,
  movement_date date NOT NULL,
  description text NOT NULL,
  reference text,
  debit numeric(14,2) NOT NULL DEFAULT 0,   -- cargo (sale dinero)
  credit numeric(14,2) NOT NULL DEFAULT 0,  -- abono (entra dinero)
  reported_balance numeric(14,2),
  category text,
  category_source text CHECK (category_source IN ('manual', 'regla', 'excel', 'sugerida')),
  review_status text NOT NULL DEFAULT 'pendiente' CHECK (review_status IN ('pendiente', 'clasificado')),
  -- Traspasos internos y dinero de terceros no cuentan como ingreso/gasto operativo.
  excluded_from_flow boolean NOT NULL DEFAULT false,
  expense_id uuid REFERENCES public.expenses(id) ON DELETE SET NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  notes text,
  dedupe_hash text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, account_id, dedupe_hash)
);
CREATE INDEX IF NOT EXISTS finance_movements_org_date_idx ON public.finance_movements (organization_id, movement_date DESC);
CREATE INDEX IF NOT EXISTS finance_movements_review_idx ON public.finance_movements (organization_id, review_status);

CREATE TABLE IF NOT EXISTS public.finance_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  name text NOT NULL,
  kind text NOT NULL DEFAULT 'gasto' CHECK (kind IN ('gasto', 'ingreso', 'neutral')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

-- Reglas aprendidas: cada clasificación confirmada refuerza (patrón -> categoría).
CREATE TABLE IF NOT EXISTS public.finance_category_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  pattern text NOT NULL,
  category text NOT NULL,
  hits integer NOT NULL DEFAULT 1,
  last_used_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, pattern, category)
);

-- Metas y presupuesto por mes (planeación).
CREATE TABLE IF NOT EXISTS public.finance_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  year integer NOT NULL,
  month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  income_target numeric(14,2) NOT NULL DEFAULT 0,
  expense_budget numeric(14,2) NOT NULL DEFAULT 0,
  new_clients_target integer NOT NULL DEFAULT 0,
  avg_new_client_monthly numeric(14,2) NOT NULL DEFAULT 0,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, year, month)
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['finance_accounts','finance_import_batches','finance_movements','finance_categories','finance_category_rules','finance_goals']
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', t || '_finance_all', t);
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO authenticated
         USING (organization_id = get_user_org_id(auth.uid()) AND has_finance_access(auth.uid()))
         WITH CHECK (organization_id = get_user_org_id(auth.uid()) AND has_finance_access(auth.uid()))',
      t || '_finance_all', t);
  END LOOP;
END $$;

CREATE TRIGGER finance_accounts_updated_at BEFORE UPDATE ON public.finance_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER finance_movements_updated_at BEFORE UPDATE ON public.finance_movements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
CREATE TRIGGER finance_goals_updated_at BEFORE UPDATE ON public.finance_goals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
