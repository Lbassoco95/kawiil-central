-- Fase 2 del módulo de Actividades: asistentes/confirmaciones y proveedores.
--   activity_attendees → quién asiste y su confirmación (convivencias) o
--                        participantes (capacitaciones).
--   activity_providers → cotizaciones/proveedores por rubro (casas, alimentos,
--                        souvenirs, obsequios) con precio, adelanto y estatus.
-- Mismo patrón de RLS colaborativa por organización que el módulo base.

-- ─── Asistentes ──────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.activity_attendees (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id uuid NOT NULL REFERENCES public.activities(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  name text NOT NULL,
  user_id uuid,
  confirmed text NOT NULL DEFAULT 'pendiente',
  dietary_restriction text,
  notes text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT activity_attendees_confirmed_check
    CHECK (confirmed IN ('si', 'no', 'pendiente'))
);

CREATE INDEX IF NOT EXISTS idx_activity_attendees_activity ON public.activity_attendees (activity_id);
CREATE INDEX IF NOT EXISTS idx_activity_attendees_org ON public.activity_attendees (organization_id);

ALTER TABLE public.activity_attendees ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "activity_attendees_select_org" ON public.activity_attendees;
CREATE POLICY "activity_attendees_select_org"
  ON public.activity_attendees FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "activity_attendees_insert_org" ON public.activity_attendees;
CREATE POLICY "activity_attendees_insert_org"
  ON public.activity_attendees FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND organization_id = get_user_org_id(auth.uid())
    AND activity_id IN (SELECT id FROM public.activities WHERE organization_id = get_user_org_id(auth.uid()))
  );

DROP POLICY IF EXISTS "activity_attendees_update_org" ON public.activity_attendees;
CREATE POLICY "activity_attendees_update_org"
  ON public.activity_attendees FOR UPDATE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()))
  WITH CHECK (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "activity_attendees_delete_org" ON public.activity_attendees;
CREATE POLICY "activity_attendees_delete_org"
  ON public.activity_attendees FOR DELETE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.activity_attendees TO authenticated;
GRANT ALL ON public.activity_attendees TO service_role;

DROP TRIGGER IF EXISTS set_activity_attendees_updated_at ON public.activity_attendees;
CREATE TRIGGER set_activity_attendees_updated_at
  BEFORE UPDATE ON public.activity_attendees
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- ─── Proveedores / cotizaciones ──────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.activity_providers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  activity_id uuid NOT NULL REFERENCES public.activities(id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  category text NOT NULL DEFAULT 'otro',
  name text NOT NULL,
  description text,
  unit_price numeric,
  quantity numeric,
  advance numeric,
  status text NOT NULL DEFAULT 'cotizacion',
  link text,
  notes text,
  created_by uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT activity_providers_category_check
    CHECK (category IN ('casas', 'alimentos', 'souvenirs', 'obsequios', 'otro')),
  CONSTRAINT activity_providers_status_check
    CHECK (status IN ('cotizacion', 'elegido', 'apartado', 'pagado', 'descartado')),
  CONSTRAINT activity_providers_amounts_non_negative_check
    CHECK ((unit_price IS NULL OR unit_price >= 0)
       AND (quantity IS NULL OR quantity >= 0)
       AND (advance IS NULL OR advance >= 0))
);

CREATE INDEX IF NOT EXISTS idx_activity_providers_activity ON public.activity_providers (activity_id);
CREATE INDEX IF NOT EXISTS idx_activity_providers_org ON public.activity_providers (organization_id);

ALTER TABLE public.activity_providers ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "activity_providers_select_org" ON public.activity_providers;
CREATE POLICY "activity_providers_select_org"
  ON public.activity_providers FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "activity_providers_insert_org" ON public.activity_providers;
CREATE POLICY "activity_providers_insert_org"
  ON public.activity_providers FOR INSERT TO authenticated
  WITH CHECK (
    created_by = auth.uid()
    AND organization_id = get_user_org_id(auth.uid())
    AND activity_id IN (SELECT id FROM public.activities WHERE organization_id = get_user_org_id(auth.uid()))
  );

DROP POLICY IF EXISTS "activity_providers_update_org" ON public.activity_providers;
CREATE POLICY "activity_providers_update_org"
  ON public.activity_providers FOR UPDATE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()))
  WITH CHECK (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "activity_providers_delete_org" ON public.activity_providers;
CREATE POLICY "activity_providers_delete_org"
  ON public.activity_providers FOR DELETE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.activity_providers TO authenticated;
GRANT ALL ON public.activity_providers TO service_role;

DROP TRIGGER IF EXISTS set_activity_providers_updated_at ON public.activity_providers;
CREATE TRIGGER set_activity_providers_updated_at
  BEFORE UPDATE ON public.activity_providers
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
