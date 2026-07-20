-- Categorías de calendario propias de Kawiil + etiquetado de eventos de CUALQUIER
-- cuenta (Microsoft principal, Google, Outlook adicional). Como los eventos de las
-- cuentas vinculadas son de solo lectura, la etiqueta se guarda del lado de Kawiil
-- referenciando el id del evento (namespaced para Google/Outlook, id de Graph para M365).
--
-- Deploy: supabase db push

-- 1) Categorías compartidas por organización (ej. "Cliente", "Bloqueo", …).
CREATE TABLE IF NOT EXISTS public.calendar_categories (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  organization_id uuid NOT NULL,
  name text NOT NULL,
  color text NOT NULL DEFAULT '#6366f1',
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, name)
);

CREATE INDEX IF NOT EXISTS idx_calendar_categories_org ON public.calendar_categories (organization_id);

ALTER TABLE public.calendar_categories ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cal_categories_select_org" ON public.calendar_categories;
CREATE POLICY "cal_categories_select_org"
  ON public.calendar_categories FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "cal_categories_insert_org" ON public.calendar_categories;
CREATE POLICY "cal_categories_insert_org"
  ON public.calendar_categories FOR INSERT TO authenticated
  WITH CHECK (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "cal_categories_update_org" ON public.calendar_categories;
CREATE POLICY "cal_categories_update_org"
  ON public.calendar_categories FOR UPDATE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()))
  WITH CHECK (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "cal_categories_delete_org" ON public.calendar_categories;
CREATE POLICY "cal_categories_delete_org"
  ON public.calendar_categories FOR DELETE TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()) AND (created_by = auth.uid() OR is_admin_or_manager(auth.uid())));

GRANT SELECT, INSERT, UPDATE, DELETE ON public.calendar_categories TO authenticated;
GRANT ALL ON public.calendar_categories TO service_role;

-- 2) Etiquetado de eventos (por usuario y por id de evento).
CREATE TABLE IF NOT EXISTS public.calendar_event_tags (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  event_id text NOT NULL,
  category_id uuid NOT NULL REFERENCES public.calendar_categories (id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, event_id, category_id)
);

CREATE INDEX IF NOT EXISTS idx_calendar_event_tags_user ON public.calendar_event_tags (user_id);

ALTER TABLE public.calendar_event_tags ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cal_event_tags_select_own" ON public.calendar_event_tags;
CREATE POLICY "cal_event_tags_select_own"
  ON public.calendar_event_tags FOR SELECT TO authenticated
  USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "cal_event_tags_insert_own" ON public.calendar_event_tags;
CREATE POLICY "cal_event_tags_insert_own"
  ON public.calendar_event_tags FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "cal_event_tags_delete_own" ON public.calendar_event_tags;
CREATE POLICY "cal_event_tags_delete_own"
  ON public.calendar_event_tags FOR DELETE TO authenticated
  USING (auth.uid() = user_id);

GRANT SELECT, INSERT, DELETE ON public.calendar_event_tags TO authenticated;
GRANT ALL ON public.calendar_event_tags TO service_role;
