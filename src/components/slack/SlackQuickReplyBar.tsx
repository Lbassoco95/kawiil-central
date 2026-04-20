import { useCallback, useEffect, useMemo, useState } from "react";
import { Sparkles, Loader2, RefreshCw, X, ChevronDown } from "lucide-react";
import type { SlackMessage } from "@/lib/slackApi";
import { slackUserDisplayName } from "@/components/slack/slackGrouping";
import { supabase } from "@/integrations/supabase/client";
import { cn } from "@/lib/utils";
import { KAWIIL_AI_GRADIENT } from "@/lib/kawiilAi";

/**
 * SlackQuickReplyBar — barra "✦ KAWIIL SUGIERE" (v2.4) que se muestra justo
 * arriba del composer. Al pulsar un chip se inserta el texto sugerido en
 * el draft del composer. Reusa la Edge `slack-ai-quick-reply` (JWT).
 *
 * Para evitar quemar tokens en cada cambio de canal:
 * - Carga lazy: la primera vez que se abre + cache por (canal+lastTs) en `localStorage`.
 * - Límite: solo si hay >=2 mensajes recientes y el usuario tiene la barra visible.
 */

type SlackUserMap = Record<
  string,
  { display_name: string | null; real_name: string | null } | undefined
>;

type QuickReply = {
  id: string;
  label: string;
  tone: "professional" | "short" | "affirmative" | "declining";
  body: string;
};

interface Props {
  channelId: string;
  channelTitle: string;
  messages: SlackMessage[];
  userMap: SlackUserMap;
  selfUserId: string | null;
  conversationType?: "channel" | "private" | "im" | "mpim";
  userName?: string;
  /** Inserta el body sugerido en el draft del composer. */
  onInsertReply: (text: string) => void;
  /** Si false, la barra no se renderiza (ahorra fetches). */
  enabled?: boolean;
  /** Visibilidad inicial. El usuario puede minimizarla con la "X". */
  defaultOpen?: boolean;
}

const TONE_CHIP: Record<QuickReply["tone"], string> = {
  professional:
    "border-blue-200/70 bg-blue-50 text-blue-700 hover:bg-blue-100 dark:border-blue-800/40 dark:bg-blue-950/30 dark:text-blue-300",
  short:
    "border-sky-200/70 bg-sky-50 text-sky-700 hover:bg-sky-100 dark:border-sky-800/40 dark:bg-sky-950/30 dark:text-sky-300",
  affirmative:
    "border-emerald-200/70 bg-emerald-50 text-emerald-700 hover:bg-emerald-100 dark:border-emerald-800/40 dark:bg-emerald-950/30 dark:text-emerald-300",
  declining:
    "border-amber-200/70 bg-amber-50 text-amber-700 hover:bg-amber-100 dark:border-amber-800/40 dark:bg-amber-950/30 dark:text-amber-300",
};

const TONE_ICON: Record<QuickReply["tone"], string> = {
  professional: "✦",
  short: "👍",
  affirmative: "✓",
  declining: "↩",
};

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

