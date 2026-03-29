-- Seed default organization (needed for seed data below)
INSERT INTO public.organizations (id, name, slug) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'Kawiil', 'kawiil')
ON CONFLICT (id) DO NOTHING;

-- Areas table
CREATE TABLE public.areas (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  slug text NOT NULL UNIQUE,
  description text,
  color text DEFAULT '#6366f1',
  responsible_user_id uuid,
  is_active boolean NOT NULL DEFAULT true,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.areas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org users see areas" ON public.areas FOR SELECT USING (organization_id = get_user_org_id(auth.uid()));
CREATE POLICY "Admin/manager manage areas" ON public.areas FOR ALL USING (organization_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

-- Seed default areas
INSERT INTO public.areas (name, slug, description, organization_id) VALUES
  ('Contabilidad', 'contabilidad', 'Servicios contables y fiscales', 'a0000000-0000-0000-0000-000000000001'),
  ('Legal', 'legal', 'Servicios legales y corporativos', 'a0000000-0000-0000-0000-000000000001'),
  ('Soft Landing', 'softlanding', 'Servicios de establecimiento empresarial', 'a0000000-0000-0000-0000-000000000001'),
  ('PLD/FT', 'pld_ft', 'Prevención de lavado de dinero', 'a0000000-0000-0000-0000-000000000001'),
  ('Juicios', 'juicios', 'Litigios y procesos judiciales', 'a0000000-0000-0000-0000-000000000001');

-- Document types catalog
CREATE TABLE public.document_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  is_active boolean NOT NULL DEFAULT true,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.document_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org users see document_types" ON public.document_types FOR SELECT USING (organization_id = get_user_org_id(auth.uid()));
CREATE POLICY "Admin/manager manage document_types" ON public.document_types FOR ALL USING (organization_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

INSERT INTO public.document_types (name, description, organization_id) VALUES
  ('Acta constitutiva', 'Documento de constitución de sociedad', 'a0000000-0000-0000-0000-000000000001'),
  ('Poder notarial', 'Poder otorgado ante notario', 'a0000000-0000-0000-0000-000000000001'),
  ('CFDI', 'Comprobante fiscal digital', 'a0000000-0000-0000-0000-000000000001'),
  ('Constancia de situación fiscal', 'CSF emitida por el SAT', 'a0000000-0000-0000-0000-000000000001'),
  ('Estado de cuenta bancario', 'Estado de cuenta mensual', 'a0000000-0000-0000-0000-000000000001'),
  ('Contrato', 'Contrato legal', 'a0000000-0000-0000-0000-000000000001'),
  ('Declaración fiscal', 'Declaración presentada al SAT', 'a0000000-0000-0000-0000-000000000001'),
  ('Identificación oficial', 'INE, pasaporte u otra ID', 'a0000000-0000-0000-0000-000000000001');

-- Tags catalog
CREATE TABLE public.catalog_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  color text DEFAULT '#8b5cf6',
  is_active boolean NOT NULL DEFAULT true,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.catalog_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org users see catalog_tags" ON public.catalog_tags FOR SELECT USING (organization_id = get_user_org_id(auth.uid()));
CREATE POLICY "Admin/manager manage catalog_tags" ON public.catalog_tags FOR ALL USING (organization_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

-- Tax obligations catalog
CREATE TABLE public.tax_obligation_types (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  frequency text DEFAULT 'mensual',
  is_active boolean NOT NULL DEFAULT true,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.tax_obligation_types ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org users see tax_obligation_types" ON public.tax_obligation_types FOR SELECT USING (organization_id = get_user_org_id(auth.uid()));
CREATE POLICY "Admin/manager manage tax_obligation_types" ON public.tax_obligation_types FOR ALL USING (organization_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

INSERT INTO public.tax_obligation_types (name, description, frequency, organization_id) VALUES
  ('ISR personas morales', 'Impuesto sobre la renta - PM', 'mensual', 'a0000000-0000-0000-0000-000000000001'),
  ('IVA', 'Impuesto al valor agregado', 'mensual', 'a0000000-0000-0000-0000-000000000001'),
  ('ISR retenciones', 'Retenciones de ISR por salarios y asimilados', 'mensual', 'a0000000-0000-0000-0000-000000000001'),
  ('DIOT', 'Declaración informativa de operaciones con terceros', 'mensual', 'a0000000-0000-0000-0000-000000000001'),
  ('Declaración anual PM', 'Declaración anual personas morales', 'anual', 'a0000000-0000-0000-0000-000000000001'),
  ('IMSS/INFONAVIT', 'Cuotas obrero-patronales', 'bimestral', 'a0000000-0000-0000-0000-000000000001'),
  ('ISN', 'Impuesto sobre nóminas', 'mensual', 'a0000000-0000-0000-0000-000000000001');
