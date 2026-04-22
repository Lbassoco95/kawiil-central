-- Valores por defecto para el contexto enviado a kawiil-agents (expedientes / límite ~200k tokens en la VM)

ALTER TABLE public.ai_projects
  ADD COLUMN IF NOT EXISTS agent_context_mode text NOT NULL DEFAULT 'refs_budget';

ALTER TABLE public.ai_projects
  ADD COLUMN IF NOT EXISTS agent_conversation_excerpt_mode text NOT NULL DEFAULT 'last_n';

ALTER TABLE public.ai_projects
  ADD COLUMN IF NOT EXISTS agent_conversation_excerpt_max_messages int NOT NULL DEFAULT 30;

ALTER TABLE public.ai_projects
  ADD COLUMN IF NOT EXISTS agent_max_knowledge_bytes bigint;

DO $body$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_projects_agent_context_mode_check') THEN
    ALTER TABLE public.ai_projects ADD CONSTRAINT ai_projects_agent_context_mode_check
      CHECK (agent_context_mode IN ('full_refs', 'rag_first', 'refs_budget'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_projects_agent_conversation_excerpt_mode_check') THEN
    ALTER TABLE public.ai_projects ADD CONSTRAINT ai_projects_agent_conversation_excerpt_mode_check
      CHECK (agent_conversation_excerpt_mode IN ('full', 'last_n', 'off'));
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_projects_agent_conversation_excerpt_max_messages_check') THEN
    ALTER TABLE public.ai_projects ADD CONSTRAINT ai_projects_agent_conversation_excerpt_max_messages_check
      CHECK (agent_conversation_excerpt_max_messages >= 0 AND agent_conversation_excerpt_max_messages <= 500);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ai_projects_agent_max_knowledge_bytes_check') THEN
    ALTER TABLE public.ai_projects ADD CONSTRAINT ai_projects_agent_max_knowledge_bytes_check
      CHECK (agent_max_knowledge_bytes IS NULL OR (agent_max_knowledge_bytes > 0 AND agent_max_knowledge_bytes <= 524288000));
  END IF;
END
$body$;

COMMENT ON COLUMN public.ai_projects.agent_context_mode IS
  'Sugerencia para kawiil-agents: full_refs, rag_first o refs_budget.';
COMMENT ON COLUMN public.ai_projects.agent_conversation_excerpt_mode IS
  'Sugerencia para kawiil-agents: full, last_n o off; ver agent_conversation_excerpt_max_messages si last_n.';
COMMENT ON COLUMN public.ai_projects.agent_max_knowledge_bytes IS
  'Techo opcional (bytes) sumando documentos de conocimiento; null usa el tope de la app.';
