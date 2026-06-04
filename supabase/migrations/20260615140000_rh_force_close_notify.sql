-- =============================================================
-- RH — Aviso al colaborador cuando se cierra su jornada a la fuerza.
-- Reemplaza rh_force_close_jornadas para que, además de cerrar (provisional
-- al fin del día) y marcar 'pending_user', inserte una notificación (campana)
-- pidiéndole declarar su hora de salida. Mantiene el horario 00:01 CDMX.
-- =============================================================

CREATE OR REPLACE FUNCTION public.rh_force_close_jornadas()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  WITH upd AS (
    UPDATE public.rh_attendance
    SET check_out_at = ((work_date + interval '23 hours 59 minutes') AT TIME ZONE 'America/Mexico_City'),
        auto_closed = true,
        checkout_review = 'pending_user'
    WHERE check_out_at IS NULL
      AND checkout_review IS NULL
      AND work_date < (now() AT TIME ZONE 'America/Mexico_City')::date
    RETURNING user_id, organization_id, work_date, id
  )
  INSERT INTO public.notifications (user_id, organization_id, type, title, body, entity_type, entity_id, is_read)
  SELECT
    user_id, organization_id, 'rh_checkout_pending',
    'Registra tu salida',
    'Tu jornada del ' || to_char(work_date, 'DD/MM') ||
      ' se cerró automáticamente porque no registraste tu salida. Indica tu hora aproximada en Recursos Humanos; pasará a aprobación de tu G4.',
    'rh', id, false
  FROM upd;
END $$;

REVOKE ALL ON FUNCTION public.rh_force_close_jornadas() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rh_force_close_jornadas() TO postgres;
