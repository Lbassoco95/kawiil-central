-- =============================================================
-- RH — Entrega 2: control de jornada por eventos
-- Punches granulares: entrada, comida (pausa), descansos de 20 min,
-- y salida. Cada evento guarda ubicación (también en home office).
-- =============================================================

-- Tipos de evento de jornada
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'rh_event_type') THEN
    CREATE TYPE public.rh_event_type AS ENUM (
      'check_in',
      'lunch_start',
      'lunch_end',
      'break_start',
      'break_end',
      'check_out'
    );
  END IF;
END$$;

-- Ventana de comida de referencia en el turno (flexible; default 14–15)
ALTER TABLE public.rh_work_schedules
  ADD COLUMN IF NOT EXISTS lunch_start time NOT NULL DEFAULT '14:00';
ALTER TABLE public.rh_work_schedules
  ADD COLUMN IF NOT EXISTS lunch_end time NOT NULL DEFAULT '15:00';

-- -------------------------------------------------------------
-- Eventos de jornada (uno por punch). Inmutables.
-- -------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.rh_attendance_events (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  attendance_id      uuid NOT NULL REFERENCES public.rh_attendance(id) ON DELETE CASCADE,
  organization_id    uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  event_type         public.rh_event_type NOT NULL,
  event_at           timestamptz NOT NULL DEFAULT now(),
  lat                numeric(9,6),
  lng                numeric(9,6),
  accuracy_m         numeric,
  within_geofence    boolean,
  office_location_id uuid REFERENCES public.rh_office_locations(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_rh_events_attendance
  ON public.rh_attendance_events(attendance_id, event_at);
CREATE INDEX IF NOT EXISTS idx_rh_events_user
  ON public.rh_attendance_events(user_id, event_at DESC);

-- =============================================================
-- RLS
-- =============================================================
ALTER TABLE public.rh_attendance_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Read own or G4 reads org events" ON public.rh_attendance_events;
CREATE POLICY "Read own or G4 reads org events" ON public.rh_attendance_events
  FOR SELECT TO authenticated
  USING (
    organization_id = public.get_user_org_id(auth.uid())
    AND (user_id = auth.uid() OR public.has_role(auth.uid(), 'transformador'))
  );

DROP POLICY IF EXISTS "Insert own events" ON public.rh_attendance_events;
CREATE POLICY "Insert own events" ON public.rh_attendance_events
  FOR INSERT TO authenticated
  WITH CHECK (
    user_id = auth.uid()
    AND organization_id = public.get_user_org_id(auth.uid())
  );
