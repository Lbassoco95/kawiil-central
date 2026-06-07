-- =============================================================
-- RH — Reclutamiento: cierre de brechas del brief CHRO
--   * Vacante: grado (G1–G4) y presupuesto.
--   * Candidato: liga de examen/psicométrico (Tally/TypeForm fase 0).
--   * Recordatorio 48h: digest diario a G4 de candidatos sin avance.
-- =============================================================

ALTER TABLE public.rh_recruitment_processes
  ADD COLUMN IF NOT EXISTS grade  text,
  ADD COLUMN IF NOT EXISTS budget numeric(12,2);

ALTER TABLE public.rh_candidates
  ADD COLUMN IF NOT EXISTS assessment_url text;

-- ---------------- Recordatorio 48h: digest diario a G4 ----------------
CREATE OR REPLACE FUNCTION public.rh_recruit_stale_digest()
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  WITH last_touch AS (
    SELECT c.id, c.process_id,
           GREATEST(c.created_at, c.updated_at, COALESCE(max(a.created_at), c.created_at)) AS touch
    FROM public.rh_candidates c
    LEFT JOIN public.rh_candidate_activities a ON a.candidate_id = c.id
    WHERE c.status = 'active'
    GROUP BY c.id, c.process_id, c.created_at, c.updated_at
  ),
  stale AS (
    SELECT process_id, count(*) AS cnt
    FROM last_touch
    WHERE touch < now() - interval '48 hours'
    GROUP BY process_id
  )
  INSERT INTO public.notifications (user_id, organization_id, type, title, body, entity_type, entity_id, is_read)
  SELECT ur.user_id, p.organization_id, 'rh_recruit_stale',
         'Candidatos sin avance · ' || p.title,
         s.cnt || ' candidato(s) llevan más de 48 h sin avance en ' || p.title || '. Da seguimiento.',
         'rh', p.id, false
  FROM stale s
  JOIN public.rh_recruitment_processes p ON p.id = s.process_id AND p.status = 'open'
  JOIN public.profiles pr ON pr.organization_id = p.organization_id
  JOIN public.user_roles ur ON ur.user_id = pr.user_id AND ur.role = 'transformador';
END $$;

REVOKE ALL ON FUNCTION public.rh_recruit_stale_digest() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.rh_recruit_stale_digest() TO postgres;

DO $$ DECLARE j record; BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'rh-recruit-stale-digest' LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
EXCEPTION WHEN undefined_table THEN NULL; END $$;

-- 15:00 UTC = 09:00 CDMX (aviso por la mañana).
DO $$ BEGIN
  PERFORM cron.schedule('rh-recruit-stale-digest', '0 15 * * *',
    $cron$SELECT public.rh_recruit_stale_digest()$cron$);
EXCEPTION
  WHEN undefined_function THEN RAISE NOTICE 'pg_cron no disponible';
  WHEN undefined_table THEN RAISE NOTICE 'pg_cron no disponible';
END $$;
