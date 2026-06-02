-- =============================================================
-- RH — aviso proactivo diario de ausencias (Kawiil AI)
-- Cada tarde (CDMX) avisa al G4 responsable de cada célula quién
-- tiene ausencia aprobada para el día siguiente. Inserta en
-- notifications (campana + entrega in-app). Sin edge functions.
-- =============================================================

CREATE OR REPLACE FUNCTION public.rh_absence_daily_digest()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_tomorrow date := ((now() AT TIME ZONE 'America/Mexico_City')::date + 1);
  r record;
BEGIN
  FOR r IN
    SELECT
      c.responsible_user_id AS approver,
      c.organization_id      AS org,
      c.name                 AS celula_name,
      count(*)               AS n,
      string_agg(
        coalesce(p.full_name, 'Alguien')
          || ' (' || public.rh_absence_type_label(a.absence_type)
          || ', ' || public.rh_day_part_label(a.day_part) || ')',
        ', ' ORDER BY p.full_name
      ) AS detalle
    FROM public.rh_absence_requests a
    JOIN public.celulas c ON c.id = a.celula_id AND c.responsible_user_id IS NOT NULL
    JOIN public.profiles p ON p.user_id = a.user_id
    WHERE a.status = 'approved'
      AND v_tomorrow BETWEEN a.start_date AND a.end_date
    GROUP BY c.responsible_user_id, c.organization_id, c.name
  LOOP
    INSERT INTO public.notifications (user_id, organization_id, type, title, body, entity_type, entity_id, is_read)
    VALUES (
      r.approver, r.org, 'rh_absence_digest',
      'Ausencias de mañana · ' || r.celula_name,
      'Mañana ' || to_char(v_tomorrow, 'DD/MM') || ': ' || r.n || ' ausencia(s) — ' || r.detalle,
      'rh', NULL, false
    );
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.rh_absence_daily_digest() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rh_absence_daily_digest() TO postgres;

-- Reprograma el cron de forma idempotente.
DO $$
DECLARE
  j record;
BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'rh-absence-daily-digest'
  LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
EXCEPTION
  WHEN undefined_table THEN
    NULL;
END $$;

-- 01:00 UTC = 19:00 CDMX del día anterior → aviso por la tarde de lo de mañana.
DO $$
BEGIN
  PERFORM cron.schedule(
    'rh-absence-daily-digest',
    '0 1 * * *',
    $cron$SELECT public.rh_absence_daily_digest()$cron$
  );
EXCEPTION
  WHEN undefined_function THEN
    RAISE NOTICE 'pg_cron no disponible; omitiendo schedule de rh-absence-daily-digest';
  WHEN undefined_table THEN
    RAISE NOTICE 'pg_cron no disponible; omitiendo schedule de rh-absence-daily-digest';
END $$;
