
-- Accounting periods: tracks monthly accounting workflow per project
CREATE TABLE public.accounting_periods (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  year integer NOT NULL,
  month integer NOT NULL CHECK (month BETWEEN 1 AND 12),
  steps jsonb NOT NULL DEFAULT '[
    {"key":"recoleccion","label":"Recolección de documentos","completed":false,"completed_at":null,"completed_by":null},
    {"key":"descarga_sat","label":"Descarga de facturas del SAT","completed":false,"completed_at":null,"completed_by":null},
    {"key":"clasificacion","label":"Clasificación de documentos","completed":false,"completed_at":null,"completed_by":null},
    {"key":"conciliacion","label":"Conciliación bancaria","completed":false,"completed_at":null,"completed_by":null},
    {"key":"registro_contpaqi","label":"Registro en ContPAQi","completed":false,"completed_at":null,"completed_by":null},
    {"key":"ajustes","label":"Ajustes contables","completed":false,"completed_at":null,"completed_by":null},
    {"key":"preparacion","label":"Preparación de declaraciones","completed":false,"completed_at":null,"completed_by":null},
    {"key":"presentacion","label":"Presentación ante el SAT","completed":false,"completed_at":null,"completed_by":null},
    {"key":"envio_acuses","label":"Envío de acuses al cliente","completed":false,"completed_at":null,"completed_by":null}
  ]'::jsonb,
  status text NOT NULL DEFAULT 'pendiente',
  notes text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(project_id, year, month)
);

-- RLS
ALTER TABLE public.accounting_periods ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org users see accounting periods"
  ON public.accounting_periods FOR SELECT
  USING (organization_id = get_user_org_id(auth.uid()));

CREATE POLICY "Org users create accounting periods"
  ON public.accounting_periods FOR INSERT
  WITH CHECK (organization_id = get_user_org_id(auth.uid()));

CREATE POLICY "Org users update accounting periods"
  ON public.accounting_periods FOR UPDATE
  USING (organization_id = get_user_org_id(auth.uid()));

-- Updated_at trigger
CREATE TRIGGER update_accounting_periods_updated_at
  BEFORE UPDATE ON public.accounting_periods
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
