CREATE POLICY "ai_feedback_update_own"
  ON public.ai_feedback FOR UPDATE TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
