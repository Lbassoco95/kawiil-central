-- RH — Reclutamiento: archivo del examen/psicométrico del candidato (PDF).
-- Se guarda en el bucket privado 'cv' (mismos permisos: reclutador/responsable/
-- entrevistador). La calificación sigue en la rúbrica.
ALTER TABLE public.rh_candidates
  ADD COLUMN IF NOT EXISTS assessment_file_path text;
