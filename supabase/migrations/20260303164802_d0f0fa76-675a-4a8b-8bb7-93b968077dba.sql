
CREATE TABLE public.annual_declarations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  year integer NOT NULL,
  status text NOT NULL DEFAULT 'pendiente',
  steps jsonb NOT NULL DEFAULT '[
    {"key":"pagos_provisionales","label":"Pagos Provisionales","completed":false,"completed_at":null,"completed_by":null,"step_status":"pendiente","notes":null,"document_ids":[]},
    {"key":"depreciacion_activo_fijo","label":"Depreciación Activo Fijo","completed":false,"completed_at":null,"completed_by":null,"step_status":"pendiente","notes":null,"document_ids":[]},
    {"key":"amortizacion","label":"Amortización","completed":false,"completed_at":null,"completed_by":null,"step_status":"pendiente","notes":null,"document_ids":[]},
    {"key":"inventarios","label":"Inventarios","completed":false,"completed_at":null,"completed_by":null,"step_status":"pendiente","notes":null,"document_ids":[]},
    {"key":"papel_iva","label":"Papel de IVA (A favor y/o a pagar)","completed":false,"completed_at":null,"completed_by":null,"step_status":"pendiente","notes":null,"document_ids":[]},
    {"key":"retenciones_serv_profesionales","label":"Retenciones Serv. Profesionales","completed":false,"completed_at":null,"completed_by":null,"step_status":"pendiente","notes":null,"document_ids":[]},
    {"key":"retenciones_arrendamiento","label":"Retenciones Arrendamiento","completed":false,"completed_at":null,"completed_by":null,"step_status":"pendiente","notes":null,"document_ids":[]},
    {"key":"retenciones_sueldos","label":"Retenciones Sueldos","completed":false,"completed_at":null,"completed_by":null,"step_status":"pendiente","notes":null,"document_ids":[]},
    {"key":"retenciones_asimilados","label":"Retenciones Asimilados","completed":false,"completed_at":null,"completed_by":null,"step_status":"pendiente","notes":null,"document_ids":[]},
    {"key":"cfdi_nomina","label":"CFDI Nómina y/o Asimilados","completed":false,"completed_at":null,"completed_by":null,"step_status":"pendiente","notes":null,"document_ids":[]},
    {"key":"opinion_32d","label":"32-D","completed":false,"completed_at":null,"completed_by":null,"step_status":"pendiente","notes":null,"document_ids":[]},
    {"key":"balanza_completa","label":"Balanza Completa","completed":false,"completed_at":null,"completed_by":null,"step_status":"pendiente","notes":null,"document_ids":[]},
    {"key":"estado_resultados","label":"Estado de Resultados","completed":false,"completed_at":null,"completed_by":null,"step_status":"pendiente","notes":null,"document_ids":[]},
    {"key":"estado_situacion_financiera","label":"Estado de Situación Financiera","completed":false,"completed_at":null,"completed_by":null,"step_status":"pendiente","notes":null,"document_ids":[]},
    {"key":"estados_cambios_capital","label":"Estados de Cambios en el Capital Contable","completed":false,"completed_at":null,"completed_by":null,"step_status":"pendiente","notes":null,"document_ids":[]},
    {"key":"actas_asamblea","label":"Actas de Asamblea (Aumento o cambios en el capital)","completed":false,"completed_at":null,"completed_by":null,"step_status":"pendiente","notes":null,"document_ids":[]},
    {"key":"papel_calculo_isr","label":"Papel Cálculo ISR Completo","completed":false,"completed_at":null,"completed_by":null,"step_status":"pendiente","notes":null,"document_ids":[]},
    {"key":"detalle_acuse","label":"Detalle y Acuse en Carpeta","completed":false,"completed_at":null,"completed_by":null,"step_status":"pendiente","notes":null,"document_ids":[]},
    {"key":"fecha_presentacion","label":"Fecha de Presentación","completed":false,"completed_at":null,"completed_by":null,"step_status":"pendiente","notes":null,"document_ids":[]},
    {"key":"isr_utilidad_perdida","label":"ISR Utilidad/Pérdida","completed":false,"completed_at":null,"completed_by":null,"step_status":"pendiente","notes":null,"document_ids":[]},
    {"key":"isr_resultado","label":"ISR Resultado $","completed":false,"completed_at":null,"completed_by":null,"step_status":"pendiente","notes":null,"document_ids":[]},
    {"key":"ptu","label":"PTU","completed":false,"completed_at":null,"completed_by":null,"step_status":"pendiente","notes":null,"document_ids":[]},
    {"key":"observaciones","label":"Observaciones","completed":false,"completed_at":null,"completed_by":null,"step_status":"pendiente","notes":null,"document_ids":[]}
  ]'::jsonb,
  notes text,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  updated_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (project_id, year)
);

ALTER TABLE public.annual_declarations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org users see annual declarations" ON public.annual_declarations
  FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

CREATE POLICY "Org users create annual declarations" ON public.annual_declarations
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = get_user_org_id(auth.uid()));

CREATE POLICY "Org users update annual declarations" ON public.annual_declarations
  FOR UPDATE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

CREATE POLICY "Admin/manager delete annual declarations" ON public.annual_declarations
  FOR DELETE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));
