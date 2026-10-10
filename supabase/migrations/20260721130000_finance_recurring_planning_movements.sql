-- Planeación financiera del despacho: gastos recurrentes, empresas del grupo
-- (cuentas por cobrar intercompañía) y carga/revisión de movimientos bancarios
-- (estados de cuenta) con apoyo de IA. Primer paso hacia open banking: por ahora
-- los movimientos se cargan manualmente (PDF, Excel/CSV, foto) y la IA los
-- desglosa para revisarlos y conciliarlos contra los gastos registrados.

-- ─────────────────────────────────────────────────────────────────────────────
-- 1) Empresas del grupo (catálogo configurable)
--    Yoltik, Tonatiuh, Ixim, etc. Cuando pagamos "por cuenta de" una de estas
--    empresas, ellas nos deben: se rastrea como cuenta por cobrar intercompañía.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.group_companies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  name text NOT NULL,
  rfc text,
  notes text,
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_group_companies_org ON public.group_companies (organization_id, is_active);

ALTER TABLE public.group_companies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org users see group companies" ON public.group_companies;
CREATE POLICY "Org users see group companies" ON public.group_companies
  FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Finance insert group companies" ON public.group_companies;
CREATE POLICY "Finance insert group companies" ON public.group_companies
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = get_user_org_id(auth.uid()) AND has_finance_access(auth.uid()));

DROP POLICY IF EXISTS "Finance update group companies" ON public.group_companies;
CREATE POLICY "Finance update group companies" ON public.group_companies
  FOR UPDATE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()) AND has_finance_access(auth.uid()));

DROP POLICY IF EXISTS "Admin delete group companies" ON public.group_companies;
CREATE POLICY "Admin delete group companies" ON public.group_companies
  FOR DELETE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

DROP TRIGGER IF EXISTS set_group_companies_updated_at ON public.group_companies;
CREATE TRIGGER set_group_companies_updated_at
  BEFORE UPDATE ON public.group_companies
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─────────────────────────────────────────────────────────────────────────────
-- 2) Extensión de expenses: gasto a cuenta de una empresa del grupo.
--    Se reutiliza el rastreo de reembolso: reimbursement_type =
--    'cobrar_empresa_grupo' + group_company_id apuntando a quién nos debe.
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE public.expenses
  ADD COLUMN IF NOT EXISTS group_company_id uuid REFERENCES public.group_companies(id) ON DELETE SET NULL;

COMMENT ON COLUMN public.expenses.group_company_id IS
  'Empresa del grupo a cuenta de la cual se hizo el gasto (nos debe). Solo aplica cuando reimbursement_type = cobrar_empresa_grupo.';

-- Amplía los valores admitidos de reimbursement_type sin romper filas existentes.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'expenses_reimbursement_type_check') THEN
    ALTER TABLE public.expenses DROP CONSTRAINT expenses_reimbursement_type_check;
  END IF;
  ALTER TABLE public.expenses
    ADD CONSTRAINT expenses_reimbursement_type_check
    CHECK (
      reimbursement_type IS NULL
      OR reimbursement_type IN ('cobrar_cliente', 'reembolsar_trabajador', 'cobrar_empresa_grupo')
    );
END $$;

CREATE INDEX IF NOT EXISTS idx_expenses_group_company ON public.expenses (group_company_id);

-- ─────────────────────────────────────────────────────────────────────────────
-- 3) Gastos recurrentes (plantillas de planeación)
--    Renta, software, nómina, servicios… Definen el compromiso mensual esperado
--    para comparar contra lo realmente registrado mes a mes.
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.recurring_expenses (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  name text NOT NULL,
  category text NOT NULL DEFAULT 'operativo',
  amount numeric(12,2) NOT NULL,
  currency text NOT NULL DEFAULT 'MXN',
  -- semanal | quincenal | mensual | bimestral | trimestral | semestral | anual
  frequency text NOT NULL DEFAULT 'mensual',
  -- día del mes en que suele cargarse (1-31), opcional
  day_of_month int,
  vendor text,
  -- kawiil | cliente | reembolsar_trabajador | empresa_grupo
  charge_to text NOT NULL DEFAULT 'kawiil',
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  group_company_id uuid REFERENCES public.group_companies(id) ON DELETE SET NULL,
  start_date date NOT NULL DEFAULT CURRENT_DATE,
  end_date date,
  active boolean NOT NULL DEFAULT true,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT recurring_expenses_frequency_check
    CHECK (frequency IN ('semanal','quincenal','mensual','bimestral','trimestral','semestral','anual')),
  CONSTRAINT recurring_expenses_charge_to_check
    CHECK (charge_to IN ('kawiil','cliente','reembolsar_trabajador','empresa_grupo')),
  CONSTRAINT recurring_expenses_day_check
    CHECK (day_of_month IS NULL OR (day_of_month BETWEEN 1 AND 31))
);

CREATE INDEX IF NOT EXISTS idx_recurring_expenses_org ON public.recurring_expenses (organization_id, active);

ALTER TABLE public.recurring_expenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Finance see recurring expenses" ON public.recurring_expenses;
CREATE POLICY "Finance see recurring expenses" ON public.recurring_expenses
  FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()) AND has_finance_access(auth.uid()));

DROP POLICY IF EXISTS "Finance insert recurring expenses" ON public.recurring_expenses;
CREATE POLICY "Finance insert recurring expenses" ON public.recurring_expenses
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = get_user_org_id(auth.uid()) AND has_finance_access(auth.uid()));

