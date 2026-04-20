-- Tasks/Projects v2.5 redesign: estimated hours, dependencies, project team roles.
-- Idempotent: usa IF NOT EXISTS y ALTER ... ADD COLUMN IF NOT EXISTS.

------------------------------------------------------------------------
-- 1) Tareas: tiempo estimado en horas (mostrado en sidebar "Tiempo")
------------------------------------------------------------------------
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS estimated_hours numeric(6,2);

COMMENT ON COLUMN public.tasks.estimated_hours IS
  'Horas estimadas para completar la tarea. Comparado contra time_spent_seconds en la sidebar Tiempo del detalle.';

------------------------------------------------------------------------
-- 2) Dependencias entre tareas (depende_de / bloquea)
--    Modelo: task_id "depende de" depends_on_task_id (i.e., depends_on bloquea a task_id).
------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.task_dependencies (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  depends_on_task_id uuid NOT NULL REFERENCES public.tasks(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'blocks' CHECK (kind IN ('blocks','relates')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (task_id, depends_on_task_id),
  CHECK (task_id <> depends_on_task_id)
);

CREATE INDEX IF NOT EXISTS task_dependencies_task_idx
  ON public.task_dependencies(task_id);
CREATE INDEX IF NOT EXISTS task_dependencies_depends_on_idx
  ON public.task_dependencies(depends_on_task_id);
CREATE INDEX IF NOT EXISTS task_dependencies_org_idx
  ON public.task_dependencies(organization_id);

ALTER TABLE public.task_dependencies ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org users see task dependencies" ON public.task_dependencies;
CREATE POLICY "Org users see task dependencies" ON public.task_dependencies
  FOR SELECT USING (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Org users insert task dependencies" ON public.task_dependencies;
CREATE POLICY "Org users insert task dependencies" ON public.task_dependencies
  FOR INSERT WITH CHECK (
    organization_id = get_user_org_id(auth.uid())
    AND task_id IN (
      SELECT t.id FROM public.tasks t WHERE t.organization_id = get_user_org_id(auth.uid())
    )
    AND depends_on_task_id IN (
      SELECT t.id FROM public.tasks t WHERE t.organization_id = get_user_org_id(auth.uid())
    )
  );

DROP POLICY IF EXISTS "Org users delete task dependencies" ON public.task_dependencies;
CREATE POLICY "Org users delete task dependencies" ON public.task_dependencies
  FOR DELETE USING (organization_id = get_user_org_id(auth.uid()));

COMMENT ON TABLE public.task_dependencies IS
  'Dependencias entre tareas: task_id depende de depends_on_task_id (i.e., depends_on bloquea task_id).';

------------------------------------------------------------------------
-- 3) Equipo del proyecto con rol explícito (Lead/Senior/Revisión/Junior/Colaborador)
------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.project_team (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'colaborador'
    CHECK (role IN ('lead','senior','revision','junior','colaborador')),
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (project_id, user_id)
);

CREATE INDEX IF NOT EXISTS project_team_project_idx
  ON public.project_team(project_id);
CREATE INDEX IF NOT EXISTS project_team_user_idx
  ON public.project_team(user_id);
CREATE INDEX IF NOT EXISTS project_team_org_idx
  ON public.project_team(organization_id);

ALTER TABLE public.project_team ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org users see project team" ON public.project_team;
CREATE POLICY "Org users see project team" ON public.project_team
  FOR SELECT USING (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Org users insert project team" ON public.project_team;
CREATE POLICY "Org users insert project team" ON public.project_team
  FOR INSERT WITH CHECK (
    organization_id = get_user_org_id(auth.uid())
    AND project_id IN (
      SELECT p.id FROM public.projects p WHERE p.organization_id = get_user_org_id(auth.uid())
    )
  );

DROP POLICY IF EXISTS "Org users update project team" ON public.project_team;
CREATE POLICY "Org users update project team" ON public.project_team
  FOR UPDATE USING (organization_id = get_user_org_id(auth.uid()))
  WITH CHECK (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "Org users delete project team" ON public.project_team;
CREATE POLICY "Org users delete project team" ON public.project_team
  FOR DELETE USING (organization_id = get_user_org_id(auth.uid()));

COMMENT ON TABLE public.project_team IS
  'Miembros explícitos del equipo de un proyecto con rol (lead/senior/revision/junior/colaborador). Renderizado en sidebar Equipo del detalle.';
