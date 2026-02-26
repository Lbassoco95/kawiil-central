
-- Fix infinite recursion: projects policy references project_members which references projects
-- Solution: Use a security definer function to check project membership

CREATE OR REPLACE FUNCTION public.is_project_member(_user_id uuid, _project_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = 'public'
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.project_members WHERE user_id = _user_id AND project_id = _project_id
  )
$$;

-- Drop and recreate projects SELECT policy to avoid recursion
DROP POLICY IF EXISTS "Org users see projects" ON public.projects;
CREATE POLICY "Org users see projects"
  ON public.projects FOR SELECT
  USING (
    organization_id = get_user_org_id(auth.uid())
    AND (
      is_admin_or_manager(auth.uid())
      OR responsible_user_id = auth.uid()
      OR is_project_member(auth.uid(), id)
    )
  );

-- Drop and recreate tasks SELECT policy to avoid recursion through project_members
DROP POLICY IF EXISTS "Org users see tasks" ON public.tasks;
CREATE POLICY "Org users see tasks"
  ON public.tasks FOR SELECT
  USING (
    organization_id = get_user_org_id(auth.uid())
    AND (
      is_admin_or_manager(auth.uid())
      OR assigned_to = auth.uid()
      OR (project_id IS NOT NULL AND is_project_member(auth.uid(), project_id))
    )
  );

-- Fix project_members SELECT policy too
DROP POLICY IF EXISTS "Org users see project members" ON public.project_members;
CREATE POLICY "Org users see project members"
  ON public.project_members FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.projects p
      WHERE p.id = project_id
      AND p.organization_id = get_user_org_id(auth.uid())
    )
  );
