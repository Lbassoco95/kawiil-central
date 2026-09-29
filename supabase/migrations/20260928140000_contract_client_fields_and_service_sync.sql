CREATE OR REPLACE FUNCTION public.contract_client_patch(
  p_token text,
  p_answers jsonb,
  p_role text DEFAULT 'client'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_eng public.contract_engagements%ROWTYPE;
  v_hash text;
  v_client_answers jsonb;
  v_merged jsonb;
  v_complete boolean;
  v_new_status public.contract_engagement_status;
BEGIN
  IF NULLIF(trim(COALESCE(p_token, '')), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_token');
  END IF;
  v_hash := public.contract_hash_token(p_token);

  SELECT * INTO v_eng
  FROM public.contract_engagements e
  WHERE e.client_access_token_hash = v_hash
    AND e.status NOT IN ('void', 'expired', 'signed_confirmed')
    AND (e.client_access_expires_at IS NULL OR e.client_access_expires_at > now())
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_or_expired_token');
  END IF;

  v_client_answers := COALESCE(p_answers, '{}'::jsonb) - ARRAY[
    'plan_id',
    'plan_name',
    'list_price',
    'discount_amount',
    'discount_label',
    'net_price',
    'currency',
    'vat_included',
    'payment_method',
    'authorized_persons',
    'services.labeled',
    'firma.fecha',
    'firma.lugar'
  ];
  v_merged := COALESCE(v_eng.answers, '{}'::jsonb) || v_client_answers;
  v_complete := public.contract_is_required_complete(v_merged, v_eng.package_kind);
  v_new_status := CASE
    WHEN v_eng.status IN ('document_draft', 'document_ready') THEN v_eng.status
    WHEN v_complete THEN 'ready_to_generate'::public.contract_engagement_status
    ELSE 'onboarding'::public.contract_engagement_status
  END;

  UPDATE public.contract_engagements SET
    answers = v_merged,
    answers_updated_at = now(),
    answers_updated_by = auth.uid(),
    answers_updated_by_role = 'client',
    status = v_new_status,
    updated_at = now()
  WHERE id = v_eng.id
  RETURNING * INTO v_eng;

  RETURN jsonb_build_object(
    'ok', true,
    'answers', v_eng.answers,
    'status', v_eng.status,
    'answers_updated_at', v_eng.answers_updated_at,
    'answers_updated_by_role', v_eng.answers_updated_by_role
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_unsigned_contract_services()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.service_types IS DISTINCT FROM OLD.service_types THEN
    UPDATE public.contract_engagements
    SET service_types = COALESCE(NEW.service_types, '{}'::public.service_area[]),
        updated_at = now()
    WHERE lead_id = NEW.id
      AND status NOT IN ('signed_confirmed', 'void', 'expired');
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS sync_unsigned_contract_services_from_lead ON public.leads;
CREATE TRIGGER sync_unsigned_contract_services_from_lead
AFTER UPDATE OF service_types ON public.leads
FOR EACH ROW
EXECUTE FUNCTION public.sync_unsigned_contract_services();

CREATE OR REPLACE FUNCTION public.contract_is_required_complete(
  p_answers jsonb,
  p_package_kind public.contract_package_kind
)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SET search_path = public
AS $$
DECLARE
  a jsonb := COALESCE(p_answers, '{}'::jsonb);
BEGIN
  IF NULLIF(trim(COALESCE(a->>'client.legal_name', a->>'legal_name', '')), '') IS NULL THEN
    RETURN false;
  END IF;
  IF NULLIF(trim(COALESCE(a->>'client.rfc', a->>'rfc', '')), '') IS NULL THEN
    RETURN false;
  END IF;
  IF p_package_kind = 'backoffice_pm'
     AND (a->>'net_price') IS NULL
     AND (a->'billing'->>'net_price') IS NULL THEN
    RETURN false;
  END IF;
  IF p_package_kind = 'softlanding'
     AND NULLIF(trim(COALESCE(a->>'sociedad.denominacion_1', '')), '') IS NULL THEN
    RETURN false;
  END IF;
  RETURN true;
END;
$$;

GRANT EXECUTE ON FUNCTION public.contract_client_patch(text, jsonb, text) TO anon, authenticated;
NOTIFY pgrst, 'reload schema';