DROP POLICY IF EXISTS "Finance update recurring expenses" ON public.recurring_expenses;
CREATE POLICY "Finance update recurring expenses" ON public.recurring_expenses
  FOR UPDATE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()) AND has_finance_access(auth.uid()));

DROP POLICY IF EXISTS "Finance delete recurring expenses" ON public.recurring_expenses;
CREATE POLICY "Finance delete recurring expenses" ON public.recurring_expenses
  FOR DELETE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()) AND has_finance_access(auth.uid()));

DROP TRIGGER IF EXISTS set_recurring_expenses_updated_at ON public.recurring_expenses;
CREATE TRIGGER set_recurring_expenses_updated_at
  BEFORE UPDATE ON public.recurring_expenses
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─────────────────────────────────────────────────────────────────────────────
-- 4) Estados de cuenta cargados (agrupan movimientos)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bank_statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  file_path text,
  file_name text,
  -- pdf | excel | csv | image | manual
  source_type text NOT NULL DEFAULT 'pdf',
  bank_name text,
  account_label text,
  period_start date,
  period_end date,
  -- procesando | listo | error | revisado
  status text NOT NULL DEFAULT 'procesando',
  movements_count int NOT NULL DEFAULT 0,
  ai_summary text,
  error_message text,
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bank_statements_status_check
    CHECK (status IN ('procesando','listo','error','revisado'))
);

CREATE INDEX IF NOT EXISTS idx_bank_statements_org ON public.bank_statements (organization_id, created_at DESC);

ALTER TABLE public.bank_statements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Finance see bank statements" ON public.bank_statements;
CREATE POLICY "Finance see bank statements" ON public.bank_statements
  FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()) AND has_finance_access(auth.uid()));

DROP POLICY IF EXISTS "Finance insert bank statements" ON public.bank_statements;
CREATE POLICY "Finance insert bank statements" ON public.bank_statements
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = get_user_org_id(auth.uid()) AND has_finance_access(auth.uid()));

DROP POLICY IF EXISTS "Finance update bank statements" ON public.bank_statements;
CREATE POLICY "Finance update bank statements" ON public.bank_statements
  FOR UPDATE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()) AND has_finance_access(auth.uid()));

DROP POLICY IF EXISTS "Finance delete bank statements" ON public.bank_statements;
CREATE POLICY "Finance delete bank statements" ON public.bank_statements
  FOR DELETE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()) AND has_finance_access(auth.uid()));

DROP TRIGGER IF EXISTS set_bank_statements_updated_at ON public.bank_statements;
CREATE TRIGGER set_bank_statements_updated_at
  BEFORE UPDATE ON public.bank_statements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─────────────────────────────────────────────────────────────────────────────
-- 5) Movimientos bancarios (renglones del estado de cuenta o captura suelta)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.bank_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  statement_id uuid REFERENCES public.bank_statements(id) ON DELETE CASCADE,
  movement_date date,
  description text,
  amount numeric(14,2) NOT NULL,
  -- cargo (egreso) | abono (ingreso)
  direction text NOT NULL DEFAULT 'cargo',
  currency text NOT NULL DEFAULT 'MXN',
  balance numeric(14,2),
  counterparty text,
  suggested_category text,
  category text,
  -- pendiente | conciliado | ignorado | gasto_creado
  status text NOT NULL DEFAULT 'pendiente',
  matched_expense_id uuid REFERENCES public.expenses(id) ON DELETE SET NULL,
  recurring_expense_id uuid REFERENCES public.recurring_expenses(id) ON DELETE SET NULL,
  notes text,
  raw jsonb,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT bank_movements_direction_check CHECK (direction IN ('cargo','abono')),
  CONSTRAINT bank_movements_status_check
    CHECK (status IN ('pendiente','conciliado','ignorado','gasto_creado'))
);

CREATE INDEX IF NOT EXISTS idx_bank_movements_statement ON public.bank_movements (statement_id);
CREATE INDEX IF NOT EXISTS idx_bank_movements_org ON public.bank_movements (organization_id, movement_date DESC);
CREATE INDEX IF NOT EXISTS idx_bank_movements_status ON public.bank_movements (organization_id, status);

ALTER TABLE public.bank_movements ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Finance see bank movements" ON public.bank_movements;
CREATE POLICY "Finance see bank movements" ON public.bank_movements
  FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()) AND has_finance_access(auth.uid()));

DROP POLICY IF EXISTS "Finance insert bank movements" ON public.bank_movements;
CREATE POLICY "Finance insert bank movements" ON public.bank_movements
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = get_user_org_id(auth.uid()) AND has_finance_access(auth.uid()));

DROP POLICY IF EXISTS "Finance update bank movements" ON public.bank_movements;
CREATE POLICY "Finance update bank movements" ON public.bank_movements
  FOR UPDATE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()) AND has_finance_access(auth.uid()));

DROP POLICY IF EXISTS "Finance delete bank movements" ON public.bank_movements;
CREATE POLICY "Finance delete bank movements" ON public.bank_movements
  FOR DELETE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()) AND has_finance_access(auth.uid()));

DROP TRIGGER IF EXISTS set_bank_movements_updated_at ON public.bank_movements;
CREATE TRIGGER set_bank_movements_updated_at
  BEFORE UPDATE ON public.bank_movements
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
