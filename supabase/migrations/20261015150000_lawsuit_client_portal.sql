-- Portal del cliente: enlace privado + código para consultar un juicio/trámite (solo lectura).
-- El acceso público NO toca tablas con la sesión del cliente: lo resuelve la Edge Function
-- `client-portal` con service role, validando token y código.

CREATE TABLE IF NOT EXISTS public.lawsuit_client_links (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  lawsuit_id uuid NOT NULL UNIQUE REFERENCES public.project_lawsuits(id) ON DELETE CASCADE,
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

CREATE INDEX IF NOT EXISTS lawsuit_client_links_org_idx ON public.lawsuit_client_links (organization_id);

DROP TRIGGER IF EXISTS lawsuit_client_links_updated_at ON public.lawsuit_client_links;
CREATE TRIGGER lawsuit_client_links_updated_at
  BEFORE UPDATE ON public.lawsuit_client_links
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.lawsuit_client_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lawsuit_client_links_select ON public.lawsuit_client_links;
CREATE POLICY lawsuit_client_links_select ON public.lawsuit_client_links FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));
DROP POLICY IF EXISTS lawsuit_client_links_insert ON public.lawsuit_client_links;
CREATE POLICY lawsuit_client_links_insert ON public.lawsuit_client_links FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));
DROP POLICY IF EXISTS lawsuit_client_links_update ON public.lawsuit_client_links;
CREATE POLICY lawsuit_client_links_update ON public.lawsuit_client_links FOR UPDATE TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));
DROP POLICY IF EXISTS lawsuit_client_links_delete ON public.lawsuit_client_links;
CREATE POLICY lawsuit_client_links_delete ON public.lawsuit_client_links FOR DELETE TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));

-- Qué actuaciones ve el cliente (las notas internas quedan ocultas por defecto).
ALTER TABLE public.project_lawsuit_entries
  ADD COLUMN IF NOT EXISTS client_visible boolean NOT NULL DEFAULT false;
