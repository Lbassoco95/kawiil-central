-- Sugerencias de mejora detectadas desde mensajes del chat (IA)
CREATE TABLE IF NOT EXISTS public.improvement_suggestions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  conversation_id uuid NOT NULL REFERENCES public.chat_conversations (id) ON DELETE CASCADE,
  chat_message_id uuid NOT NULL REFERENCES public.chat_messages (id) ON DELETE CASCADE,
  suggestion_text text NOT NULL,
  category text NOT NULL,
  summary jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (chat_message_id)
);

CREATE INDEX IF NOT EXISTS idx_improvement_suggestions_org_status
  ON public.improvement_suggestions (organization_id, status, created_at DESC);

ALTER TABLE public.improvement_suggestions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "improvement_suggestions_select_org"
  ON public.improvement_suggestions FOR SELECT TO authenticated
  USING (
    organization_id = (SELECT p.organization_id FROM public.profiles p WHERE p.user_id = auth.uid())
    AND (
      user_id = auth.uid()
      OR EXISTS (
        SELECT 1 FROM public.user_module_permissions ump
        WHERE ump.user_id = auth.uid()
          AND ump.organization_id = improvement_suggestions.organization_id
          AND ump.module_key IN ('admin', 'conocimiento')
          AND ump.enabled = true
      )
    )
  );

CREATE POLICY "improvement_suggestions_update_managers"
  ON public.improvement_suggestions FOR UPDATE TO authenticated
  USING (
    organization_id = (SELECT p.organization_id FROM public.profiles p WHERE p.user_id = auth.uid())
    AND EXISTS (
      SELECT 1 FROM public.user_module_permissions ump
      WHERE ump.user_id = auth.uid()
        AND ump.organization_id = improvement_suggestions.organization_id
        AND ump.module_key IN ('admin', 'conocimiento')
        AND ump.enabled = true
    )
  )
  WITH CHECK (
    organization_id = (SELECT p.organization_id FROM public.profiles p WHERE p.user_id = auth.uid())
  );

CREATE TRIGGER update_improvement_suggestions_updated_at
  BEFORE UPDATE ON public.improvement_suggestions
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

COMMENT ON TABLE public.improvement_suggestions IS 'Sugerencias de mejora al producto detectadas en el chat (Edge analyze-improvement-suggestions).';
