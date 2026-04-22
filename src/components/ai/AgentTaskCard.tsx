import { useEffect, useMemo, useRef, useState } from "react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Loader2,
  CheckCircle2,
  XCircle,
  Clock,
  ChevronDown,
  ChevronUp,
  Copy,
  ExternalLink,
  UserPlus,
  RotateCw,
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useAgentTaskProgress,
  type AgentTaskEvent,
  type AgentTaskStatus as HookStatus,
} from "@/hooks/useAgentTaskProgress";
import { supabase } from "@/integrations/supabase/client";
import {
  resolveAgentTaskDisplayText,
  getAgentTaskPreviewModel,
  extractDeliverableLinks,
  type AgentTaskDeliverableLink,
} from "@/lib/agentTaskResult";

/**
 * AgentTaskCard (Bloque B1.6.4)
 * -----------------------------
 * Card inline que se renderiza dentro del stream del chat de /asistente
 * cuando el usuario delega una tarea a un agente consultable.
 *
 * Renderiza:
 *  - Header con avatar coloreado del agente, nombre, rol, título de la
 *    tarea y último evento en vivo (siempre visible, click = toggle).
 *  - Timeline de eventos expandible (Collapsible) con traducción humana
 *    de cada `event_type` de `ai_task_events`.
 *  - Preview del resultado (texto canónico desde `result` / `result_summary` vía `agentTaskResult`).
 *  - Mensaje de error cuando la tarea falla.
 *  - Footer con acciones "Ver detalles" y "Copiar resultado".
 *
 * Fuente de verdad:
 *  - Status + eventos en vivo: `useAgentTaskProgress(taskId)` (realtime
 *    postgres_changes sobre `ai_task_events` con polling de respaldo).
 *  - Resultado final: fetch puntual de `agent_tasks` cuando el status
 *    transita a `completed`/`failed`.
 *
 * En `AsistenteIA.tsx` el resultado se sincroniza además al `content` del mensaje del hilo.
 */

export interface AgentTaskCardProps {
  /** UUID de la fila en `agent_tasks`. */
  taskId: string;
  agent: {
    /** Nombre visible (ej. "Amatl"). */
    display_name: string;
    /** Rol técnico (ej. "amatl"). */
    role: string;
    /** Color de marca del agente en hex (ej. "#4da6ff"). */
    color: string;
  };
  /** Título que el usuario dio a la tarea al delegarla. */
  title: string;
  className?: string;
  /** Callback del botón "Ver detalles" (p.ej. abrir panel lateral). */
  onViewDetails?: () => void;
  /** Mensaje del hilo donde volcar el Markdown del resultado (una sola vez al completar). */
  chatMessageId?: string;
  patchMessageContent?: (messageId: string, content: string) => Promise<boolean>;
  /** Si el contenido ya está en `chat_messages` (recarga o tras sync), no duplicar el cuerpo en la card. */
  hasChatContent?: boolean;
  /** Abre el modal con el mismo agente y contexto de seguimiento (no reintento). */
  onFollowUpSameAgent?: () => void;
  /** Segunda búsqueda / reintento enlazado a esta tarea (`previous_task_id` en dispatch). */
  onRetryAgentSearch?: () => void;
  /** Contenido actual del mensaje en el hilo (para re-sincronizar si el canónico del servidor es más largo). */
  serverMessageContent?: string;
  /** Entregables detectados al cargar `result` / `execution_metadata`. */
  onDeliverableLinksChange?: (taskId: string, links: AgentTaskDeliverableLink[]) => void;
}

type TaskStatus = "pending" | "running" | "completed" | "failed";

interface FetchedResult {
  result: unknown;
  result_summary: string | null;
  error_message: string | null;
  execution_metadata: unknown;
}

/**
 * Mapea el status del hook (5 estados) al TaskStatus del card (4 estados).
 * `idle` y `connecting` colapsan a `pending` porque, desde el punto de vista
 * visual del usuario, ambos significan "la tarea aún no ha emitido eventos".
 */
function mapHookStatus(hookStatus: HookStatus): TaskStatus {
  switch (hookStatus) {
    case "idle":
    case "connecting":
      return "pending";
    case "running":
      return "running";
    case "completed":
      return "completed";
    case "failed":
      return "failed";
    default:
      return "pending";
  }
}

/** Fila en `agent_tasks` (la VM actualiza status aunque no haya filas en `ai_task_events`). */
type AgentTaskDbRow = {
  status: string;
  error_message: string | null;
  started_at: string | null;
};