export function SlackQuickReplyBar({
  channelId,
  channelTitle,
  messages,
  userMap,
  selfUserId,
  conversationType = "channel",
  userName,
  onInsertReply,
  enabled = true,
  defaultOpen = true,
}: Props) {
  const recent = useMemo(() => messages.slice(-25), [messages]);
  const lastTs = recent.length > 0 ? recent[recent.length - 1].ts : "";
  const cacheKey = `kawiil-slack-quick-reply-bar-v1-${channelId}-${lastTs}`;

  const [open, setOpen] = useState(defaultOpen);
  const [replies, setReplies] = useState<QuickReply[] | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      const cached = localStorage.getItem(cacheKey);
      if (!cached) return null;
      const parsed = JSON.parse(cached) as QuickReply[];
      return Array.isArray(parsed) ? parsed : null;
    } catch {
      return null;
    }
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const fetchReplies = useCallback(
    async (force = false) => {
      if (recent.length < 2) return;
      if (!force && replies && replies.length > 0) return;
      setLoading(true);
      setError(null);
      try {
        const { data, error: err } = await supabase.functions.invoke(
          "slack-ai-quick-reply",
          {
            body: {
              channelTitle,
              channelType: conversationType,
              messages: buildEdgeMessages(),
              userName: userName || "",
              locale: "es",
            },
          },
        );
        if (err) throw new Error(err.message || "Error invocando slack-ai-quick-reply");
        const result = (data ?? {}) as {
          suggestions?: QuickReply[];
          error?: string;
          message?: string;
        };
        if (result.error) throw new Error(result.message || result.error);
        const arr = Array.isArray(result.suggestions) ? result.suggestions : [];
        setReplies(arr);
        try {
          localStorage.setItem(cacheKey, JSON.stringify(arr));
        } catch {
          /* ignore */
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : "No se pudieron generar respuestas");
      } finally {
        setLoading(false);
      }
    },
    [recent.length, replies, channelTitle, conversationType, buildEdgeMessages, userName, cacheKey],
  );

  // Auto-fetch al abrir cuando hay mensajes y no hay cache.
  useEffect(() => {
    if (!enabled || !open) return;
    if (!replies && !loading && recent.length >= 2) {
      void fetchReplies(false);
    }
  }, [enabled, open, replies, loading, recent.length, fetchReplies]);

  // Reset cache local al cambiar de canal.
  useEffect(() => {
    setReplies(null);
    setError(null);
  }, [channelId]);

  if (!enabled || !channelId) return null;

  // Modo minimizado: muestra una píldora discreta para volver a abrir.
  if (!open) {
    return (
      <div className="mx-auto mb-1 max-w-4xl px-3">
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="inline-flex items-center gap-1.5 rounded-full border border-sky-200/70 bg-white px-2.5 py-0.5 text-[11px] font-medium text-sky-700 shadow-sm hover:bg-sky-50 dark:border-sky-800/40 dark:bg-background/80 dark:text-sky-300 dark:hover:bg-sky-500/10"
          title="Mostrar sugerencias de Kawiil"
        >
          <Sparkles className="h-3 w-3" />
          Kawiil sugiere
          <ChevronDown className="h-3 w-3" />
        </button>
      </div>
    );
  }

  const hasReplies = !!(replies && replies.length > 0);

  return (
    <div className="mx-auto mb-1 max-w-4xl px-3">
      <div className="flex items-center gap-2 overflow-hidden rounded-full border border-sky-200/70 bg-gradient-to-r from-sky-50 via-white to-blue-50 px-2 py-1 shadow-sm dark:border-sky-800/40 dark:from-sky-950/30 dark:via-background/80 dark:to-blue-950/20">
        <span
          className="inline-flex shrink-0 items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.12em] text-white shadow-sm"
          style={{ background: KAWIIL_AI_GRADIENT }}
        >
          <Sparkles className="h-3 w-3" />
          Kawiil sugiere
        </span>

        <div className="flex flex-1 items-center gap-1.5 overflow-x-auto scrollbar-thin">
          {loading && !hasReplies ? (
            <span className="inline-flex items-center gap-1.5 text-[11px] text-sky-700 dark:text-sky-300">
              <Loader2 className="h-3 w-3 animate-spin" />
              Pensando 3 respuestas para este chat…
            </span>
          ) : error ? (
            <span className="text-[11px] text-destructive">{error}</span>
          ) : hasReplies ? (
            replies!.slice(0, 3).map((r) => (
              <button
                key={r.id}
                type="button"
                onClick={() => onInsertReply(r.body)}
                className={cn(
                  "shrink-0 inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-medium whitespace-nowrap transition-colors",
                  TONE_CHIP[r.tone],
                )}
                title={r.body}
              >
                <span aria-hidden>{TONE_ICON[r.tone]}</span>
                <span className="max-w-[180px] truncate">{r.label}</span>
              </button>
            ))
          ) : recent.length < 2 ? (
            <span className="text-[11px] text-muted-foreground">
              Aún no hay suficiente conversación para sugerir respuestas.
            </span>
          ) : (
            <span className="text-[11px] text-muted-foreground">
              Pulsa el botón para generar 3 respuestas rápidas.
            </span>
          )}
        </div>

        <button
          type="button"
          onClick={() => void fetchReplies(true)}
          disabled={loading || recent.length < 2}
          className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-sky-100 hover:text-sky-700 disabled:opacity-50 dark:hover:bg-sky-500/10 dark:hover:text-sky-300"
          title="Regenerar sugerencias"
        >
          {loading ? (
            <Loader2 className="h-3 w-3 animate-spin" />
          ) : (
            <RefreshCw className="h-3 w-3" />
          )}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="shrink-0 inline-flex h-6 w-6 items-center justify-center rounded-full text-muted-foreground hover:bg-sky-100 hover:text-sky-700 dark:hover:bg-sky-500/10 dark:hover:text-sky-300"
          title="Ocultar barra de sugerencias"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
