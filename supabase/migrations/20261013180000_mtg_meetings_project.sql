-- Juntas: vincular una junta/minuta a un proyecto específico (opcional).
ALTER TABLE public.mtg_meetings
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_mtg_meetings_project ON public.mtg_meetings(project_id)
  WHERE project_id IS NOT NULL;