/**
 * Poll ligero a `agent_tasks`: si Realtime/RLS ocultan `ai_task_events`, igual mostramos
 * running/completed/failed según la columna `status` del servidor.
 */
function useAgentTaskDbPoll(taskId: string) {
  const [row, setRow] = useState<AgentTaskDbRow | null>(null);

  useEffect(() => {
    let cancelled = false;

    const tick = async () => {
      const { data, error } = await supabase
        .from("agent_tasks")
        .select("status, error_message, started_at")
        .eq("id", taskId)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        console.warn("[agent-task-card] agent_tasks", error.message);
        return;
      }
      if (!data) return;
      setRow({
        status: typeof data.status === "string" ? data.status : "",
        error_message: data.error_message ?? null,
        started_at: data.started_at ?? null,
      });
    };

    void tick();
    const intervalId = window.setInterval(() => void tick(), 12_000);

    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [taskId]);

  return row;
}

/**
 * Prioridad: eventos del stream → estado derivado del hook → columnas `agent_tasks`.
 * Así la tarjeta no se queda en "Pendiente" si el worker ya marcó running/completed en DB.
 */
function mergeTaskStatus(
  hookMapped: TaskStatus,
  events: AgentTaskEvent[],
  db: AgentTaskDbRow | null,
): TaskStatus {
  if (events.some((e) => e.event_type === "completed")) return "completed";
  if (events.some((e) => e.event_type === "failed")) return "failed";
  if (hookMapped === "completed" || hookMapped === "failed") return hookMapped;

  if (db) {
    const s = db.status.toLowerCase();
    if (s === "completed" || s === "success") return "completed";
    if (
      s === "failed" ||
      s === "error" ||
      (db.error_message && db.error_message.trim().length > 0)
    ) {
      return "failed";
    }
    if (
      s === "running" ||
      s === "processing" ||
      s === "in_progress" ||
      (db.started_at && db.started_at.length > 0)
    ) {
      return "running";
    }
  }
  return hookMapped;
}

