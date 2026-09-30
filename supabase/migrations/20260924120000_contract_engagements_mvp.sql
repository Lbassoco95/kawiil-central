-- =================================================================
-- MVP contratos: engagements + package_items + templates + catálogo
-- Decisiones D1–D12 (onboarding post-convertido, dual fill, firma externa)
-- =================================================================

CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ── Enums ──────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE public.contract_package_kind AS ENUM ('softlanding', 'backoffice_pm');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.contract_engagement_status AS ENUM (
    'awaiting_start',
    'onboarding',
    'ready_to_generate',
    'document_draft',
    'document_ready',
    'signed_confirmed',
    'void',
    'expired'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.contract_package_item_status AS ENUM (
    'pending',
    'capturing',
    'ready_to_generate',
    'issued',
    'signed_external',
    'void'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.contract_version_status AS ENUM (
    'draft',
    'ready',
    'signed_upload',
    'superseded'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE public.contract_engagement_origin AS ENUM ('onboarding', 'client_update');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── Catálogo de precios (D10) ──────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.pricing_catalog (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  package_kind public.contract_package_kind NOT NULL,
  plan_code text NOT NULL,
  plan_name text NOT NULL,
  list_price numeric(12,2) NOT NULL,
  currency text NOT NULL DEFAULT 'MXN',
  vat_included boolean NOT NULL DEFAULT false,
  max_operations integer,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS pricing_catalog_org_plan_uidx
  ON public.pricing_catalog (organization_id, package_kind, plan_code)
  WHERE organization_id IS NOT NULL;

COMMENT ON TABLE public.pricing_catalog IS
  'Precios de lista editables (Backoffice planes, fees Softlanding). Nunca hardcode en body legal (D10).';

-- Unique with NULL org: Postgres trata NULLs como distintos en UNIQUE estándar
CREATE UNIQUE INDEX IF NOT EXISTS pricing_catalog_global_plan_uidx
  ON public.pricing_catalog (package_kind, plan_code)
  WHERE organization_id IS NULL;

-- Seed global (organization_id NULL = defaults de producto)
INSERT INTO public.pricing_catalog (
  organization_id, package_kind, plan_code, plan_name, list_price, currency, vat_included, max_operations, sort_order, metadata
)
SELECT NULL, v.package_kind::public.contract_package_kind, v.plan_code, v.plan_name, v.list_price, v.currency, v.vat_included, v.max_operations, v.sort_order, v.metadata::jsonb
FROM (VALUES
  ('backoffice_pm', 'bo_01_arrancando', 'Plan 01 Arrancando', 5000, 'MXN', false, 50, 10, '{"ops_label":"hasta 50 operaciones"}'),
  ('backoffice_pm', 'bo_02_creciendo', 'Plan 02 Creciendo', 6500, 'MXN', false, 120, 20, '{"ops_label":"hasta 120 operaciones"}'),
  ('backoffice_pm', 'bo_03_pyme', 'Plan 03 PYME', 9200, 'MXN', false, 220, 30, '{"ops_label":"hasta 220 operaciones"}'),
  ('softlanding', 'sl_constitucion_mxn', 'Honorario constitución Softlanding', 32000, 'MXN', true, NULL::integer, 10, '{"fee_kind":"constitucion"}'),
  ('softlanding', 'sl_recurrente_usd', 'Honorario recurrente Softlanding (6 meses)', 250, 'USD', false, NULL::integer, 20, '{"fee_kind":"recurrente","forced_months":6}')
) AS v(package_kind, plan_code, plan_name, list_price, currency, vat_included, max_operations, sort_order, metadata)
WHERE NOT EXISTS (
  SELECT 1 FROM public.pricing_catalog p
  WHERE p.organization_id IS NULL
    AND p.package_kind = v.package_kind::public.contract_package_kind
    AND p.plan_code = v.plan_code
);

-- ── Plantillas ─────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.contract_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid REFERENCES public.organizations(id) ON DELETE CASCADE,
  package_kind public.contract_package_kind NOT NULL,
  template_key text NOT NULL,
  name text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  body_html text NOT NULL DEFAULT '',
  body_format text NOT NULL DEFAULT 'html',
  sign_policy text NOT NULL DEFAULT 'with_marco',
  package_item_key text NOT NULL DEFAULT 'marco',
  is_active boolean NOT NULL DEFAULT true,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS contract_templates_global_key_uidx
  ON public.contract_templates (package_kind, template_key, version)
  WHERE organization_id IS NULL;

CREATE TABLE IF NOT EXISTS public.contract_template_fields (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  template_id uuid NOT NULL REFERENCES public.contract_templates(id) ON DELETE CASCADE,
  field_key text NOT NULL,
  label text NOT NULL,
  field_type text NOT NULL DEFAULT 'text',
  required boolean NOT NULL DEFAULT false,
  editable_by text[] NOT NULL DEFAULT ARRAY['client','staff'],
  source_binding text,
  fallback_bindings text[] DEFAULT '{}',
  placeholder_in_body text NOT NULL,
  package_item_key text,
  default_value text,
  sort_order integer NOT NULL DEFAULT 0,
  help_text text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  UNIQUE (template_id, field_key)
);

-- ── Engagements ────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.contract_engagements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id uuid REFERENCES public.leads(id) ON DELETE SET NULL,
  client_id uuid REFERENCES public.clients(id) ON DELETE SET NULL,
  origin public.contract_engagement_origin NOT NULL DEFAULT 'onboarding',
  package_kind public.contract_package_kind NOT NULL,
  status public.contract_engagement_status NOT NULL DEFAULT 'onboarding',
  service_types public.service_area[] NOT NULL DEFAULT '{}',
  answers jsonb NOT NULL DEFAULT '{}'::jsonb,
  answers_updated_at timestamptz,
  answers_updated_by uuid,
  answers_updated_by_role text,
  current_version_id uuid,
  client_access_token_hash text,
  client_access_token_hint text,
  client_access_expires_at timestamptz,
  document_ready_at timestamptz,
  signed_confirmed_at timestamptz,
  signed_confirmed_by uuid,
  signed_file_document_id uuid,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT contract_engagements_lead_or_client CHECK (lead_id IS NOT NULL OR client_id IS NOT NULL)
);

CREATE INDEX IF NOT EXISTS idx_contract_engagements_lead
  ON public.contract_engagements (lead_id) WHERE lead_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contract_engagements_client
  ON public.contract_engagements (client_id) WHERE client_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_contract_engagements_org
  ON public.contract_engagements (organization_id);
CREATE INDEX IF NOT EXISTS idx_contract_engagements_token_hash
  ON public.contract_engagements (client_access_token_hash)
  WHERE client_access_token_hash IS NOT NULL;

-- Un engagement activo por (lead, package_kind) para onboarding
CREATE UNIQUE INDEX IF NOT EXISTS contract_engagements_lead_kind_active_uidx
  ON public.contract_engagements (lead_id, package_kind)
  WHERE lead_id IS NOT NULL
    AND origin = 'onboarding'
    AND status NOT IN ('void', 'expired');

CREATE TABLE IF NOT EXISTS public.contract_package_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  engagement_id uuid NOT NULL REFERENCES public.contract_engagements(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  item_key text NOT NULL,
  template_id uuid REFERENCES public.contract_templates(id) ON DELETE SET NULL,
  template_version integer,
  status public.contract_package_item_status NOT NULL DEFAULT 'pending',
  current_version_id uuid,
  project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  sort_order integer NOT NULL DEFAULT 0,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (engagement_id, item_key)
);

CREATE TABLE IF NOT EXISTS public.contract_versions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  package_item_id uuid NOT NULL REFERENCES public.contract_package_items(id) ON DELETE CASCADE,
  engagement_id uuid NOT NULL REFERENCES public.contract_engagements(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  version_number integer NOT NULL DEFAULT 1,
  status public.contract_version_status NOT NULL DEFAULT 'draft',
  template_id uuid REFERENCES public.contract_templates(id) ON DELETE SET NULL,
  field_values jsonb NOT NULL DEFAULT '{}'::jsonb,
  merged_html text,
  document_id uuid,
  storage_path text,
  changelog text,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (package_item_id, version_number)
);

-- FKs diferidas (current_version)
DO $$ BEGIN
  ALTER TABLE public.contract_engagements
    ADD CONSTRAINT contract_engagements_current_version_fkey
    FOREIGN KEY (current_version_id) REFERENCES public.contract_versions(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE public.contract_package_items
    ADD CONSTRAINT contract_package_items_current_version_fkey
    FOREIGN KEY (current_version_id) REFERENCES public.contract_versions(id) ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ── RLS ────────────────────────────────────────────────────────────
ALTER TABLE public.pricing_catalog ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_templates ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_template_fields ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_engagements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_package_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.contract_versions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS pricing_catalog_select ON public.pricing_catalog;
CREATE POLICY pricing_catalog_select ON public.pricing_catalog
  FOR SELECT TO authenticated
  USING (
    organization_id IS NULL
    OR organization_id = public.get_user_org_id(auth.uid())
  );

DROP POLICY IF EXISTS pricing_catalog_write ON public.pricing_catalog;
CREATE POLICY pricing_catalog_write ON public.pricing_catalog
  FOR ALL TO authenticated
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    AND public.user_can_manage_pipeline()
  )
  WITH CHECK (
    organization_id = public.get_user_org_id(auth.uid())
    AND public.user_can_manage_pipeline()
  );

DROP POLICY IF EXISTS contract_templates_select ON public.contract_templates;
CREATE POLICY contract_templates_select ON public.contract_templates
  FOR SELECT TO authenticated
  USING (
    organization_id IS NULL
    OR organization_id = public.get_user_org_id(auth.uid())
  );

DROP POLICY IF EXISTS contract_template_fields_select ON public.contract_template_fields;
CREATE POLICY contract_template_fields_select ON public.contract_template_fields
  FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.contract_templates t
      WHERE t.id = template_id
        AND (t.organization_id IS NULL OR t.organization_id = public.get_user_org_id(auth.uid()))
    )
  );

DROP POLICY IF EXISTS contract_engagements_select ON public.contract_engagements;
CREATE POLICY contract_engagements_select ON public.contract_engagements
  FOR SELECT TO authenticated
  USING (organization_id = public.user_pipeline_org_id());

DROP POLICY IF EXISTS contract_engagements_insert ON public.contract_engagements;
CREATE POLICY contract_engagements_insert ON public.contract_engagements
  FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.user_pipeline_org_id());

