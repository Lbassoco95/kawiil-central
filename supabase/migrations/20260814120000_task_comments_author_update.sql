-- Permite que el autor edite su propio comentario de tarea.
-- Antes solo existían políticas de SELECT (ver) e INSERT (crear); sin una de
-- UPDATE, la edición era rechazada por RLS. Idempotente para no romper el deploy.
DROP POLICY IF EXISTS "Authors update own task comments" ON public.task_comments;
CREATE POLICY "Authors update own task comments" ON public.task_comments
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
