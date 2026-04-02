-- Pipeline & Leads (Spec Kawiil OS v1) — tablas multi-tenant, RLS, RPCs, seed etapas

-- ---------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------

CREATE TABLE public.pipeline_stages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  slug text NOT NULL,
  position integer NOT NULL DEFAULT 0,
  color text NOT NULL DEFAULT '#3B82F6',
  is_terminal boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, slug)
);

CREATE INDEX idx_pipeline_stages_org ON public.pipeline_stages(organization_id);
CREATE INDEX idx_pipeline_stages_org_pos ON public.pipeline_stages(organization_id, position);

CREATE TABLE public.leads (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  meta_lead_id text,
  meta_created_at timestamptz,
  campaign_name text,
  form_name text,
  full_name text NOT NULL,
  email text,
  phone text,
  whatsapp text,
  company_name text,
  country_code text,
  country_name text,
  preferred_contact text,
  preferred_time text,
  stage_id uuid NOT NULL REFERENCES public.pipeline_stages(id) ON DELETE RESTRICT,
  owner_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  priority text NOT NULL DEFAULT 'medium' CHECK (priority IN ('urgent', 'high', 'medium', 'low')),
  score integer NOT NULL DEFAULT 0 CHECK (score >= 0 AND score <= 100),
  tags text[],
  source text NOT NULL DEFAULT 'manual' CHECK (source IN ('meta_ads', 'manual', 'import', 'referral')),
  is_active boolean NOT NULL DEFAULT true,
  notes text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_leads_stage ON public.leads(stage_id);
CREATE INDEX idx_leads_owner ON public.leads(owner_id);
CREATE INDEX idx_leads_priority ON public.leads(priority);
CREATE INDEX idx_leads_source ON public.leads(source);
CREATE INDEX idx_leads_created ON public.leads(created_at DESC);
CREATE INDEX idx_leads_email ON public.leads(email);
CREATE INDEX idx_leads_meta_id ON public.leads(meta_lead_id);
CREATE INDEX idx_leads_org ON public.leads(organization_id);
CREATE INDEX idx_leads_org_active ON public.leads(organization_id, is_active) WHERE is_active = true;

CREATE TRIGGER update_leads_updated_at
  BEFORE UPDATE ON public.leads
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.lead_activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  type text NOT NULL,
  metadata jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_activities_lead ON public.lead_activities(lead_id, created_at DESC);
CREATE INDEX idx_activities_org ON public.lead_activities(organization_id);

CREATE OR REPLACE FUNCTION public.set_lead_activity_organization_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  SELECT organization_id INTO NEW.organization_id FROM public.leads WHERE id = NEW.lead_id;
  IF NEW.organization_id IS NULL THEN
    RAISE EXCEPTION 'lead not found';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_lead_activities_set_org
  BEFORE INSERT ON public.lead_activities
  FOR EACH ROW EXECUTE FUNCTION public.set_lead_activity_organization_id();

CREATE TABLE public.email_templates (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  subject text NOT NULL,
  body_html text NOT NULL,
  body_text text,
  category text NOT NULL DEFAULT 'follow_up'
    CHECK (category IN ('first_contact', 'follow_up', 'proposal', 'reactivation')),
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_email_templates_org ON public.email_templates(organization_id);

CREATE TRIGGER update_email_templates_updated_at
  BEFORE UPDATE ON public.email_templates
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE TABLE public.email_sequences (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name text NOT NULL,
  description text,
  trigger_stage uuid REFERENCES public.pipeline_stages(id) ON DELETE SET NULL,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_email_sequences_org ON public.email_sequences(organization_id);

CREATE TABLE public.email_sequence_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sequence_id uuid NOT NULL REFERENCES public.email_sequences(id) ON DELETE CASCADE,
  template_id uuid NOT NULL REFERENCES public.email_templates(id) ON DELETE RESTRICT,
  step_order integer NOT NULL,
  delay_hours integer NOT NULL DEFAULT 0,
  condition jsonb,
  UNIQUE (sequence_id, step_order)
);

CREATE INDEX idx_email_sequence_steps_seq ON public.email_sequence_steps(sequence_id);

CREATE TABLE public.email_log (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  lead_id uuid NOT NULL REFERENCES public.leads(id) ON DELETE CASCADE,
  template_id uuid REFERENCES public.email_templates(id) ON DELETE SET NULL,
  sequence_step_id uuid REFERENCES public.email_sequence_steps(id) ON DELETE SET NULL,
  to_email text NOT NULL,
  subject text NOT NULL,
  status text NOT NULL DEFAULT 'queued'
    CHECK (status IN (
      'queued', 'sent', 'delivered', 'opened', 'clicked', 'bounced', 'failed', 'cancelled'
    )),
  scheduled_at timestamptz,
  sent_at timestamptz,
  opened_at timestamptz,
  clicked_at timestamptz,
  error_message text,
  graph_message_id text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_email_log_lead ON public.email_log(lead_id, created_at DESC);
CREATE INDEX idx_email_log_status ON public.email_log(status) WHERE status = 'queued';
CREATE INDEX idx_email_log_org ON public.email_log(organization_id);
CREATE INDEX idx_email_log_scheduled ON public.email_log(organization_id, scheduled_at)
  WHERE status = 'queued';

CREATE OR REPLACE FUNCTION public.set_email_log_organization_id()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  SELECT organization_id INTO NEW.organization_id FROM public.leads WHERE id = NEW.lead_id;
  IF NEW.organization_id IS NULL THEN
    RAISE EXCEPTION 'lead not found';
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_email_log_set_org
  BEFORE INSERT ON public.email_log
  FOR EACH ROW EXECUTE FUNCTION public.set_email_log_organization_id();

-- ---------------------------------------------------------------------------
-- Seed etapas por organización (idempotente)
-- ---------------------------------------------------------------------------

INSERT INTO public.pipeline_stages (organization_id, name, slug, position, color, is_terminal)
SELECT o.id, v.name, v.slug, v.position, v.color, v.is_terminal
FROM public.organizations o
CROSS JOIN (
  VALUES
    ('Registrado', 'registrado', 0, '#6B7280', false),
    ('Contactado', 'contactado', 1, '#3B82F6', false),
    ('Calificado', 'calificado', 2, '#8B5CF6', false),
    ('Propuesta', 'propuesta', 3, '#F59E0B', false),
    ('Negociación', 'negociacion', 4, '#EF4444', false),
    ('Frío', 'frio', 5, '#94A3B8', false),
    ('Convertido', 'convertido', 6, '#22C55E', true),
    ('Perdido', 'perdido', 7, '#9CA3AF', true)
) AS v(name, slug, position, color, is_terminal)
ON CONFLICT (organization_id, slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- RLS helpers
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.user_pipeline_org_id()
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT organization_id FROM public.profiles WHERE user_id = auth.uid() LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.user_can_manage_pipeline()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid()
      AND ur.role IN ('transformador', 'admin', 'manager')
  );
$$;

-- pipeline_stages
ALTER TABLE public.pipeline_stages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "pipeline_stages_select"
  ON public.pipeline_stages FOR SELECT TO authenticated
  USING (organization_id = public.user_pipeline_org_id());

CREATE POLICY "pipeline_stages_insert"
  ON public.pipeline_stages FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.user_pipeline_org_id()
    AND public.user_can_manage_pipeline()
  );

CREATE POLICY "pipeline_stages_update"
  ON public.pipeline_stages FOR UPDATE TO authenticated
  USING (
    organization_id = public.user_pipeline_org_id()
    AND public.user_can_manage_pipeline()
  );

CREATE POLICY "pipeline_stages_delete"
  ON public.pipeline_stages FOR DELETE TO authenticated
  USING (
    organization_id = public.user_pipeline_org_id()
    AND public.user_can_manage_pipeline()
  );

-- leads
ALTER TABLE public.leads ENABLE ROW LEVEL SECURITY;

CREATE POLICY "leads_select"
  ON public.leads FOR SELECT TO authenticated
  USING (organization_id = public.user_pipeline_org_id());

CREATE POLICY "leads_insert"
  ON public.leads FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.user_pipeline_org_id());

CREATE POLICY "leads_update"
  ON public.leads FOR UPDATE TO authenticated
  USING (
    organization_id = public.user_pipeline_org_id()
    AND (
      owner_id IS NULL
      OR owner_id = auth.uid()
      OR public.user_can_manage_pipeline()
    )
  );

CREATE POLICY "leads_delete"
  ON public.leads FOR DELETE TO authenticated
  USING (
    organization_id = public.user_pipeline_org_id()
    AND public.user_can_manage_pipeline()
  );

-- lead_activities
ALTER TABLE public.lead_activities ENABLE ROW LEVEL SECURITY;

CREATE POLICY "lead_activities_select"
  ON public.lead_activities FOR SELECT TO authenticated
  USING (organization_id = public.user_pipeline_org_id());

CREATE POLICY "lead_activities_insert"
  ON public.lead_activities FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.user_pipeline_org_id());

