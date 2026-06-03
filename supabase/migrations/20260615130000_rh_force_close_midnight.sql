-- =============================================================
-- RH — Ajuste del cierre forzado de jornada:
--   * Corre a las 00:01 (CDMX), apenas termina el día.
--   * El cierre provisional NO asume 8h: tapa al FIN DEL DÍA trabajado
--     (23:59 CDMX), porque la jornada real puede ser más larga y eso lo
--     declara el colaborador (y lo aprueba G4). Lo que no puede pasar es
--     que termine el día y siga "trabajando".
-- (Auto-contenida: reasegura columnas/RLS por si la migración previa no
--  se corrió.)
-- =============================================================

ALTER TABLE public.rh_attendance
  ADD COLUMN IF NOT EXISTS auto_closed          boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS proposed_check_out_at timestamptz,
  ADD COLUMN IF NOT EXISTS checkout_review       text,
  ADD COLUMN IF NOT EXISTS checkout_reviewed_by  uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS checkout_reviewed_at  timestamptz;

DROP POLICY IF EXISTS "G4 updates org attendance" ON public.rh_attendance;
CREATE POLICY "G4 updates org attendance" ON public.rh_attendance
  FOR UPDATE TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'transformador'))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()) AND public.has_role(auth.uid(), 'transformador'));

CREATE OR REPLACE FUNCTION public.rh_force_close_jornadas()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  UPDATE public.rh_attendance
  SET check_out_at = ((work_date + interval '23 hours 59 minutes') AT TIME ZONE 'America/Mexico_City'),
      auto_closed = true,
      checkout_review = 'pending_user'
  WHERE check_out_at IS NULL
    AND checkout_review IS NULL
    AND work_date < (now() AT TIME ZONE 'America/Mexico_City')::date;
END $$;

REVOKE ALL ON FUNCTION public.rh_force_close_jornadas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rh_force_close_jornadas() TO postgres;

-- Reprograma a las 00:01 CDMX (= 06:01 UTC, sin horario de verano).
DO $$ DECLARE j record; BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'rh-force-close-jornadas' LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
EXCEPTION WHEN undefined_table THEN NULL; END $$;

DO $$ BEGIN
  PERFORM cron.schedule('rh-force-close-jornadas', '1 6 * * *',
    $cron$SELECT public.rh_force_close_jornadas()$cron$);
EXCEPTION
  WHEN undefined_function THEN RAISE NOTICE 'pg_cron no disponible';
  WHEN undefined_table THEN RAISE NOTICE 'pg_cron no disponible';
END $$;
