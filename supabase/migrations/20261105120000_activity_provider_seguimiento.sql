-- Seguimiento detallado de proveedores/cotizaciones de una actividad:
--   · responsable y fecha límite por proveedor
--   · subtareas (items) con responsable, fecha límite y estado
--   · comentarios / bitácora

ALTER TABLE public.activity_providers
  ADD COLUMN IF NOT EXISTS assigned_to uuid,
  ADD COLUMN IF NOT EXISTS due_date date;

-- ─── Subtareas ───────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.activity_provider_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.activity_providers(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  title text NOT NULL,
  completed boolean NOT NULL DEFAULT false,
  completed_at timestamptz,
  assigned_to uuid,
  due_date date,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activity_provider_items_provider ON public.activity_provider_items (provider_id);

-- ─── Comentarios ─────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.activity_provider_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider_id uuid NOT NULL REFERENCES public.activity_providers(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  user_id uuid NOT NULL,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_activity_provider_comments_provider ON public.activity_provider_comments (provider_id);

-- ─── RLS ─────────────────────────────────────────────────────────────────────
ALTER TABLE public.activity_provider_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.activity_provider_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "activity_provider_items_select_org" ON public.activity_provider_items;
CREATE POLICY "activity_provider_items_select_org"
  ON public.activity_provider_items FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));
DROP POLICY IF EXISTS "activity_provider_items_insert_org" ON public.activity_provider_items;
CREATE POLICY "activity_provider_items_insert_org"
  ON public.activity_provider_items FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND organization_id = get_user_org_id(auth.uid())
    AND provider_id IN (SELECT id FROM public.activity_providers WHERE organization_id = get_user_org_id(auth.uid()))
  );
DROP POLICY IF EXISTS "activity_provider_items_update_org" ON public.activity_provider_items;
CREATE POLICY "activity_provider_items_update_org"
  ON public.activity_provider_items FOR UPDATE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()))
  WITH CHECK (organization_id = get_user_org_id(auth.uid()));
DROP POLICY IF EXISTS "activity_provider_items_delete_org" ON public.activity_provider_items;
CREATE POLICY "activity_provider_items_delete_org"
  ON public.activity_provider_items FOR DELETE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "activity_provider_comments_select_org" ON public.activity_provider_comments;
CREATE POLICY "activity_provider_comments_select_org"
  ON public.activity_provider_comments FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));
DROP POLICY IF EXISTS "activity_provider_comments_insert_org" ON public.activity_provider_comments;
CREATE POLICY "activity_provider_comments_insert_org"
  ON public.activity_provider_comments FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND organization_id = get_user_org_id(auth.uid())
    AND provider_id IN (SELECT id FROM public.activity_providers WHERE organization_id = get_user_org_id(auth.uid()))
  );
DROP POLICY IF EXISTS "activity_provider_comments_delete_own" ON public.activity_provider_comments;
CREATE POLICY "activity_provider_comments_delete_own"
  ON public.activity_provider_comments FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND organization_id = get_user_org_id(auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.activity_provider_items TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.activity_provider_comments TO authenticated;
GRANT ALL ON public.activity_provider_items TO service_role;
GRANT ALL ON public.activity_provider_comments TO service_role;

DROP TRIGGER IF EXISTS set_activity_provider_items_updated_at ON public.activity_provider_items;
CREATE TRIGGER set_activity_provider_items_updated_at
  BEFORE UPDATE ON public.activity_provider_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
