import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Sparkles,
  X,
  Loader2,
  RefreshCw,
  AtSign,
  MessageSquareReply,
  Lightbulb,
  Copy,
  Send,
  ListChecks,
  ListTodo,
  ArrowRight,
  Wand2,
  CheckCheck,
} from "lucide-react";
import type { SlackMessage } from "@/lib/slackApi";
import { slackUserDisplayName } from "@/components/slack/slackGrouping";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { SlackChannelFilesPanel } from "@/components/slack/SlackChannelFilesPanel";
import { AiFeedback } from "@/components/ai/AiFeedback";
import { aiFeedbackKey } from "@/lib/aiFeedbackKey";

/**
 * SlackAiPanel — Fase 2 del rediseño v2.4 del módulo Slack.
 * Panel derecho con:
 *   • Resumen ejecutivo + Pendientes + Decisiones (tabs).
 *   • Triage local (menciones, hilos activos, mensajes calientes).
 *   • Sugerencias de respuesta rápida (chips por tono).
 *
 * Llama a las Edge Functions:
 *   - slack-ai-summary
 *   - slack-ai-quick-reply
 *
 * Las dos requieren JWT (`verify_jwt = true`).
 */

type SlackUserMap = Record<
  string,
  { display_name: string | null; real_name: string | null } | undefined
>;

type SummaryResult = {
  summary: string;
  pendings: string[];
  decisions: string[];
  suggestedAction: string | null;
};

type QuickReply = {
  id: string;
  label: string;
  tone: "professional" | "short" | "affirmative" | "declining";
  body: string;
};

interface Props {
  open: boolean;
  onClose: () => void;
  channelId: string;
  channelTitle: string;
  messages: SlackMessage[];
  userMap: SlackUserMap;
  selfUserId: string | null;
  onJumpToMessage: (ts: string) => void;
  onInsertDraft: (text: string) => void;
  /** Tipo de conversación para que la edge afine el prompt. */
  conversationType?: "channel" | "private" | "im" | "mpim";
  /** Nombre del usuario actual para que la edge afine la firma. */
  userName?: string;
  /** Atajo opcional a "crear tarea" desde la acción sugerida. */
  onCreateTask?: (suggestedTitle?: string | null) => void;
}

const TAB_DEFS = [
  { id: "summary", label: "Resumen", icon: Sparkles },
  { id: "pendings", label: "Pendientes", icon: ListTodo },
  { id: "decisions", label: "Decisiones", icon: CheckCheck },
] as const;

type TabId = typeof TAB_DEFS[number]["id"];

const TONE_STYLE: Record<QuickReply["tone"], string> = {
  professional:
    "border-blue-200/70 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-800/40 dark:bg-blue-950/30 dark:text-blue-300",
  short:
    "border-sky-200/70 bg-sky-50 text-sky-700 hover:bg-sky-100 dark:border-sky-800/40 dark:bg-sky-950/30 dark:text-sky-300",
  affirmative:
    "border-emerald-200/70 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800/40 dark:bg-emerald-950/30 dark:text-emerald-300",
  declining:
    "border-amber-200/70 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-800/40 dark:bg-amber-950/30 dark:text-amber-300",
};

const KAWIIL_AI_GRADIENT = "linear-gradient(135deg, hsl(200 100% 50%), hsl(220 100% 55%))";
const KAWIIL_AI_HEADER_BG =
  "linear-gradient(135deg, hsl(200 100% 96%) 0%, hsl(220 100% 96%) 100%)";

const MENTION_RE = /<@([UW][A-Z0-9]+)(?:\|[^>]+)?>/g;

