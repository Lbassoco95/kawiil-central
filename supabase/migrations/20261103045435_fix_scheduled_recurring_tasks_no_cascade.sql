-- Marcador: esta versión quedó registrada en remoto (aplicada fuera del repo: corrección de
-- public.create_scheduled_recurring_tasks para que no encadene tareas recurrentes). Sin este archivo
-- `supabase db push --include-all` aborta con "Remote migration versions not found in local migrations directory"
-- en cualquier fusión que toque supabase/migrations (mismo caso que 20261014191959_scheduled_mail_send_new.sql).
-- No hace nada a propósito. Si el SQL real llega al repo en otro PR, reemplazar este archivo por ese (misma versión).
SELECT 1;