-- email_templates
ALTER TABLE public.email_templates ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_templates_select"
  ON public.email_templates FOR SELECT TO authenticated
  USING (organization_id = public.user_pipeline_org_id());

CREATE POLICY "email_templates_insert"
  ON public.email_templates FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.user_pipeline_org_id()
    AND public.user_can_manage_pipeline()
  );

CREATE POLICY "email_templates_update"
  ON public.email_templates FOR UPDATE TO authenticated
  USING (
    organization_id = public.user_pipeline_org_id()
    AND public.user_can_manage_pipeline()
  );

CREATE POLICY "email_templates_delete"
  ON public.email_templates FOR DELETE TO authenticated
  USING (
    organization_id = public.user_pipeline_org_id()
    AND public.user_can_manage_pipeline()
  );

-- email_sequences
ALTER TABLE public.email_sequences ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_sequences_select"
  ON public.email_sequences FOR SELECT TO authenticated
  USING (organization_id = public.user_pipeline_org_id());

CREATE POLICY "email_sequences_insert"
  ON public.email_sequences FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.user_pipeline_org_id()
    AND public.user_can_manage_pipeline()
  );

CREATE POLICY "email_sequences_update"
  ON public.email_sequences FOR UPDATE TO authenticated
  USING (
    organization_id = public.user_pipeline_org_id()
    AND public.user_can_manage_pipeline()
  );

