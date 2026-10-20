-- Actuaciones con más detalle: tipo, cuándo se lleva a cabo, responsable, lugar y notas internas.
ALTER TABLE public.project_lawsuit_entries
  ADD COLUMN IF NOT EXISTS entry_type text,
  ADD COLUMN IF NOT EXISTS scheduled_date date,
  ADD COLUMN IF NOT EXISTS scheduled_time time,
  ADD COLUMN IF NOT EXISTS assigned_to uuid,
  ADD COLUMN IF NOT EXISTS location text,
  ADD COLUMN IF NOT EXISTS notes text,
  ADD COLUMN IF NOT EXISTS completed_at timestamptz;

CREATE INDEX IF NOT EXISTS project_lawsuit_entries_assigned_pending_idx
  ON public.project_lawsuit_entries (assigned_to, scheduled_date)
  WHERE completed_at IS NULL;
