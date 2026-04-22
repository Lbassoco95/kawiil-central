-- Contexto de delegación a agente en el hilo (sin nueva tabla):
-- { "task_ref": { ... }, "last_interaction": "delegate" | "chat" }
-- Permite rehidratar "Continuar con [agente]" al reabrir la conversación.
ALTER TABLE public.chat_conversations
  ADD COLUMN IF NOT EXISTS agent_session jsonb;

COMMENT ON COLUMN public.chat_conversations.agent_session IS
  'Contexto de sesión con agente delegable: task_ref (agent_task_ref) y last_interaction (delegate=última acción fue delegación, chat=usuario habla con asistente Kawiil).';

CREATE INDEX IF NOT EXISTS idx_chat_conversations_agent_session
  ON public.chat_conversations ((agent_session->'task_ref'->>'task_id'))
  WHERE agent_session IS NOT NULL;
