-- Admin/manager puede gestionar filas de finance_income_viewers en su organización.
DROP POLICY IF EXISTS "Users see own finance income viewer row" ON public.finance_income_viewers;

CREATE POLICY "finance_income_viewers_select"
  ON public.finance_income_viewers
  FOR SELECT
  TO authenticated
  USING (
    user_id = auth.uid()
    OR (
      organization_id = get_user_org_id(auth.uid())
      AND is_admin_or_manager(auth.uid())
    )
  );

CREATE POLICY "finance_income_viewers_insert_admin"
  ON public.finance_income_viewers
  FOR INSERT
  TO authenticated
  WITH CHECK (
    is_admin_or_manager(auth.uid())
    AND organization_id = get_user_org_id(auth.uid())
    AND get_user_org_id(user_id) = organization_id
  );

CREATE POLICY "finance_income_viewers_delete_admin"
  ON public.finance_income_viewers
  FOR DELETE
  TO authenticated
  USING (
    is_admin_or_manager(auth.uid())
    AND organization_id = get_user_org_id(auth.uid())
  );

-- Acceso inicial ingresos Savio (@kawiil.mx).
INSERT INTO public.finance_income_viewers (organization_id, user_id)
SELECT get_user_org_id(u.id), u.id
FROM auth.users u
WHERE lower(u.email) IN (
  'leo.bassoco@kawiil.mx',
  'vturcott@kawiil.mx',
  'jturcott@kawiil.mx'
)
ON CONFLICT (organization_id, user_id) DO NOTHING;
