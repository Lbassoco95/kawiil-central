-- Los pendientes de una actividad pasan a ser TAREAS reales del sistema, para
-- que tengan responsable + vencimiento y aparezcan en "Mis tareas" y el perfil
-- de cada persona (siguen siendo trabajo y deben registrarse como tal).
--
--   * Se agrega tasks.activity_id (liga la tarea a una actividad interna).
--   * Se migran los pendientes ya cargados (activity_items) a tasks.
--   * Se elimina la tabla activity_items (su función la absorbe tasks).

-- 1) Vínculo tarea → actividad.
ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS activity_id uuid REFERENCES public.activities(id) ON DELETE CASCADE;

COMMENT ON COLUMN public.tasks.activity_id IS
  'Actividad interna a la que pertenece la tarea (módulo Actividades). NULL para tareas normales.';

CREATE INDEX IF NOT EXISTS idx_tasks_activity ON public.tasks(activity_id) WHERE activity_id IS NOT NULL;

-- 2) Migrar pendientes existentes (activity_items) a tasks y eliminar la tabla.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = 'activity_items'
  ) THEN
    INSERT INTO public.tasks
      (organization_id, title, description, status, priority, due_date, activity_id, created_by)
    SELECT
      ai.organization_id,
      ai.title,
      NULLIF(concat_ws(
        E'\n',
        CASE WHEN ai.responsible IS NOT NULL THEN 'Responsable sugerido: ' || ai.responsible END,
        ai.notes
      ), ''),
      (CASE ai.status
         WHEN 'pendiente'   THEN 'pendiente'
         WHEN 'en_proceso'  THEN 'en_progreso'
         WHEN 'en_revision' THEN 'en_revision'
         WHEN 'hecho'       THEN 'completada'
         ELSE 'pendiente'
       END)::task_status,
      'media'::task_priority,
      ai.due_date,
      ai.activity_id,
      ai.created_by
    FROM public.activity_items ai
    WHERE NOT EXISTS (
      SELECT 1 FROM public.tasks t
       WHERE t.activity_id = ai.activity_id AND t.title = ai.title
    );

    DROP TABLE public.activity_items;
  END IF;
END $$;
