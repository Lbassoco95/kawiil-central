-- Savio: lectura de eventos webhook para quien tiene acceso al módulo Finanzas (misma lógica que has_finance_access en app).
CREATE OR REPLACE FUNCTION public.has_finance_access(_user_id uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_celulas uc
    JOIN public.celulas c ON c.id = uc.celula_id
    WHERE uc.user_id = _user_id
      AND c.slug IN ('finanzas', 'administracion', 'administraci_n')
  )
  OR is_admin_or_manager(_user_id);
$$;

DROP POLICY IF EXISTS "Admin/manager see savio events" ON public.savio_webhook_events;

CREATE POLICY "Finance access see savio events"
  ON public.savio_webhook_events
  FOR SELECT
  TO authenticated
  USING (
    organization_id = get_user_org_id(auth.uid())
    AND has_finance_access(auth.uid())
  );
