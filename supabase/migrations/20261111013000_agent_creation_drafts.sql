-- Borradores de la creación de agentes: si Dirección se queda a la mitad del chat del Constructor, se guarda y se puede continuar
-- desde cualquier dispositivo. Cada borrador es de una sola persona (RLS) y solo Dirección (admin/manager) los ve.
-- No guarda credenciales: el chat ya rechaza contraseñas y llaves antes de guardar nada.
CREATE TABLE IF NOT EXISTS public.agent_creation_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users (id) ON DELETE CASCADE,
  titulo text NOT NULL DEFAULT '' CHECK (char_length(titulo) <= 120),
  messages jsonb NOT NULL DEFAULT '[]'::jsonb CHECK (jsonb_typeof(messages) = 'array' AND octet_length(messages::text) <= 300000),
  propuesta jsonb CHECK (propuesta IS NULL OR (jsonb_typeof(propuesta) = 'object' AND octet_length(propuesta::text) <= 60000)),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_agent_creation_drafts_user ON public.agent_creation_drafts (user_id, updated_at DESC);

ALTER TABLE public.agent_creation_drafts ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "agent_creation_drafts_owner_select" ON public.agent_creation_drafts;
CREATE POLICY "agent_creation_drafts_owner_select" ON public.agent_creation_drafts FOR SELECT TO authenticated
  USING (user_id = auth.uid() AND public.is_admin_or_manager(auth.uid()));

DROP POLICY IF EXISTS "agent_creation_drafts_owner_insert" ON public.agent_creation_drafts;
CREATE POLICY "agent_creation_drafts_owner_insert" ON public.agent_creation_drafts FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid() AND public.is_admin_or_manager(auth.uid()));

DROP POLICY IF EXISTS "agent_creation_drafts_owner_update" ON public.agent_creation_drafts;
CREATE POLICY "agent_creation_drafts_owner_update" ON public.agent_creation_drafts FOR UPDATE TO authenticated
  USING (user_id = auth.uid() AND public.is_admin_or_manager(auth.uid()))
  WITH CHECK (user_id = auth.uid() AND public.is_admin_or_manager(auth.uid()));

DROP POLICY IF EXISTS "agent_creation_drafts_owner_delete" ON public.agent_creation_drafts;
CREATE POLICY "agent_creation_drafts_owner_delete" ON public.agent_creation_drafts FOR DELETE TO authenticated
  USING (user_id = auth.uid() AND public.is_admin_or_manager(auth.uid()));

CREATE OR REPLACE FUNCTION public.agent_creation_drafts_touch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END $$;
DROP TRIGGER IF EXISTS trg_agent_creation_drafts_touch ON public.agent_creation_drafts;
CREATE TRIGGER trg_agent_creation_drafts_touch BEFORE UPDATE ON public.agent_creation_drafts
  FOR EACH ROW EXECUTE FUNCTION public.agent_creation_drafts_touch();
