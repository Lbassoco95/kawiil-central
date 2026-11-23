-- Compatibilidad con "equipo de apoyo" de las tareas de actividad (task_assignees, PR #589).
-- La política de tareas de 20261123050000 dejaba ver una tarea de actividad solo a quien tiene
-- assigned_to, a quien la creó y a quienes administran la actividad; el equipo de apoyo (task_assignees)
-- quedaba sin acceso. Ahora quien figura en task_assignees de esa tarea también la ve y la actualiza.
-- Los kawiilers que no administran ni están asignados siguen sin ver tareas de actividad.

CREATE OR REPLACE FUNCTION public.is_task_member(_task_id uuid)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (SELECT 1 FROM public.task_assignees WHERE task_id = _task_id AND user_id = auth.uid());
$$;
REVOKE ALL ON FUNCTION public.is_task_member(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_task_member(uuid) TO authenticated, service_role;

DROP POLICY IF EXISTS "Org users see tasks" ON public.tasks;
CREATE POLICY "Org users see tasks" ON public.tasks FOR SELECT TO authenticated
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    AND (activity_id IS NULL OR assigned_to = auth.uid() OR created_by = auth.uid()
         OR public.is_task_member(id) OR public.can_manage_activity(activity_id))
  );
DROP POLICY IF EXISTS "Org users update tasks" ON public.tasks;
CREATE POLICY "Org users update tasks" ON public.tasks FOR UPDATE TO authenticated
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    AND (activity_id IS NULL OR assigned_to = auth.uid() OR created_by = auth.uid()
         OR public.is_task_member(id) OR public.can_manage_activity(activity_id))
  )
  WITH CHECK (
    organization_id = public.get_user_org_id(auth.uid())
    AND (activity_id IS NULL OR assigned_to = auth.uid() OR public.is_task_member(id) OR public.can_manage_activity(activity_id))
  );
