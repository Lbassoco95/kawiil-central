-- Finanzas: estados de cuenta bancarios, movimientos y metas de ahorro.
-- Acceso: mismo criterio que gastos internos (has_finance_access).
-- Los archivos originales se guardan en el bucket "documents" bajo bank-statements/<org>/...

CREATE TABLE IF NOT EXISTS public.finance_bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  name text NOT NULL,
  bank text,
  last4 text,
  currency text NOT NULL DEFAULT 'MXN',
  archived boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.finance_bank_statements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES public.finance_bank_accounts(id) ON DELETE CASCADE,
  period_start date,
  period_end date,
  opening_balance numeric(14,2),
  closing_balance numeric(14,2),
  file_path text,
  file_name text,
  tx_count integer NOT NULL DEFAULT 0,
  uploaded_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.finance_bank_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  account_id uuid NOT NULL REFERENCES public.finance_bank_accounts(id) ON DELETE CASCADE,
  statement_id uuid REFERENCES public.finance_bank_statements(id) ON DELETE CASCADE,
  tx_date date NOT NULL,
  description text NOT NULL DEFAULT '',
  -- positivo = abono (entra), negativo = cargo (sale)
  amount numeric(14,2) NOT NULL,
  balance numeric(14,2),
  -- evita duplicar movimientos si se sube dos veces el mismo periodo
  dedupe_key text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (account_id, dedupe_key)
);

CREATE INDEX IF NOT EXISTS idx_fin_bank_tx_account_date ON public.finance_bank_transactions(account_id, tx_date DESC);
CREATE INDEX IF NOT EXISTS idx_fin_bank_stmt_account ON public.finance_bank_statements(account_id, period_end DESC);

CREATE TABLE IF NOT EXISTS public.finance_savings_goals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  name text NOT NULL,
  target_amount numeric(14,2) NOT NULL,
  saved_amount numeric(14,2) NOT NULL DEFAULT 0,
  target_date date,
  archived boolean NOT NULL DEFAULT false,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'finance_bank_accounts','finance_bank_statements',
    'finance_bank_transactions','finance_savings_goals'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format('DROP POLICY IF EXISTS "Finance access %1$s" ON public.%1$I', t);
    EXECUTE format(
      'CREATE POLICY "Finance access %1$s" ON public.%1$I FOR ALL TO authenticated
         USING (organization_id = get_user_org_id(auth.uid()) AND has_finance_access(auth.uid()))
         WITH CHECK (organization_id = get_user_org_id(auth.uid()) AND has_finance_access(auth.uid()))',
      t);
  END LOOP;
END $$;

DROP TRIGGER IF EXISTS update_finance_bank_accounts_updated_at ON public.finance_bank_accounts;
CREATE TRIGGER update_finance_bank_accounts_updated_at
  BEFORE UPDATE ON public.finance_bank_accounts
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS update_finance_savings_goals_updated_at ON public.finance_savings_goals;
CREATE TRIGGER update_finance_savings_goals_updated_at
  BEFORE UPDATE ON public.finance_savings_goals
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