CREATE POLICY "email_sequences_delete"
  ON public.email_sequences FOR DELETE TO authenticated
  USING (
    organization_id = public.user_pipeline_org_id()
    AND public.user_can_manage_pipeline()
  );

-- email_sequence_steps: join parent sequence org
ALTER TABLE public.email_sequence_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_sequence_steps_select"
  ON public.email_sequence_steps FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.email_sequences s
      WHERE s.id = sequence_id AND s.organization_id = public.user_pipeline_org_id()
    )
  );

CREATE POLICY "email_sequence_steps_insert"
  ON public.email_sequence_steps FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.email_sequences s
      WHERE s.id = sequence_id
        AND s.organization_id = public.user_pipeline_org_id()
        AND public.user_can_manage_pipeline()
    )
  );

CREATE POLICY "email_sequence_steps_update"
  ON public.email_sequence_steps FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.email_sequences s
      WHERE s.id = sequence_id
        AND s.organization_id = public.user_pipeline_org_id()
        AND public.user_can_manage_pipeline()
    )
  );

CREATE POLICY "email_sequence_steps_delete"
  ON public.email_sequence_steps FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.email_sequences s
      WHERE s.id = sequence_id
        AND s.organization_id = public.user_pipeline_org_id()
        AND public.user_can_manage_pipeline()
    )
  );

-- email_log
ALTER TABLE public.email_log ENABLE ROW LEVEL SECURITY;

