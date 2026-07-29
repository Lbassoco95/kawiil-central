-- Módulo de Actividades internas del despacho.
-- Da control y seguimiento a eventos internos (NO de cliente): convivencias,
-- capacitaciones/cursos que imparte el equipo y actividades del despacho.
-- Es un módulo propio, independiente de Proyectos (que es trabajo de cliente).
--
--   activities       → el evento/actividad (tipo, fecha, sede, responsable,
--                      estatus y presupuesto estimado vs. gastado).
--   activity_items   → los pendientes/seguimiento de cada actividad
--                      (responsable, estatus, fecha límite y costo).
--
-- RLS: colaborativa por organización — cualquier integrante de la organización
-- puede ver y editar las actividades de su organización.

-- ─── Tabla principal: actividades ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.activities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  name text NOT NULL,
  activity_type text,
  status text NOT NULL DEFAULT 'planeacion',
  event_date date,
  location text,
  responsible_user_id uuid,
  budget_estimated numeric,
  budget_spent numeric,
  dropbox_url text,
  notes text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT activities_activity_type_check
    CHECK (activity_type IS NULL OR activity_type IN ('convivencia', 'capacitacion', 'despacho', 'otro')),
  CONSTRAINT activities_status_check
    CHECK (status IN ('planeacion', 'en_curso', 'completada', 'cancelada')),
  CONSTRAINT activities_budget_non_negative_check
    CHECK ((budget_estimated IS NULL OR budget_estimated >= 0)
       AND (budget_spent IS NULL OR budget_spent >= 0))
);

CREATE INDEX IF NOT EXISTS idx_activities_org ON public.activities (organization_id);
CREATE INDEX IF NOT EXISTS idx_activities_type ON public.activities (activity_type) WHERE activity_type IS NOT NULL;

ALTER TABLE public.activities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "activities_select_org" ON public.activities;
CREATE POLICY "activities_select_org"
  ON public.activities FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "activities_insert_org" ON public.activities;
CREATE POLICY "activities_insert_org"
  ON public.activities FOR INSERT TO authenticated
  WITH CHECK (created_by = auth.uid() AND organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "activities_update_org" ON public.activities;
CREATE POLICY "activities_update_org"
  ON public.activities FOR UPDATE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()))
  WITH CHECK (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "activities_delete_org" ON public.activities;
CREATE POLICY "activities_delete_org"
  ON public.activities FOR DELETE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.activities TO authenticated;
GRANT ALL ON public.activities TO service_role;

DROP TRIGGER IF EXISTS set_activities_updated_at ON public.activities;
CREATE TRIGGER set_activities_updated_at
  BEFORE UPDATE ON public.activities
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─── Tabla hija: pendientes / seguimiento ────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.activity_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id uuid NOT NULL REFERENCES public.activities(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  title text NOT NULL,
  responsible text,
  status text NOT NULL DEFAULT 'pendiente',
  due_date date,
  budget_estimated numeric,
  budget_spent numeric,
  notes text,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT activity_items_status_check
    CHECK (status IN ('pendiente', 'en_proceso', 'en_revision', 'hecho')),
  CONSTRAINT activity_items_budget_non_negative_check
    CHECK ((budget_estimated IS NULL OR budget_estimated >= 0)
       AND (budget_spent IS NULL OR budget_spent >= 0))
);

CREATE INDEX IF NOT EXISTS idx_activity_items_activity ON public.activity_items (activity_id);
CREATE INDEX IF NOT EXISTS idx_activity_items_org ON public.activity_items (organization_id);

ALTER TABLE public.activity_items ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "activity_items_select_org" ON public.activity_items;
CREATE POLICY "activity_items_select_org"
  ON public.activity_items FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "activity_items_insert_org" ON public.activity_items;
CREATE POLICY "activity_items_insert_org"
  ON public.activity_items FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND organization_id = get_user_org_id(auth.uid())
    AND activity_id IN (SELECT id FROM public.activities WHERE organization_id = get_user_org_id(auth.uid()))
  );

DROP POLICY IF EXISTS "activity_items_update_org" ON public.activity_items;
CREATE POLICY "activity_items_update_org"
  ON public.activity_items FOR UPDATE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()))
  WITH CHECK (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "activity_items_delete_org" ON public.activity_items;
CREATE POLICY "activity_items_delete_org"
  ON public.activity_items FOR DELETE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.activity_items TO authenticated;
GRANT ALL ON public.activity_items TO service_role;

DROP TRIGGER IF EXISTS set_activity_items_updated_at ON public.activity_items;
CREATE TRIGGER set_activity_items_updated_at
  BEFORE UPDATE ON public.activity_items
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
