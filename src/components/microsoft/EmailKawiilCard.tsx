import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Sparkles,
  Loader2,
  RefreshCw,
  Send,
  Copy,
  ListChecks,
  ListTodo,
  ArrowRight,
  Wand2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { FunctionsHttpError } from "@supabase/functions-js";
import { withAiRateLimit, invalidateAiCache } from "@/lib/kawiilAiCache";

/**
 * Extrae el mensaje real de una Edge Function cuando responde 4xx/5xx.
 * `supabase.functions.invoke` tapa el body del error con el genérico
 * "Edge Function returned a non-2xx status code"; aquí leemos el body.
 */
async function extractEdgeFunctionError(error: unknown, fallback: string): Promise<string> {
  if (error instanceof FunctionsHttpError) {
    const res = error.context;
    if (res instanceof Response) {
      try {
        const body = (await res.clone().json()) as {
          error?: string;
          message?: string;
          detail?: string;
          status?: number;
        };
        const hint =
          body?.error === "ai_not_configured"
            ? "Falta configurar ANTHROPIC_API_KEY en Edge Functions → Secrets."
            : body?.error === "ai_provider_error"
              ? `Anthropic rechazó la petición${body?.status ? ` (HTTP ${body.status})` : ""}.`
              : body?.error === "empty_body"
                ? "El correo no tiene contenido para resumir."
                : body?.error === "ai_parse_error"
                  ? "La IA respondió en un formato inesperado."
                  : null;
        const pieces = [
          body?.message,
          hint,
          body?.detail,
          body?.error && !hint ? body.error : null,
        ].filter((x): x is string => typeof x === "string" && x.length > 0);
        if (pieces.length > 0) {
          const dedup = Array.from(new Set(pieces));
          return dedup.join(" · ").slice(0, 500);
        }
      } catch {
        try {
          const text = await res.clone().text();
          if (text) return text.slice(0, 300);
        } catch {
          /* ignore */
        }
      }
    }
  }
  if (error instanceof Error && error.message) return error.message;
  return fallback;
}

/**
 * EmailKawiilCard — Fase 2 del rediseño v2.4 del módulo Correo.
 * Muestra resumen ejecutivo + puntos clave + acción sugerida + sugerencias de respuesta rápida.
 *
 * Llama a las Edge Functions:
 *   - email-ai-summary
 *   - email-ai-quick-reply
 *
 * Las dos requieren JWT (`verify_jwt = true`).
 */

type SummaryResult = {
  summary: string;
  keyPoints: string[];
  suggestedAction: string | null;
};

type QuickReply = {
  id: string;
  label: string;
  tone: "professional" | "short" | "affirmative" | "declining";
  body: string;
};

interface Props {
  emailId: string;
  subject: string;
  senderName?: string;
  senderEmail?: string;
  body: string;
  thread?: string;
  userName?: string;
  /** Permite insertar una sugerencia de respuesta como borrador. */
  onUseReply?: (body: string) => void;
  /** Atajo a "crear tarea desde correo". */
  onCreateTask?: (suggestedTitle?: string | null) => void;
  /**
   * Se llama cuando el resumen ya está disponible. Permite a la vista padre
   * reusar el resumen (ej. compartir en Slack).
   */
  onSummaryReady?: (summary: SummaryResult) => void;
  className?: string;
}

const TAB_DEFS = [
  { id: "summary", label: "Resumen", icon: Sparkles },
  { id: "keyPoints", label: "Puntos clave", icon: ListChecks },
  { id: "action", label: "Acción", icon: ArrowRight },
] as const;

type TabId = typeof TAB_DEFS[number]["id"];

const TONE_STYLE: Record<QuickReply["tone"], string> = {
  professional: "border-blue-200/70 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-800/40 dark:bg-blue-950/30 dark:text-blue-300",
  short: "border-sky-200/70 bg-sky-50 text-sky-700 hover:bg-sky-100 dark:border-sky-800/40 dark:bg-sky-950/30 dark:text-sky-300",
  affirmative: "border-emerald-200/70 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800/40 dark:bg-emerald-950/30 dark:text-emerald-300",
  declining: "border-amber-200/70 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-800/40 dark:bg-amber-950/30 dark:text-amber-300",
};

