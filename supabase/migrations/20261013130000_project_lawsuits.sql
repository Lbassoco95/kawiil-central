-- Control de juicios: un proyecto del área "juicios" puede llevar N juicios
-- (expedientes), cada uno con su propio estatus, juzgado, etapa y fechas clave.

CREATE TABLE IF NOT EXISTS public.project_lawsuits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  name text NOT NULL,
  lawsuit_type text,
  case_number text,
  court text,
  plaintiff text,
  defendant text,
  status text NOT NULL DEFAULT 'en_tramite'
    CHECK (status IN ('en_tramite', 'en_apelacion', 'amparo', 'suspendido', 'concluido', 'archivado')),
  current_stage text,
  filed_date date,
  next_hearing_date date,
  next_deadline_date date,
  next_deadline_note text,
  notes text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_lawsuits_project_idx ON public.project_lawsuits (project_id);
CREATE INDEX IF NOT EXISTS project_lawsuits_org_idx ON public.project_lawsuits (organization_id);

DROP TRIGGER IF EXISTS project_lawsuits_updated_at ON public.project_lawsuits;
CREATE TRIGGER project_lawsuits_updated_at
  BEFORE UPDATE ON public.project_lawsuits
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.project_lawsuits ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_lawsuits_select ON public.project_lawsuits;
CREATE POLICY project_lawsuits_select ON public.project_lawsuits FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));
DROP POLICY IF EXISTS project_lawsuits_insert ON public.project_lawsuits;
CREATE POLICY project_lawsuits_insert ON public.project_lawsuits FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));
DROP POLICY IF EXISTS project_lawsuits_update ON public.project_lawsuits;
CREATE POLICY project_lawsuits_update ON public.project_lawsuits FOR UPDATE TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));
DROP POLICY IF EXISTS project_lawsuits_delete ON public.project_lawsuits;
CREATE POLICY project_lawsuits_delete ON public.project_lawsuits FOR DELETE TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));
