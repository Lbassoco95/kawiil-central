import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Sparkles,
  X,
  Loader2,
  RefreshCw,
  ListTodo,
  Phone,
  ArrowRight,
  CheckCheck,
} from "lucide-react";
import type { SlackMessage } from "@/lib/slackApi";
import { slackUserDisplayName } from "@/components/slack/slackGrouping";
import { Button } from "@/components/ui/button";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { KAWIIL_AI_GRADIENT } from "@/lib/kawiilAi";

/**
 * SlackChannelInlineSummary — banner "KAWIIL · RESUMEN DEL CANAL" v2.4.
 *
 * Aparece arriba del `SlackMessageList` (no en el panel lateral) para
 * dar un resumen rápido del canal/DM sin cambiar de columna.
 *
 * Reusa la Edge Function `slack-ai-summary` (JWT) y cachea por
 * rango + `lastTs` en `localStorage`.
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

type RangeId = "today" | "week" | "unread";

const RANGE_DEFS: Array<{ id: RangeId; label: string; hoursBack: number | null }> = [
  { id: "today", label: "Hoy", hoursBack: 24 },
  { id: "week", label: "Esta semana", hoursBack: 24 * 7 },
  { id: "unread", label: "Sin leer", hoursBack: null },
];

interface Props {
  open: boolean;
  onClose: () => void;
  channelId: string;
  channelTitle: string;
  messages: SlackMessage[];
  userMap: SlackUserMap;
  selfUserId: string | null;
  conversationType?: "channel" | "private" | "im" | "mpim";
  /** `ts` a partir del cual se consideran mensajes sin leer (ej. cursor del canal). */
  unreadSinceTs?: string | null;
  /** Cantidad de mensajes sin leer (para el badge "Te perdiste N mensajes"). */
  unreadCount?: number;
  /** Crear tareas a partir de los pendientes detectados. */
  onCreateTasksFromPendings?: (pendings: string[]) => void;
  /** Agendar llamada (abre composer o modal). */
  onScheduleCall?: () => void;
  /** Saltar al primer mensaje del rango (ver hilo completo). */
  onJumpToFirst?: () => void;
}

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

