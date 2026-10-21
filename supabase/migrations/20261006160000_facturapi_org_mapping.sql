-- Mapeo opcional cliente central → organización Facturapi (Fase 1: llaves en central).
-- La API key sigue en Edge Secrets (FACTURAPI_SECRET_KEY); aquí solo el org id / ref.

CREATE TABLE IF NOT EXISTS public.facturapi_client_orgs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  facturapi_organization_id text NOT NULL,
  livemode boolean NOT NULL DEFAULT false,
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (client_id)
);

CREATE INDEX IF NOT EXISTS facturapi_client_orgs_org_idx
  ON public.facturapi_client_orgs (facturapi_organization_id);

COMMENT ON TABLE public.facturapi_client_orgs IS
  'Organización Facturapi por cliente de central. Secret key en Edge Secrets, no en esta tabla.';

ALTER TABLE public.facturapi_client_orgs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS facturapi_client_orgs_staff ON public.facturapi_client_orgs;
CREATE POLICY facturapi_client_orgs_staff ON public.facturapi_client_orgs
  FOR SELECT TO authenticated
  USING (public.is_admin_or_manager(auth.uid()));

GRANT SELECT ON public.facturapi_client_orgs TO authenticated;
GRANT ALL ON public.facturapi_client_orgs TO service_role;
