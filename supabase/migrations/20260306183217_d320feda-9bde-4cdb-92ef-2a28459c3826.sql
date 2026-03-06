DROP POLICY "Admin/manager create projects" ON public.projects;
CREATE POLICY "Org users create projects" ON public.projects
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = get_user_org_id(auth.uid()));