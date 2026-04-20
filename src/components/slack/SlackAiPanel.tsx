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
} from "lucide-react";
import type { SlackMessage } from "@/lib/slackApi";
import { slackUserDisplayName } from "@/components/slack/slackGrouping";

type SlackUserMap = Record<
  string,
  { display_name: string | null; real_name: string | null } | undefined
>;
import { fetchAiChatSimpleContent } from "@/lib/fetchAiChatSimple";
import { KawiilAiMarkdown } from "@/components/shared/KawiilAiMarkdown";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

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
}

const MENTION_RE = /<@([UW][A-Z0-9]+)(?:\|[^>]+)?>/g;

function plainSlackText(text: string | null | undefined, userMap: SlackUserMap): string {
  if (!text) return "";
  let out = text.replace(MENTION_RE, (_m, id: string) => `@${slackUserDisplayName(id, userMap)}`);
  // <https://x|label> → label
  out = out.replace(/<((?:https?:\/\/|mailto:)[^|>\s]+)\|([^>]+)>/g, "$2");
  out = out.replace(/<((?:https?:\/\/|mailto:)[^>\s]+)>/g, "$1");
  // <#C123|name> → #name
  out = out.replace(/<#[CG][A-Z0-9]+\|([^>]+)>/g, "#$1");
  // <!subteam^...|@grupo> → @grupo
  out = out.replace(/<!subteam\^[A-Z0-9]+\|@?([^>]+)>/g, "@$1");
  out = out.replace(/<!(channel|here|everyone)>/g, "@$1");
  return out.trim();
}

function buildContextPrompt(
  channelTitle: string,
  recent: SlackMessage[],
  userMap: SlackUserMap,
): string {
  const lines: string[] = [];
  lines.push(`Canal: #${channelTitle}`);
  lines.push(`Últimos ${recent.length} mensajes (más antiguos arriba):`);
  for (const m of recent) {
    const who = m.user ? slackUserDisplayName(m.user, userMap) : m.bot_id ? "bot" : "?";
    const txt = plainSlackText(m.text, userMap);
    if (!txt) continue;
    const short = txt.length > 360 ? txt.slice(0, 360) + "…" : txt;
    lines.push(`- ${who}: ${short.replace(/\n+/g, " ")}`);
  }
  return lines.join("\n");
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
}: Props) {
  const recent = useMemo(() => messages.slice(-30), [messages]);
  const lastTs = recent.length > 0 ? recent[recent.length - 1].ts : "";
  const cacheKey = `kawiil-slack-ai-summary-${channelId}-${lastTs}`;

  const [summary, setSummary] = useState<string | null>(() => {
    if (typeof window === "undefined") return null;
    try {
      return localStorage.getItem(cacheKey);
    } catch {
      return null;
    }
  });
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [summaryError, setSummaryError] = useState<string | null>(null);

  const [suggestions, setSuggestions] = useState<string[] | null>(null);
  const [suggLoading, setSuggLoading] = useState(false);
  const [suggError, setSuggError] = useState<string | null>(null);

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

  const generateSummary = useCallback(
    async (force = false) => {
      if (!recent.length) {
        setSummary(null);
        return;
      }
      if (!force) {
        try {
          const cached = localStorage.getItem(cacheKey);
          if (cached) {
            setSummary(cached);
            return;
          }
        } catch {
          /* ignore */
        }
      }
      setSummaryLoading(true);
      setSummaryError(null);
      try {
        const ctx = buildContextPrompt(channelTitle, recent, userMap);
        const content = await fetchAiChatSimpleContent([
          {
            role: "system",
            content:
              "Eres el asistente Slack de Kawiil. Resume conversaciones en español neutro de forma extremadamente breve (máx 3 viñetas, una línea cada una) destacando: temas, decisiones tomadas y acciones pendientes con responsable si se infiere. Si hay urgencias, márcalas con **negrita**. No inventes nombres ni hechos.",
          },
          { role: "user", content: ctx },
        ]);
        setSummary(content);
        try {
          localStorage.setItem(cacheKey, content);
        } catch {
          /* ignore */
        }
      } catch (err) {
        setSummaryError(err instanceof Error ? err.message : "No se pudo generar el resumen");
      } finally {
        setSummaryLoading(false);
      }
    },
    [recent, cacheKey, channelTitle, userMap],
  );

  const generateSuggestions = useCallback(async () => {
    if (!recent.length) return;
    const lastNotMine = [...recent].reverse().find((m) => m.user && m.user !== selfUserId);
    if (!lastNotMine) {
      setSuggestions([
        "Gracias por la información, lo reviso y te confirmo.",
        "¿Tienes contexto adicional sobre este punto?",
        "Perfecto, lo agendo para esta semana.",
      ]);
      return;
    }
    setSuggLoading(true);
    setSuggError(null);
    try {
      const ctx = buildContextPrompt(channelTitle, recent, userMap);
      const content = await fetchAiChatSimpleContent([
        {
          role: "system",
          content:
            "Eres el copiloto de respuesta Slack de Kawiil. Genera EXACTAMENTE 3 sugerencias de respuesta cortas (1-2 frases cada una) en español neutro, separadas por saltos de línea con prefijo '1) ', '2) ', '3) '. Sin viñetas ni markdown extra. Tono profesional y cercano. Responde como si fueras el usuario que contesta al último mensaje del canal.",
        },
        { role: "user", content: ctx },
      ]);
      const lines = content
        .split(/\n+/)
        .map((l) => l.replace(/^\s*\d+[)\].:-]\s*/, "").trim())
        .filter((l) => l.length > 0)
        .slice(0, 3);
      setSuggestions(lines.length ? lines : [content.trim()]);
    } catch (err) {
      setSuggError(err instanceof Error ? err.message : "No se pudieron generar sugerencias");
    } finally {
      setSuggLoading(false);
    }
  }, [recent, selfUserId, channelTitle, userMap]);

  useEffect(() => {
    if (!open) return;
    if (!summary && !summaryLoading && recent.length > 0) {
      void generateSummary(false);
    }
  }, [open, summary, summaryLoading, recent.length, generateSummary]);

  useEffect(() => {
    if (!open) return;
    if (suggestions === null && !suggLoading && recent.length > 0) {
      void generateSuggestions();
    }
  }, [open, suggestions, suggLoading, recent.length, generateSuggestions]);

  if (!open) return null;

  return (
    <aside
      className={cn(
        "shrink-0 flex flex-col border-l bg-card",
        "w-full sm:w-[360px] lg:w-[380px] min-w-0",
      )}
      style={{ borderColor: "hsl(var(--border))" }}
    >
      {/* Header */}
      <div className="shrink-0 flex items-center justify-between border-b border-border/70 px-4 py-2.5">
        <div className="flex items-center gap-2 min-w-0">
          <span className="grid h-7 w-7 place-items-center rounded-lg bg-primary/10 text-primary">
            <Sparkles className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <p className="text-xs font-semibold tracking-tight text-foreground leading-tight">
              Asistente del canal
            </p>
            <p className="text-[10.5px] text-muted-foreground truncate leading-tight">
              IA · #{channelTitle}
            </p>
          </div>
        </div>
        <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={onClose} aria-label="Cerrar asistente">
          <X className="h-4 w-4" />
        </Button>
      </div>

      <ScrollArea className="flex-1 min-h-0">
        <div className="p-4 space-y-5">
          {/* Resumen */}
          <section>
            <header className="flex items-center justify-between mb-2">
              <h3 className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-primary">
                <MessageSquareReply className="h-3 w-3" />
                Resumen del canal
              </h3>
              <button
                type="button"
                onClick={() => void generateSummary(true)}
                className="text-muted-foreground hover:text-foreground transition-colors"
                title="Regenerar resumen"
                aria-label="Regenerar resumen"
                disabled={summaryLoading}
              >
                {summaryLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              </button>
            </header>
            <div className="rounded-xl border border-border/60 bg-background/60 px-3 py-2.5 text-sm leading-relaxed">
              {summaryError ? (
                <p className="text-xs text-destructive">{summaryError}</p>
              ) : summary ? (
                <KawiilAiMarkdown className="text-sm leading-relaxed">{summary}</KawiilAiMarkdown>
              ) : summaryLoading ? (
                <p className="text-xs text-muted-foreground inline-flex items-center gap-2">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Analizando los últimos {recent.length} mensajes…
                </p>
              ) : (
                <p className="text-xs text-muted-foreground">
                  {recent.length === 0
                    ? "Sin mensajes recientes que analizar."
                    : "Pulsa actualizar para generar un resumen."}
                </p>
              )}
            </div>
          </section>

          {/* Triage */}
          <section>
            <h3 className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-amber-600 mb-2">
              <ListChecks className="h-3 w-3" />
              Triage
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

          {/* Sugerencias */}
          <section>
            <header className="flex items-center justify-between mb-2">
              <h3 className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-emerald-600">
                <Lightbulb className="h-3 w-3" />
                Sugerencias de respuesta
              </h3>
              <button
                type="button"
                onClick={() => void generateSuggestions()}
                className="text-muted-foreground hover:text-foreground transition-colors"
                title="Generar otras sugerencias"
                aria-label="Generar otras sugerencias"
                disabled={suggLoading}
              >
                {suggLoading ? <Loader2 className="h-3 w-3 animate-spin" /> : <RefreshCw className="h-3 w-3" />}
              </button>
            </header>
            {suggError ? (
              <p className="text-xs text-destructive">{suggError}</p>
            ) : null}
            {suggLoading && !suggestions ? (
              <p className="text-xs text-muted-foreground inline-flex items-center gap-2">
                <Loader2 className="h-3 w-3 animate-spin" />
                Pensando respuestas…
              </p>
            ) : null}
            {suggestions && suggestions.length > 0 ? (
              <div className="space-y-2">
                {suggestions.map((s, i) => (
                  <div
                    key={`${i}-${s.slice(0, 16)}`}
                    className="rounded-xl border border-emerald-500/25 bg-emerald-500/5 px-3 py-2"
                  >
                    <p className="text-sm text-foreground leading-relaxed">{s}</p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      <Button
                        type="button"
                        size="sm"
                        className="h-7 px-2.5 text-[11px]"
                        onClick={() => {
                          onInsertDraft(s);
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
                          void navigator.clipboard.writeText(s);
                          toast.success("Copiado al portapapeles");
                        }}
                      >
                        <Copy className="mr-1 h-3 w-3" />
                        Copiar
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            <p className="mt-2 text-[10.5px] text-muted-foreground">
              Las sugerencias son borradores generados por IA. Revísalas antes de enviar.
            </p>
          </section>
        </div>
      </ScrollArea>
    </aside>
  );
}
