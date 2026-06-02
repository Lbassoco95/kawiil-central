-- =============================================================
-- Módulo de Recursos Humanos (RH) — Entrega 1
-- Fundación: check-in/out de horario con geolocalización,
-- configuración de turnos y modalidad (oficina / home office)
-- por empleado, administrada por los G4 (transformador).
-- =============================================================

-- Modalidad de trabajo (ubicación esperada / registrada)
--   office       → en la oficina (validable por geocerca)
--   home_office  → trabajo desde casa
--   commission   → de comisión / trabajo de campo fuera de oficina
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rh_work_mode') THEN
    CREATE TYPE public.rh_work_mode AS ENUM ('office', 'home_office', 'commission');
  END IF;
END$$;

-- Tipo de contratación
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rh_employment_type') THEN
    CREATE TYPE public.rh_employment_type AS ENUM ('full_time', 'part_time');
  END IF;
END$$;

-- -------------------------------------------------------------
-- Ubicaciones de oficina (geocerca). Configuradas por G4.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rh_office_locations (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name            text NOT NULL,
  address         text,
  latitude        numeric(9,6) NOT NULL,
  longitude       numeric(9,6) NOT NULL,
  radius_meters   integer NOT NULL DEFAULT 150,
  is_active       boolean NOT NULL DEFAULT true,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rh_office_locations_org
  ON public.rh_office_locations(organization_id);

-- -------------------------------------------------------------
-- Turno + modalidad semanal por empleado. Configurado por G4.
-- weekly_plan: jsonb { "1": "office", "2": "home_office", ... "7": null }
-- claves = ISO weekday (1=Lunes ... 7=Domingo); null = día de descanso.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rh_work_schedules (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id   uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id           uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  shift_label       text NOT NULL DEFAULT 'Turno general',
  employment_type   public.rh_employment_type NOT NULL DEFAULT 'full_time',
  start_time        time NOT NULL DEFAULT '09:00',
  end_time          time NOT NULL DEFAULT '18:00',
  timezone          text NOT NULL DEFAULT 'America/Mexico_City',
  default_work_mode public.rh_work_mode NOT NULL DEFAULT 'office',
  weekly_plan       jsonb NOT NULL DEFAULT '{}'::jsonb,
  office_location_id uuid REFERENCES public.rh_office_locations(id) ON DELETE SET NULL,
  notes             text,
  assigned_by       uuid REFERENCES auth.users(id),
  created_at        timestamptz NOT NULL DEFAULT now(),
  updated_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_rh_work_schedules_org
  ON public.rh_work_schedules(organization_id);

-- -------------------------------------------------------------
-- Registros de asistencia (check-in / check-out) con geo.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rh_attendance (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id     uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id             uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  work_date           date NOT NULL DEFAULT (now() AT TIME ZONE 'America/Mexico_City')::date,
  check_in_at         timestamptz NOT NULL DEFAULT now(),
  check_out_at        timestamptz,
  work_mode           public.rh_work_mode NOT NULL DEFAULT 'office',
  -- Modalidad planificada por el turno del G4 (para evaluar cumplimiento)
  expected_work_mode  public.rh_work_mode,
  -- Geolocalización del check-in
  check_in_lat        numeric(9,6),
  check_in_lng        numeric(9,6),
  check_in_accuracy_m numeric,
  within_geofence     boolean,
  office_location_id  uuid REFERENCES public.rh_office_locations(id) ON DELETE SET NULL,
  -- Geolocalización del check-out
  check_out_lat       numeric(9,6),
  check_out_lng       numeric(9,6),
  notes               text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rh_attendance_user_date
  ON public.rh_attendance(user_id, work_date DESC);
CREATE INDEX IF NOT EXISTS idx_rh_attendance_org_date
  ON public.rh_attendance(organization_id, work_date DESC);

-- -------------------------------------------------------------
-- Triggers updated_at (reutiliza helper existente)
-- -------------------------------------------------------------
DROP TRIGGER IF EXISTS set_updated_at_rh_office_locations ON public.rh_office_locations;
CREATE TRIGGER set_updated_at_rh_office_locations
  BEFORE UPDATE ON public.rh_office_locations
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at_rh_work_schedules ON public.rh_work_schedules;
CREATE TRIGGER set_updated_at_rh_work_schedules
  BEFORE UPDATE ON public.rh_work_schedules
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

DROP TRIGGER IF EXISTS set_updated_at_rh_attendance ON public.rh_attendance;
CREATE TRIGGER set_updated_at_rh_attendance
  BEFORE UPDATE ON public.rh_attendance
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- =============================================================
-- RLS
-- =============================================================
ALTER TABLE public.rh_office_locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_work_schedules  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_attendance      ENABLE ROW LEVEL SECURITY;

-- ---- Office locations: todos en la org leen; solo G4 administra ----
CREATE POLICY "Org reads office locations" ON public.rh_office_locations
  FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));

CREATE POLICY "G4 manage office locations" ON public.rh_office_locations
  FOR ALL TO authenticated
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    AND public.has_role(auth.uid(), 'transformador')
  )
  WITH CHECK (
    organization_id = public.get_user_org_id(auth.uid())
    AND public.has_role(auth.uid(), 'transformador')
  );

-- ---- Work schedules: empleado ve el suyo; G4 ve y administra toda la org ----
CREATE POLICY "Read own or G4 reads org schedules" ON public.rh_work_schedules
  FOR SELECT TO authenticated
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    AND (user_id = auth.uid() OR public.has_role(auth.uid(), 'transformador'))
  );

CREATE POLICY "G4 manage schedules" ON public.rh_work_schedules
  FOR ALL TO authenticated
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    AND public.has_role(auth.uid(), 'transformador')
  )
  WITH CHECK (
    organization_id = public.get_user_org_id(auth.uid())
    AND public.has_role(auth.uid(), 'transformador')
  );

-- ---- Attendance: empleado ve/crea/cierra el suyo; G4 ve toda la org ----
CREATE POLICY "Read own or G4 reads org attendance" ON public.rh_attendance
  FOR SELECT TO authenticated
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    AND (user_id = auth.uid() OR public.has_role(auth.uid(), 'transformador'))
  );

CREATE POLICY "Insert own attendance" ON public.rh_attendance
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND organization_id = public.get_user_org_id(auth.uid())
  );

CREATE POLICY "Update own attendance" ON public.rh_attendance
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

-- Nota: RH vive dentro del módulo Hub (no requiere permiso de módulo propio).
-- Todos los Kawiilers con acceso a Hub pueden registrar su jornada; las
-- vistas de administración (turnos, asistencia del equipo, oficinas) se
-- gatean dentro de la app por el grado G4 (transformador).
