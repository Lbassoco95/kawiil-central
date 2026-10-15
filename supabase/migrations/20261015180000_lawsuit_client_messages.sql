-- Mensajes entre el equipo y el cliente por juicio/trámite (soporte).
-- El cliente escribe desde el portal público a través de la Edge Function `client-portal`
-- (service role); el equipo lee y responde desde Kawiil OS con RLS por organización.

CREATE TABLE IF NOT EXISTS public.lawsuit_client_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations(id),
  lawsuit_id uuid NOT NULL REFERENCES public.project_lawsuits(id) ON DELETE CASCADE,
  sender text NOT NULL CHECK (sender IN ('team', 'client')),
  author_name text,
  content text NOT NULL CHECK (char_length(content) BETWEEN 1 AND 4000),
  created_by uuid,
  -- Solo aplica a mensajes del cliente: cuándo los vio el equipo.
  read_by_team_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS lawsuit_client_messages_lawsuit_idx
  ON public.lawsuit_client_messages (lawsuit_id, created_at);

ALTER TABLE public.lawsuit_client_messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS lawsuit_client_messages_select ON public.lawsuit_client_messages;
CREATE POLICY lawsuit_client_messages_select ON public.lawsuit_client_messages FOR SELECT TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));
-- El equipo solo inserta mensajes propios; los del cliente los inserta la Edge Function.
DROP POLICY IF EXISTS lawsuit_client_messages_insert ON public.lawsuit_client_messages;
CREATE POLICY lawsuit_client_messages_insert ON public.lawsuit_client_messages FOR INSERT TO authenticated
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()) AND sender = 'team');
DROP POLICY IF EXISTS lawsuit_client_messages_update ON public.lawsuit_client_messages;
CREATE POLICY lawsuit_client_messages_update ON public.lawsuit_client_messages FOR UPDATE TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()))
  WITH CHECK (organization_id = public.get_user_org_id(auth.uid()));
DROP POLICY IF EXISTS lawsuit_client_messages_delete ON public.lawsuit_client_messages;
CREATE POLICY lawsuit_client_messages_delete ON public.lawsuit_client_messages FOR DELETE TO authenticated
  USING (organization_id = public.get_user_org_id(auth.uid()));