export function AgentTaskCard({
  taskId,
  agent,
  title,
  className,
  onViewDetails,
  chatMessageId,
  patchMessageContent,
  hasChatContent = false,
  onFollowUpSameAgent,
  onRetryAgentSearch,
  serverMessageContent = "",
  onDeliverableLinksChange,
}: AgentTaskCardProps) {
  const { events, status: hookStatus, isConnected } = useAgentTaskProgress(taskId);
  const dbRow = useAgentTaskDbPoll(taskId);
  const status = useMemo(
    () => mergeTaskStatus(mapHookStatus(hookStatus), events, dbRow),
    [hookStatus, events, dbRow],
  );

  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  const [isCopied, setIsCopied] = useState(false);
  const [fetched, setFetched] = useState<FetchedResult | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  /** Guard para evitar refetch si el status oscila por polling. */
  const hasFetchedRef = useRef(false);
  /** Timer de reset del estado "Copiado" — se limpia si el componente desmonta. */
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    hasFetchedRef.current = false;
  }, [taskId]);

  const canonicalText = useMemo(
    () =>
      fetched
        ? resolveAgentTaskDisplayText(
            fetched.result,
            fetched.result_summary,
            fetched.execution_metadata,
          ).trim()
        : "",
    [fetched],
  );

  useEffect(() => {
    if (status !== "completed" || !chatMessageId || !patchMessageContent || !fetched) return;
    const text = canonicalText;
    if (!text) return;
    const serverLen = (serverMessageContent ?? "").trim().length;
    if (text.length <= serverLen) return;

    let cancelled = false;
    void (async () => {
      const ok = await patchMessageContent(chatMessageId, text);
      if (cancelled) return;
    })();
    return () => {
      cancelled = true;
    };
  }, [status, chatMessageId, patchMessageContent, fetched, canonicalText, serverMessageContent]);

  useEffect(() => {
    if (status !== "completed" && status !== "failed") return;
    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;

    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("agent_tasks")
        .select("result, result_summary, error_message, execution_metadata")
        .eq("id", taskId)
        .maybeSingle();
      if (cancelled) return;
      if (error) {
        console.warn("[agent-task-card] failed to fetch result", error.message);
        setFetchError(error.message);
        return;
      }
      if (!data) return;
      setFetched({
        result: data.result ?? null,
        result_summary: data.result_summary ?? null,
        error_message: data.error_message ?? null,
        execution_metadata: data.execution_metadata ?? null,
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [status, taskId]);

  useEffect(() => {
    if (!fetched || !onDeliverableLinksChange) return;
    const links = extractDeliverableLinks(fetched.result, fetched.execution_metadata);
    onDeliverableLinksChange(taskId, links);
  }, [fetched, taskId, onDeliverableLinksChange]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const lastEventMessage = useMemo(() => {
    if (events.length === 0) {
      if (status === "running") {
        return "Ejecución en curso en el servidor (si no ves el detalle línea a línea, comprueba la VM de agentes y Realtime).";
      }
      if (status === "pending") return "Esperando a que el agente inicie…";
      return "Sin eventos todavía";
    }
    return formatEventMessage(events[events.length - 1]);
  }, [events, status]);

  const errorMessage = useMemo(() => {
    if (dbRow?.error_message && dbRow.error_message.trim()) return dbRow.error_message;
    if (fetched?.error_message) return fetched.error_message;
    const failed = [...events].reverse().find((e) => e.event_type === "failed");
    const raw = failed?.payload?.error;
    if (typeof raw === "string" && raw.trim()) return raw;
    return null;
  }, [dbRow, fetched, events]);

  const handleCopy = async () => {
    const text = resolveAgentTaskDisplayText(
      fetched?.result,
      fetched?.result_summary,
      fetched?.execution_metadata,
    );
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setIsCopied(true);
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
      copyTimerRef.current = window.setTimeout(() => {
        setIsCopied(false);
        copyTimerRef.current = null;
      }, 2000);
    } catch (err) {
      console.warn("[agent-task-card] clipboard write failed", err);
    }
  };

  const showFooter = status === "completed" || status === "failed";

  return (
    <div
      className={cn(
        "rounded-2xl border px-4 py-3 transition-colors",
        status === "completed" && "border-success/30 bg-success/5",
        status === "failed" && "border-destructive/30 bg-destructive/5",
        (status === "running" || status === "pending") && "border-border bg-card",
        className,
      )}
    >
      <Collapsible open={isExpanded} onOpenChange={setIsExpanded}>
        <CollapsibleTrigger className="flex items-center gap-3 w-full text-left">
          <AgentAvatar displayName={agent.display_name} color={agent.color} />

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <p className="text-sm font-semibold truncate">{agent.display_name}</p>
              <p className="text-[10px] text-muted-foreground uppercase tracking-wide">
                {agent.role}
              </p>
            </div>
            <p className="text-[11px] text-muted-foreground truncate">{title}</p>
            <p
              className={cn(
                "text-[11px] truncate mt-0.5",
                status === "running" ? "text-foreground/80" : "text-muted-foreground",
              )}
              title={lastEventMessage}
            >
              {lastEventMessage}
            </p>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <StatusBadge status={status} isConnected={isConnected} />
            {isExpanded ? (
              <ChevronUp className="h-4 w-4 text-muted-foreground" />
            ) : (
              <ChevronDown className="h-4 w-4 text-muted-foreground" />
            )}
          </div>
        </CollapsibleTrigger>

        <CollapsibleContent className="mt-3 space-y-3">
          <EventTimeline events={events} status={status} dbStatus={dbRow?.status ?? null} />

          {status === "completed" && (
            <ResultPreview
              result={fetched?.result ?? null}
              resultSummary={fetched?.result_summary ?? null}
              executionMetadata={fetched?.execution_metadata ?? null}
              fetchError={fetchError}
              syncedToChatBelow={hasChatContent}
            />
          )}

          {status === "failed" && <FailureMessage error={errorMessage} />}

          {showFooter && (
            <Footer
              onCopy={handleCopy}
              onViewDetails={onViewDetails}
              onFollowUpSameAgent={
                status === "completed" || status === "failed" ? onFollowUpSameAgent : undefined
              }
              onRetryAgentSearch={
                status === "completed" || status === "failed" ? onRetryAgentSearch : undefined
              }
              isCopied={isCopied}
              canCopy={canCopyResult(fetched)}
            />
          )}
        </CollapsibleContent>
      </Collapsible>
    </div>
  );
}

/* ======================================================================== */
/* Subcomponentes locales                                                   */
/* ======================================================================== */

function AgentAvatar({ displayName, color }: { displayName: string; color: string }) {
  const initials = displayName.slice(0, 2).toUpperCase();
  return (
    <div
      className="h-8 w-8 rounded-lg flex items-center justify-center shrink-0 text-white font-semibold text-xs shadow-sm"
      style={{ backgroundColor: color }}
      aria-label={displayName}
    >
      {initials}
    </div>
  );
}

function StatusBadge({
  status,
  isConnected,
}: {
  status: TaskStatus;
  isConnected: boolean;
}) {
  switch (status) {
    case "pending":
      return (
        <Badge
          variant="outline"
          className="bg-muted text-muted-foreground border-muted-foreground/20 text-[10px] font-medium"
          title={isConnected ? "Esperando primer evento" : "Conectando al stream…"}
        >
          <Clock className="h-3 w-3 mr-1" />
          Pendiente
        </Badge>
      );
    case "running":
      return (
        <Badge
          variant="secondary"
          className="text-[10px] font-medium bg-primary/10 text-primary border-primary/20"
        >
          <Loader2 className="h-3 w-3 mr-1 animate-spin" />
          En progreso
        </Badge>
      );
    case "completed":
      return (
        <Badge className="bg-success/10 text-success border-success/30 text-[10px] font-medium hover:bg-success/15">
          <CheckCircle2 className="h-3 w-3 mr-1" />
          Completada
        </Badge>
      );
    case "failed":
      return (
        <Badge variant="destructive" className="text-[10px] font-medium">
          <XCircle className="h-3 w-3 mr-1" />
          Error
        </Badge>
      );
  }
}

function EventTimeline({
  events,
  status,
  dbStatus,
}: {
  events: AgentTaskEvent[];
  status: TaskStatus;
  dbStatus: string | null;
}) {
  if (events.length === 0) {
    const serverRunning =
      status === "running" ||
      /\b(running|processing|in_progress)\b/i.test(dbStatus || "");
    return (
      <div className="text-[11px] text-muted-foreground italic space-y-1">
        <p>
          {serverRunning
            ? "La tarea está activa en el backend; los pasos detallados dependen de la VM kawiil-agents y de eventos en la tabla ai_task_events."
            : "Aún no hay eventos en tiempo real. Suele significar cola en la VM, worker detenido, o que la tarea sigue en estado pendiente en agent_tasks."}
        </p>
        {dbStatus ? (
          <p className="text-[10px] not-italic font-mono text-muted-foreground/90">
            Estado en servidor: {dbStatus}
          </p>
        ) : null}
      </div>
    );
  }
  return (
    <ol className="space-y-1.5 list-none">
      {events.map((event, idx) => {
        const isLast = idx === events.length - 1;
        const isFailed = event.event_type === "failed";
        const showSpinner = isLast && status === "running";
        return (
          <li
            key={event.id}
            className="flex gap-2 items-start text-[11px]"
          >
            <span
              className={cn(
                "shrink-0 w-4 h-4 rounded-full flex items-center justify-center mt-0.5",
                showSpinner
                  ? "bg-primary/20 text-primary"
                  : isFailed
                    ? "bg-destructive/15 text-destructive"
                    : "bg-muted text-muted-foreground",
              )}
            >
              {showSpinner ? (
                <Loader2 className="h-2.5 w-2.5 animate-spin" />
              ) : isFailed ? (
                <XCircle className="h-2.5 w-2.5" />
              ) : (
                <CheckCircle2 className="h-2.5 w-2.5" />
              )}
            </span>
            <span
              className={cn(
                "leading-snug break-words",
                showSpinner
                  ? "text-foreground/90"
                  : isFailed
                    ? "text-destructive"
                    : "text-muted-foreground",
              )}
            >
              {formatEventMessage(event)}
            </span>
          </li>
        );
      })}
    </ol>
  );
}

function ResultPreview({
  result,
  resultSummary,
  executionMetadata,
  fetchError,
  syncedToChatBelow,
}: {
  result: unknown;
  resultSummary: string | null;
  executionMetadata: unknown | null;
  fetchError: string | null;
  syncedToChatBelow: boolean;
}) {
  if (syncedToChatBelow) {
    return (
      <div className="rounded-md bg-background/60 border border-border/50 p-2.5">
        <p className="text-[11px] text-muted-foreground leading-snug">
          El resultado completo está en el mensaje de abajo en el hilo.
        </p>
      </div>
    );
  }

  if (fetchError) {
    return (
      <div className="text-[11px] text-muted-foreground italic">
        No se pudo cargar el resultado ({fetchError}).
      </div>
    );
  }

  const { preview, isJson } = getAgentTaskPreviewModel(result, resultSummary, executionMetadata ?? undefined);

  if (!preview) {
    return (
      <div className="text-[11px] text-muted-foreground italic">
        La tarea se completó sin generar contenido de respuesta.
      </div>
    );
  }

  return (
    <div className="rounded-md bg-background/60 border border-border/50 p-2.5">
      <p className="text-[10px] uppercase tracking-wide text-muted-foreground mb-1">
        Resultado
      </p>
      {isJson ? (
        <pre className="text-[11px] font-mono text-foreground/90 whitespace-pre-wrap break-words max-h-[min(70vh,520px)] overflow-auto">
          {preview}
        </pre>
      ) : (
        <div className="text-sm text-foreground/90 whitespace-pre-wrap break-words max-h-[min(70vh,520px)] overflow-y-auto">
          {preview}
        </div>
      )}
    </div>
  );
}

function FailureMessage({ error }: { error: string | null }) {
  return (
    <div className="text-sm text-destructive bg-destructive/10 rounded-md p-2 border border-destructive/20">
      {error ?? "Error desconocido"}
    </div>
  );
}

function Footer({
  onCopy,
  onViewDetails,
  onFollowUpSameAgent,
  onRetryAgentSearch,
  isCopied,
  canCopy,
}: {
  onCopy: () => void;
  onViewDetails?: () => void;
  onFollowUpSameAgent?: () => void;
  onRetryAgentSearch?: () => void;
  isCopied: boolean;
  canCopy: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2 pt-2 border-t border-border/30">
      {onRetryAgentSearch && (
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="h-7 text-xs border-primary/35"
          onClick={onRetryAgentSearch}
        >
          <RotateCw className="h-3 w-3 mr-1" />
          Reintentar búsqueda
        </Button>
      )}
      {onFollowUpSameAgent && (
        <Button
          type="button"
          size="sm"
          variant="secondary"
          className="h-7 text-xs"
          onClick={onFollowUpSameAgent}
        >
          <UserPlus className="h-3 w-3 mr-1" />
          Nueva tarea con este agente
        </Button>
      )}
      {onViewDetails && (
        <Button
          size="sm"
          variant="outline"
          className="h-7 text-xs"
          onClick={onViewDetails}
        >
          <ExternalLink className="h-3 w-3 mr-1" />
          Ver detalles
        </Button>
      )}
      <Button
        size="sm"
        variant="ghost"
        className="h-7 text-xs"
        onClick={onCopy}
        disabled={isCopied || !canCopy}
      >
        <Copy className="h-3 w-3 mr-1" />
        {isCopied ? "Copiado" : "Copiar resultado"}
      </Button>
    </div>
  );
}

/* ======================================================================== */
/* Helpers                                                                  */
/* ======================================================================== */

/**
 * Traduce un `event_type` de `ai_task_events` a un texto humano breve.
 * Los tipos conocidos están mapeados explícitamente; el resto cae en un
 * fallback genérico que formatea el tipo (snake_case → Sentence case).
 */
function formatEventMessage(event: AgentTaskEvent): string {
  const payload = (event.payload ?? {}) as Record<string, unknown>;
  const str = (k: string): string | undefined =>
    typeof payload[k] === "string" ? (payload[k] as string) : undefined;
  const num = (k: string): number | undefined =>
    typeof payload[k] === "number" ? (payload[k] as number) : undefined;

  switch (event.event_type) {
    case "started":
      return "Tarea iniciada";
    case "attachments_processing_started":
      return "Procesando archivos adjuntos";
    case "attachment_processed": {
      const filename = str("filename") ?? str("name");
      return filename
        ? `Archivo procesado (${filename})`
        : "Archivo procesado";
    }
    case "attachments_processing_completed":
      return "Archivos listos";
    case "thinking":
      return "Analizando…";
    case "response_generated": {
      const tokens = num("output_tokens") ?? num("tokens");
      return tokens != null
        ? `Respuesta generada (${tokens} tokens)`
        : "Respuesta generada";
    }
    case "insight_generation_started":
      return "Generando insight";
    case "insight_written":
      return "Insight guardado";
    case "completed":
      return "Completada";
    case "failed": {
      const err = str("error");
      return err ? `Error: ${err}` : "Error";
    }
    default:
      return humanizeEventType(event.event_type);
  }
}

function humanizeEventType(type: string): string {
  if (!type) return "Evento";
  const spaced = type.replace(/_/g, " ");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function canCopyResult(fetched: FetchedResult | null): boolean {
  if (!fetched) return false;
  return (
    resolveAgentTaskDisplayText(fetched.result, fetched.result_summary, fetched.execution_metadata).trim()
      .length > 0
  );
}
