-- Corrige "infinite recursion detected in policy" en esign_signers / esign_requests:
-- la política de cada tabla consultaba a la otra. Se rompe el ciclo con funciones
-- SECURITY DEFINER (leen sin pasar por RLS). Idempotente: ya aplicada en producción.

CREATE OR REPLACE FUNCTION public.esign_is_signer(_request_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.esign_signers s
    WHERE s.request_id = _request_id AND s.user_id = _user_id
  )
$$;

CREATE OR REPLACE FUNCTION public.esign_can_manage_request(_request_id uuid, _user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.esign_requests r
    WHERE r.id = _request_id
      AND (r.created_by = _user_id OR public.is_admin_or_manager(_user_id))
  )
$$;

REVOKE EXECUTE ON FUNCTION public.esign_is_signer(uuid, uuid) FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.esign_can_manage_request(uuid, uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.esign_is_signer(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.esign_can_manage_request(uuid, uuid) TO authenticated;

ALTER POLICY "Esign requests visible" ON public.esign_requests
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    AND (
      created_by = auth.uid()
      OR public.is_admin_or_manager(auth.uid())
      OR public.esign_is_signer(id, auth.uid())
    )
  );

ALTER POLICY "Esign signers visible" ON public.esign_signers
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    AND (
      user_id = auth.uid()
      OR public.esign_can_manage_request(request_id, auth.uid())
    )
  );
