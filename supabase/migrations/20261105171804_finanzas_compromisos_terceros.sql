-- Finanzas: compromisos (por pagar / por cobrar) y sub-libros de terceros dentro de una cuenta bancaria.

-- Una cuenta puede ser un sub-libro dentro de otra (ej. hoja GONZALO dentro de Banregio):
-- su saldo está físicamente en la cuenta padre pero no es disponible de Kawiil.
ALTER TABLE public.finance_accounts
  ADD COLUMN IF NOT EXISTS parent_account_id uuid REFERENCES public.finance_accounts(id) ON DELETE SET NULL;

ALTER TABLE public.finance_movements ADD COLUMN IF NOT EXISTS entity text;
-- Orden de la fila en el Excel importado: permite anclar el saldo al último saldo reportado por el banco.
ALTER TABLE public.finance_movements ADD COLUMN IF NOT EXISTS row_seq integer;

CREATE TABLE IF NOT EXISTS public.finance_commitments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  direction text NOT NULL CHECK (direction IN ('pagar', 'cobrar')),
  counterparty text,
  concept text NOT NULL,
  amount numeric(14,2) NOT NULL,              -- en MXN
  currency text NOT NULL DEFAULT 'MXN',
  original_amount numeric(14,2),              -- monto en moneda original (ej. 250 USD)
  fx_rate numeric(12,4),
  due_date date,
  status text NOT NULL DEFAULT 'pendiente' CHECK (status IN ('pendiente', 'pagado', 'cancelado')),
  category text,
  source text NOT NULL DEFAULT 'manual',
  external_key text,                          -- para no duplicar al re-subir el Excel
  notes text,
  settled_at date,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, external_key)
);
CREATE INDEX IF NOT EXISTS finance_commitments_org_status_idx ON public.finance_commitments (organization_id, status, due_date);

ALTER TABLE public.finance_commitments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS finance_commitments_finance_all ON public.finance_commitments;
CREATE POLICY finance_commitments_finance_all ON public.finance_commitments FOR ALL TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()) AND has_finance_access(auth.uid()))
  WITH CHECK (organization_id = get_user_org_id(auth.uid()) AND has_finance_access(auth.uid()));

CREATE TRIGGER finance_commitments_updated_at BEFORE UPDATE ON public.finance_commitments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