DROP POLICY IF EXISTS contract_engagements_update ON public.contract_engagements;
CREATE POLICY contract_engagements_update ON public.contract_engagements
  FOR UPDATE TO authenticated
  USING (organization_id = public.user_pipeline_org_id())
  WITH CHECK (organization_id = public.user_pipeline_org_id());

DROP POLICY IF EXISTS contract_package_items_all ON public.contract_package_items;
CREATE POLICY contract_package_items_all ON public.contract_package_items
  FOR ALL TO authenticated
  USING (organization_id = public.user_pipeline_org_id())
  WITH CHECK (organization_id = public.user_pipeline_org_id());

DROP POLICY IF EXISTS contract_versions_all ON public.contract_versions;
CREATE POLICY contract_versions_all ON public.contract_versions
  FOR ALL TO authenticated
  USING (organization_id = public.user_pipeline_org_id())
  WITH CHECK (organization_id = public.user_pipeline_org_id());

-- ── Helpers ────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.contract_hash_token(p_token text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT encode(digest(convert_to(trim(p_token), 'UTF8'), 'sha256'), 'hex');
$$;

CREATE OR REPLACE FUNCTION public.contract_is_required_complete(p_answers jsonb, p_package_kind public.contract_package_kind)
RETURNS boolean
LANGUAGE plpgsql
STABLE
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
  IF p_package_kind = 'backoffice_pm' THEN
    IF NULLIF(trim(COALESCE(a->>'plan_id', a->>'billing.plan_id', '')), '') IS NULL THEN
      RETURN false;
    END IF;
    IF (a->>'net_price') IS NULL AND (a->'billing'->>'net_price') IS NULL THEN
      RETURN false;
    END IF;
  END IF;
  IF p_package_kind = 'softlanding' THEN
    IF NULLIF(trim(COALESCE(a->>'sociedad.denominacion_1', '')), '') IS NULL THEN
      RETURN false;
    END IF;
  END IF;
  RETURN true;
END;
$$;

-- ── start_contract_engagement (D1 gate convertido) ─────────────────
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

  SELECT s.slug INTO v_stage_slug
  FROM public.pipeline_stages s
  WHERE s.id = v_lead.stage_id;
  IF v_stage_slug IS DISTINCT FROM 'convertido' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'lead_not_converted', 'stage', v_stage_slug);
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
    -- Rotar token si no hay uno usable
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

  v_token := encode(gen_random_bytes(24), 'hex');
  v_hash := public.contract_hash_token(v_token);

  -- Snapshot de servicios del lead
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

  -- Items del paquete
  IF p_package_kind = 'backoffice_pm' THEN
    SELECT id, version INTO v_tpl FROM public.contract_templates
    WHERE package_kind = 'backoffice_pm' AND template_key = 'backoffice_pm_caratula'
      AND is_active AND organization_id IS NULL
    ORDER BY version DESC LIMIT 1;

    INSERT INTO public.contract_package_items (
      engagement_id, organization_id, item_key, template_id, template_version, status, sort_order
    ) VALUES (
      v_eng.id, v_org, 'caratula_a1', v_tpl.id, v_tpl.version, 'capturing', 10
    ) RETURNING id INTO v_item_id;

    -- Anexo B OS diferido (D11)
    INSERT INTO public.contract_package_items (
      engagement_id, organization_id, item_key, status, sort_order, metadata
    ) VALUES (
      v_eng.id, v_org, 'anexo_b_os', 'pending', 90, '{"deferred":true,"note":"Orden de Servicio bajo demanda"}'::jsonb
    );
  ELSE
    SELECT id, version INTO v_tpl FROM public.contract_templates
    WHERE package_kind = 'softlanding' AND template_key = 'softlanding_marco_a1'
      AND is_active AND organization_id IS NULL
    ORDER BY version DESC LIMIT 1;

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

