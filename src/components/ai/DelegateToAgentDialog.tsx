import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import {
  Loader2,
  Check,
  ChevronsUpDown,
  AlertCircle,
  Paperclip,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAgentList, type Agent } from "@/hooks/useAgentList";
import { useClients } from "@/hooks/useClients";
import type { Client } from "@/hooks/useClients";
import type { ChatAttachmentMeta } from "@/hooks/useChat";
import {
  buildProjectKnowledgeForAgentDispatch,
  mergeAgentAttachmentRefs,
  roughEstimateDocTokensForDispatch,
} from "@/lib/buildAgentProjectKnowledgeDispatch";
import {
  AGENT_CONTEXT_MODES,
  AGENT_CONVERSATION_EXCERPT_MODES,
  DEFAULT_AGENT_CONTEXT_MODE,
  DEFAULT_AGENT_CONVERSATION_EXCERPT_MAX_MESSAGES,
  DEFAULT_AGENT_CONVERSATION_EXCERPT_MODE,
  DEFAULT_AGENT_MAX_KNOWLEDGE_BYTES,
  type AgentContextMode,
  type AgentConversationExcerptMode,
} from "@/lib/agentDispatchInputContext";
import type { AiProject, AiProjectDocumentWithFile } from "@/hooks/useAiProjects";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { supabase } from "@/integrations/supabase/client";

/**
 * Adjuntos del composer; compatible con `ChatAttachmentMeta` y campos opcionales extra.
 */
export type AttachmentRef = ChatAttachmentMeta & {
  size_bytes?: number;
  document_id?: string | null;
};

export interface DelegateToAgentDialogProps {
  isOpen: boolean;
  onClose: () => void;

  /** Primera línea del composer del chat (sugerencia de título). */
  defaultTitle?: string;
  /** Adjuntos pendientes en el composer. */
  attachments?: AttachmentRef[];
  /** ID de la conversación activa en el chat. */
  conversationId?: string;

  /**
   * Contexto de cliente (p. ej. desde `ai_projects.client_id`).
   * `null` = tarea general del despacho.
   */
  defaultClientId?: string | null;

  /** `template_id` del agente (mismo valor que en `agent_task_ref.agent_id`). */
  defaultAgentTemplateId?: string | null;

  /** Proyecto IA activo; se envía en `input_context.ai_project_id` para la VM kawiil-agents. */
  aiProjectId?: string | null;

  /**
   * Tarea de agente previa en este hilo. La edge reenvía `input_context.previous_task_id`
   * a la VM para segunda búsqueda o seguimiento enlazado.
   */
  previousTaskId?: string | null;

  /** Tipo de seguimiento (metadata para la VM). */
  followUpKind?: "retry" | "continuation" | null;

  /**
   * Instrucciones del proyecto IA; se rellenan al abrir el modal y se envían
   * en el body como `instructions` a la VM (kawiil-agents), además de lo que ya vaya en el chat.
   */
  projectInstructions?: string | null;

  /**
   * Filas de `ai_project_documents` (join `documents`) para armar referencias; el usuario
   * puede restringir qué se envía (subconjunto + presupuesto de bytes) desde el modal.
   */
  projectDocuments?: AiProjectDocumentWithFile[] | null;
  /**
   * Valores de `ai_projects` (migración agent context) o null si no hay proyecto.
   * Si faltan columnas (migración pendiente), se usan constantes de `agentDispatchInputContext`.
   */
  projectContextDefaults?: Pick<
    AiProject,
    | "agent_context_mode"
    | "agent_conversation_excerpt_mode"
    | "agent_conversation_excerpt_max_messages"
    | "agent_max_knowledge_bytes"
  > | null;

  /**
   * Solo con seguimiento (`previousTaskId`): limpia el vínculo a la tarea anterior y
   * deja el mismo modal en modo "tarea nueva" (sin enlace a la tarea previa).
   */
  onStartFreshTask?: () => void;

  /** Tras un dispatch exitoso desde la VM (vía edge `dispatch-to-agent`). */
  onDelegated: (ref: {
    task_id: string;
    agent_id: string;
    agent_name: string;
    agent_display_name: string;
    agent_color: string;
    title: string;
  }) => void;
}

const AGENT_GROUPS = {
  LEGAL: ["amatl", "nelli", "tepantli", "tlahtoani", "tequitl"],
  CONTABLE_FISCAL: ["balam", "teocuitl", "metztli"],
  GESTORIA: ["yollotl", "atl"],
  DOCUMENTOS_COMUNICACION: ["tlahtolli", "coyolli"],
  INVESTIGACION_ANALISIS: ["tochtli", "ollin"],
} as const;

