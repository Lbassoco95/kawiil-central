/**
 * Contrato `input_context` hacia kawiil-agents (vía
 * [dispatch-to-agent](../supabase/functions/dispatch-to-agent/index.ts)).
 * La edge reenvía el objeto; la VM interpreta y aplica presupuesto de tokens
 * (p. ej. límite ~200k de Anthropic).
 *
 * **context_mode: `rag_first` (Kawiil OS)**  
 * El cliente de **kawiil-central** no añade a `attachment_refs` rutas del bucket
 * `documents` del expediente del proyecto; `attachment_refs` trae solo adjuntos
 * subidos al chat. Siguen yendo `ai_project_id` y
 * `knowledge_included_document_ids` (y, si aplica, `knowledge_dropbox_documents`) para
 * acotar búsqueda: la VM kawiil-agents debe leer el contexto vía
 * `document_chunks` (p. ej. RPC `public.match_document_chunks_for_agent` con
 * `filter_org_id` + `filter_document_ids` = `knowledge_included_document_ids`) y
 * **no** re-descargar el expediente entero de Storage. No usar
 * `document_chunks.project_id` como `ai_project_id` (el primero apunta a `public.projects` CRM). El presupuesto de bytes del expediente en
 * `knowledge_max_total_bytes` aplica a modos con refs, no a `rag_first`
 * (el cliente manda pistas de `max_attachment_bytes_per_task` / `max_estimated_input_tokens`
 * a partir de los bytes conocidos de adjuntos de chat, si los hay).
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
   * Suma aprox. de bytes de refs de **expediente** que el cliente pide a la VM
   * (modos con binario por Storage en `attachment_refs` + refs del proyecto). No se envía
   * bajo el contrato de `context_mode: rag_first` (ver cabecera de este módulo).
   */
  knowledge_max_total_bytes?: number;
  /**
   * Con `context_mode: rag_first`, pista de tamaño (bytes) de adjuntos reales
   * del chat, si el cliente conoce `size_bytes` en la meta. La VM no está obligada
   * a leer otras señales de tope; opcional, bytes.
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

/**
 * Expedientes grandes bien indexados: el equipo suele preferir `'rag_first'` en `ai_projects.agent_context_mode`
 * (la VM usa `document_chunks` y limita refs de Storage; ver `dispatch-to-agent`).
 */
export const DEFAULT_AGENT_CONTEXT_MODE: AgentContextMode = "refs_budget";
export const DEFAULT_AGENT_CONVERSATION_EXCERPT_MODE: AgentConversationExcerptMode = "last_n";
export const DEFAULT_AGENT_CONVERSATION_EXCERPT_MAX_MESSAGES = 30;
/** 8 MB acumulado (refs) si `agent_max_knowledge_bytes` en proyecto es null. */
export const DEFAULT_AGENT_MAX_KNOWLEDGE_BYTES = 8 * 1024 * 1024;
