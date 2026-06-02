-- =============================================================
-- RH — turno adicional (segundo turno del día)
-- Un turno iniciado después de cerrar el principal no lleva hora
-- de comida; solo descansos cortos.
-- =============================================================

ALTER TABLE public.rh_attendance
  ADD COLUMN IF NOT EXISTS is_additional_shift boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.rh_attendance.is_additional_shift IS
  'true si es un turno adicional iniciado tras cerrar el principal del día (sin comida, solo descansos).';
