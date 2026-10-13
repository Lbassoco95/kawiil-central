-- Espacio de trabajo por juicio: etapas, actuaciones (bitácora) y tareas vinculadas.

ALTER TABLE public.project_lawsuits
  ADD COLUMN IF NOT EXISTS stages jsonb NOT NULL DEFAULT '[]'::jsonb;

CREATE TABLE IF NOT EXISTS public.project_lawsuit_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  lawsuit_id uuid NOT NULL REFERENCES public.project_lawsuits(id) ON DELETE CASCADE,
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  content text NOT NULL,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_lawsuit_entries_lawsuit_idx
  ON public.project_lawsuit_entries (lawsuit_id, entry_date DESC);

ALTER TABLE public.project_lawsuit_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_lawsuit_entries_select ON public.project_lawsuit_entries;
CREATE POLICY project_lawsuit_entries_select ON public.project_lawsuit_entries FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));
DROP POLICY IF EXISTS project_lawsuit_entries_insert ON public.project_lawsuit_entries;
CREATE POLICY project_lawsuit_entries_insert ON public.project_lawsuit_entries FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));
DROP POLICY IF EXISTS project_lawsuit_entries_update ON public.project_lawsuit_entries;
CREATE POLICY project_lawsuit_entries_update ON public.project_lawsuit_entries FOR UPDATE TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));
DROP POLICY IF EXISTS project_lawsuit_entries_delete ON public.project_lawsuit_entries;
CREATE POLICY project_lawsuit_entries_delete ON public.project_lawsuit_entries FOR DELETE TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));

-- Tareas vinculadas a un juicio concreto (además del proyecto).
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS lawsuit_id uuid REFERENCES public.project_lawsuits(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS tasks_lawsuit_idx ON public.tasks (lawsuit_id) WHERE lawsuit_id IS NOT NULL;
