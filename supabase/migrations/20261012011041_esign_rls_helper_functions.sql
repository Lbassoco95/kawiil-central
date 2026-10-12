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