type AgentGroupKey = keyof typeof AGENT_GROUPS | "OTROS";

const GROUP_LABELS: Record<AgentGroupKey, string> = {
  LEGAL: "Legal",
  CONTABLE_FISCAL: "Contable y Fiscal",
  GESTORIA: "Gestoría",
  DOCUMENTOS_COMUNICACION: "Documentos y Comunicación",
  INVESTIGACION_ANALISIS: "Investigación y Análisis",
  OTROS: "Otros",
};

const MAX_DELEGATE_INSTRUCTIONS = 12_000;

/** Sobre el conocimiento: aviso de posible carga de contexto (el texto extraído en la VM puede exceder esto). */
const KNOWLEDGE_TOKEN_ROUGH_WARN = 100_000;

function coalesceContextMode(m?: string | null): AgentContextMode {
  if (m && (AGENT_CONTEXT_MODES as readonly string[]).includes(m)) {
    return m as AgentContextMode;
  }
  return DEFAULT_AGENT_CONTEXT_MODE;
}

function coalesceExcerptMode(m?: string | null): AgentConversationExcerptMode {
  if (m && (AGENT_CONVERSATION_EXCERPT_MODES as readonly string[]).includes(m)) {
    return m as AgentConversationExcerptMode;
  }
  return DEFAULT_AGENT_CONVERSATION_EXCERPT_MODE;
}

const GROUP_ORDER: AgentGroupKey[] = [
  "LEGAL",
  "CONTABLE_FISCAL",
  "GESTORIA",
  "DOCUMENTOS_COMUNICACION",
  "INVESTIGACION_ANALISIS",
  "OTROS",
];

function groupAgents(agents: Agent[]): Record<AgentGroupKey, Agent[]> {
  const groups: Record<AgentGroupKey, Agent[]> = {
    LEGAL: [],
    CONTABLE_FISCAL: [],
    GESTORIA: [],
    DOCUMENTOS_COMUNICACION: [],
    INVESTIGACION_ANALISIS: [],
    OTROS: [],
  };

  for (const agent of agents) {
    let placed = false;
    for (const [groupKey, names] of Object.entries(AGENT_GROUPS)) {
      if ((names as readonly string[]).includes(agent.name)) {
        groups[groupKey as keyof typeof AGENT_GROUPS].push(agent);
        placed = true;
        break;
      }
    }
    if (!placed) groups.OTROS.push(agent);
  }

  for (const key of GROUP_ORDER) {
    groups[key].sort((a, b) =>
      a.display_name.localeCompare(b.display_name, "es"),
    );
  }

  return groups;
}

