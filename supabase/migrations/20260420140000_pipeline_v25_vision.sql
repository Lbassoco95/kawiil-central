-- =============================================================================
-- Pipeline v2.5 vision alignment
-- =============================================================================
-- Idempotent migration:
--   1. leads.estimated_value numeric(12,2)  (MXN, nullable)
--   2. Rename pipeline_stages labels to conversational names (slug stays intact)
--   3. Table pipeline_automations (org-scoped, RLS) with default seed per org
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. leads.estimated_value
-- ---------------------------------------------------------------------------

ALTER TABLE public.leads
  ADD COLUMN IF NOT EXISTS estimated_value numeric(12,2);

COMMENT ON COLUMN public.leads.estimated_value IS
  'Monto estimado del deal en MXN. Nullable.';

-- ---------------------------------------------------------------------------
-- 2. Rename pipeline_stages labels (conversational v2.5)
--    Slugs permanecen intactos para no romper integraciones.
-- ---------------------------------------------------------------------------

UPDATE public.pipeline_stages SET name = 'Nuevo'              WHERE slug = 'registrado';
UPDATE public.pipeline_stages SET name = 'Saludé'             WHERE slug = 'contactado';
UPDATE public.pipeline_stages SET name = 'Entendí qué busca'  WHERE slug = 'calificado';
UPDATE public.pipeline_stages SET name = 'Le mandé propuesta' WHERE slug = 'propuesta';
UPDATE public.pipeline_stages SET name = 'Negociando'         WHERE slug = 'negociacion';
UPDATE public.pipeline_stages SET name = 'Cerrado'            WHERE slug = 'convertido';
-- 'frio' y 'perdido' permanecen igual.

-- ---------------------------------------------------------------------------
-- 3. pipeline_automations
-- ---------------------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.pipeline_automations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  key text NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  config jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, key)
);

CREATE INDEX IF NOT EXISTS idx_pipeline_automations_org
  ON public.pipeline_automations(organization_id);

DROP TRIGGER IF EXISTS update_pipeline_automations_updated_at
  ON public.pipeline_automations;

CREATE TRIGGER update_pipeline_automations_updated_at
  BEFORE UPDATE ON public.pipeline_automations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Seed por org: 3 automations, inicialmente deshabilitadas
INSERT INTO public.pipeline_automations (organization_id, key, enabled, config)
SELECT o.id, v.key, v.enabled, v.config::jsonb
FROM public.organizations o
CROSS JOIN (
  VALUES
    ('auto_cool_down_14d',        true,  '{"days": 14}'),
    ('auto_advance_on_reply',     false, '{}'),
    ('auto_score_boost_on_open',  false, '{"boost": 5}')
) AS v(key, enabled, config)
ON CONFLICT (organization_id, key) DO NOTHING;

-- RLS org-scoped (patrón de pipeline_stages)
ALTER TABLE public.pipeline_automations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "pipeline_automations_select" ON public.pipeline_automations;
CREATE POLICY "pipeline_automations_select"
  ON public.pipeline_automations FOR SELECT TO authenticated
  USING (organization_id = public.user_pipeline_org_id());

DROP POLICY IF EXISTS "pipeline_automations_insert" ON public.pipeline_automations;
CREATE POLICY "pipeline_automations_insert"
  ON public.pipeline_automations FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.user_pipeline_org_id()
    AND public.user_can_manage_pipeline()
  );

DROP POLICY IF EXISTS "pipeline_automations_update" ON public.pipeline_automations;
CREATE POLICY "pipeline_automations_update"
  ON public.pipeline_automations FOR UPDATE TO authenticated
  USING (
    organization_id = public.user_pipeline_org_id()
    AND public.user_can_manage_pipeline()
  );

DROP POLICY IF EXISTS "pipeline_automations_delete" ON public.pipeline_automations;
CREATE POLICY "pipeline_automations_delete"
  ON public.pipeline_automations FOR DELETE TO authenticated
  USING (
    organization_id = public.user_pipeline_org_id()
    AND public.user_can_manage_pipeline()
  );

-- Trigger: cuando se crea una organización, inicializa sus automations
CREATE OR REPLACE FUNCTION public.seed_pipeline_automations_for_new_org()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.pipeline_automations (organization_id, key, enabled, config)
  VALUES
    (NEW.id, 'auto_cool_down_14d',       true,  '{"days": 14}'::jsonb),
    (NEW.id, 'auto_advance_on_reply',    false, '{}'::jsonb),
    (NEW.id, 'auto_score_boost_on_open', false, '{"boost": 5}'::jsonb)
  ON CONFLICT (organization_id, key) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_seed_pipeline_automations
  ON public.organizations;

CREATE TRIGGER trg_seed_pipeline_automations
  AFTER INSERT ON public.organizations
  FOR EACH ROW EXECUTE FUNCTION public.seed_pipeline_automations_for_new_org();
