CREATE TABLE IF NOT EXISTS public.ai_feedback (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES public.organizations (id) ON DELETE CASCADE,
  user_id uuid NOT NULL,
  chat_message_id uuid REFERENCES public.chat_messages (id) ON DELETE SET NULL,
  rating text NOT NULL CHECK (rating IN ('up', 'down')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, chat_message_id)
);

CREATE INDEX IF NOT EXISTS ai_feedback_org_created_idx ON public.ai_feedback (organization_id, created_at DESC);

ALTER TABLE public.ai_feedback ENABLE ROW LEVEL SECURITY;

CREATE POLICY "ai_feedback_select_own"
  ON public.ai_feedback FOR SELECT TO authenticated
  USING (user_id = auth.uid());

CREATE POLICY "ai_feedback_insert_own"
  ON public.ai_feedback FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());
