-- Colaboradores de seguimiento explícitos por cliente (además del responsable en clients.responsible_user_id)

CREATE TABLE public.client_collaborators (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  client_id uuid NOT NULL REFERENCES public.clients(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  UNIQUE (client_id, user_id)
);

CREATE INDEX idx_client_collaborators_client_id ON public.client_collaborators(client_id);
CREATE INDEX idx_client_collaborators_user_id ON public.client_collaborators(user_id);

ALTER TABLE public.client_collaborators ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Org users see client collaborators"
  ON public.client_collaborators
  FOR SELECT
  USING (
    client_id IN (
      SELECT c.id
      FROM public.clients c
      WHERE c.organization_id = get_user_org_id(auth.uid())
    )
  );

CREATE POLICY "Org users insert client collaborators"
  ON public.client_collaborators
  FOR INSERT
  WITH CHECK (
    client_id IN (
      SELECT c.id
      FROM public.clients c
      WHERE c.organization_id = get_user_org_id(auth.uid())
    )
  );

CREATE POLICY "Org users delete client collaborators"
  ON public.client_collaborators
  FOR DELETE
  USING (
    client_id IN (
      SELECT c.id
      FROM public.clients c
      WHERE c.organization_id = get_user_org_id(auth.uid())
    )
  );
