-- =============================================================
-- RH — Iniciar jornada de forma atómica e idempotente.
--
-- Problema: el cliente insertaba rh_attendance y luego el punch
-- (rh_attendance_events) en dos round-trips. Si fallaba el segundo,
-- o si la UI leía la sesión abierta sin eventos aún, el botón
-- "Iniciar jornada" parecía arrancar y luego se revertía (o
-- respondía "ya tienes una jornada abierta").
--
-- Solución: una sola función SECURITY DEFINER que, en una
-- transacción:
--   * reutiliza jornada huérfana abierta de hoy (CDMX),
--   * es idempotente si ya hay check_in,
--   * o crea attendance + evento check_in juntos.
-- =============================================================

CREATE OR REPLACE FUNCTION public.rh_start_jornada(
  p_work_mode public.rh_work_mode,
  p_expected_work_mode public.rh_work_mode DEFAULT NULL,
  p_lat numeric DEFAULT NULL,
  p_lng numeric DEFAULT NULL,
  p_accuracy_m numeric DEFAULT NULL,
  p_within_geofence boolean DEFAULT NULL,
  p_office_location_id uuid DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'pg_temp', 'public'
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_org uuid;
  v_today date := (now() AT TIME ZONE 'America/Mexico_City')::date;
  v_att public.rh_attendance%ROWTYPE;
  v_has_checkin boolean := false;
  v_created boolean := false;
  v_additional boolean := false;
  v_count integer := 0;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'not_authenticated' USING ERRCODE = '42501';
  END IF;

  v_org := public.get_user_org_id(v_uid);
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'no_organization' USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_att
  FROM public.rh_attendance
  WHERE user_id = v_uid
    AND work_date = v_today
    AND check_out_at IS NULL
  ORDER BY check_in_at DESC
  LIMIT 1;

  IF FOUND THEN
    SELECT EXISTS (
      SELECT 1
      FROM public.rh_attendance_events e
      WHERE e.attendance_id = v_att.id
        AND e.event_type = 'check_in'
    ) INTO v_has_checkin;

    IF v_has_checkin THEN
      RETURN jsonb_build_object(
        'attendance', to_jsonb(v_att),
        'already_active', true,
        'created', false
      );
    END IF;

    -- Huérfana: actualizar modalidad/geo y backfill del evento abajo.
    UPDATE public.rh_attendance
    SET
      work_mode = p_work_mode,
      expected_work_mode = COALESCE(p_expected_work_mode, expected_work_mode),
      check_in_lat = COALESCE(p_lat, check_in_lat),
      check_in_lng = COALESCE(p_lng, check_in_lng),
      check_in_accuracy_m = COALESCE(p_accuracy_m, check_in_accuracy_m),
      within_geofence = COALESCE(p_within_geofence, within_geofence),
      office_location_id = COALESCE(p_office_location_id, office_location_id)
    WHERE id = v_att.id
    RETURNING * INTO v_att;
  ELSE
    SELECT COUNT(*)::integer
      INTO v_count
    FROM public.rh_attendance
    WHERE user_id = v_uid
      AND work_date = v_today;
    v_additional := v_count > 0;

    INSERT INTO public.rh_attendance (
      user_id,
      organization_id,
      work_date,
      check_in_at,
      work_mode,
      expected_work_mode,
      check_in_lat,
      check_in_lng,
      check_in_accuracy_m,
      within_geofence,
      office_location_id,
      is_additional_shift
    ) VALUES (
      v_uid,
      v_org,
      v_today,
      now(),
      p_work_mode,
      p_expected_work_mode,
      p_lat,
      p_lng,
      p_accuracy_m,
      p_within_geofence,
      p_office_location_id,
      v_additional
    )
    RETURNING * INTO v_att;
    v_created := true;
  END IF;

  INSERT INTO public.rh_attendance_events (
    attendance_id,
    organization_id,
    user_id,
    event_type,
    event_at,
    lat,
    lng,
    accuracy_m,
    within_geofence,
    office_location_id
  ) VALUES (
    v_att.id,
    v_org,
    v_uid,
    'check_in',
    now(),
    p_lat,
    p_lng,
    p_accuracy_m,
    p_within_geofence,
    p_office_location_id
  );

  RETURN jsonb_build_object(
    'attendance', to_jsonb(v_att),
    'already_active', false,
    'created', v_created
  );
END;
$$;

REVOKE ALL ON FUNCTION public.rh_start_jornada(
  public.rh_work_mode,
  public.rh_work_mode,
  numeric,
  numeric,
  numeric,
  boolean,
  uuid
) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.rh_start_jornada(
  public.rh_work_mode,
  public.rh_work_mode,
  numeric,
  numeric,
  numeric,
  boolean,
  uuid
) TO authenticated;

COMMENT ON FUNCTION public.rh_start_jornada(
  public.rh_work_mode,
  public.rh_work_mode,
  numeric,
  numeric,
  numeric,
  boolean,
  uuid
) IS
  'Inicia (o reanuda) la jornada del usuario autenticado en el día CDMX: atómico e idempotente.';