export function SlackChannelInlineSummary({
  open,
  onClose,
  channelId,
  channelTitle,
  messages,
  userMap,
  selfUserId,
  conversationType = "channel",
  unreadSinceTs = null,
  unreadCount = 0,
  onCreateTasksFromPendings,
  onScheduleCall,
  onJumpToFirst,
}: Props) {
  const [range, setRange] = useState<RangeId>("today");
  const [summary, setSummary] = useState<SummaryResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const rangeMessages = useMemo(() => {
    if (!messages.length) return [] as SlackMessage[];
    if (range === "unread" && unreadSinceTs) {
      return messages.filter((m) => Number(m.ts) > Number(unreadSinceTs));
    }
    const def = RANGE_DEFS.find((r) => r.id === range);
    if (!def || def.hoursBack == null) return messages.slice(-60);
    const cutoffSec = Math.floor(Date.now() / 1000) - def.hoursBack * 3600;
    return messages.filter((m) => Number(m.ts) >= cutoffSec);
  }, [messages, range, unreadSinceTs]);

  const lastTs = rangeMessages.length > 0 ? rangeMessages[rangeMessages.length - 1].ts : "";
  const cacheKey = `kawiil-slack-inline-summary-v1-${channelId}-${range}-${lastTs}`;

  const buildEdgeMessages = useCallback(() => {
    return rangeMessages
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
  }, [rangeMessages, userMap, selfUserId]);

  const fetchSummary = useCallback(
    async (force = false) => {
      if (!rangeMessages.length) {
        setSummary(null);
        return;
      }
      if (!force) {
        try {
          const cached = localStorage.getItem(cacheKey);
          if (cached) {
            const parsed = JSON.parse(cached) as SummaryResult;
            if (parsed && typeof parsed === "object" && "summary" in parsed) {
              setSummary(parsed);
              return;
            }
          }
        } catch {
          /* ignore */
        }
      }
      setLoading(true);
      setError(null);
      try {
        const { data, error: err } = await supabase.functions.invoke("slack-ai-summary", {
          body: {
            channelTitle,
            channelType: conversationType,
            messages: buildEdgeMessages(),
            locale: "es",
          },
        });
        if (err) throw new Error(err.message || "Error invocando slack-ai-summary");
        const result = (data ?? {}) as Partial<SummaryResult> & { error?: string; message?: string };
        if (result.error) throw new Error(result.message || result.error);
        const next: SummaryResult = {
          summary: typeof result.summary === "string" ? result.summary : "",
          pendings: Array.isArray(result.pendings) ? result.pendings : [],
          decisions: Array.isArray(result.decisions) ? result.decisions : [],
          suggestedAction:
            typeof result.suggestedAction === "string" && result.suggestedAction.trim()
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
        setError(err instanceof Error ? err.message : "No se pudo generar el resumen");
      } finally {
        setLoading(false);
      }
    },
    [rangeMessages.length, cacheKey, channelTitle, conversationType, buildEdgeMessages],
  );

  useEffect(() => {
    if (!open) return;
    if (!summary && !loading && rangeMessages.length > 0) {
      void fetchSummary(false);
    }
  }, [open, summary, loading, rangeMessages.length, fetchSummary]);

  // Reset al cambiar canal o rango.
  useEffect(() => {
    setSummary(null);
    setError(null);
  }, [channelId, range]);

  if (!open) return null;

  const pendingsCount = summary?.pendings.length ?? 0;
  const rangeLabel = RANGE_DEFS.find((r) => r.id === range)?.label ?? "Hoy";
  const messagesSummaryLabel =
    range === "unread" && unreadCount > 0
      ? `Te perdiste ${unreadCount} mensaje${unreadCount === 1 ? "" : "s"}.`
      : `${rangeMessages.length} mensaje${rangeMessages.length === 1 ? "" : "s"} en ${rangeLabel.toLowerCase()}.`;

  return (
    <div className="mx-3 mt-3 animate-fade-in">
      <div className="relative overflow-hidden rounded-2xl border border-sky-200/70 bg-gradient-to-br from-sky-50 via-white to-blue-50 shadow-sm dark:border-sky-800/40 dark:from-sky-950/40 dark:via-background dark:to-blue-950/30">
        {/* Header */}
        <div className="flex items-start justify-between gap-3 px-4 pt-3">
          <div className="flex items-center gap-2 min-w-0">
            <span
              className="inline-flex h-6 w-6 items-center justify-center rounded-full text-white shadow-sm ring-1 ring-white/30"
              style={{ background: KAWIIL_AI_GRADIENT }}
            >
              <Sparkles className="h-3.5 w-3.5" />
            </span>
            <span className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-sky-700 dark:text-sky-300">
              Kawiil · Resumen del canal
            </span>
            <span className="hidden sm:inline text-[11px] text-muted-foreground truncate">
              · {channelTitle}
            </span>
          </div>
          <div className="flex items-center gap-1">
            <div className="flex rounded-full border border-sky-200/70 bg-white/70 p-0.5 dark:border-sky-800/40 dark:bg-background/60">
              {RANGE_DEFS.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setRange(r.id)}
                  className={cn(
                    "rounded-full px-2.5 py-1 text-[10.5px] font-medium transition-colors",
                    range === r.id
                      ? "bg-sky-500 text-white shadow-sm"
                      : "text-sky-700/80 hover:bg-sky-100/70 dark:text-sky-300/80 dark:hover:bg-sky-500/10",
                  )}
                >
                  {r.label}
                  {r.id === "unread" && unreadCount > 0 ? (
                    <span className="ml-1 rounded-full bg-white/25 px-1 text-[9px] font-bold">
                      {unreadCount > 99 ? "99+" : unreadCount}
                    </span>
                  ) : null}
                </button>
              ))}
            </div>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={() => void fetchSummary(true)}
              disabled={loading}
              title="Regenerar resumen"
            >
              {loading ? (
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
              ) : (
                <RefreshCw className="h-3.5 w-3.5" />
              )}
            </Button>
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="h-7 w-7 text-muted-foreground hover:text-foreground"
              onClick={onClose}
              title="Cerrar resumen"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        {/* Body */}
        <div className="px-4 pb-3 pt-2">
          {loading && !summary ? (
            <div className="flex items-center gap-2 py-4 text-[12.5px] text-muted-foreground">
              <Loader2 className="h-3.5 w-3.5 animate-spin text-sky-600" />
              Generando resumen con Kawiil AI…
            </div>
          ) : error ? (
            <div className="py-3 text-[12.5px] text-destructive">
              {error}
              <button
                type="button"
                onClick={() => void fetchSummary(true)}
                className="ml-2 underline underline-offset-2 hover:no-underline"
              >
                Reintentar
              </button>
            </div>
          ) : !summary ? (
            <div className="py-3 text-[12.5px] text-muted-foreground">
              No hay suficientes mensajes en este rango para resumir.
            </div>
          ) : (
            <>
              <p className="text-[12.5px] leading-relaxed text-foreground/90">
                <span className="font-medium text-sky-700 dark:text-sky-300">{messagesSummaryLabel}</span>{" "}
                {summary.summary}
              </p>
              {summary.pendings.length > 0 && (
                <ul className="mt-2 space-y-1.5 text-[12.5px] text-foreground/90">
                  {summary.pendings.slice(0, 4).map((p, i) => (
                    <li key={i} className="flex items-start gap-2">
                      <span className="mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full bg-sky-500" aria-hidden />
                      <span>{p}</span>
                    </li>
                  ))}
                </ul>
              )}
              {summary.decisions.length > 0 && (
                <div className="mt-2 flex flex-wrap items-center gap-1.5 text-[11.5px] text-muted-foreground">
                  <CheckCheck className="h-3.5 w-3.5 text-emerald-600" />
                  <span className="font-medium">Decisiones:</span>
                  <span className="truncate">{summary.decisions.slice(0, 2).join(" · ")}</span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Acciones */}
        {summary && !loading ? (
          <div className="flex flex-wrap items-center gap-1.5 border-t border-sky-200/60 bg-white/40 px-3 py-2 dark:border-sky-800/30 dark:bg-background/40">
            {pendingsCount > 0 && onCreateTasksFromPendings ? (
              <button
                type="button"
                onClick={() => onCreateTasksFromPendings(summary.pendings.slice(0, 5))}
                className="inline-flex items-center gap-1.5 rounded-full border border-sky-300/70 bg-white px-2.5 py-1 text-[11px] font-medium text-sky-700 hover:bg-sky-50 dark:border-sky-700/40 dark:bg-background/60 dark:text-sky-300 dark:hover:bg-sky-500/10"
              >
                <ListTodo className="h-3 w-3" />
                Crear {pendingsCount} tarea{pendingsCount === 1 ? "" : "s"}
              </button>
            ) : null}
            {onScheduleCall ? (
              <button
                type="button"
                onClick={onScheduleCall}
                className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-white px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-accent/60 dark:bg-background/60"
              >
                <Phone className="h-3 w-3" />
                Agendar llamada
              </button>
            ) : null}
            {onJumpToFirst ? (
              <button
                type="button"
                onClick={onJumpToFirst}
                className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-white px-2.5 py-1 text-[11px] font-medium text-foreground hover:bg-accent/60 dark:bg-background/60"
              >
                <ArrowRight className="h-3 w-3" />
                Ver hilo completo
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
