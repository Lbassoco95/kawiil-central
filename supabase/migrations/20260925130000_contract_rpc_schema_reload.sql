-- =============================================================================
-- Softlanding start: schema cache PostgREST + guard de plantilla faltante
-- =============================================================================
-- Prod sintió POST /rpc/start_contract_engagement → 404 PGRST202 aunque la
-- función existía en Postgres: caché de PostgREST desactualizada tras apply_migration.
-- Además, si falta el seed softlanding_marco_a1, el INSERT con v_tpl.id NULL
-- explotaba como excepción opaca; ahora devolvemos jsonb { ok:false, error }.
-- =============================================================================

CREATE OR REPLACE FUNCTION public.start_contract_engagement(
  p_lead_id uuid,
  p_package_kind public.contract_package_kind
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_lead record;
  v_stage_slug text;
  v_stage_name text;
  v_stage_terminal boolean;
  v_token text;
  v_hash text;
  v_eng public.contract_engagements%ROWTYPE;
  v_services public.service_area[];
  v_tpl record;
  v_item_id uuid;
  v_existing uuid;
BEGIN
  v_org := public.user_pipeline_org_id();
  IF v_org IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_organization');
  END IF;

  SELECT l.* INTO v_lead
  FROM public.leads l
  WHERE l.id = p_lead_id AND l.organization_id = v_org;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'lead_not_found');
  END IF;

  SELECT s.slug, s.name, s.is_terminal
    INTO v_stage_slug, v_stage_name, v_stage_terminal
  FROM public.pipeline_stages s
  WHERE s.id = v_lead.stage_id;

  IF NOT public.pipeline_stage_is_won(v_stage_slug, v_stage_name, v_stage_terminal) THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'lead_not_converted',
      'stage', v_stage_slug,
      'stage_name', v_stage_name
    );
  END IF;

  SELECT e.id INTO v_existing
  FROM public.contract_engagements e
  WHERE e.lead_id = p_lead_id
    AND e.package_kind = p_package_kind
    AND e.origin = 'onboarding'
    AND e.status NOT IN ('void', 'expired')
  LIMIT 1;

  IF v_existing IS NOT NULL THEN
    SELECT * INTO v_eng FROM public.contract_engagements WHERE id = v_existing;
    v_token := encode(gen_random_bytes(24), 'hex');
    v_hash := public.contract_hash_token(v_token);
    UPDATE public.contract_engagements SET
      client_access_token_hash = v_hash,
      client_access_token_hint = right(v_token, 6),
      client_access_expires_at = now() + interval '30 days',
      updated_at = now()
    WHERE id = v_existing;
    RETURN jsonb_build_object(
      'ok', true,
      'engagement_id', v_existing,
      'access_token', v_token,
      'package_kind', p_package_kind,
      'reused', true,
      'expires_at', (now() + interval '30 days')
    );
  END IF;

  -- Resolver plantilla ANTES del insert para no dejar engagements huérfanos
  IF p_package_kind = 'backoffice_pm' THEN
    SELECT id, version INTO v_tpl FROM public.contract_templates
    WHERE package_kind = 'backoffice_pm' AND template_key = 'backoffice_pm_caratula'
      AND is_active AND organization_id IS NULL
    ORDER BY version DESC LIMIT 1;
  ELSE
    SELECT id, version INTO v_tpl FROM public.contract_templates
    WHERE package_kind = 'softlanding' AND template_key = 'softlanding_marco_a1'
      AND is_active AND organization_id IS NULL
    ORDER BY version DESC LIMIT 1;
  END IF;

  IF v_tpl.id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'template_missing', 'package_kind', p_package_kind);
  END IF;

  v_token := encode(gen_random_bytes(24), 'hex');
  v_hash := public.contract_hash_token(v_token);

  BEGIN
    v_services := COALESCE(v_lead.service_types, '{}'::public.service_area[]);
  EXCEPTION WHEN undefined_column THEN
    v_services := '{}'::public.service_area[];
  END;
  IF v_services IS NULL OR cardinality(v_services) = 0 THEN
    IF p_package_kind = 'backoffice_pm' THEN
      v_services := ARRAY['legal','contabilidad']::public.service_area[];
    ELSIF p_package_kind = 'softlanding' THEN
      v_services := ARRAY['softlanding']::public.service_area[];
    END IF;
  END IF;

  INSERT INTO public.contract_engagements (
    organization_id, lead_id, origin, package_kind, status, service_types,
    answers, client_access_token_hash, client_access_token_hint, client_access_expires_at,
    created_by, answers_updated_by_role
  ) VALUES (
    v_org, p_lead_id, 'onboarding', p_package_kind, 'onboarding', v_services,
    jsonb_build_object(
      'client.legal_name', COALESCE(v_lead.billing_legal_name, v_lead.company_name, v_lead.full_name),
      'client.contact_name', v_lead.full_name,
      'client.email', v_lead.email,
      'client.phone', v_lead.phone,
      'client.rfc', v_lead.billing_rfc,
      'firma.lugar', 'Ciudad de México, México'
    ),
    v_hash, right(v_token, 6), now() + interval '30 days',
    auth.uid(), 'staff'
  )
  RETURNING * INTO v_eng;

  IF p_package_kind = 'backoffice_pm' THEN
    INSERT INTO public.contract_package_items (
      engagement_id, organization_id, item_key, template_id, template_version, status, sort_order
    ) VALUES (
      v_eng.id, v_org, 'caratula_a1', v_tpl.id, v_tpl.version, 'capturing', 10
    ) RETURNING id INTO v_item_id;

    INSERT INTO public.contract_package_items (
      engagement_id, organization_id, item_key, status, sort_order, metadata
    ) VALUES (
      v_eng.id, v_org, 'anexo_b_os', 'pending', 90, '{"deferred":true,"note":"Orden de Servicio bajo demanda"}'::jsonb
    );
  ELSE
    INSERT INTO public.contract_package_items (
      engagement_id, organization_id, item_key, template_id, template_version, status, sort_order
    ) VALUES (
      v_eng.id, v_org, 'marco', v_tpl.id, v_tpl.version, 'capturing', 10
    );

    INSERT INTO public.contract_package_items (
      engagement_id, organization_id, item_key, status, sort_order, metadata
    ) VALUES
      (v_eng.id, v_org, 'caratula_a2', 'pending', 20, '{"deferred":true,"hito":"constitucion"}'::jsonb),
      (v_eng.id, v_org, 'anexo_b', 'pending', 30, '{"deferred":true,"hito":"efirma"}'::jsonb),
      (v_eng.id, v_org, 'anexo_c', 'pending', 40, '{"deferred":true,"hito":"imss"}'::jsonb),
      (v_eng.id, v_org, 'anexo_d', 'pending', 50, '{"deferred":true,"hito":"os"}'::jsonb);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'engagement_id', v_eng.id,
    'access_token', v_token,
    'package_kind', p_package_kind,
    'reused', false,
    'expires_at', v_eng.client_access_expires_at
  );
END;
$$;

COMMENT ON FUNCTION public.start_contract_engagement(uuid, public.contract_package_kind) IS
  'Inicia engagement de contrato si el lead está en etapa ganada (Cerrado/convertido/cerrado).';

GRANT EXECUTE ON FUNCTION public.start_contract_engagement(uuid, public.contract_package_kind) TO authenticated;
GRANT EXECUTE ON FUNCTION public.start_contract_engagement(uuid, public.contract_package_kind) TO service_role;

-- Fuerza a PostgREST a redescubrir RPCs/enums tras migraciones MCP/SQL Editor
NOTIFY pgrst, 'reload schema';
