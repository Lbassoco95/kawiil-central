-- Backfill module rows for all transformadores (matches frontend MODULE_KEYS).
INSERT INTO public.user_module_permissions (user_id, organization_id, module_key, enabled)
SELECT ur.user_id, p.organization_id, m.key, true
FROM public.user_roles ur
JOIN public.profiles p ON p.user_id = ur.user_id
CROSS JOIN (
  VALUES
    ('ai'),
    ('conocimiento'),
    ('finanzas'),
    ('calendario'),
    ('correo'),
    ('documentos'),
    ('hub'),
    ('admin'),
    ('pipeline')
) AS m(key)
WHERE ur.role = 'transformador'
ON CONFLICT (user_id, module_key) DO NOTHING;

-- Steward: when organizations.settings.permissions_steward_user_id is set (uuid string),
-- only that transformador may change user_module_permissions or org settings from the app.
-- Emergency: set permissions_steward_user_id to null in SQL to restore "any transformador".
CREATE OR REPLACE FUNCTION public.can_edit_org_permission_settings(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.organizations o ON o.id = p.organization_id
    WHERE p.user_id = _user_id
      AND public.has_role(_user_id, 'transformador'::public.app_role)
      AND (
        o.settings->>'permissions_steward_user_id' IS NULL
        OR btrim(o.settings->>'permissions_steward_user_id') = ''
        OR (NULLIF(btrim(o.settings->>'permissions_steward_user_id'), ''))::uuid = _user_id
      )
  );
$$;

REVOKE ALL ON FUNCTION public.can_edit_org_permission_settings(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_edit_org_permission_settings(uuid) TO authenticated;

DROP POLICY IF EXISTS "Transformadores insert module permissions" ON public.user_module_permissions;
CREATE POLICY "Transformadores insert module permissions"
  ON public.user_module_permissions FOR INSERT
  WITH CHECK (
    organization_id IN (
      SELECT p.organization_id FROM public.profiles p WHERE p.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'transformador'
    )
    AND public.can_edit_org_permission_settings(auth.uid())
  );

DROP POLICY IF EXISTS "Transformadores update module permissions" ON public.user_module_permissions;
CREATE POLICY "Transformadores update module permissions"
  ON public.user_module_permissions FOR UPDATE
  USING (
    organization_id IN (
      SELECT p.organization_id FROM public.profiles p WHERE p.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'transformador'
    )
    AND public.can_edit_org_permission_settings(auth.uid())
  );

DROP POLICY IF EXISTS "Transformadores delete module permissions" ON public.user_module_permissions;
CREATE POLICY "Transformadores delete module permissions"
  ON public.user_module_permissions FOR DELETE
  USING (
    organization_id IN (
      SELECT p.organization_id FROM public.profiles p WHERE p.user_id = auth.uid()
    )
    AND EXISTS (
      SELECT 1 FROM public.user_roles ur
      WHERE ur.user_id = auth.uid() AND ur.role = 'transformador'
    )
    AND public.can_edit_org_permission_settings(auth.uid())
  );

DROP POLICY IF EXISTS "Transformadores update org settings" ON public.organizations;
CREATE POLICY "Transformadores update org settings"
  ON public.organizations
  FOR UPDATE
  TO authenticated
  USING (
    id = public.get_user_org_id(auth.uid())
    AND public.has_role(auth.uid(), 'transformador'::public.app_role)
    AND public.can_edit_org_permission_settings(auth.uid())
  )
  WITH CHECK (
    id = public.get_user_org_id(auth.uid())
    AND public.has_role(auth.uid(), 'transformador'::public.app_role)
    AND public.can_edit_org_permission_settings(auth.uid())
  );

-- Set default steward to leo.bassoco@kawiil.mx when that user exists in auth.users.
UPDATE public.organizations o
SET settings = o.settings || jsonb_build_object(
  'permissions_steward_user_id',
  (SELECT au.id::text FROM auth.users au WHERE lower(au.email) = 'leo.bassoco@kawiil.mx' LIMIT 1)
)
WHERE (
    (o.settings->>'permissions_steward_user_id') IS NULL
    OR btrim(o.settings->>'permissions_steward_user_id') = ''
  )
  AND EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN auth.users au ON au.id = p.user_id
    WHERE p.organization_id = o.id
      AND lower(au.email) = 'leo.bassoco@kawiil.mx'
  );

COMMENT ON FUNCTION public.can_edit_org_permission_settings(uuid) IS
  'Transformadores may edit org permission settings and user_module_permissions when settings.permissions_steward_user_id is null/empty or equals the caller.';
