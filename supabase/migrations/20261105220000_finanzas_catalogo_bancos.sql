-- Finanzas: catálogo de bancos/instituciones (importable desde la lista de Banxico) y perfil de importación por cuenta.

CREATE TABLE IF NOT EXISTS public.finance_banks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  name text NOT NULL,
  code text,                       -- clave (3 dígitos de CLABE o 5 de Banxico)
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'banxico', 'base')),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

ALTER TABLE public.finance_banks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS finance_banks_finance_all ON public.finance_banks;
CREATE POLICY finance_banks_finance_all ON public.finance_banks FOR ALL TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()) AND has_finance_access(auth.uid()))
  WITH CHECK (organization_id = get_user_org_id(auth.uid()) AND has_finance_access(auth.uid()));

ALTER TABLE public.finance_accounts ADD COLUMN IF NOT EXISTS bank_code text;
-- Mapeo de columnas del estado de cuenta de esta cuenta (se recuerda para la siguiente carga).
ALTER TABLE public.finance_accounts ADD COLUMN IF NOT EXISTS import_profile jsonb;
