-- =============================================================
-- RH — Reclutamiento Fase E: roles Admin / Entrevistador
-- Admin  = rh_is_recruiter (G4 o permiso de módulo 'reclutamiento'): control total.
-- Entrevistador = persona asignada a una vacante: puede VER la vacante y sus
--   candidatos, CALIFICAR la rúbrica y AGREGAR NOTAS. Nada de configuración,
--   importación, correos, mover de fase/estado ni eliminar.
-- Asignación POR VACANTE mediante rh_process_interviewers.
-- =============================================================

CREATE TABLE IF NOT EXISTS public.rh_process_interviewers (
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  process_id      uuid NOT NULL REFERENCES public.rh_recruitment_processes(id) ON DELETE CASCADE,
  user_id         uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_by      uuid REFERENCES auth.users(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (process_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_rh_interviewer_user ON public.rh_process_interviewers(user_id);

-- ---------------- Helpers ----------------
CREATE OR REPLACE FUNCTION public.rh_is_process_interviewer(_user_id uuid, _process_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.rh_process_interviewers
    WHERE user_id = _user_id AND process_id = _process_id
  )
$$;

CREATE OR REPLACE FUNCTION public.rh_is_any_interviewer(_user_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.rh_process_interviewers WHERE user_id = _user_id)
$$;

CREATE OR REPLACE FUNCTION public.rh_can_interview_candidate(_user_id uuid, _candidate_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.rh_candidates c
    JOIN public.rh_process_interviewers i ON i.process_id = c.process_id
    WHERE c.id = _candidate_id AND i.user_id = _user_id
  )
$$;

ALTER TABLE public.rh_process_interviewers ENABLE ROW LEVEL SECURITY;

-- El Admin gestiona las asignaciones; el entrevistador ve sus propias filas.
DROP POLICY IF EXISTS "Recruiters manage interviewers" ON public.rh_process_interviewers;
CREATE POLICY "Recruiters manage interviewers" ON public.rh_process_interviewers
  FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()) AND public.rh_is_recruiter(auth.uid()))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()) AND public.rh_is_recruiter(auth.uid()));

DROP POLICY IF EXISTS "Interviewer sees own assignment" ON public.rh_process_interviewers;
CREATE POLICY "Interviewer sees own assignment" ON public.rh_process_interviewers
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

-- ---------------- Lectura para entrevistadores (políticas adicionales) ----------------
DROP POLICY IF EXISTS "Interviewer reads process" ON public.rh_recruitment_processes;
CREATE POLICY "Interviewer reads process" ON public.rh_recruitment_processes
  FOR SELECT TO authenticated
  USING (public.rh_is_process_interviewer(auth.uid(), id));

DROP POLICY IF EXISTS "Interviewer reads stages" ON public.rh_recruitment_stages;
CREATE POLICY "Interviewer reads stages" ON public.rh_recruitment_stages
  FOR SELECT TO authenticated
  USING (public.rh_is_process_interviewer(auth.uid(), process_id));

DROP POLICY IF EXISTS "Interviewer reads states" ON public.rh_recruitment_states;
CREATE POLICY "Interviewer reads states" ON public.rh_recruitment_states
  FOR SELECT TO authenticated
  USING (public.rh_is_process_interviewer(auth.uid(), process_id));

DROP POLICY IF EXISTS "Interviewer reads criteria" ON public.rh_recruitment_criteria;
CREATE POLICY "Interviewer reads criteria" ON public.rh_recruitment_criteria
  FOR SELECT TO authenticated
  USING (public.rh_is_process_interviewer(auth.uid(), process_id));

DROP POLICY IF EXISTS "Interviewer reads candidates" ON public.rh_candidates;
CREATE POLICY "Interviewer reads candidates" ON public.rh_candidates
  FOR SELECT TO authenticated
  USING (public.rh_is_process_interviewer(auth.uid(), process_id));

-- Calificar la rúbrica: ver, crear y actualizar sus calificaciones.
DROP POLICY IF EXISTS "Interviewer reads scores" ON public.rh_candidate_scores;
CREATE POLICY "Interviewer reads scores" ON public.rh_candidate_scores
  FOR SELECT TO authenticated
  USING (public.rh_can_interview_candidate(auth.uid(), candidate_id));

DROP POLICY IF EXISTS "Interviewer inserts scores" ON public.rh_candidate_scores;
CREATE POLICY "Interviewer inserts scores" ON public.rh_candidate_scores
  FOR INSERT TO authenticated
  WITH CHECK (
    organization_id = public.get_user_org_id(auth.uid())
    AND public.rh_can_interview_candidate(auth.uid(), candidate_id)
  );

DROP POLICY IF EXISTS "Interviewer updates scores" ON public.rh_candidate_scores;
CREATE POLICY "Interviewer updates scores" ON public.rh_candidate_scores
  FOR UPDATE TO authenticated
  USING (public.rh_can_interview_candidate(auth.uid(), candidate_id))
  WITH CHECK (public.rh_can_interview_candidate(auth.uid(), candidate_id));

-- Seguimiento: ver actividad y agregar NOTAS (no correos ni cambios de fase).
DROP POLICY IF EXISTS "Interviewer reads activities" ON public.rh_candidate_activities;
CREATE POLICY "Interviewer reads activities" ON public.rh_candidate_activities
  FOR SELECT TO authenticated
  USING (public.rh_can_interview_candidate(auth.uid(), candidate_id));

DROP POLICY IF EXISTS "Interviewer adds notes" ON public.rh_candidate_activities;
CREATE POLICY "Interviewer adds notes" ON public.rh_candidate_activities
  FOR INSERT TO authenticated
  WITH CHECK (
    activity_type = 'note'
    AND organization_id = public.get_user_org_id(auth.uid())
    AND public.rh_can_interview_candidate(auth.uid(), candidate_id)
  );

-- CV: los entrevistadores (de cualquier vacante) pueden leer los CV.
DROP POLICY IF EXISTS "CV interviewers select" ON storage.objects;
CREATE POLICY "CV interviewers select" ON storage.objects
  FOR SELECT TO authenticated
  USING (bucket_id = 'cv' AND public.rh_is_any_interviewer(auth.uid()));

-- =============================================================
-- Rating automático: al calificar, recalcular el promedio ponderado en
-- rh_candidates.rating mediante trigger (SECURITY DEFINER), para que los
-- entrevistadores no necesiten permiso de UPDATE sobre rh_candidates.
-- =============================================================
CREATE OR REPLACE FUNCTION public.rh_recalc_candidate_rating()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE _cand uuid; _avg numeric;
BEGIN
  _cand := COALESCE(NEW.candidate_id, OLD.candidate_id);
  SELECT sum(s.score * c.weight) / NULLIF(sum(c.weight), 0)
    INTO _avg
  FROM public.rh_candidate_scores s
  JOIN public.rh_recruitment_criteria c ON c.id = s.criterion_id
  WHERE s.candidate_id = _cand;
  UPDATE public.rh_candidates
    SET rating = COALESCE(round(_avg), 0)
    WHERE id = _cand;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS rh_recalc_rating ON public.rh_candidate_scores;
CREATE TRIGGER rh_recalc_rating
  AFTER INSERT OR UPDATE OR DELETE ON public.rh_candidate_scores
  FOR EACH ROW EXECUTE FUNCTION public.rh_recalc_candidate_rating();
