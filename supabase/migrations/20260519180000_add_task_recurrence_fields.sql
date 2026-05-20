-- Recurrencia de tareas: nuevas columnas y motor SQL
-- recurrence_type: 'on_complete' (se crea al completar, manejado en el cliente)
--                  'scheduled'   (se crea automáticamente por pg_cron)
-- next_recurrence_date: fecha en que debe generarse la siguiente ocurrencia

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS recurrence_type TEXT
    CHECK (recurrence_type IN ('on_complete', 'scheduled')),
  ADD COLUMN IF NOT EXISTS next_recurrence_date DATE;

-- ─────────────────────────────────────────────────────────────────────────────
-- Función auxiliar: calcula la próxima fecha según el patrón de recurrencia
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION calculate_next_recurrence_date(base_date DATE, pattern TEXT)
RETURNS DATE
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  next_date DATE := base_date;
BEGIN
  CASE pattern
    WHEN 'daily' THEN
      next_date := base_date + INTERVAL '1 day';
    WHEN 'weekdays' THEN
      next_date := base_date + INTERVAL '1 day';
      WHILE EXTRACT(DOW FROM next_date) IN (0, 6) LOOP
        next_date := next_date + INTERVAL '1 day';
      END LOOP;
    WHEN 'weekly' THEN
      next_date := base_date + INTERVAL '7 days';
    WHEN 'biweekly' THEN
      next_date := base_date + INTERVAL '14 days';
    WHEN 'monthly' THEN
      next_date := base_date + INTERVAL '1 month';
    WHEN 'quarterly' THEN
      next_date := base_date + INTERVAL '3 months';
    WHEN 'annual' THEN
      next_date := base_date + INTERVAL '1 year';
    ELSE
      next_date := base_date + INTERVAL '7 days';
  END CASE;
  RETURN next_date;
END;
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- Función principal del cron: genera ocurrencias de tareas con scheduled
-- Para cada tarea recurrente cuya next_recurrence_date ya llegó:
--   1. Inserta una copia con due_date = next_recurrence_date y status = pendiente
--   2. Avanza next_recurrence_date en la tarea original/plantilla
-- ─────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION create_scheduled_recurring_tasks()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  task_rec RECORD;
  next_date DATE;
BEGIN
  FOR task_rec IN
    SELECT *
    FROM tasks
    WHERE is_recurring = TRUE
      AND recurrence_type = 'scheduled'
      AND next_recurrence_date <= CURRENT_DATE
      AND status != 'cancelada'
  LOOP
    next_date := calculate_next_recurrence_date(
      task_rec.next_recurrence_date,
      task_rec.recurrence_pattern
    );

    INSERT INTO tasks (
      organization_id,
      project_id,
      client_id,
      title,
      description,
      area,
      assigned_to,
      priority,
      status,
      due_date,
      tags,
      is_recurring,
      recurrence_pattern,
      recurrence_type,
      next_recurrence_date,
      created_by,
      template_id,
      phase_key,
      dropbox_links,
      criticality_level
    )
    SELECT
      organization_id,
      project_id,
      client_id,
      title,
      description,
      area,
      assigned_to,
      priority,
      'pendiente',
      task_rec.next_recurrence_date,
      tags,
      is_recurring,
      recurrence_pattern,
      recurrence_type,
      next_date,
      created_by,
      COALESCE(template_id, task_rec.id),
      phase_key,
      dropbox_links,
      criticality_level
    FROM tasks
    WHERE id = task_rec.id;

    UPDATE tasks
    SET next_recurrence_date = next_date
    WHERE id = task_rec.id;
  END LOOP;
END;
$$;

REVOKE ALL ON FUNCTION public.create_scheduled_recurring_tasks() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.create_scheduled_recurring_tasks() TO postgres;

-- ─────────────────────────────────────────────────────────────────────────────
-- Programar cron diario 08:00 UTC (02:00 CDMX / 03:00 CDMX verano)
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  j record;
BEGIN
  FOR j IN SELECT jobid FROM cron.job WHERE jobname = 'create-recurring-tasks'
  LOOP
    PERFORM cron.unschedule(j.jobid);
  END LOOP;
EXCEPTION
  WHEN undefined_table THEN NULL;
END $$;

SELECT cron.schedule(
  'create-recurring-tasks',
  '0 8 * * *',
  $$SELECT public.create_scheduled_recurring_tasks()$$
);