function plainSlackText(text: string | null | undefined, userMap: SlackUserMap): string {
  if (!text) return "";
  let out = text.replace(MENTION_RE, (_m, id: string) => `@${slackUserDisplayName(id, userMap)}`);
  out = out.replace(/<((?:https?:\/\/|mailto:)[^|>\s]+)\|([^>]+)>/g, "$2");
  out = out.replace(/<((?:https?:\/\/|mailto:)[^>\s]+)>/g, "$1");
  out = out.replace(/<#[CG][A-Z0-9]+\|([^>]+)>/g, "#$1");
  out = out.replace(/<!subteam\^[A-Z0-9]+\|@?([^>]+)>/g, "@$1");
  out = out.replace(/<!(channel|here|everyone)>/g, "@$1");
  return out.trim();
}

export function SlackAiPanel({
  open,
  onClose,
  channelId,
  channelTitle,
  messages,
  userMap,
  selfUserId,
  onJumpToMessage,
  onInsertDraft,
  conversationType = "channel",
  userName,
  onCreateTask,
}: Props) {
  const recent = useMemo(() => messages.slice(-40), [messages]);
  const lastTs = recent.length > 0 ? recent[recent.length - 1].ts : "";
  const cacheKey = `kawiil-slack-ai-summary-v2-${channelId}-${lastTs}`;

  const [activeTab, setActiveTab] = useState<TabId>("summary");

  const [summary, setSummary] = useState<SummaryResult | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const cached = localStorage.getItem(cacheKey);
      if (!cached) return null;
      const parsed = JSON.parse(cached);
      if (parsed && typeof parsed === "object" && "summary" in parsed) return parsed as SummaryResult;
      return null;
    } catch {
      return null;
    }
  });
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [quickReplies, setQuickReplies] = useState<QuickReply[] | null>(null);
  const [quickLoading, setQuickLoading] = useState(false);
  const [quickError, setQuickError] = useState<string | null>(null);
  const [expandedReply, setExpandedReply] = useState<string | null>(null);

  // ─── Triage local ──────────────────────────────────────────
  const triage = useMemo(() => {
    const mentions: SlackMessage[] = [];
    const openThreads: SlackMessage[] = [];
    const hot: SlackMessage[] = [];
    const me = selfUserId;
    for (const m of messages) {
      const isMine = !!me && m.user === me;
      if (me && m.text && m.text.includes(`<@${me}>`) && !isMine) {
        mentions.push(m);
      }
      if (!isMine && (m.reply_count ?? 0) > 0 && !m.thread_ts) {
        openThreads.push(m);
      }
      const reactions = (m as unknown as { reactions?: Array<{ count?: number }> }).reactions ?? [];
      const reactionCount = reactions.reduce((acc, r) => acc + (r.count ?? 0), 0);
      if (reactionCount >= 3) hot.push(m);
    }
    return {
      mentions: mentions.slice(-5).reverse(),
      openThreads: openThreads.slice(-5).reverse(),
      hot: hot.slice(-3).reverse(),
    };
  }, [messages, selfUserId]);

  const buildEdgeMessages = useCallback(() => {
    return recent
      .map((m) => {
        const txt = plainSlackText(m.text, userMap);
        if (!txt) return null;
        const author = m.user
          ? slackUserDisplayName(m.user, userMap)
          : m.bot_id
            ? "bot"
            : "Usuario";
        return {
          author,
          text: txt,
          ts: m.ts,
          isMine: !!selfUserId && m.user === selfUserId,
        };
      })
      .filter(Boolean) as Array<{ author: string; text: string; ts: string; isMine: boolean }>;
  }, [recent, userMap, selfUserId]);

  const fetchSummary = useCallback(
    async (force = false) => {
      if (!recent.length) {
        setSummary(null);
        return;
      }
      if (!force) {
        try {
          const cached = localStorage.getItem(cacheKey);
          if (cached) {
            try {
              const parsed = JSON.parse(cached) as SummaryResult;
              if (parsed && typeof parsed === "object" && "summary" in parsed) {
                setSummary(parsed);
                return;
              }
            } catch {
              /* ignore */
            }
          }
        } catch {
          /* ignore */
        }
      }
      setSummaryLoading(true);
      setSummaryError(null);
      try {
        const { data, error } = await supabase.functions.invoke("slack-ai-summary", {
          body: {
            channelTitle,
            channelType: conversationType,
            messages: buildEdgeMessages(),
            locale: "es",
          },
        });
        if (error) throw new Error(error.message || "Error invocando slack-ai-summary");
        const result = (data ?? {}) as Partial<SummaryResult> & { error?: string; message?: string };
        if (result.error) {
          throw new Error(result.message || result.error);
        }
        const next: SummaryResult = {
          summary: typeof result.summary === "string" ? result.summary : "",
          pendings: Array.isArray(result.pendings) ? result.pendings : [],
          decisions: Array.isArray(result.decisions) ? result.decisions : [],
          suggestedAction:
            typeof result.suggestedAction === "string" && result.suggestedAction.trim().length > 0
              ? result.suggestedAction
              : null,
        };
        setSummary(next);
        try {
          localStorage.setItem(cacheKey, JSON.stringify(next));
        } catch {
          /* ignore */
        }
      } catch (err) {
        setSummaryError(err instanceof Error ? err.message : "No se pudo generar el resumen");
      } finally {
        setSummaryLoading(false);
      }
    },
    [recent.length, cacheKey, channelTitle, conversationType, buildEdgeMessages],
  );

  const fetchQuickReplies = useCallback(async () => {
    if (!recent.length) return;
    setQuickLoading(true);
    setQuickError(null);
    try {
      const { data, error } = await supabase.functions.invoke("slack-ai-quick-reply", {
        body: {
          channelTitle,
          channelType: conversationType,
          messages: buildEdgeMessages(),
          userName: userName || "",
          locale: "es",
        },
      });
      if (error) throw new Error(error.message || "Error invocando slack-ai-quick-reply");
      const result = (data ?? {}) as { suggestions?: QuickReply[]; error?: string; message?: string };
      if (result.error) throw new Error(result.message || result.error);
      const arr = Array.isArray(result.suggestions) ? result.suggestions : [];
      setQuickReplies(arr);
      setExpandedReply(arr[0]?.id ?? null);
    } catch (err) {
      setQuickError(err instanceof Error ? err.message : "No se pudieron generar respuestas");
    } finally {
      setQuickLoading(false);
    }
  }, [recent.length, channelTitle, conversationType, buildEdgeMessages, userName]);

  useEffect(() => {
    if (!open) return;
    if (!summary && !summaryLoading && recent.length > 0) {
      void fetchSummary(false);
    }
  }, [open, summary, summaryLoading, recent.length, fetchSummary]);

  // Reset cuando cambia el canal
  useEffect(() => {
    setSummary(null);
    setSummaryError(null);
    setQuickReplies(null);
    setQuickError(null);
    setExpandedReply(null);
    setActiveTab("summary");
  }, [channelId]);

  if (!open) return null;

  return (
    <aside
      className={cn(
        "shrink-0 flex flex-col border-l border-border/60 bg-card",
        "w-full sm:w-[380px] lg:w-[400px] min-w-0",
      )}
    >
      {/* Header con gradiente Kawiil AI (azul) */}
      <div
        className="shrink-0 flex items-center justify-between border-b border-sky-200/40 dark:border-sky-800/30 px-4 py-3"
        style={{ background: KAWIIL_AI_HEADER_BG }}
      >
        <div className="flex items-center gap-2.5 min-w-0">
          <span
            className="grid h-8 w-8 place-items-center rounded-xl text-white shadow-sm shrink-0"
            style={{ background: KAWIIL_AI_GRADIENT }}
          >
            <Sparkles className="h-4 w-4" />
          </span>
          <div className="min-w-0">
            <p className="text-[12px] font-semibold tracking-tight text-foreground leading-tight">
              Kawiil AI · Resumen del canal
            </p>
            <p className="text-[10.5px] text-muted-foreground truncate leading-tight">
              {channelTitle} · últimos {recent.length} mensajes
            </p>
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="icon"
          className="h-7 w-7 hover:bg-white/60 dark:hover:bg-white/10"
          onClick={onClose}
          aria-label="Cerrar asistente"
        >
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-4 space-y-5">
          {/* Tabs */}
          <div className="rounded-xl border border-sky-200/60 dark:border-sky-800/30 bg-gradient-to-br from-sky-50/80 via-white to-blue-50/60 dark:from-sky-950/20 dark:via-card dark:to-blue-950/20 p-3 shadow-sm">
            <div className="flex items-center justify-between mb-2">
              <div className="flex gap-1">
                {TAB_DEFS.map((tab) => {
                  const Icon = tab.icon;
                  const active = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveTab(tab.id)}
                      className={cn(
                        "inline-flex items-center gap-1 rounded-lg px-2 py-1 text-[10.5px] font-semibold uppercase tracking-wider transition-colors",
                        active
                          ? "bg-sky-600 text-white shadow-sm"
                          : "text-muted-foreground hover:bg-sky-100 dark:hover:bg-sky-900/20",
                      )}
                    >
                      <Icon className="h-3 w-3" />
                      {tab.label}
                    </button>
                  );
                })}
              </div>
              <button
                type="button"
                onClick={() => void fetchSummary(true)}
                disabled={summaryLoading || recent.length === 0}
                className="text-muted-foreground hover:text-foreground disabled:opacity-50 transition-colors"
                title="Regenerar resumen"
                aria-label="Regenerar resumen"
              >
                {summaryLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <RefreshCw className="h-3.5 w-3.5" />
                )}
              </button>
            </div>

            <div className="min-h-[88px]">
              {summaryError ? (
                <p className="text-xs text-destructive">{summaryError}</p>
              ) : summaryLoading && !summary ? (
                <p className="text-xs text-muted-foreground inline-flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Analizando los últimos {recent.length} mensajes…
                </p>
              ) : !summary ? (
                <p className="text-xs text-muted-foreground">
                  {recent.length === 0
                    ? "Sin mensajes recientes que analizar."
                    : "Pulsa actualizar para generar un resumen."}
                </p>
              ) : activeTab === "summary" ? (
                <p className="text-sm leading-relaxed text-foreground">
                  {summary.summary || "Sin resumen disponible."}
                </p>
              ) : activeTab === "pendings" ? (
                summary.pendings.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No detecté pendientes claros en este canal.</p>
                ) : (
                  <ul className="space-y-1.5">
                    {summary.pendings.map((p, i) => (
                      <li key={`p-${i}`} className="flex gap-2 text-sm text-foreground leading-snug">
                        <ListTodo className="h-3.5 w-3.5 shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
                        <span>{p}</span>
                      </li>
                    ))}
                  </ul>
                )
              ) : summary.decisions.length === 0 ? (
                <p className="text-xs text-muted-foreground">No detecté decisiones explícitas recientes.</p>
              ) : (
                <ul className="space-y-1.5">
                  {summary.decisions.map((d, i) => (
                    <li key={`d-${i}`} className="flex gap-2 text-sm text-foreground leading-snug">
                      <CheckCheck className="h-3.5 w-3.5 shrink-0 mt-0.5 text-emerald-600 dark:text-emerald-400" />
                      <span>{d}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            {summary?.suggestedAction ? (
              <div className="mt-3 rounded-lg border border-sky-300/40 dark:border-sky-700/40 bg-white/70 dark:bg-sky-950/20 px-3 py-2">
                <div className="flex items-start gap-2">
                  <ArrowRight className="h-3.5 w-3.5 mt-0.5 text-sky-600 dark:text-sky-400 shrink-0" />
                  <div className="min-w-0 flex-1">
                    <p className="text-[10.5px] font-semibold uppercase tracking-wider text-sky-700 dark:text-sky-300">
                      Acción sugerida
                    </p>
                    <p className="mt-0.5 text-sm text-foreground leading-snug">
                      {summary.suggestedAction}
                    </p>
                    {onCreateTask && (
                      <Button
                        type="button"
                        size="sm"
                        variant="ghost"
                        className="mt-1 h-7 px-2 text-[11px] text-sky-700 dark:text-sky-300 hover:bg-sky-100 dark:hover:bg-sky-900/30"
                        onClick={() => onCreateTask(summary.suggestedAction)}
                      >
                        <Wand2 className="h-3 w-3 mr-1" />
                        Crear tarea desde esta acción
                      </Button>
                    )}
                  </div>
                </div>
              </div>
            ) : null}

            {summary?.summary ? (
              <div className="mt-2 flex justify-end">
                <AiFeedback surface="slack_summary" contextKey={aiFeedbackKey(summary.summary)} />
              </div>
            ) : null}
          </div>

          {/* Triage local (sin IA) */}
          <section>
            <h3 className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-amber-600 dark:text-amber-400 mb-2">
              <ListChecks className="h-3 w-3" />
              Triage automático
            </h3>
            <div className="space-y-2">
              {triage.mentions.length === 0 && triage.openThreads.length === 0 && triage.hot.length === 0 ? (
                <div className="rounded-xl border border-border/60 bg-background/60 px-3 py-2.5 text-xs text-muted-foreground">
                  Nada que requiera tu atención inmediata aquí.
                </div>
              ) : null}

              {triage.mentions.map((m) => (
                <button
                  key={`mention-${m.ts}`}
                  type="button"
                  onClick={() => onJumpToMessage(m.ts)}
                  className="block w-full text-left rounded-xl border border-amber-500/30 bg-amber-500/5 px-3 py-2 hover:bg-amber-500/10 transition-colors"
                >
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-amber-600">
                    <AtSign className="h-3 w-3" />
                    Te mencionaron
                  </span>
                  <p className="mt-1 text-xs text-foreground line-clamp-2">
                    <span className="font-semibold">
                      {m.user ? slackUserDisplayName(m.user, userMap) : "Slack"}:
                    </span>{" "}
                    {plainSlackText(m.text, userMap)}
                  </p>
                </button>
              ))}

              {triage.openThreads.map((m) => (
                <button
                  key={`thread-${m.ts}`}
                  type="button"
                  onClick={() => onJumpToMessage(m.ts)}
                  className="block w-full text-left rounded-xl border border-border/60 bg-background/60 px-3 py-2 hover:bg-accent/50 transition-colors"
                >
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    <MessageSquareReply className="h-3 w-3" />
                    Hilo activo · {m.reply_count ?? 0} respuestas
                  </span>
                  <p className="mt-1 text-xs text-foreground line-clamp-2">
                    {plainSlackText(m.text, userMap)}
                  </p>
                </button>
              ))}

              {triage.hot.map((m) => (
                <button
                  key={`hot-${m.ts}`}
                  type="button"
                  onClick={() => onJumpToMessage(m.ts)}
                  className="block w-full text-left rounded-xl border border-primary/30 bg-primary/5 px-3 py-2 hover:bg-primary/10 transition-colors"
                >
                  <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-primary">
                    <Sparkles className="h-3 w-3" />
                    Mensaje con muchas reacciones
                  </span>
                  <p className="mt-1 text-xs text-foreground line-clamp-2">
                    {plainSlackText(m.text, userMap)}
                  </p>
                </button>
              ))}
            </div>
          </section>

          {/* Quick replies */}
          <section>
            <header className="flex items-center justify-between mb-2">
              <h3 className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-emerald-600 dark:text-emerald-400">
                <Lightbulb className="h-3 w-3" />
                Respuesta rápida
              </h3>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="h-7 px-2 text-[11px] gap-1"
                onClick={() => void fetchQuickReplies()}
                disabled={quickLoading || recent.length === 0}
              >
                {quickLoading ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <Wand2 className="h-3 w-3" />
                )}
                {quickReplies && quickReplies.length > 0 ? "Regenerar" : "Generar"}
              </Button>
            </header>

            {quickError ? <p className="text-xs text-destructive mb-2">{quickError}</p> : null}

            {quickLoading && !quickReplies ? (
              <p className="text-xs text-muted-foreground inline-flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" />
                Pensando respuestas para este canal…
              </p>
            ) : null}

            {quickReplies && quickReplies.length > 0 ? (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {quickReplies.map((qr) => {
                    const active = expandedReply === qr.id;
                    return (
                      <button
                        key={qr.id}
                        type="button"
                        onClick={() => setExpandedReply(active ? null : qr.id)}
                        className={cn(
                          "inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-medium transition-all",
                          TONE_STYLE[qr.tone],
                          active && "ring-2 ring-offset-1 ring-current/40",
                        )}
                      >
                        {qr.label}
                      </button>
                    );
                  })}
                </div>
                {expandedReply ? (
                  (() => {
                    const r = quickReplies.find((q) => q.id === expandedReply);
                    if (!r) return null;
                    return (
                      <div className="rounded-xl border border-border/60 bg-background/60 px-3 py-2.5 space-y-2">
                        <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap">
                          {r.body}
                        </p>
                        <div className="flex flex-wrap gap-1.5 pt-1 border-t border-border/40">
                          <Button
                            type="button"
                            size="sm"
                            className="h-7 px-2.5 text-[11px]"
                            onClick={() => {
                              onInsertDraft(r.body);
                              toast.success("Sugerencia agregada al borrador");
                            }}
                          >
                            <Send className="mr-1 h-3 w-3" />
                            Usar
                          </Button>
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            className="h-7 px-2.5 text-[11px]"
                            onClick={() => {
                              void navigator.clipboard.writeText(r.body);
                              toast.success("Copiado al portapapeles");
                            }}
                          >
                            <Copy className="mr-1 h-3 w-3" />
                            Copiar
                          </Button>
                        </div>
                      </div>
                    );
                  })()
                ) : null}
              </div>
            ) : null}

            <p className="mt-2 text-[10.5px] text-muted-foreground">
              Las respuestas son borradores generados por IA. Revísalas antes de enviar.
            </p>
          </section>

          {/* Archivos del canal: preview, sync a Kawiil y guardar en Dropbox */}
          <SlackChannelFilesPanel
            channelTitle={channelTitle}
            messages={messages}
            userMap={userMap}
          />
        </div>
      </ScrollArea>
    </aside>
  );
}
