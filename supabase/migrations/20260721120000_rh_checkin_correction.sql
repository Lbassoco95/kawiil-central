-- =============================================================
-- RH — Corrección de la hora de ENTRADA (análogo a la de salida).
--   El colaborador propone su hora de entrada correcta y el G4 responsable de su
--   célula la aprueba (aplica la hora) o la rechaza.
-- =============================================================

ALTER TABLE public.rh_attendance
  ADD COLUMN IF NOT EXISTS proposed_check_in_at timestamptz,
  ADD COLUMN IF NOT EXISTS checkin_review text,        -- pending_g4 | approved | rejected | null
  ADD COLUMN IF NOT EXISTS checkin_reviewed_by uuid REFERENCES auth.users(id),
  ADD COLUMN IF NOT EXISTS checkin_reviewed_at timestamptz,
  ADD COLUMN IF NOT EXISTS checkin_note text;

CREATE INDEX IF NOT EXISTS idx_rh_attendance_checkin_review
  ON public.rh_attendance(checkin_review) WHERE checkin_review IS NOT NULL;
