-- =============================================================
-- RH — Cierre de jornada olvidado: cierre forzado + corrección de salida
-- con aprobación de G4.
--   1) Un cron cierra (provisionalmente) las jornadas que quedaron abiertas
--      de días anteriores y las marca 'pending_user'.
--   2) El colaborador declara su hora aproximada de salida -> 'pending_g4'.
--   3) G4 aprueba (fija la hora real) o rechaza (vuelve a pedirla).
-- =============================================================

ALTER TABLE public.rh_attendance
  ADD COLUMN IF NOT EXISTS auto_closed          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS proposed_check_out_at timestamptz,
  ADD COLUMN IF NOT EXISTS checkout_review       text,   -- pending_user | pending_g4 | approved | rejected
  ADD COLUMN IF NOT EXISTS checkout_reviewed_by  uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS checkout_reviewed_at  timestamptz;

-- G4 puede actualizar la asistencia de su organización (para aprobar la salida).
DROP POLICY IF EXISTS "G4 updates org attendance" ON public.rh_attendance;
CREATE POLICY "G4 updates org attendance" ON public.rh_attendance
  FOR UPDATE TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'transformador'))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'transformador'));

-- ---------------- Cierre forzado de jornadas abiertas ----------------
CREATE OR REPLACE FUNCTION public.rh_force_close_jornadas()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.rh_attendance
  SET check_out_at = check_in_at + interval '8 hours',  -- provisional; se corrige al aprobar
      auto_closed = true,
      checkout_review = 'pending_user'
  WHERE check_out_at IS NULL
    AND checkout_review IS NULL
    AND work_date < (now() AT TIME ZONE 'America/Mexico_City')::date;
END $$;

REVOKE ALL ON FUNCTION public.rh_force_close_jornadas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rh_force_close_jornadas() TO postgres;

-- Reprograma de forma idempotente. 08:00 UTC = 02:00 CDMX (ya pasó la medianoche).
DO $$ DECLARE j record; BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'rh-force-close-jornadas' LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  PERFORM cron.schedule('rh-force-close-jornadas', '0 8 * * *',
    $cron$SELECT public.rh_force_close_jornadas()$cron$);
EXCEPTION
  WHEN undefined_function THEN RAISE NOTICE 'pg_cron no disponible';
  WHEN undefined_table THEN RAISE NOTICE 'pg_cron no disponible';
END $$;
