-- RH — Reclutamiento: ubicación de la vacante (para la página pública de
-- postulación y futuras publicaciones en portales). description/grade/budget
-- ya existen.
ALTER TABLE public.rh_recruitment_processes
  ADD COLUMN IF NOT EXISTS location text;
