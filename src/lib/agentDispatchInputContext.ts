/**
 * Contrato `input_context` hacia kawiil-agents (vía
 * [dispatch-to-agent](../supabase/functions/dispatch-to-agent/index.ts)).
 * La edge reenvía el objeto; la VM interpreta y aplica presupuesto de tokens
 * (p. ej. límite ~200k de Anthropic).
 */
export const AGENT_CONTEXT_MODES = ["full_refs", "rag_first", "refs_budget"] as const;
export type AgentContextMode = (typeof AGENT_CONTEXT_MODES)[number];

export const AGENT_CONVERSATION_EXCERPT_MODES = ["full", "last_n", "off"] as const;
export type AgentConversationExcerptMode = (typeof AGENT_CONVERSATION_EXCERPT_MODES)[number];

/** Campos que el cliente envía bajo `input_context` (además de conversation_id, ai_project_id, etc.). */
export type AgentDispatchInputContext = {
  conversation_id?: string;
  ai_project_id?: string;
  /**
   * @deprecated La VM debería preferir `conversation_excerpt_mode` + `include_conversation_excerpt`.
   * Si solo existe el boolean, true ≈ "full" o "last_n" según el servidor.
   */
  include_conversation_excerpt?: boolean;
  /** Cómo incorporar el hilo del chat al prompt en la VM. */
  conversation_excerpt_mode?: AgentConversationExcerptMode;
  /** Con `last_n`, cuántos mensajes recientes (0 = tratar como off). */
  conversation_excerpt_max_messages?: number;
  /**
   * Estrategia de contexto de expediente: inyección completa de adjuntos, RAG
   * primero, o recorte por presupuesto (recomendado con expedientes grandes).
   */
  context_mode?: AgentContextMode;
  /** IDs de `documents` incluidos a propósito en este envío (subconjunto del conocimiento). */
  knowledge_included_document_ids?: string[];
  /**
   * Pistas de tope; la VM aplica el recorte final frente a 200k tokens.
   * `knowledge_max_total_bytes` estima con `documents.file_size` (Storage).
   */
  knowledge_max_total_bytes?: number;
  /**
   * Techo duro de adjuntos o texto extraído en la VM; opcional, bytes.
   * Si la VM no lo implementa, ignora.
   */
  max_attachment_bytes_per_task?: number;
  /**
   * Presupuesto blando de ~tokens de entrada (estimación); la VM puede truncar
   * antes de llamar a Anthropic.
   */
  max_estimated_input_tokens?: number;
  previous_task_id?: string;
  follow_up_kind?: "retry" | "continuation";
  knowledge_supabase_ref_count?: number;
  knowledge_dropbox_documents?: { document_id: string; name: string; external_path: string }[];
};

export const DEFAULT_AGENT_CONTEXT_MODE: AgentContextMode = "refs_budget";
export const DEFAULT_AGENT_CONVERSATION_EXCERPT_MODE: AgentConversationExcerptMode = "last_n";
export const DEFAULT_AGENT_CONVERSATION_EXCERPT_MAX_MESSAGES = 30;
/** 8 MB acumulado (refs) si `agent_max_knowledge_bytes` en proyecto es null. */
export const DEFAULT_AGENT_MAX_KNOWLEDGE_BYTES = 8 * 1024 * 1024;
