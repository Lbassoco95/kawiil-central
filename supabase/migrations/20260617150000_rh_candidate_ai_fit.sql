-- =============================================================
-- RH — Análisis de "Fit Kawiil" con IA para candidatos
-- Guarda el resultado del análisis del examen psicométrico contra
-- los requisitos de la vacante + el perfil cultural de Kawiil.
--
-- El perfil cultural global vive en organizations.settings->>'rh_cultural_profile'
-- (jsonb ya existente; no requiere columna nueva).
-- =============================================================

ALTER TABLE public.rh_candidates
  ADD COLUMN IF NOT EXISTS ai_fit_score    integer
    CHECK (ai_fit_score IS NULL OR (ai_fit_score BETWEEN 0 AND 100)),
  ADD COLUMN IF NOT EXISTS ai_analysis     jsonb,
  ADD COLUMN IF NOT EXISTS ai_analyzed_at  timestamptz,
  ADD COLUMN IF NOT EXISTS ai_analyzed_by  uuid REFERENCES auth.users(id);

COMMENT ON COLUMN public.rh_candidates.ai_fit_score IS 'Puntaje 0-100 de adaptación a Kawiil generado por IA.';
COMMENT ON COLUMN public.rh_candidates.ai_analysis IS 'Análisis estructurado de IA: summary, strengths[], risks[], interview_questions[], suggested_rubric_scores[].';
