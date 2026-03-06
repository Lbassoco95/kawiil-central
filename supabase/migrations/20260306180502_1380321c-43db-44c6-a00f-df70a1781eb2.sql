
-- 1. Allow ALL org users to see clients (not just admin/manager/responsible)
DROP POLICY IF EXISTS "Org users see clients" ON public.clients;
CREATE POLICY "Org users see clients"
  ON public.clients FOR SELECT
  TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

-- 2. Allow ALL org users to see projects (not just admin/manager/responsible/member)
DROP POLICY IF EXISTS "Org users see projects" ON public.projects;
CREATE POLICY "Org users see projects"
  ON public.projects FOR SELECT
  TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

-- 3. Allow ALL org users to see tasks (not just admin/manager/assigned)
DROP POLICY IF EXISTS "Org users see tasks" ON public.tasks;
CREATE POLICY "Org users see tasks"
  ON public.tasks FOR SELECT
  TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));
