-- =============================================================
-- RH — Reclutamiento Fase A+B
-- A) Ficha de candidato completa: datos académicos, software,
--    experiencia/pretensión, disponibilidad y enlaces.
-- B) Rúbrica de scoring: criterios ponderados por vacante y
--    calificaciones por candidato.
-- =============================================================

-- ---------------- A) Campos de la ficha ----------------
ALTER TABLE public.rh_candidates
  ADD COLUMN IF NOT EXISTS university        text,
  ADD COLUMN IF NOT EXISTS degree            text,
  ADD COLUMN IF NOT EXISTS education_status  text,         -- titulado | pasante | trunco
  ADD COLUMN IF NOT EXISTS skills            text[] NOT NULL DEFAULT '{}',
  ADD COLUMN IF NOT EXISTS years_experience  numeric(4,1),
  ADD COLUMN IF NOT EXISTS salary_expectation numeric(12,2),
  ADD COLUMN IF NOT EXISTS available_from    date,
  ADD COLUMN IF NOT EXISTS linkedin_url      text,
  ADD COLUMN IF NOT EXISTS portfolio_url     text;

-- ---------------- B) Criterios de la rúbrica ----------------
CREATE TABLE IF NOT EXISTS public.rh_recruitment_criteria (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  process_id      uuid NOT NULL REFERENCES public.rh_recruitment_processes(id) ON DELETE CASCADE,
  name            text NOT NULL,
  weight          numeric(5,2) NOT NULL DEFAULT 1,
  position        integer NOT NULL DEFAULT 0,
  created_at      timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_rh_crit_proc ON public.rh_recruitment_criteria(process_id, position);

-- Calificación de un candidato en un criterio (1..5).
CREATE TABLE IF NOT EXISTS public.rh_candidate_scores (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  candidate_id    uuid NOT NULL REFERENCES public.rh_candidates(id) ON DELETE CASCADE,
  criterion_id    uuid NOT NULL REFERENCES public.rh_recruitment_criteria(id) ON DELETE CASCADE,
  score           integer NOT NULL CHECK (score BETWEEN 1 AND 5),
  scored_by       uuid REFERENCES auth.users(id),
  updated_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (candidate_id, criterion_id)
);
CREATE INDEX IF NOT EXISTS idx_rh_score_cand ON public.rh_candidate_scores(candidate_id);

ALTER TABLE public.rh_recruitment_criteria ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.rh_candidate_scores ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Recruiters manage rh_recruitment_criteria" ON public.rh_recruitment_criteria;
CREATE POLICY "Recruiters manage rh_recruitment_criteria" ON public.rh_recruitment_criteria
  FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()) AND public.rh_is_recruiter(auth.uid()))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()) AND public.rh_is_recruiter(auth.uid()));

DROP POLICY IF EXISTS "Recruiters manage rh_candidate_scores" ON public.rh_candidate_scores;
CREATE POLICY "Recruiters manage rh_candidate_scores" ON public.rh_candidate_scores
  FOR ALL TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()) AND public.rh_is_recruiter(auth.uid()))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()) AND public.rh_is_recruiter(auth.uid()));

-- ---- Seed de criterios por defecto para procesos existentes ----
DO $$
DECLARE p record;
BEGIN
  FOR p IN SELECT id, organization_id FROM public.rh_recruitment_processes LOOP
    IF NOT EXISTS (SELECT 1 FROM public.rh_recruitment_criteria WHERE process_id = p.id) THEN
      INSERT INTO public.rh_recruitment_criteria (organization_id, process_id, name, weight, position)
      VALUES
        (p.organization_id, p.id, 'Experiencia',        1, 0),
        (p.organization_id, p.id, 'Habilidades técnicas', 1, 1),
        (p.organization_id, p.id, 'Comunicación',        1, 2),
        (p.organization_id, p.id, 'Cultura / actitud',   1, 3);
    END IF;
  END LOOP;
END $$;
