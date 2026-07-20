-- =============================================================
-- RH — Reclutamiento: evaluación (rúbrica) por entrevistador
--   Antes había una sola calificación por (candidato, criterio) —compartida—.
--   Ahora cada entrevistador tiene su propia calificación, y la ficha muestra
--   el promedio del panel. Se cambia la llave única para incluir scored_by.
-- =============================================================

-- Quita la restricción única antigua (nombre por defecto de Postgres).
ALTER TABLE public.rh_candidate_scores
  DROP CONSTRAINT IF EXISTS rh_candidate_scores_candidate_id_criterion_id_key;

-- Nueva llave única: una calificación por criterio POR evaluador.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'rh_candidate_scores_cand_crit_scorer_key'
  ) THEN
    ALTER TABLE public.rh_candidate_scores
      ADD CONSTRAINT rh_candidate_scores_cand_crit_scorer_key
      UNIQUE (candidate_id, criterion_id, scored_by);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_rh_score_cand_scorer
  ON public.rh_candidate_scores(candidate_id, scored_by);
