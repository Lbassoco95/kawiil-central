-- Ubicación / estatus de trabajo por día y por usuario ("¿dónde estás trabajando?").
-- Más que un lugar fijo, es un ESTATUS: en tránsito (p. ej. atendiendo desde el coche),
-- remoto, en oficina, o en sitio (en un cliente/empresa como Dazon).
-- Visible para la organización (base para coordinar al equipo).
--
-- Deploy: supabase db push

CREATE TABLE IF NOT EXISTS public.work_locations (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  organization_id uuid NOT NULL,
  date date NOT NULL,
  -- oficina | remoto | transito | en_sitio
  status text NOT NULL DEFAULT 'oficina',
  place text,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_work_locations_org_date ON public.work_locations (organization_id, date);

ALTER TABLE public.work_locations ENABLE ROW LEVEL SECURITY;

-- Los miembros de la organización ven las ubicaciones de todos (coordinación de equipo).
DROP POLICY IF EXISTS "work_locations_select_org" ON public.work_locations;
CREATE POLICY "work_locations_select_org"
  ON public.work_locations FOR SELECT TO authenticated
  USING (organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "work_locations_insert_own" ON public.work_locations;
CREATE POLICY "work_locations_insert_own"
  ON public.work_locations FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND organization_id = get_user_org_id(auth.uid()));

DROP POLICY IF EXISTS "work_locations_update_own" ON public.work_locations;
CREATE POLICY "work_locations_update_own"
  ON public.work_locations FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "work_locations_delete_own" ON public.work_locations;
CREATE POLICY "work_locations_delete_own"
  ON public.work_locations FOR DELETE TO authenticated
  USING (user_id = auth.uid());

GRANT SELECT, INSERT, UPDATE, DELETE ON public.work_locations TO authenticated;
GRANT ALL ON public.work_locations TO service_role;

CREATE OR REPLACE FUNCTION public.set_work_locations_updated_at()
RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := now(); RETURN NEW; END; $$;

DROP TRIGGER IF EXISTS trg_work_locations_updated_at ON public.work_locations;
CREATE TRIGGER trg_work_locations_updated_at
  BEFORE UPDATE ON public.work_locations
  FOR EACH ROW EXECUTE FUNCTION public.set_work_locations_updated_at();
