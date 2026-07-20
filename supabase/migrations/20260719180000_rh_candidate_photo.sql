-- =============================================================
-- RH — Reclutamiento: foto del candidato (para identificarlo más fácil).
--   Guarda la ruta de la foto en el bucket privado 'cv'. Puede subirse a mano
--   o extraerse del CV con IA.
-- =============================================================

ALTER TABLE public.rh_candidates
  ADD COLUMN IF NOT EXISTS photo_url text;
