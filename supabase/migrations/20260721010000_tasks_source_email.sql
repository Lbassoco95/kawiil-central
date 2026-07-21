-- Vincula tareas con el correo desde el que se crearon, para mostrar "Tareas relacionadas"
-- en el módulo de Correo y rastrear el trabajo originado en correos.
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS source_email_id text,
  ADD COLUMN IF NOT EXISTS source_email_subject text,
  ADD COLUMN IF NOT EXISTS source_email_from text;

-- Búsqueda rápida de tareas por el correo de origen.
CREATE INDEX IF NOT EXISTS idx_tasks_source_email_id
  ON public.tasks (source_email_id)
  WHERE source_email_id IS NOT NULL;