CREATE POLICY "email_log_select"
  ON public.email_log FOR SELECT TO authenticated
  USING (organization_id = public.user_pipeline_org_id());

CREATE POLICY "email_log_insert"
  ON public.email_log FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.user_pipeline_org_id());

CREATE POLICY "email_log_update"
  ON public.email_log FOR UPDATE TO authenticated
  USING (
    organization_id = public.user_pipeline_org_id()
    AND public.user_can_manage_pipeline()
  );

-- ---------------------------------------------------------------------------
-- Realtime
-- ---------------------------------------------------------------------------

ALTER PUBLICATION supabase_realtime ADD TABLE public.leads;
ALTER PUBLICATION supabase_realtime ADD TABLE public.lead_activities;
ALTER PUBLICATION supabase_realtime ADD TABLE public.email_log;

-- ---------------------------------------------------------------------------
-- RPCs
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.cancel_sequence_emails(p_lead_id uuid, p_sequence_id uuid DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_n int;
BEGIN
  v_org := public.user_pipeline_org_id();
  IF v_org IS NULL THEN
    RETURN 0;
  END IF;

  UPDATE public.email_log el
  SET status = 'cancelled'
  WHERE el.organization_id = v_org
    AND el.lead_id = p_lead_id
    AND el.status = 'queued'
    AND (
      p_sequence_id IS NULL
      OR el.sequence_step_id IN (
        SELECT id FROM public.email_sequence_steps WHERE sequence_id = p_sequence_id
      )
    );

  GET DIAGNOSTICS v_n = ROW_COUNT;
  RETURN v_n;
END;
$$;

CREATE OR REPLACE FUNCTION public.move_lead_stage(p_lead_id uuid, p_new_stage_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_org uuid;
  v_old_stage uuid;
  v_stage_org uuid;
BEGIN
  v_profile_org := public.user_pipeline_org_id();
  IF v_profile_org IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_organization');
  END IF;

  SELECT l.stage_id INTO v_old_stage
  FROM public.leads l
  WHERE l.id = p_lead_id AND l.organization_id = v_profile_org;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'lead_not_found');
  END IF;

  SELECT organization_id INTO v_stage_org
  FROM public.pipeline_stages
  WHERE id = p_new_stage_id;

  IF v_stage_org IS NULL OR v_stage_org <> v_profile_org THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_stage');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = p_lead_id
      AND (
        l.owner_id IS NULL
        OR l.owner_id = auth.uid()
        OR public.user_can_manage_pipeline()
      )
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  UPDATE public.leads SET stage_id = p_new_stage_id, updated_at = now() WHERE id = p_lead_id;

  INSERT INTO public.lead_activities (organization_id, lead_id, user_id, type, metadata)
  VALUES (
    v_profile_org,
    p_lead_id,
    auth.uid(),
    'stage_change',
    jsonb_build_object('from_stage_id', v_old_stage, 'to_stage_id', p_new_stage_id)
  );

  PERFORM public.cancel_sequence_emails(p_lead_id, NULL);

  RETURN jsonb_build_object('ok', true, 'lead_id', p_lead_id, 'stage_id', p_new_stage_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.assign_lead(p_lead_id uuid, p_owner_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_profile_org uuid;
  v_old uuid;
BEGIN
  v_profile_org := public.user_pipeline_org_id();
  IF v_profile_org IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_organization');
  END IF;

  SELECT owner_id INTO v_old
  FROM public.leads WHERE id = p_lead_id AND organization_id = v_profile_org;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'lead_not_found');
  END IF;

  IF NOT public.user_can_manage_pipeline() AND NOT EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = p_lead_id AND (l.owner_id IS NULL OR l.owner_id = auth.uid())
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  IF p_owner_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.user_id = p_owner_id AND p.organization_id = v_profile_org
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'owner_not_in_org');
  END IF;

  UPDATE public.leads SET owner_id = p_owner_id, updated_at = now() WHERE id = p_lead_id;

  INSERT INTO public.lead_activities (organization_id, lead_id, user_id, type, metadata)
  VALUES (
    v_profile_org,
    p_lead_id,
    auth.uid(),
    'assignment',
    jsonb_build_object('from_owner_id', v_old, 'to_owner_id', p_owner_id)
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.bulk_assign_leads(p_lead_ids uuid[], p_owner_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_id uuid;
  v_count int := 0;
BEGIN
  v_org := public.user_pipeline_org_id();
  IF v_org IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_organization');
  END IF;

  IF NOT public.user_can_manage_pipeline() THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  IF p_owner_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.profiles p WHERE p.user_id = p_owner_id AND p.organization_id = v_org
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'owner_not_in_org');
  END IF;

  FOREACH v_id IN ARRAY p_lead_ids
  LOOP
    IF EXISTS (SELECT 1 FROM public.leads WHERE id = v_id AND organization_id = v_org) THEN
      PERFORM public.assign_lead(v_id, p_owner_id);
      v_count := v_count + 1;
    END IF;
  END LOOP;

  RETURN jsonb_build_object('ok', true, 'updated', v_count);
END;
$$;

CREATE OR REPLACE FUNCTION public.score_lead(p_lead_id uuid, p_score integer, p_reason text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_old int;
BEGIN
  v_org := public.user_pipeline_org_id();
  IF v_org IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_organization');
  END IF;

  IF p_score < 0 OR p_score > 100 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_score');
  END IF;

  SELECT score INTO v_old FROM public.leads WHERE id = p_lead_id AND organization_id = v_org;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'lead_not_found');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.leads l
    WHERE l.id = p_lead_id
      AND (
        l.owner_id IS NULL
        OR l.owner_id = auth.uid()
        OR public.user_can_manage_pipeline()
      )
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'forbidden');
  END IF;

  UPDATE public.leads SET score = p_score, updated_at = now() WHERE id = p_lead_id;

  INSERT INTO public.lead_activities (organization_id, lead_id, user_id, type, metadata)
  VALUES (
    v_org,
    p_lead_id,
    auth.uid(),
    'score_change',
    jsonb_build_object('from', v_old, 'to', p_score, 'reason', p_reason)
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.detect_duplicates(p_email text, p_phone text)
RETURNS SETOF public.leads
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT l.*
  FROM public.leads l
  WHERE l.organization_id = public.user_pipeline_org_id()
    AND l.is_active = true
    AND (
      (p_email IS NOT NULL AND btrim(p_email) <> '' AND lower(l.email) = lower(btrim(p_email)))
      OR (
        p_phone IS NOT NULL AND btrim(p_phone) <> ''
        AND (l.phone = btrim(p_phone) OR l.whatsapp = btrim(p_phone))
      )
    );
$$;

CREATE OR REPLACE FUNCTION public.enqueue_sequence(p_lead_id uuid, p_sequence_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  v_rec record;
  v_cum_delay numeric := 0;
  v_sched timestamptz;
  v_tpl record;
  v_subj text;
BEGIN
  v_org := public.user_pipeline_org_id();
  IF v_org IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_organization');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.leads l WHERE l.id = p_lead_id AND l.organization_id = v_org
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'lead_not_found');
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.email_sequences s
    WHERE s.id = p_sequence_id AND s.organization_id = v_org AND s.is_active
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'sequence_not_found');
  END IF;

  PERFORM public.cancel_sequence_emails(p_lead_id, p_sequence_id);

  FOR v_rec IN
    SELECT ess.id AS step_id, ess.delay_hours, ess.template_id, ess.step_order
    FROM public.email_sequence_steps ess
    WHERE ess.sequence_id = p_sequence_id
    ORDER BY ess.step_order ASC
  LOOP
    v_cum_delay := v_cum_delay + COALESCE(v_rec.delay_hours, 0);
    v_sched := now() + make_interval(hours => v_cum_delay::integer);

    SELECT t.subject, t.name INTO v_tpl
    FROM public.email_templates t
    WHERE t.id = v_rec.template_id AND t.organization_id = v_org AND t.is_active;

    IF NOT FOUND THEN
      CONTINUE;
    END IF;

    v_subj := COALESCE(v_tpl.subject, v_tpl.name);

    INSERT INTO public.email_log (
      lead_id, template_id, sequence_step_id, to_email, subject, status, scheduled_at
    )
    SELECT
      p_lead_id,
      v_rec.template_id,
      v_rec.step_id,
      l.email,
      v_subj,
      'queued',
      v_sched
    FROM public.leads l
    WHERE l.id = p_lead_id AND l.email IS NOT NULL AND btrim(l.email) <> '';
  END LOOP;

  RETURN jsonb_build_object('ok', true);
END;
$$;

CREATE OR REPLACE FUNCTION public.cancel_sequence(p_lead_id uuid, p_sequence_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  n int;
BEGIN
  n := public.cancel_sequence_emails(p_lead_id, p_sequence_id);
  RETURN jsonb_build_object('ok', true, 'cancelled', n);
END;
$$;

CREATE OR REPLACE FUNCTION public.get_pipeline_stats(
  p_date_from timestamptz DEFAULT NULL,
  p_date_to timestamptz DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org uuid;
  df timestamptz;
  dt timestamptz;
BEGIN
  v_org := public.user_pipeline_org_id();
  IF v_org IS NULL THEN
    RETURN '{}'::jsonb;
  END IF;

  df := COALESCE(p_date_from, now() - interval '30 days');
  dt := COALESCE(p_date_to, now());

  RETURN (
    WITH bounds AS (
      SELECT df AS d0, dt AS d1
    ),
    lead_counts AS (
      SELECT
        COUNT(*) FILTER (WHERE l.created_at >= (SELECT d0 FROM bounds) AND l.created_at <= (SELECT d1 FROM bounds)) AS new_leads,
        COUNT(*) FILTER (WHERE l.is_active) AS active_leads
      FROM public.leads l
      WHERE l.organization_id = v_org
    ),
    by_stage AS (
      SELECT COALESCE(
        (SELECT jsonb_object_agg(sub.slug, sub.cnt)
         FROM (
           SELECT ps.slug, COUNT(l.id)::bigint AS cnt
           FROM public.pipeline_stages ps
           LEFT JOIN public.leads l ON l.stage_id = ps.id AND l.organization_id = v_org AND l.is_active
           WHERE ps.organization_id = v_org
           GROUP BY ps.slug
         ) sub),
        '{}'::jsonb
      ) AS stages
    ),
    email_rates AS (
      SELECT
        COUNT(*) FILTER (WHERE el.status IN ('opened', 'clicked'))::float
          / NULLIF(COUNT(*) FILTER (WHERE el.status IN ('sent', 'delivered', 'opened', 'clicked')), 0) AS open_rate
      FROM public.email_log el
      WHERE el.organization_id = v_org
        AND el.created_at >= (SELECT d0 FROM bounds)
        AND el.created_at <= (SELECT d1 FROM bounds)
    )
    SELECT jsonb_build_object(
      'new_leads', (SELECT new_leads FROM lead_counts),
      'active_leads', (SELECT active_leads FROM lead_counts),
      'by_stage', (SELECT stages FROM by_stage),
      'email_open_rate', COALESCE((SELECT open_rate FROM email_rates), 0)
    )
  );
END;
$$;

GRANT EXECUTE ON FUNCTION public.move_lead_stage(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.assign_lead(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_assign_leads(uuid[], uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.score_lead(uuid, integer, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.detect_duplicates(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.enqueue_sequence(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.cancel_sequence(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_pipeline_stats(timestamptz, timestamptz) TO authenticated;

-- Módulo pipeline en permisos (transformadores)
INSERT INTO public.user_module_permissions (user_id, organization_id, module_key, enabled)
SELECT ur.user_id, p.organization_id, 'pipeline', true
FROM public.user_roles ur
JOIN public.profiles p ON p.user_id = ur.user_id
WHERE ur.role = 'transformador'
ON CONFLICT (user_id, module_key) DO NOTHING;
