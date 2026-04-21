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
} from "lucide-react";
import { cn } from "@/lib/utils";
import {
  useAgentTaskProgress,
  type AgentTaskEvent,
  type AgentTaskStatus as HookStatus,
} from "@/hooks/useAgentTaskProgress";
import { supabase } from "@/integrations/supabase/client";

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
 *  - Preview del resultado cuando la tarea se completa (result_summary
 *    o los primeros ~300 chars de `result`).
 *  - Mensaje de error cuando la tarea falla.
 *  - Footer con acciones "Ver detalles" y "Copiar resultado".
 *
 * Fuente de verdad:
 *  - Status + eventos en vivo: `useAgentTaskProgress(taskId)` (realtime
 *    postgres_changes sobre `ai_task_events` con polling de respaldo).
 *  - Resultado final: fetch puntual de `agent_tasks` cuando el status
 *    transita a `completed`/`failed`.
 *
 * No integrado aún en `AsistenteIA.tsx` — eso es B1.6.6.
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
}

type TaskStatus = "pending" | "running" | "completed" | "failed";

interface FetchedResult {
  result: unknown;
  result_summary: string | null;
  error_message: string | null;
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

const RESULT_PREVIEW_MAX_CHARS = 300;

export function AgentTaskCard({
  taskId,
  agent,
  title,
  className,
  onViewDetails,
}: AgentTaskCardProps) {
  const { events, status: hookStatus, isConnected } = useAgentTaskProgress(taskId);
  const status = mapHookStatus(hookStatus);

  const [isExpanded, setIsExpanded] = useState<boolean>(true);
  const [isCopied, setIsCopied] = useState(false);
  const [fetched, setFetched] = useState<FetchedResult | null>(null);
  const [fetchError, setFetchError] = useState<string | null>(null);

  /** Guard para auto-colapsar solo en la primera transición a completed. */
  const hasAutoCollapsedRef = useRef(false);
  /** Guard para evitar refetch si el status oscila por polling. */
  const hasFetchedRef = useRef(false);
  /** Timer de reset del estado "Copiado" — se limpia si el componente desmonta. */
  const copyTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (status !== "completed") return;
    if (hasAutoCollapsedRef.current) return;
    hasAutoCollapsedRef.current = true;
    setIsExpanded(false);
  }, [status]);

  useEffect(() => {
    if (status !== "completed" && status !== "failed") return;
    if (hasFetchedRef.current) return;
    hasFetchedRef.current = true;

    let cancelled = false;
    (async () => {
      const { data, error } = await supabase
        .from("agent_tasks")
        .select("result, result_summary, error_message")
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
      });
    })();

    return () => {
      cancelled = true;
    };
  }, [status, taskId]);

  useEffect(() => {
    return () => {
      if (copyTimerRef.current !== null) {
        window.clearTimeout(copyTimerRef.current);
      }
    };
  }, []);

  const lastEventMessage = useMemo(() => {
    if (events.length === 0) {
      if (status === "pending") return "Esperando a que el agente inicie…";
      return "Sin eventos todavía";
    }
    return formatEventMessage(events[events.length - 1]);
  }, [events, status]);

  const errorMessage = useMemo(() => {
    if (fetched?.error_message) return fetched.error_message;
    const failed = [...events].reverse().find((e) => e.event_type === "failed");
    const raw = failed?.payload?.error;
    if (typeof raw === "string" && raw.trim()) return raw;
    return null;
  }, [fetched, events]);

  const handleCopy = async () => {
    const text = resultToCopyString(fetched?.result, fetched?.result_summary);
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
          <EventTimeline events={events} status={status} />

          {status === "completed" && (
            <ResultPreview
              result={fetched?.result ?? null}
              resultSummary={fetched?.result_summary ?? null}
              fetchError={fetchError}
            />
          )}

          {status === "failed" && <FailureMessage error={errorMessage} />}

          {showFooter && (
            <Footer
              onCopy={handleCopy}
              onViewDetails={onViewDetails}
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
}: {
  events: AgentTaskEvent[];
  status: TaskStatus;
}) {
  if (events.length === 0) {
    return (
      <div className="text-[11px] text-muted-foreground italic">
        Aún no hay eventos. El agente comenzará a reportar su progreso aquí.
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
  fetchError,
}: {
  result: unknown;
  resultSummary: string | null;
  fetchError: string | null;
}) {
  if (fetchError) {
    return (
      <div className="text-[11px] text-muted-foreground italic">
        No se pudo cargar el resultado ({fetchError}).
      </div>
    );
  }

  const { preview, isJson, truncated } = buildResultPreview(result, resultSummary);

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
        <pre className="text-[11px] font-mono text-foreground/90 whitespace-pre-wrap break-words max-h-48 overflow-auto">
          {preview}
          {truncated && <span className="text-muted-foreground">{"\n[…]"}</span>}
        </pre>
      ) : (
        <div className="text-sm text-foreground/90 whitespace-pre-wrap break-words">
          {preview}
          {truncated && <span className="text-muted-foreground"> […]</span>}
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
  isCopied,
  canCopy,
}: {
  onCopy: () => void;
  onViewDetails?: () => void;
  isCopied: boolean;
  canCopy: boolean;
}) {
  return (
    <div className="flex flex-wrap gap-2 pt-2 border-t border-border/30">
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

/**
 * Prioriza `result_summary` (ya resumido por el backend) y recurre a `result`
 * cuando no existe. Si `result` es objeto/array, lo pretty-prints. Si es string,
 * se muestra tal cual. En cualquier caso trunca a RESULT_PREVIEW_MAX_CHARS.
 */
function buildResultPreview(
  result: unknown,
  resultSummary: string | null,
): { preview: string; isJson: boolean; truncated: boolean } {
  if (resultSummary && resultSummary.trim().length > 0) {
    const trimmed = resultSummary.trim();
    const truncated = trimmed.length > RESULT_PREVIEW_MAX_CHARS;
    return {
      preview: truncated
        ? trimmed.slice(0, RESULT_PREVIEW_MAX_CHARS)
        : trimmed,
      isJson: false,
      truncated,
    };
  }

  if (result == null) return { preview: "", isJson: false, truncated: false };

  if (typeof result === "string") {
    const truncated = result.length > RESULT_PREVIEW_MAX_CHARS;
    return {
      preview: truncated
        ? result.slice(0, RESULT_PREVIEW_MAX_CHARS)
        : result,
      isJson: false,
      truncated,
    };
  }

  try {
    const serialized = JSON.stringify(result, null, 2);
    const truncated = serialized.length > RESULT_PREVIEW_MAX_CHARS;
    return {
      preview: truncated
        ? serialized.slice(0, RESULT_PREVIEW_MAX_CHARS)
        : serialized,
      isJson: true,
      truncated,
    };
  } catch {
    return { preview: "", isJson: false, truncated: false };
  }
}

function canCopyResult(fetched: FetchedResult | null): boolean {
  if (!fetched) return false;
  if (fetched.result_summary && fetched.result_summary.trim().length > 0) return true;
  if (fetched.result != null) return true;
  return false;
}

function resultToCopyString(
  result: unknown,
  resultSummary: string | null | undefined,
): string {
  if (resultSummary && resultSummary.trim().length > 0) return resultSummary;
  if (result == null) return "";
  if (typeof result === "string") return result;
  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}
