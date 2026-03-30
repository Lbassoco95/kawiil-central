-- Fix infinite recursion: policies on ai_project_members and ai_projects referenced each other via RLS.
-- SECURITY DEFINER helpers read membership without re-entering RLS.

CREATE OR REPLACE FUNCTION public.ai_project_user_has_access(_ai_project_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.ai_projects ap
    WHERE ap.id = _ai_project_id AND ap.user_id = _user_id
  )
  OR EXISTS (
    SELECT 1 FROM public.ai_project_members m
    WHERE m.ai_project_id = _ai_project_id AND m.user_id = _user_id
  );
$$;

CREATE OR REPLACE FUNCTION public.ai_project_user_can_edit(_ai_project_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.ai_projects ap
    WHERE ap.id = _ai_project_id AND ap.user_id = _user_id
  )
  OR EXISTS (
    SELECT 1 FROM public.ai_project_members m
    WHERE m.ai_project_id = _ai_project_id
      AND m.user_id = _user_id
      AND m.role IN ('owner', 'editor')
  );
$$;

CREATE OR REPLACE FUNCTION public.ai_project_user_is_creator(_ai_project_id uuid, _user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.ai_projects ap
    WHERE ap.id = _ai_project_id AND ap.user_id = _user_id
  );
$$;

COMMENT ON FUNCTION public.ai_project_user_has_access(uuid, uuid) IS
    'RLS helper: project creator or any member row (bypasses RLS; avoids policy recursion).';
COMMENT ON FUNCTION public.ai_project_user_can_edit(uuid, uuid) IS
    'RLS helper: project creator or member with owner/editor role.';
COMMENT ON FUNCTION public.ai_project_user_is_creator(uuid, uuid) IS
    'RLS helper: user is ai_projects.user_id for this project (invite/remove members).';

REVOKE ALL ON FUNCTION public.ai_project_user_has_access(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ai_project_user_can_edit(uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ai_project_user_is_creator(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ai_project_user_has_access(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ai_project_user_can_edit(uuid, uuid) TO authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.ai_project_user_is_creator(uuid, uuid) TO authenticated, service_role;

-- ai_project_members
DROP POLICY IF EXISTS "Members can view project membership" ON public.ai_project_members;
CREATE POLICY "Members can view project membership"
    ON public.ai_project_members FOR SELECT TO authenticated
    USING (public.ai_project_user_has_access(ai_project_id, auth.uid()));

DROP POLICY IF EXISTS "Owners add project members" ON public.ai_project_members;
CREATE POLICY "Owners add project members"
    ON public.ai_project_members FOR INSERT TO authenticated
    WITH CHECK (public.ai_project_user_is_creator(ai_project_id, auth.uid()));

DROP POLICY IF EXISTS "Owners remove project members" ON public.ai_project_members;
CREATE POLICY "Owners remove project members"
    ON public.ai_project_members FOR DELETE TO authenticated
    USING (
        public.ai_project_user_is_creator(ai_project_id, auth.uid())
        OR ai_project_members.user_id = auth.uid()
    );

-- ai_projects (shared view for non-creators)
DROP POLICY IF EXISTS "Members can view shared AI projects" ON public.ai_projects;
CREATE POLICY "Members can view shared AI projects"
    ON public.ai_projects FOR SELECT TO authenticated
    USING (public.ai_project_user_has_access(id, auth.uid()));

-- ai_project_shared_memories
DROP POLICY IF EXISTS "Project members read shared memories" ON public.ai_project_shared_memories;
CREATE POLICY "Project members read shared memories"
    ON public.ai_project_shared_memories FOR SELECT TO authenticated
    USING (public.ai_project_user_has_access(ai_project_id, auth.uid()));

DROP POLICY IF EXISTS "Editors manage shared memories" ON public.ai_project_shared_memories;
CREATE POLICY "Editors manage shared memories"
    ON public.ai_project_shared_memories FOR ALL TO authenticated
    USING (public.ai_project_user_can_edit(ai_project_id, auth.uid()))
    WITH CHECK (public.ai_project_user_can_edit(ai_project_id, auth.uid()));

-- ai_project_documents
DROP POLICY IF EXISTS "Members read ai project documents" ON public.ai_project_documents;
CREATE POLICY "Members read ai project documents"
    ON public.ai_project_documents FOR SELECT TO authenticated
    USING (public.ai_project_user_has_access(ai_project_id, auth.uid()));

DROP POLICY IF EXISTS "Editors manage ai project documents" ON public.ai_project_documents;
CREATE POLICY "Editors manage ai project documents"
    ON public.ai_project_documents FOR INSERT TO authenticated
    WITH CHECK (public.ai_project_user_can_edit(ai_project_id, auth.uid()));

DROP POLICY IF EXISTS "Editors update delete ai project documents" ON public.ai_project_documents;
CREATE POLICY "Editors update delete ai project documents"
    ON public.ai_project_documents FOR UPDATE TO authenticated
    USING (public.ai_project_user_can_edit(ai_project_id, auth.uid()))
    WITH CHECK (public.ai_project_user_can_edit(ai_project_id, auth.uid()));

DROP POLICY IF EXISTS "Editors delete ai project documents" ON public.ai_project_documents;
CREATE POLICY "Editors delete ai project documents"
    ON public.ai_project_documents FOR DELETE TO authenticated
    USING (public.ai_project_user_can_edit(ai_project_id, auth.uid()));
