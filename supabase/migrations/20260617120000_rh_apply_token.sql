-- =============================================================
-- RH — Postulación pública por vacante.
-- Cada vacante tiene un token público; con él se arma un link que se publica
-- afuera (Computrabajo, LinkedIn, etc.). Las postulaciones entran solas al
-- pipeline mediante la edge function 'recruit-apply' (service role).
-- =============================================================

ALTER TABLE public.rh_recruitment_processes
  ADD COLUMN IF NOT EXISTS apply_token uuid NOT NULL DEFAULT gen_random_uuid(),
  ADD COLUMN IF NOT EXISTS apply_open  boolean NOT NULL DEFAULT true;

-- Asegura token único e índice para búsqueda por token.
CREATE UNIQUE INDEX IF NOT EXISTS idx_rh_proc_apply_token ON public.rh_recruitment_processes(apply_token);
