-- Memorias automáticas por usuario/org (preferencias, patrones, etc.)
CREATE TABLE IF NOT EXISTS public.ai_user_memories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  memory_type text NOT NULL CHECK (memory_type IN ('preference', 'pattern', 'knowledge', 'context')),
  content text NOT NULL,
  content_hash text NOT NULL,
  source_conversation_id uuid REFERENCES public.chat_conversations (id) ON DELETE SET NULL,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (organization_id, user_id, content_hash)
);

CREATE INDEX IF NOT EXISTS idx_ai_user_memories_org_user
  ON public.ai_user_memories (organization_id, user_id) WHERE enabled = true;

ALTER TABLE public.ai_user_memories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_user_memories_select_own"
  ON public.ai_user_memories FOR SELECT TO authenticated
  USING (
    user_id = auth.uid()
    AND organization_id = (SELECT p.organization_id FROM public.profiles p WHERE p.user_id = auth.uid())
  );

CREATE POLICY "ai_user_memories_update_own"
  ON public.ai_user_memories FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS proactive_ai_notifications boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.profiles.proactive_ai_notifications IS 'Si false, no se generan notificaciones proactivas de IA para este usuario.';
