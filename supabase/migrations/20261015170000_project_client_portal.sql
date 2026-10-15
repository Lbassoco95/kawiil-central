-- El portal del cliente pasa de un enlace por juicio a UN enlace por proyecto (expediente completo):
-- el cliente ve todos los juicios/trámites que el equipo marque como visibles.
-- Se reemplaza la tabla anterior (solo contenía enlaces de prueba).

DROP TABLE IF EXISTS public.lawsuit_client_links;

CREATE TABLE IF NOT EXISTS public.project_client_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  project_id uuid NOT NULL UNIQUE REFERENCES public.projects(id) ON DELETE CASCADE,
  -- sha256(token) y sha256(token || ':' || código); nunca se guardan en claro.
  token_hash text NOT NULL UNIQUE,
  code_hash text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  failed_attempts integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_viewed_at timestamptz,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS project_client_links_org_idx ON public.project_client_links (organization_id);

DROP TRIGGER IF EXISTS project_client_links_updated_at ON public.project_client_links;
CREATE TRIGGER project_client_links_updated_at
  BEFORE UPDATE ON public.project_client_links
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.project_client_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS project_client_links_select ON public.project_client_links;
CREATE POLICY project_client_links_select ON public.project_client_links FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));
DROP POLICY IF EXISTS project_client_links_insert ON public.project_client_links;
CREATE POLICY project_client_links_insert ON public.project_client_links FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));
DROP POLICY IF EXISTS project_client_links_update ON public.project_client_links;
CREATE POLICY project_client_links_update ON public.project_client_links FOR UPDATE TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));
DROP POLICY IF EXISTS project_client_links_delete ON public.project_client_links;
CREATE POLICY project_client_links_delete ON public.project_client_links FOR DELETE TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));

-- Qué juicios/trámites del proyecto ve el cliente (ninguno por defecto).
ALTER TABLE public.project_lawsuits
  ADD COLUMN IF NOT EXISTS client_visible boolean NOT NULL DEFAULT false;