const KAWIIL_AI_GRADIENT = "linear-gradient(135deg, hsl(200 100% 50%), hsl(220 100% 55%))";

/** Scopes usados en `kawiilAiCache` para que coincidan entre ambas ramas. */
const CACHE_SCOPE_SUMMARY = "email-summary";
const CACHE_SCOPE_QUICK_REPLY = "email-quick-reply";

export function EmailKawiilCard({
  emailId,
  subject,
  senderName,
  senderEmail,
  body,
  thread,
  userName,
  onUseReply,
  onCreateTask,
  onSummaryReady,
  className,
}: Props) {
  const [tab, setTab] = useState<TabId>("summary");
  const [summary, setSummary] = useState<SummaryResult | null>(null);
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [quickReplies, setQuickReplies] = useState<QuickReply[] | null>(null);
  const [repliesLoading, setRepliesLoading] = useState(false);
  const [repliesError, setRepliesError] = useState<string | null>(null);
  const [expandedReplyId, setExpandedReplyId] = useState<string | null>(null);

  // Refs a las props volátiles para que `fetchSummary` / `fetchQuickReplies`
  // no cambien de identidad en cada render (lo cual antes disparaba el effect
  // y generaba peticiones redundantes contra la Edge Function).
  const propsRef = useRef({ subject, senderName, senderEmail, body, thread, userName });
  useEffect(() => {
    propsRef.current = { subject, senderName, senderEmail, body, thread, userName };
  }, [subject, senderName, senderEmail, body, thread, userName]);

  const onSummaryReadyRef = useRef(onSummaryReady);
  useEffect(() => {
    onSummaryReadyRef.current = onSummaryReady;
  }, [onSummaryReady]);

  const fetchSummary = useCallback(async (opts?: { force?: boolean; emailId?: string }) => {
    const id = opts?.emailId ?? emailId;
    const force = opts?.force ?? false;
    setSummaryLoading(true);
    setSummaryError(null);
    try {
      const { value, fromCache } = await withAiRateLimit<SummaryResult>({
        scope: CACHE_SCOPE_SUMMARY,
        key: id,
        force,
        fn: async () => {
          const p = propsRef.current;
          const { data, error } = await supabase.functions.invoke<SummaryResult & { error?: string; message?: string }>(
            "email-ai-summary",
            {
              body: {
                subject: p.subject,
                senderName: p.senderName,
                senderEmail: p.senderEmail,
                body: p.body,
                thread: p.thread,
                locale: "es",
              },
            },
          );
          if (error) {
            const msg = await extractEdgeFunctionError(error, "No se pudo generar el resumen.");
            throw new Error(msg);
          }
          if (!data || (data as any).error) {
            throw new Error((data as any)?.message || (data as any)?.error || "Sin resumen");
          }
          return {
            summary: data.summary || "",
            keyPoints: Array.isArray(data.keyPoints) ? data.keyPoints : [],
            suggestedAction: data.suggestedAction ?? null,
          };
        },
      });
      setSummary(value);
      onSummaryReadyRef.current?.(value);
      return fromCache;
    } catch (e) {
      setSummaryError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setSummaryLoading(false);
    }
  }, [emailId]);

  const fetchQuickReplies = useCallback(async (opts?: { force?: boolean }) => {
    const force = opts?.force ?? false;
    setRepliesLoading(true);
    setRepliesError(null);
    try {
      const { value } = await withAiRateLimit<QuickReply[]>({
        scope: CACHE_SCOPE_QUICK_REPLY,
        key: emailId,
        force,
        fn: async () => {
          const p = propsRef.current;
          const { data, error } = await supabase.functions.invoke<{ suggestions?: QuickReply[]; error?: string; message?: string }>(
            "email-ai-quick-reply",
            {
              body: {
                subject: p.subject,
                senderName: p.senderName,
                senderEmail: p.senderEmail,
                body: p.body,
                thread: p.thread,
                userName: p.userName,
                locale: "es",
              },
            },
          );
          if (error) {
            const msg = await extractEdgeFunctionError(error, "No se pudieron generar sugerencias.");
            throw new Error(msg);
          }
          if (!data || (data as any).error) {
            throw new Error((data as any)?.message || (data as any)?.error || "Sin sugerencias");
          }
          return Array.isArray(data.suggestions) ? data.suggestions : [];
        },
      });
      setQuickReplies(value);
    } catch (e) {
      setRepliesError(e instanceof Error ? e.message : "Error desconocido");
    } finally {
      setRepliesLoading(false);
    }
  }, [emailId]);

  useEffect(() => {
    setExpandedReplyId(null);
    setSummaryError(null);
    setRepliesError(null);
    // Se limpia el estado local; `withAiRateLimit` decidirá si sirve del caché
    // persistente o dispara la Edge Function.
    setSummary(null);
    setQuickReplies(null);
    void fetchSummary({ emailId });
  }, [emailId, fetchSummary]);

  const showActionBadge = useMemo(() => Boolean(summary?.suggestedAction), [summary]);

  const handleCopy = (text: string) => {
    if (!text) return;
    void navigator.clipboard.writeText(text);
    toast.success("Copiado al portapapeles");
  };

  return (
    <div
      className={cn(
        "rounded-2xl border border-sky-200/60 bg-gradient-to-br from-sky-50 via-white to-blue-50 shadow-sm",
        "dark:border-sky-900/40 dark:from-sky-950/30 dark:via-background dark:to-blue-950/20",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-2 border-b border-sky-200/50 px-3 py-2 dark:border-sky-900/30">
        <div className="flex min-w-0 items-center gap-2">
          <span
            className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-lg shadow-sm ring-1 ring-sky-300/40"
            style={{ background: KAWIIL_AI_GRADIENT }}
          >
            <Sparkles className="h-3.5 w-3.5 text-white" />
          </span>
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-foreground">Kawiil AI · Resumen</p>
            <p className="truncate text-[10px] text-muted-foreground">
              {summaryLoading ? "Procesando…" : "Análisis del correo"}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {showActionBadge && (
            <span className="inline-flex items-center gap-1 rounded-full border border-amber-300/60 bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700 dark:border-amber-800/40 dark:bg-amber-950/30 dark:text-amber-300">
              Acción sugerida
            </span>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7"
            onClick={() => {
              invalidateAiCache(CACHE_SCOPE_SUMMARY, emailId);
              void fetchSummary({ force: true, emailId });
            }}
            disabled={summaryLoading}
            aria-label="Regenerar resumen"
            title="Regenerar resumen"
          >
            <RefreshCw className={cn("h-3.5 w-3.5", summaryLoading && "animate-spin")} />
          </Button>
        </div>
      </div>

      <div className="flex items-center gap-1 border-b border-sky-200/40 px-3 pt-2 dark:border-sky-900/30">
        {TAB_DEFS.map((t) => {
          const active = tab === t.id;
          const Icon = t.icon;
          return (
            <button
              key={t.id}
              type="button"
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-1.5 rounded-t-md border-b-2 px-2 py-1.5 text-[11px] font-medium transition-colors",
                active
                  ? "border-sky-500 text-sky-700 dark:text-sky-300"
                  : "border-transparent text-muted-foreground hover:text-foreground",
              )}
            >
              <Icon className="h-3 w-3" />
              {t.label}
            </button>
          );
        })}
      </div>

      <div className="px-4 py-3 text-sm text-foreground/85">
        {summaryLoading && !summary && (
          <div className="flex items-center gap-2 py-2 text-xs text-muted-foreground">
            <Loader2 className="h-3.5 w-3.5 animate-spin" />
            Generando resumen del correo…
          </div>
        )}
        {summaryError && (
          <div className="rounded-md border border-destructive/30 bg-destructive/5 px-2 py-1.5 text-xs text-destructive">
            {summaryError}
          </div>
        )}

        {summary && tab === "summary" && (
          <p className="leading-relaxed text-foreground/90">
            {summary.summary || "Sin resumen disponible."}
          </p>
        )}

        {summary && tab === "keyPoints" && (
          summary.keyPoints.length === 0 ? (
            <p className="text-xs italic text-muted-foreground">No se detectaron puntos clave.</p>
          ) : (
            <ul className="space-y-1.5">
              {summary.keyPoints.map((kp, idx) => (
                <li key={idx} className="flex gap-2 text-[13px] leading-relaxed">
                  <span className="mt-1.5 inline-block h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500" />
                  <span>{kp}</span>
                </li>
              ))}
            </ul>
          )
        )}

        {summary && tab === "action" && (
          summary.suggestedAction ? (
            <div className="space-y-2">
              <p className="text-[13px] leading-relaxed">{summary.suggestedAction}</p>
              {onCreateTask && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 gap-1.5 border-amber-300/70 bg-amber-50 text-xs text-amber-800 hover:bg-amber-100 dark:border-amber-800/40 dark:bg-amber-950/30 dark:text-amber-200"
                  onClick={() => onCreateTask(summary.suggestedAction)}
                >
                  <ListTodo className="h-3.5 w-3.5" />
                  Crear tarea desde esta acción
                </Button>
              )}
            </div>
          ) : (
            <p className="text-xs italic text-muted-foreground">No se requiere ninguna acción inmediata.</p>
          )
        )}
      </div>

      <div className="border-t border-sky-200/40 px-3 py-2.5 dark:border-sky-900/30">
        <div className="mb-1.5 flex items-center justify-between">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
            Respuesta rápida
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 gap-1 text-[11px]"
            onClick={() => {
              const forceRegen = Boolean(quickReplies);
              if (forceRegen) invalidateAiCache(CACHE_SCOPE_QUICK_REPLY, emailId);
              void fetchQuickReplies({ force: forceRegen });
            }}
            disabled={repliesLoading}
          >
            {repliesLoading ? (
              <Loader2 className="h-3 w-3 animate-spin" />
            ) : (
              <Wand2 className="h-3 w-3" />
            )}
            {quickReplies ? "Regenerar" : "Generar"}
          </Button>
        </div>

        {repliesError && (
          <p className="mb-1 text-[11px] text-destructive">{repliesError}</p>
        )}

        {!quickReplies && !repliesLoading && (
          <p className="text-[11px] text-muted-foreground">
            Genera 3 borradores listos para usar (Profesional, Breve, Confirmar).
          </p>
        )}

        {repliesLoading && (
          <div className="flex items-center gap-2 py-1 text-[11px] text-muted-foreground">
            <Loader2 className="h-3 w-3 animate-spin" />
            Generando sugerencias…
          </div>
        )}

        {quickReplies && quickReplies.length > 0 && (
          <div className="space-y-1.5">
            <div className="flex flex-wrap gap-1.5">
              {quickReplies.map((qr) => {
                const expanded = expandedReplyId === qr.id;
                return (
                  <button
                    key={qr.id}
                    type="button"
                    onClick={() => setExpandedReplyId(expanded ? null : qr.id)}
                    className={cn(
                      "rounded-full border px-2.5 py-1 text-[11px] font-medium transition-colors",
                      TONE_STYLE[qr.tone],
                      expanded && "ring-1 ring-offset-1 ring-sky-400/50 dark:ring-offset-background",
                    )}
                  >
                    {qr.label}
                  </button>
                );
              })}
            </div>
            {expandedReplyId && (() => {
              const qr = quickReplies.find((x) => x.id === expandedReplyId);
              if (!qr) return null;
              return (
                <div className="rounded-md border border-border/60 bg-background/70 p-2.5 text-xs leading-relaxed">
                  <p className="whitespace-pre-wrap text-foreground/90">{qr.body}</p>
                  <div className="mt-2 flex flex-wrap items-center justify-end gap-1.5">
                    <Button
                      variant="outline"
                      size="sm"
                      className="h-6 gap-1 text-[11px]"
                      onClick={() => handleCopy(qr.body)}
                    >
                      <Copy className="h-3 w-3" />
                      Copiar
                    </Button>
                    {onUseReply && (
                      <Button
                        size="sm"
                        className="h-6 gap-1 text-[11px] text-white shadow-sm"
                        style={{ background: KAWIIL_AI_GRADIENT }}
                        onClick={() => {
                          onUseReply(qr.body);
                          toast.success("Borrador insertado");
                        }}
                      >
                        <Send className="h-3 w-3" />
                        Usar
                      </Button>
                    )}
                  </div>
                </div>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
}