GRANT EXECUTE ON FUNCTION public.start_contract_engagement(uuid, public.contract_package_kind) TO authenticated;

-- ── Acceso cliente por token (anon + authenticated) ────────────────
CREATE OR REPLACE FUNCTION public.contract_client_get(p_token text)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_eng public.contract_engagements%ROWTYPE;
  v_hash text;
  v_fields jsonb;
  v_items jsonb;
  v_tpl jsonb;
BEGIN
  IF NULLIF(trim(COALESCE(p_token, '')), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'missing_token');
  END IF;
  v_hash := public.contract_hash_token(p_token);

  SELECT * INTO v_eng
  FROM public.contract_engagements e
  WHERE e.client_access_token_hash = v_hash
    AND e.status NOT IN ('void', 'expired')
    AND (e.client_access_expires_at IS NULL OR e.client_access_expires_at > now())
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_or_expired_token');
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', i.id,
    'item_key', i.item_key,
    'status', i.status,
    'template_id', i.template_id,
    'sort_order', i.sort_order,
    'metadata', i.metadata
  ) ORDER BY i.sort_order), '[]'::jsonb)
  INTO v_items
  FROM public.contract_package_items i
  WHERE i.engagement_id = v_eng.id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'field_key', f.field_key,
    'label', f.label,
    'field_type', f.field_type,
    'required', f.required,
    'placeholder_in_body', f.placeholder_in_body,
    'editable_by', f.editable_by,
    'default_value', f.default_value,
    'sort_order', f.sort_order,
    'help_text', f.help_text
  ) ORDER BY f.sort_order), '[]'::jsonb)
  INTO v_fields
  FROM public.contract_template_fields f
  JOIN public.contract_package_items i ON i.template_id = f.template_id
  WHERE i.engagement_id = v_eng.id
    AND i.status IN ('capturing', 'ready_to_generate', 'issued');

  SELECT jsonb_build_object(
    'id', t.id,
    'name', t.name,
    'body_html', t.body_html,
    'template_key', t.template_key
  )
  INTO v_tpl
  FROM public.contract_templates t
  JOIN public.contract_package_items i ON i.template_id = t.id
  WHERE i.engagement_id = v_eng.id
    AND i.status IN ('capturing', 'ready_to_generate', 'issued')
  ORDER BY i.sort_order
  LIMIT 1;

  RETURN jsonb_build_object(
    'ok', true,
    'engagement', jsonb_build_object(
      'id', v_eng.id,
      'package_kind', v_eng.package_kind,
      'status', v_eng.status,
      'service_types', to_jsonb(v_eng.service_types),
      'answers', v_eng.answers,
      'answers_updated_at', v_eng.answers_updated_at,
      'answers_updated_by_role', v_eng.answers_updated_by_role,
      'document_ready_at', v_eng.document_ready_at,
      'signed_confirmed_at', v_eng.signed_confirmed_at
    ),
    'items', v_items,
    'fields', v_fields,
    'template', v_tpl
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.contract_client_patch(
  p_token text,
  p_answers jsonb,
  p_role text DEFAULT 'client'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_eng public.contract_engagements%ROWTYPE;
  v_hash text;
  v_merged jsonb;
  v_role text := CASE WHEN p_role IN ('client', 'staff') THEN p_role ELSE 'client' END;
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

  v_merged := COALESCE(v_eng.answers, '{}'::jsonb) || COALESCE(p_answers, '{}'::jsonb);
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
    answers_updated_by_role = v_role,
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

GRANT EXECUTE ON FUNCTION public.contract_client_get(text) TO anon, authenticated;
GRANT EXECUTE ON FUNCTION public.contract_client_patch(text, jsonb, text) TO anon, authenticated;

-- Staff patch answers (JWT)
CREATE OR REPLACE FUNCTION public.contract_staff_patch_answers(
  p_engagement_id uuid,
  p_answers jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_eng public.contract_engagements%ROWTYPE;
  v_merged jsonb;
  v_complete boolean;
  v_new_status public.contract_engagement_status;
BEGIN
  v_org := public.user_pipeline_org_id();
  IF v_org IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_organization');
  END IF;

  SELECT * INTO v_eng FROM public.contract_engagements
  WHERE id = p_engagement_id AND organization_id = v_org;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_eng.status = 'signed_confirmed' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'immutable_signed');
  END IF;

  v_merged := COALESCE(v_eng.answers, '{}'::jsonb) || COALESCE(p_answers, '{}'::jsonb);
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
    answers_updated_by_role = 'staff',
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

GRANT EXECUTE ON FUNCTION public.contract_staff_patch_answers(uuid, jsonb) TO authenticated;

-- Generar versión (guarda HTML merged; inmutabilidad D12)
CREATE OR REPLACE FUNCTION public.contract_generate_version(
  p_engagement_id uuid,
  p_item_key text DEFAULT NULL,
  p_merged_html text DEFAULT NULL,
  p_field_values jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_eng public.contract_engagements%ROWTYPE;
  v_item public.contract_package_items%ROWTYPE;
  v_ver_num integer;
  v_ver_id uuid;
BEGIN
  v_org := public.user_pipeline_org_id();
  IF v_org IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_organization');
  END IF;

  SELECT * INTO v_eng FROM public.contract_engagements
  WHERE id = p_engagement_id AND organization_id = v_org;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;
  IF v_eng.status = 'signed_confirmed' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'immutable_signed');
  END IF;

  SELECT * INTO v_item FROM public.contract_package_items
  WHERE engagement_id = p_engagement_id
    AND (p_item_key IS NULL OR item_key = p_item_key)
    AND status <> 'pending'
    AND status <> 'void'
    AND status <> 'signed_external'
  ORDER BY sort_order
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_active_item');
  END IF;

  -- Supersede drafts previos
  UPDATE public.contract_versions
  SET status = 'superseded'
  WHERE package_item_id = v_item.id AND status IN ('draft', 'ready');

  SELECT COALESCE(MAX(version_number), 0) + 1 INTO v_ver_num
  FROM public.contract_versions WHERE package_item_id = v_item.id;

  INSERT INTO public.contract_versions (
    package_item_id, engagement_id, organization_id, version_number, status,
    template_id, field_values, merged_html, created_by, changelog
  ) VALUES (
    v_item.id, v_eng.id, v_org, v_ver_num, 'ready',
    v_item.template_id,
    COALESCE(p_field_values, v_eng.answers),
    p_merged_html,
    auth.uid(),
    'Generación MVP'
  )
  RETURNING id INTO v_ver_id;

  UPDATE public.contract_package_items SET
    current_version_id = v_ver_id,
    status = 'issued',
    updated_at = now()
  WHERE id = v_item.id;

  UPDATE public.contract_engagements SET
    current_version_id = v_ver_id,
    status = 'document_ready',
    document_ready_at = now(),
    updated_at = now()
  WHERE id = v_eng.id;

  RETURN jsonb_build_object(
    'ok', true,
    'version_id', v_ver_id,
    'version_number', v_ver_num,
    'package_item_id', v_item.id,
    'item_key', v_item.item_key
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.contract_generate_version(uuid, text, text, jsonb) TO authenticated;

-- Confirmar firmado → clients + proyectos (D5)
CREATE OR REPLACE FUNCTION public.confirm_contract_signed(
  p_engagement_id uuid,
  p_signed_file_document_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_eng public.contract_engagements%ROWTYPE;
  v_lead record;
  v_client_id uuid;
  v_svc public.service_area;
  v_name text;
  v_area text;
  v_proj_id uuid;
  v_created_projects jsonb := '[]'::jsonb;
  v_services public.service_area[];
BEGIN
  v_org := public.user_pipeline_org_id();
  IF v_org IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_organization');
  END IF;

  SELECT * INTO v_eng FROM public.contract_engagements
  WHERE id = p_engagement_id AND organization_id = v_org;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  IF v_eng.status = 'signed_confirmed' AND v_eng.client_id IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'client_id', v_eng.client_id, 'already', true);
  END IF;

  IF v_eng.status NOT IN ('document_ready', 'document_draft', 'ready_to_generate', 'onboarding') THEN
    -- permitir confirmar si hay documento listo o datos; MVP flexible
    NULL;
  END IF;

  v_client_id := v_eng.client_id;
  v_services := COALESCE(v_eng.service_types, '{}'::public.service_area[]);

  IF v_client_id IS NULL AND v_eng.lead_id IS NOT NULL THEN
    SELECT * INTO v_lead FROM public.leads WHERE id = v_eng.lead_id AND organization_id = v_org;
    v_name := COALESCE(
      NULLIF(trim(v_eng.answers->>'client.legal_name'), ''),
      v_lead.billing_legal_name,
      v_lead.company_name,
      v_lead.full_name,
      'Cliente'
    );

    IF cardinality(v_services) = 0 THEN
      IF v_eng.package_kind = 'backoffice_pm' THEN
        v_services := ARRAY['legal','contabilidad']::public.service_area[];
      ELSE
        v_services := ARRAY['softlanding']::public.service_area[];
      END IF;
    END IF;

    INSERT INTO public.clients (
      organization_id, name, email, phone, rfc, contact_name,
      services, status, client_type, created_by, responsible_user_id, notes
    ) VALUES (
      v_org,
      v_name,
      COALESCE(NULLIF(trim(v_eng.answers->>'client.email'), ''), v_lead.email),
      COALESCE(NULLIF(trim(v_eng.answers->>'client.phone'), ''), v_lead.phone),
      COALESCE(NULLIF(trim(v_eng.answers->>'client.rfc'), ''), v_lead.billing_rfc),
      COALESCE(NULLIF(trim(v_eng.answers->>'client.contact_name'), ''), v_lead.full_name),
      v_services,
      'activo',
      CASE WHEN v_eng.package_kind = 'backoffice_pm' THEN 'persona_moral'::public.client_type ELSE 'persona_moral'::public.client_type END,
      auth.uid(),
      COALESCE(v_lead.owner_id, auth.uid()),
      'Creado al confirmar contrato firmado (engagement ' || v_eng.id::text || ')'
    )
    RETURNING id INTO v_client_id;
  END IF;

  -- Crear proyectos por service_area del engagement
  IF v_client_id IS NOT NULL THEN
    FOREACH v_svc IN ARRAY v_services LOOP
      v_area := v_svc::text;
      -- Evitar duplicar área activa
      IF EXISTS (
        SELECT 1 FROM public.projects p
        WHERE p.client_id = v_client_id
          AND p.area = v_svc
          AND p.status IS DISTINCT FROM 'cancelado'::public.project_status
      ) THEN
        CONTINUE;
      END IF;

      -- Softlanding: un proyecto softlanding; contabilidad solo si no hay softlanding
      IF v_area = 'contabilidad' AND 'softlanding' = ANY (v_services) THEN
        CONTINUE;
      END IF;

      INSERT INTO public.projects (
        name, client_id, area, organization_id, created_by, responsible_user_id, tax_obligations
      ) VALUES (
        initcap(replace(v_area, '_', ' ')) || ' - ' || (SELECT name FROM public.clients WHERE id = v_client_id),
        v_client_id,
        v_svc,
        v_org,
        auth.uid(),
        auth.uid(),
        '[]'::jsonb
      )
      RETURNING id INTO v_proj_id;

      v_created_projects := v_created_projects || jsonb_build_array(jsonb_build_object('id', v_proj_id, 'area', v_area));

      -- Ligar items pendientes Softlanding al proyecto
      IF v_eng.package_kind = 'softlanding' AND v_area = 'softlanding' THEN
        UPDATE public.contract_package_items SET
          project_id = v_proj_id,
          updated_at = now()
        WHERE engagement_id = v_eng.id AND status = 'pending';
      END IF;
    END LOOP;
  END IF;

  UPDATE public.contract_package_items SET
    status = 'signed_external',
    updated_at = now()
  WHERE engagement_id = v_eng.id
    AND status = 'issued'
    AND item_key IN ('marco', 'caratula_a1');

  UPDATE public.contract_versions SET status = 'signed_upload'
  WHERE id = v_eng.current_version_id;

  UPDATE public.contract_engagements SET
    status = 'signed_confirmed',
    signed_confirmed_at = now(),
    signed_confirmed_by = auth.uid(),
    signed_file_document_id = COALESCE(p_signed_file_document_id, signed_file_document_id),
    client_id = COALESCE(client_id, v_client_id),
    updated_at = now()
  WHERE id = v_eng.id;

  RETURN jsonb_build_object(
    'ok', true,
    'client_id', v_client_id,
    'projects', v_created_projects,
    'engagement_id', p_engagement_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.confirm_contract_signed(uuid, uuid) TO authenticated;

-- Regenerar access token (staff)
CREATE OR REPLACE FUNCTION public.contract_rotate_access_token(p_engagement_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_token text;
  v_hash text;
BEGIN
  v_org := public.user_pipeline_org_id();
  IF v_org IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_organization');
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM public.contract_engagements
    WHERE id = p_engagement_id AND organization_id = v_org
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_found');
  END IF;

  v_token := encode(gen_random_bytes(24), 'hex');
  v_hash := public.contract_hash_token(v_token);
  UPDATE public.contract_engagements SET
    client_access_token_hash = v_hash,
    client_access_token_hint = right(v_token, 6),
    client_access_expires_at = now() + interval '30 days',
    updated_at = now()
  WHERE id = p_engagement_id;

  RETURN jsonb_build_object(
    'ok', true,
    'access_token', v_token,
    'expires_at', now() + interval '30 days'
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.contract_rotate_access_token(uuid) TO authenticated;
