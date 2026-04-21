-- Migration: chat_messages.agent_task_ref
-- Propósito: agregar columna jsonb para referenciar tareas delegadas
--            a agentes IA desde el chat de /asistente. Cuando un
--            mensaje es una AgentTaskCard, agent_task_ref contiene
--            la metadata mínima para renderizar la tarjeta y conectar
--            el hook useAgentTaskProgress(task_id).
-- Estructura esperada del JSON:
--   {
--     "task_id": "uuid",
--     "agent_id": "uuid",
--     "agent_name": "doc_reviewer",
--     "agent_display_name": "Sofia",
--     "title": "Revisar 5 contratos de arrendamiento"
--   }
-- Parte del Bloque B1.6 del plan v6.

-- Agregar columna nullable (la mayoría de mensajes NO tienen
-- agent_task_ref, solo los que delegan a un agente).
ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS agent_task_ref jsonb;

-- Comentario de documentación
COMMENT ON COLUMN public.chat_messages.agent_task_ref IS
  'Referencia a una tarea delegada a un agente IA. NULL para mensajes normales. Estructura: {task_id, agent_id, agent_name, agent_display_name, title}. El task_id permite al frontend suscribirse via useAgentTaskProgress para streaming en vivo.';

-- Índice GIN para queries genéricas sobre agent_task_ref
CREATE INDEX IF NOT EXISTS idx_chat_messages_agent_task_ref
  ON public.chat_messages USING gin (agent_task_ref);

-- Índice partial por task_id — para queries eficientes tipo
-- "dame el mensaje del chat asociado a este task_id"
CREATE INDEX IF NOT EXISTS idx_chat_messages_agent_task_id
  ON public.chat_messages ((agent_task_ref->>'task_id'))
  WHERE agent_task_ref IS NOT NULL;
