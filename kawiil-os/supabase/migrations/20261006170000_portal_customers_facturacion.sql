-- Clientes frecuentes para wizard de Facturación (reutilizables, editables al emitir).

CREATE TABLE IF NOT EXISTS public.portal_customers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.portal_companies(id) ON DELETE CASCADE,
  internal_id text NOT NULL,
  label text NOT NULL,
  rfc text NOT NULL,
  nombre text NOT NULL,
  regimen text NOT NULL DEFAULT '601',
  cp text NOT NULL,
  uso_cfdi text NOT NULL DEFAULT 'G03',
  email text,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id, internal_id)
);

CREATE INDEX IF NOT EXISTS portal_customers_client_idx
  ON public.portal_customers (client_id, updated_at DESC);
CREATE INDEX IF NOT EXISTS portal_customers_rfc_idx
  ON public.portal_customers (client_id, rfc);

COMMENT ON TABLE public.portal_customers IS
  'Clientes (receptores) guardados para reutilizar en el wizard de Facturación. Editables al emitir.';

ALTER TABLE public.portal_customers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS portal_customers_select ON public.portal_customers;
CREATE POLICY portal_customers_select ON public.portal_customers
  FOR SELECT TO authenticated
  USING (public.portal_has_company_role(client_id, ARRAY['administrador','operativo','consulta']::public.portal_role[]));

DROP POLICY IF EXISTS portal_customers_write ON public.portal_customers;
CREATE POLICY portal_customers_write ON public.portal_customers
  FOR ALL TO authenticated
  USING (public.portal_has_company_role(client_id, ARRAY['administrador','operativo']::public.portal_role[]))
  WITH CHECK (public.portal_has_company_role(client_id, ARRAY['administrador','operativo']::public.portal_role[]));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.portal_customers TO authenticated;
GRANT ALL ON public.portal_customers TO service_role;
