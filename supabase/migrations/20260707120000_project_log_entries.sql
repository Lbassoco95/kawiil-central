-- Bitácora de proyecto: registro cronológico del proceso de cada proyecto.
-- A diferencia de projects.delay_notes (un solo campo que se sobrescribe) y de
-- project_comments (chat libre), la bitácora es un histórico estructurado de
-- entradas: qué pasó, si hubo atraso y de quién fue la responsabilidad
-- (cliente / nosotros / autoridad / externo). Sirve como expediente del cliente.
CREATE TABLE IF NOT EXISTS public.project_log_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  project_id uuid NOT NULL REFERENCES public.projects(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  entry_date date NOT NULL DEFAULT CURRENT_DATE,
  -- avance | hito | atraso | bloqueo | reunion | nota
  entry_type text NOT NULL DEFAULT 'avance',
  -- responsable del atraso/bloqueo: kawiil | cliente | autoridad | externo (NULL si no aplica)
  responsibility text,
  title text,
  content text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_project_log_entries_project ON public.project_log_entries (project_id, entry_date DESC, created_at DESC);

ALTER TABLE public.project_log_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Org users see project log entries" ON public.project_log_entries;
CREATE POLICY "Org users see project log entries" ON public.project_log_entries
  FOR SELECT TO authenticated
  USING (project_id IN (SELECT id FROM projects WHERE organization_id = get_user_org_id(auth.uid())));

DROP POLICY IF EXISTS "Org users create project log entries" ON public.project_log_entries;
CREATE POLICY "Org users create project log entries" ON public.project_log_entries
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND project_id IN (SELECT id FROM projects WHERE organization_id = get_user_org_id(auth.uid())));

DROP POLICY IF EXISTS "Users update own project log entries" ON public.project_log_entries;
CREATE POLICY "Users update own project log entries" ON public.project_log_entries
  FOR UPDATE TO authenticated
  USING (user_id = auth.uid() OR is_admin_or_manager(auth.uid()));

DROP POLICY IF EXISTS "Users delete own project log entries" ON public.project_log_entries;
CREATE POLICY "Users delete own project log entries" ON public.project_log_entries
  FOR DELETE TO authenticated
  USING (user_id = auth.uid() OR is_admin_or_manager(auth.uid()));

-- Mantener updated_at en sync (usa el helper existente de la base)
DROP TRIGGER IF EXISTS set_project_log_entries_updated_at ON public.project_log_entries;
CREATE TRIGGER set_project_log_entries_updated_at
  BEFORE UPDATE ON public.project_log_entries
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();
