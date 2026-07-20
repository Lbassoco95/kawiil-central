-- El alias de conversación es dato por-usuario: basta user_id = auth.uid() para
-- la seguridad. Quitamos la dependencia de organization_id (que exigía leer el
-- perfil y hacía fallar el guardado si esa lectura/coincidencia fallaba).
ALTER TABLE public.slack_conversation_aliases
  ALTER COLUMN organization_id DROP NOT NULL;

DROP POLICY IF EXISTS "Users manage own slack conversation aliases" ON public.slack_conversation_aliases;
CREATE POLICY "Users manage own slack conversation aliases"
  ON public.slack_conversation_aliases FOR ALL TO authenticated
  USING (user_id = auth.uid())
  WITH CHECK (user_id = auth.uid());
