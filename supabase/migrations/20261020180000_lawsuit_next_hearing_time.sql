-- Hora de la próxima audiencia (opcional; la fecha sigue en next_hearing_date).
ALTER TABLE public.project_lawsuits ADD COLUMN IF NOT EXISTS next_hearing_time time;
