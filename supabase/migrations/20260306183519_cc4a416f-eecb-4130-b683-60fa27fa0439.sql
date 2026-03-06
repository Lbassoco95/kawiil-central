-- PROJECTS: Allow all org users to UPDATE (not just admin/manager)
DROP POLICY "Admin/manager update projects" ON public.projects;
CREATE POLICY "Org users update projects" ON public.projects
  FOR UPDATE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

-- PROJECTS: DELETE stays admin/manager only (already correct)

-- TASKS: Allow all org users to UPDATE
DROP POLICY "Org users update tasks" ON public.tasks;
CREATE POLICY "Org users update tasks" ON public.tasks
  FOR UPDATE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

-- TASKS: Restrict DELETE to admin/manager only
DROP POLICY "Org users delete tasks" ON public.tasks;
CREATE POLICY "Admin/manager delete tasks" ON public.tasks
  FOR DELETE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()) AND is_admin_or_manager(auth.uid()));

-- CLIENTS: Allow all org users to UPDATE (so staff can add info)
DROP POLICY "Admin/manager update clients" ON public.clients;
CREATE POLICY "Org users update clients" ON public.clients
  FOR UPDATE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

-- CLIENTS: DELETE stays admin/manager only (already correct)