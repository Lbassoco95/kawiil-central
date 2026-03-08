
-- Add criticality and delay tracking columns to projects
ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS criticality_level text DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS delay_category text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS delay_notes text DEFAULT NULL;

-- Add criticality and delay tracking columns to tasks
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS criticality_level text DEFAULT 'normal',
  ADD COLUMN IF NOT EXISTS delay_category text DEFAULT NULL,
  ADD COLUMN IF NOT EXISTS delay_notes text DEFAULT NULL;