export function DelegateToAgentDialog({
  isOpen,
  onClose,
  defaultTitle = "",
  attachments,
  conversationId,
  defaultClientId = null,
  defaultAgentTemplateId = null,
  aiProjectId = null,
  previousTaskId = null,
  followUpKind = null,
  projectInstructions = null,
  projectDocuments = null,
  projectContextDefaults = null,
  onStartFreshTask,
  onDelegated,
}: DelegateToAgentDialogProps) {
  const { data: clients = [], isLoading: clientsLoading } = useClients();
  const clientList = (clients ?? []) as Client[];

  const [selectedClientId, setSelectedClientId] = useState<string | null>(
    defaultClientId ?? null,
  );
  const [selectedAgentId, setSelectedAgentId] = useState<string | null>(null);
  const [title, setTitle] = useState<string>("");
  const [isDispatching, setIsDispatching] = useState(false);
  const [dispatchError, setDispatchError] = useState<string | null>(null);
  const [clientPopoverOpen, setClientPopoverOpen] = useState(false);
  const [agentPopoverOpen, setAgentPopoverOpen] = useState(false);
  const [agentInstructions, setAgentInstructions] = useState("");
  const [contextMode, setContextMode] = useState<AgentContextMode>(DEFAULT_AGENT_CONTEXT_MODE);
  const [conversationExcerptMode, setConversationExcerptMode] =
    useState<AgentConversationExcerptMode>(DEFAULT_AGENT_CONVERSATION_EXCERPT_MODE);
  const [excerptMaxMessages, setExcerptMaxMessages] = useState(
    DEFAULT_AGENT_CONVERSATION_EXCERPT_MAX_MESSAGES,
  );
  /** "all" o lista de `documents.id` incluidos. */
  const [knowledgeDocSelection, setKnowledgeDocSelection] = useState<"all" | string[]>("all");

  const agentList = useAgentList(selectedClientId);

  const effectiveMaxKnowledgeBytes = useMemo(
    () => projectContextDefaults?.agent_max_knowledge_bytes ?? DEFAULT_AGENT_MAX_KNOWLEDGE_BYTES,
    [projectContextDefaults?.agent_max_knowledge_bytes],
  );

  const allKnowledgeDocIds = useMemo(
    () =>
      (projectDocuments ?? [])
        .map((d) => d.document_id)
        .filter((x): x is string => Boolean(x)),
    [projectDocuments],
  );

  const knowledge = useMemo(() => {
    if (!projectDocuments?.length) return null;
    return buildProjectKnowledgeForAgentDispatch(projectDocuments, {
      includedDocumentIds: knowledgeDocSelection === "all" ? null : knowledgeDocSelection,
      maxTotalBytes: effectiveMaxKnowledgeBytes,
    });
  }, [projectDocuments, knowledgeDocSelection, effectiveMaxKnowledgeBytes]);

  useEffect(() => {
    if (!isOpen) return;
    setDispatchError(null);
    setIsDispatching(false);
    setSelectedClientId(defaultClientId ?? null);
    setSelectedAgentId(defaultAgentTemplateId ?? null);
    setTitle((defaultTitle ?? "").trim().slice(0, 200));
    setClientPopoverOpen(false);
    setAgentPopoverOpen(false);
    setAgentInstructions((projectInstructions ?? "").trim());
    setKnowledgeDocSelection("all");
    setContextMode(coalesceContextMode(projectContextDefaults?.agent_context_mode));
    setConversationExcerptMode(
      coalesceExcerptMode(projectContextDefaults?.agent_conversation_excerpt_mode),
    );
    setExcerptMaxMessages(
      typeof projectContextDefaults?.agent_conversation_excerpt_max_messages === "number"
        ? projectContextDefaults.agent_conversation_excerpt_max_messages
        : DEFAULT_AGENT_CONVERSATION_EXCERPT_MAX_MESSAGES,
    );
  }, [
    isOpen,
    defaultClientId,
    defaultTitle,
    defaultAgentTemplateId,
    projectInstructions,
    previousTaskId,
    projectContextDefaults,
  ]);

  const handleClientSelect = (id: string | null) => {
    setSelectedClientId((prev) => {
      if (prev !== id) setSelectedAgentId(null);
      return id;
    });
  };

  const groupedAgents = useMemo(
    () => groupAgents(agentList.agents),
    [agentList.agents],
  );

  const selectedAgent = useMemo(
    () => agentList.agents.find((a) => a.template_id === selectedAgentId),
    [agentList.agents, selectedAgentId],
  );

  const isRagFirst = contextMode === "rag_first";

  const knowledgeSupabaseRefs = knowledge?.supabaseRefs ?? [];
  const knowledgeDropbox = knowledge?.dropboxDocuments ?? [];
  const knowledgeTotalCount = knowledgeSupabaseRefs.length + knowledgeDropbox.length;
  const knowledgeRoughTokens = knowledge
    ? roughEstimateDocTokensForDispatch(knowledge.includedBytesEstimate)
    : 0;

  const chatAttachmentBytes = useMemo(() => {
    if (!attachments?.length) return 0;
    return (attachments as AttachmentRef[]).reduce((sum, a) => {
      const b = a.size_bytes;
      return sum + (typeof b === "number" && b > 0 ? b : 0);
    }, 0);
  }, [attachments]);
  const chatRoughTokens = roughEstimateDocTokensForDispatch(chatAttachmentBytes);
  const showKnowledgeTokenWarning = isRagFirst
    ? chatRoughTokens > KNOWLEDGE_TOKEN_ROUGH_WARN
    : knowledge != null && knowledgeRoughTokens > KNOWLEDGE_TOKEN_ROUGH_WARN;

  const isFollowUp = Boolean(previousTaskId);
  const instrTrim = agentInstructions.replace(/\r\n/g, "\n").trim();
  const hasDispatchBody = title.trim().length > 0 || instrTrim.length > 0;

  const canSubmit =
    selectedAgentId !== null &&
    hasDispatchBody &&
    !agentList.isLoading &&
    !agentList.error &&
    !clientsLoading &&
    (allKnowledgeDocIds.length === 0 ||
      knowledgeDocSelection === "all" ||
      (Array.isArray(knowledgeDocSelection) && knowledgeDocSelection.length > 0));

  const handleToggleKnowledgeDoc = (docId: string, checked: boolean) => {
    setKnowledgeDocSelection((prev) => {
      if (prev === "all") {
        return allKnowledgeDocIds.filter((id) => id !== docId);
      }
      const set = new Set(prev);
      if (checked) set.add(docId);
      else set.delete(docId);
      const next = allKnowledgeDocIds.filter((id) => set.has(id));
      if (next.length === 0) return [];
      if (next.length === allKnowledgeDocIds.length) return "all";
      return next;
    });
  };

  const handleDelegate = async () => {
    if (!selectedAgentId) return;

    const agent = agentList.agents.find((a) => a.template_id === selectedAgentId);
    if (!agent) {
      setDispatchError("Agente no encontrado. Recarga la lista.");
      return;
    }

    const tTrim = title.trim();
    const effectiveTitle = tTrim
      ? tTrim.slice(0, 200)
      : instrTrim
        ? instrTrim.slice(0, 200)
        : "";
    if (!effectiveTitle) {
      setDispatchError("Escribe un asunto o instrucciones.");
      return;
    }

    setIsDispatching(true);
    setDispatchError(null);

    try {
      const kBuilt = knowledge;
      const kSupa = kBuilt?.supabaseRefs ?? [];
      const fromChat = (attachments ?? []) as ChatAttachmentMeta[];
      const rag = contextMode === "rag_first";
      const mergedAttachmentRefs = rag
        ? mergeAgentAttachmentRefs([], fromChat)
        : mergeAgentAttachmentRefs(kSupa, fromChat);

      const body: Record<string, unknown> = {
        agent_id: agent.template_id,
        title: effectiveTitle,
        attachment_refs: mergedAttachmentRefs,
      };

      if (selectedClientId) {
        body.client_id = selectedClientId;
      }

      const ctx: Record<string, unknown> = {};
      if (conversationId) ctx.conversation_id = conversationId;
      if (aiProjectId) ctx.ai_project_id = aiProjectId;
      ctx.context_mode = contextMode;
      ctx.conversation_excerpt_mode = conversationExcerptMode;
      if (conversationExcerptMode === "last_n") {
        ctx.conversation_excerpt_max_messages = Math.min(
          500,
          Math.max(0, Math.floor(excerptMaxMessages)),
        );
      } else {
        ctx.conversation_excerpt_max_messages = 0;
      }
      ctx.include_conversation_excerpt = conversationExcerptMode !== "off";
      if (!rag && kSupa.length) {
        ctx.knowledge_supabase_ref_count = kSupa.length;
      }
      if (kBuilt?.dropboxDocuments && kBuilt.dropboxDocuments.length > 0) {
        ctx.knowledge_dropbox_documents = kBuilt.dropboxDocuments;
      }
      if (kBuilt && kBuilt.includedDocumentIds.length > 0) {
        ctx.knowledge_included_document_ids = kBuilt.includedDocumentIds;
      }
      if (rag) {
        if (chatAttachmentBytes > 0) ctx.max_attachment_bytes_per_task = chatAttachmentBytes;
        const t = roughEstimateDocTokensForDispatch(chatAttachmentBytes);
        if (t > 0) ctx.max_estimated_input_tokens = t;
      } else if (kBuilt) {
        ctx.knowledge_max_total_bytes = kBuilt.includedBytesEstimate;
        const est = roughEstimateDocTokensForDispatch(kBuilt.includedBytesEstimate);
        if (est > 0) ctx.max_estimated_input_tokens = est;
      }
      if (previousTaskId) {
        ctx.previous_task_id = previousTaskId;
        if (followUpKind) ctx.follow_up_kind = followUpKind;
      }
      if (Object.keys(ctx).length > 0) {
        body.input_context = ctx;
      }

      const inst = agentInstructions.replace(/\r\n/g, "\n").trim();
      if (inst.length > 0) {
        body.instructions = inst.slice(0, MAX_DELEGATE_INSTRUCTIONS);
      }

      const { data, error } = await supabase.functions.invoke(
        "dispatch-to-agent",
        { body },
      );

      if (error) throw error;

      const payload = data as Record<string, unknown> | null;
      if (payload && typeof payload.error === "string") {
        throw new Error(payload.error);
      }

      const taskId = payload?.task_id;
      if (typeof taskId !== "string" || !taskId) {
        throw new Error("Respuesta inválida del servidor");
      }

      onDelegated({
        task_id: taskId,
        agent_id: agent.template_id,
        agent_name: agent.name,
        agent_display_name: agent.display_name,
        agent_color: agent.color,
        title: effectiveTitle,
      });

      onClose();
    } catch (err) {
      const message =
        err instanceof Error ? err.message : "Error desconocido al delegar";
      setDispatchError(message);
      console.error("[delegate-dialog] dispatch failed", err);
    } finally {
      setIsDispatching(false);
    }
  };

  const primaryCtaLabel = isFollowUp
    ? followUpKind === "retry"
      ? "Reenviar ajuste"
      : "Enviar seguimiento"
    : "Delegar tarea";
  const primaryLoadingLabel = isFollowUp ? "Enviando…" : "Delegando…";
  const dialogTitle = isFollowUp ? "Seguimiento con el agente" : "Delegar tarea a un agente";

  const maxMbLabel = (effectiveMaxKnowledgeBytes / (1024 * 1024)).toFixed(1);

  const contextTuningBlock = (
    <div className="space-y-3 rounded-md border border-border/50 bg-muted/20 px-2.5 py-3">
      <p className="text-xs font-medium text-foreground">Contexto del modelo (kawiil-agents)</p>
      <div className="space-y-1.5">
        <Label className="text-[11px]">Modo de expediente</Label>
        <Select value={contextMode} onValueChange={(v) => setContextMode(v as AgentContextMode)}>
          <SelectTrigger className="h-9 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="refs_budget">Equilibrar por tamaño (recomendado)</SelectItem>
            <SelectItem value="full_refs">Cuerpos completos (si la VM aplica el modo)</SelectItem>
            <SelectItem value="rag_first">Priorizar búsqueda (RAG) en el proyecto</SelectItem>
          </SelectContent>
        </Select>
        {isRagFirst && (
          <p className="text-[10px] text-muted-foreground leading-snug">
            No se reenvían archivos del bucket del expediente: el agente usa el índice del proyecto y el acotado de
            documentos que marques abajo; solo se adjuntan al binario de la tarea los subidos en este chat.
          </p>
        )}
      </div>
      <div className="space-y-1.5">
        <Label className="text-[11px]">Extracto de esta conversación en el contexto</Label>
        <Select
          value={conversationExcerptMode}
          onValueChange={(v) => setConversationExcerptMode(v as AgentConversationExcerptMode)}
        >
          <SelectTrigger className="h-9 text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="last_n">Últimos N mensajes</SelectItem>
            <SelectItem value="full">Hilo completo (alto riesgo de límite 200k tokens)</SelectItem>
            <SelectItem value="off">No incluir el chat (solo instrucciones y documentos)</SelectItem>
          </SelectContent>
        </Select>
        {conversationExcerptMode === "last_n" && (
          <div className="flex items-center gap-2 pt-0.5">
            <Label className="text-[10px] shrink-0">Mensajes (máx. 500)</Label>
            <Input
              type="number"
              min={0}
              max={500}
              className="h-8 text-xs w-20"
              value={excerptMaxMessages}
              onChange={(e) =>
                setExcerptMaxMessages(
                  Math.min(500, Math.max(0, Math.floor(Number(e.target.value) || 0))),
                )
              }
            />
          </div>
        )}
      </div>
    </div>
  );

  const knowledgeSelectionBlock =
    allKnowledgeDocIds.length > 0 ? (
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label>{isRagFirst ? "Conocimiento del proyecto (qué entra al índice RAG)" : "Documentos de conocimiento a enviar"}</Label>
          {knowledgeDocSelection !== "all" && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-7 text-[10px]"
              onClick={() => setKnowledgeDocSelection("all")}
            >
              Incluir todos
            </Button>
          )}
        </div>
        {isRagFirst ? (
          <p className="text-[10px] text-muted-foreground leading-snug">
            Marca qué documentos acotan la búsqueda semántica; no se reenvían por Storage. Dropbox sigue
            resolviéndose en la VM según el contrato.
          </p>
        ) : (
          <p className="text-[10px] text-muted-foreground leading-snug">
            Tope acumulado: {maxMbLabel} MB (por tamaño en disco; la VM aplica límite global al prompt, ~200k
            tokens). Prioridad: documentos más recientes.
          </p>
        )}
        {showKnowledgeTokenWarning && (
          <p className="text-[10px] text-amber-800 dark:text-amber-100/90 rounded border border-amber-200/60 bg-amber-50/50 dark:bg-amber-950/30 px-2 py-1.5 leading-snug">
            {isRagFirst
              ? "Carga de contexto alta por archivos de este chat. Reduce adjuntos, acorta el hilo, o reintenta en otra tarea."
              : "Estimación de contexto alta. Usa RAG, menos archivos, extracto mínimo del chat, o un seguimiento aparte."}
          </p>
        )}
        <div className="rounded-md border border-sky-200/60 dark:border-sky-800/40 bg-sky-50/40 dark:bg-sky-950/20 p-2 max-h-40 overflow-y-auto space-y-2">
          {(projectDocuments ?? [])
            .filter((d) => d.document_id)
            .map((row) => {
              const id = row.document_id!;
              const isDrop = Boolean(row.documents?.external_path);
              const checked = knowledgeDocSelection === "all" || knowledgeDocSelection.includes(id);
              return (
                <label
                  key={row.id}
                  className="flex items-start gap-2 text-[10px] text-muted-foreground cursor-pointer"
                >
                  <Checkbox
                    className="mt-0.5"
                    checked={checked}
                    onCheckedChange={(v) => handleToggleKnowledgeDoc(id, v === true)}
                  />
                  <span className="min-w-0 break-words">
                    <span className="text-foreground/90 font-medium">{row.name}</span>{" "}
                    <span className="text-muted-foreground/80">{isDrop ? "· Dropbox" : "· Storage"}</span>
                  </span>
                </label>
              );
            })}
        </div>
        {knowledge != null && knowledge.skippedForByteBudget > 0 && !isRagFirst && (
          <p className="text-[10px] text-amber-800 dark:text-amber-100/90">
            {knowledge.skippedForByteBudget} documento(s) excluido(s) al superar el tope de {maxMbLabel} MB; se
            priorizan los más recientes.
          </p>
        )}
        {isRagFirst ? (
          <p className="text-[10px] text-muted-foreground">
            Ámbito: {knowledge?.includedDocumentIds.length ?? 0} documento(s) del proyecto (la VM filtra búsqueda
            o rutas; sin reabrir el expediente en Storage en esta tarea). Archivos añadidos al binario:{" "}
            {attachments?.length ?? 0} en el chat.
          </p>
        ) : (
          <p className="text-[10px] text-muted-foreground">
            En el envío: {knowledgeSupabaseRefs.length} en Storage
            {knowledgeDropbox.length > 0
              ? ` y ${knowledgeDropbox.length} en Dropbox.`
              : ". "}
            Los adjuntos del chat se combinan y no se duplican por ruta en Storage.
          </p>
        )}
        {knowledgeTotalCount < 1 && (knowledgeDocSelection === "all" || knowledgeDocSelection.length > 0) && (
          <p className="text-[10px] text-destructive/90">
            Ninguna referencia incluida con los filtros actuales. Aumenta el tope en el proyecto, quita
            documentos, o reactiva al menos un archivo.
          </p>
        )}
      </div>
    ) : null;

  const followUpInfoShort = isFollowUp && (
    <div
      role="status"
      className="rounded-md border border-primary/20 bg-primary/5 px-2.5 py-2 text-[11px] text-muted-foreground leading-snug"
    >
      {followUpKind === "retry" ? (
        <p>Reintento: mismo agente e historial; indica abajo el ajuste o la nueva búsqueda.</p>
      ) : (
        <p>
          Seguimiento al mismo agente: escribe qué necesitas ahora. Se incluyen documentos de conocimiento, adjuntos del
          chat y enlace a la tarea anterior.
        </p>
      )}
    </div>
  );

  return (
    <Dialog
      open={isOpen}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{dialogTitle}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          {isFollowUp ? (
            <>
              {followUpInfoShort}
              <div className="space-y-1.5">
                <Label htmlFor="agent-instructions" className="text-foreground">
                  Mensaje al agente
                </Label>
                <Textarea
                  id="agent-instructions"
                  value={agentInstructions}
                  onChange={(e) => setAgentInstructions(e.target.value.slice(0, MAX_DELEGATE_INSTRUCTIONS))}
                  placeholder="Instrucciones o preguntas para continuar con el mismo encargo. Puedes dejar en blanco el asunto si responde aquí."
                  className="min-h-[128px] max-h-56 text-sm resize-y"
                  rows={5}
                />
                <p className="text-[10.5px] text-muted-foreground">Opcional: complementa o resume con el asunto de abajo.</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="task-title">Asunto breve (opcional)</Label>
                <Input
                  id="task-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value.slice(0, 200))}
                  placeholder="p. ej. Revisar anexo 2 del expediente"
                  maxLength={200}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Cliente</Label>
                <ClientCombobox
                  clients={clientList}
                  selected={selectedClientId}
                  onSelect={handleClientSelect}
                  open={clientPopoverOpen}
                  onOpenChange={setClientPopoverOpen}
                  disabled={clientsLoading}
                />
                <p className="text-[11px] text-muted-foreground">Deja vacío si aplica tarea general del despacho.</p>
              </div>
              <div className="space-y-1.5">
                <Label>Agente (este seguimiento)</Label>
                {selectedAgent ? (
                  <div className="rounded-md border border-border/60 bg-muted/30 px-3 py-2">
                    <p className="text-sm font-medium">{selectedAgent.display_name}</p>
                    <p className="text-[11px] text-muted-foreground line-clamp-3 mt-0.5">
                      {selectedAgent.description ?? selectedAgent.role}
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-destructive">Cargando agente…</p>
                )}
                {agentList.error && (
                  <p className="text-[11px] text-destructive">{agentList.error.message}</p>
                )}
              </div>
              {onStartFreshTask && (
                <div className="pt-0.5">
                  <Button
                    type="button"
                    variant="link"
                    className="h-auto p-0 text-xs text-muted-foreground"
                    onClick={() => onStartFreshTask()}
                  >
                    Iniciar una tarea nueva (sin vincular a la anterior)
                  </Button>
                </div>
              )}
            </>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label>Cliente</Label>
                <ClientCombobox
                  clients={clientList}
                  selected={selectedClientId}
                  onSelect={handleClientSelect}
                  open={clientPopoverOpen}
                  onOpenChange={setClientPopoverOpen}
                  disabled={clientsLoading}
                />
                <p className="text-[11px] text-muted-foreground">Deja vacío si es una tarea general del despacho.</p>
              </div>
              <div className="space-y-1.5">
                <Label>Agente</Label>
                <AgentCombobox
                  grouped={groupedAgents}
                  isLoading={agentList.isLoading}
                  selected={selectedAgentId}
                  onSelect={setSelectedAgentId}
                  open={agentPopoverOpen}
                  onOpenChange={setAgentPopoverOpen}
                />
                {agentList.error && (
                  <p className="text-[11px] text-destructive">{agentList.error.message}</p>
                )}
                {selectedAgent && (
                  <p className="text-[11px] text-muted-foreground line-clamp-3">
                    {selectedAgent.description ?? selectedAgent.role}
                  </p>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="task-title">Título de la tarea</Label>
                <Input
                  id="task-title"
                  value={title}
                  onChange={(e) => setTitle(e.target.value.slice(0, 200))}
                  placeholder="Ej. Revisar contrato de arrendamiento"
                  maxLength={200}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="agent-instructions">Instrucciones (opcional)</Label>
                <Textarea
                  id="agent-instructions"
                  value={agentInstructions}
                  onChange={(e) => setAgentInstructions(e.target.value.slice(0, MAX_DELEGATE_INSTRUCTIONS))}
                  placeholder="Detalle, criterios o referencia a documentos. Pueden ampliar las instrucciones del proyecto de IA."
                  className="min-h-[100px] max-h-48 text-sm resize-y"
                  rows={4}
                />
                <p className="text-[10.5px] text-muted-foreground">
                  Si solo escribes instrucciones, se usarán como título abreviado.
                </p>
              </div>
            </>
          )}

          {contextTuningBlock}
          {knowledgeSelectionBlock}

          {attachments && attachments.length > 0 && (
            <div className="space-y-1.5">
              <Label>Archivos adjuntos ({attachments.length})</Label>
              <div className="rounded-md border border-border/50 bg-muted/30 p-2 max-h-24 overflow-auto space-y-1">
                {attachments.map((a, i) => (
                  <p
                    key={`${a.path}-${i}`}
                    className="text-[11px] text-muted-foreground truncate flex items-center gap-1.5"
                  >
                    <Paperclip className="h-3 w-3 shrink-0 opacity-70" />
                    <span className="truncate">{a.name}</span>
                  </p>
                ))}
              </div>
            </div>
          )}

          {dispatchError && (
            <div className="rounded-md bg-destructive/10 border border-destructive/30 p-2 flex items-start gap-2">
              <AlertCircle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-xs text-destructive">{dispatchError}</p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2 sm:gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={isDispatching}
          >
            Cancelar
          </Button>
          <Button
            type="button"
            onClick={() => void handleDelegate()}
            disabled={!canSubmit || isDispatching}
          >
            {isDispatching ? (
              <>
                <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                {primaryLoadingLabel}
              </>
            ) : (
              primaryCtaLabel
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ClientCombobox({
  clients,
  selected,
  onSelect,
  open,
  onOpenChange,
  disabled,
}: {
  clients: Client[];
  selected: string | null;
  onSelect: (id: string | null) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  disabled?: boolean;
}) {
  const selectedClient = clients.find((c) => c.id === selected);

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
          disabled={disabled}
        >
          <span className="truncate">
            {selectedClient ? selectedClient.name : "Sin cliente específico"}
          </span>
          <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="z-[130] w-[--radix-popover-trigger-width] p-0"
        align="start"
      >
        <Command>
          <CommandInput placeholder="Buscar cliente…" />
          <CommandList>
            <CommandEmpty>No se encontraron clientes.</CommandEmpty>
            <CommandGroup>
              <CommandItem
                value="__no_client__ sin cliente"
                onSelect={() => {
                  onSelect(null);
                  onOpenChange(false);
                }}
              >
                <Check
                  className={cn(
                    "h-4 w-4 mr-2 shrink-0",
                    selected === null ? "opacity-100" : "opacity-0",
                  )}
                />
                Sin cliente específico
              </CommandItem>
              {clients.map((client) => (
                <CommandItem
                  key={client.id}
                  value={`${client.name} ${client.id}`}
                  onSelect={() => {
                    onSelect(client.id);
                    onOpenChange(false);
                  }}
                >
                  <Check
                    className={cn(
                      "h-4 w-4 mr-2 shrink-0",
                      selected === client.id ? "opacity-100" : "opacity-0",
                    )}
                  />
                  {client.name}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function AgentCombobox({
  grouped,
  isLoading,
  selected,
  onSelect,
  open,
  onOpenChange,
}: {
  grouped: Record<AgentGroupKey, Agent[]>;
  isLoading: boolean;
  selected: string | null;
  onSelect: (templateId: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const total = GROUP_ORDER.reduce((n, k) => n + grouped[k].length, 0);

  const selectedAgentRow = useMemo(
    () =>
      selected
        ? GROUP_ORDER.flatMap((k) => grouped[k]).find(
            (a) => a.template_id === selected,
          )
        : undefined,
    [grouped, selected],
  );

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full justify-between font-normal"
          disabled={isLoading}
        >
          <span className="truncate">
            {isLoading
              ? "Cargando agentes…"
              : selectedAgentRow?.display_name ?? "Seleccionar agente"}
          </span>
          {isLoading ? (
            <Loader2 className="h-4 w-4 shrink-0 animate-spin opacity-70" />
          ) : (
            <ChevronsUpDown className="h-4 w-4 shrink-0 opacity-50" />
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="z-[130] w-[--radix-popover-trigger-width] p-0"
        align="start"
      >
        <Command>
          <CommandInput placeholder="Buscar agente…" />
          <CommandList>
            <CommandEmpty>
              {total === 0
                ? "No hay agentes disponibles."
                : "No se encontraron agentes."}
            </CommandEmpty>
            {GROUP_ORDER.map((groupKey) => {
              const groupAgents = grouped[groupKey];
              if (groupAgents.length === 0) return null;
              return (
                <CommandGroup
                  key={groupKey}
                  heading={GROUP_LABELS[groupKey]}
                >
                  {groupAgents.map((agent) => (
                    <CommandItem
                      key={`${groupKey}-${agent.template_id}`}
                      value={`${agent.display_name} ${agent.name} ${agent.description ?? ""}`}
                      onSelect={() => {
                        onSelect(agent.template_id);
                        onOpenChange(false);
                      }}
                      className="items-start py-2"
                    >
                      <Check
                        className={cn(
                          "h-4 w-4 mr-2 mt-1 shrink-0",
                          selected === agent.template_id
                            ? "opacity-100"
                            : "opacity-0",
                        )}
                      />
                      <span
                        className="h-6 w-6 rounded flex items-center justify-center text-white text-[10px] font-bold mr-2 shrink-0 mt-0.5"
                        style={{ backgroundColor: agent.color }}
                      >
                        {agent.display_name.slice(0, 2).toUpperCase()}
                      </span>
                      <div className="flex-1 min-w-0 flex flex-col gap-0.5">
                        <span className="text-sm font-medium truncate">
                          {agent.display_name}
                        </span>
                        {agent.description && (
                          <span className="text-[11px] text-muted-foreground line-clamp-2 leading-tight">
                            {agent.description}
                          </span>
                        )}
                      </div>
                    </CommandItem>
                  ))}
                </CommandGroup>
              );
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
