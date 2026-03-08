
-- Fix search_path on all SECURITY DEFINER functions to include pg_temp for hijack prevention

ALTER FUNCTION public.has_role(uuid, app_role)
  SET search_path = pg_temp, public;

ALTER FUNCTION public.is_admin_or_manager(uuid)
  SET search_path = pg_temp, public;

ALTER FUNCTION public.get_user_org_id(uuid)
  SET search_path = pg_temp, public;

ALTER FUNCTION public.is_project_member(uuid, uuid)
  SET search_path = pg_temp, public;

ALTER FUNCTION public.handle_new_user()
  SET search_path = pg_temp, public;

-- Revoke public execution and grant only to authenticated
REVOKE ALL ON FUNCTION public.has_role(uuid, app_role) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO authenticated;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, app_role) TO service_role;

REVOKE ALL ON FUNCTION public.is_admin_or_manager(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_admin_or_manager(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_admin_or_manager(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.get_user_org_id(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_user_org_id(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_user_org_id(uuid) TO service_role;

REVOKE ALL ON FUNCTION public.is_project_member(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_project_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_project_member(uuid, uuid) TO service_role;
