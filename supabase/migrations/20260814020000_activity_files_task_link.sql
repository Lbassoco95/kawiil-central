-- Liga los archivos (cotizaciones/diseños/muestras) a un PENDIENTE (tarea),
-- no a la actividad en general. Así se ven y se votan dentro de cada pendiente,
-- sin una sección/pestaña aparte.

ALTER TABLE public.activity_files
  ADD COLUMN IF NOT EXISTS task_id uuid REFERENCES public.tasks(id) ON DELETE CASCADE;

COMMENT ON COLUMN public.activity_files.task_id IS
  'Pendiente (tarea) al que pertenece el archivo. Los archivos se suben y votan dentro del pendiente.';

CREATE INDEX IF NOT EXISTS idx_activity_files_task ON public.activity_files(task_id) WHERE task_id IS NOT NULL;
