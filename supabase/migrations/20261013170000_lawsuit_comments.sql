-- Comentarios (conversación + archivos/enlaces de Dropbox) por juicio.
-- Mismo formato que task_comments: HTML/texto con adjuntos "📎 [nombre](url)".

CREATE TABLE IF NOT EXISTS public.project_lawsuit_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  lawsuit_id uuid NOT NULL REFERENCES public.project_lawsuits(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  content text NOT NULL,
  mentions text[] NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_lawsuit_comments_lawsuit_idx
  ON public.project_lawsuit_comments (lawsuit_id, created_at);

DROP TRIGGER IF EXISTS project_lawsuit_comments_updated_at ON public.project_lawsuit_comments;
CREATE TRIGGER project_lawsuit_comments_updated_at
  BEFORE UPDATE ON public.project_lawsuit_comments
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.project_lawsuit_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_lawsuit_comments_select ON public.project_lawsuit_comments;
CREATE POLICY project_lawsuit_comments_select ON public.project_lawsuit_comments FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));
DROP POLICY IF EXISTS project_lawsuit_comments_insert ON public.project_lawsuit_comments;
CREATE POLICY project_lawsuit_comments_insert ON public.project_lawsuit_comments FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()) AND user_id = auth.uid());
-- Solo el autor edita o elimina su comentario.
DROP POLICY IF EXISTS project_lawsuit_comments_update ON public.project_lawsuit_comments;
CREATE POLICY project_lawsuit_comments_update ON public.project_lawsuit_comments FOR UPDATE TO authenticated
  USING (user_id = auth.uid()) WITH CHECK (user_id = auth.uid());
DROP POLICY IF EXISTS project_lawsuit_comments_delete ON public.project_lawsuit_comments;
CREATE POLICY project_lawsuit_comments_delete ON public.project_lawsuit_comments FOR DELETE TO authenticated
  USING (user_id = auth.uid());
