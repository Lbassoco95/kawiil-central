CREATE POLICY "Admin/manager update profiles"
ON public.profiles
FOR UPDATE
TO authenticated
USING (
  organization_id = get_user_org_id(auth.uid())
  AND is_admin_or_manager(auth.uid())
);