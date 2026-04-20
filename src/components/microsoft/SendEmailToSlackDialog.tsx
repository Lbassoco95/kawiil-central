import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Send, Search, Hash, Lock, MessageCircle, Users, Sparkles } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { fetchAllSlackConversations } from "@/lib/slackWorkspaceFetch";
import { useSlackConnection } from "@/hooks/useSlackConnection";
import { useSlackUserProfiles } from "@/hooks/useSlackUserProfiles";
import { invokeSlackApi, type SlackConversation } from "@/lib/slackApi";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { KAWIIL_AI_HEADER_BG } from "@/lib/kawiilAi";

interface SendEmailToSlackDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Subject del correo. */
  subject: string;
  /** Sender name preferiblemente (o email). */
  senderLabel: string;
  /** URL pública del correo (Outlook web link) si se conoce; sino, omitir. */
  webLink?: string | null;
  /** Resumen ejecutivo (de email-ai-summary). Puede ser null si aún no se generó. */
  aiSummary?: string | null;
  /** Acción sugerida (de email-ai-summary). */
  aiSuggestedAction?: string | null;
}

type ChannelKind = "channel" | "private" | "mpim" | "im";

function classifyConversation(c: SlackConversation): ChannelKind {
  if (c.is_im) return "im";
  if (c.is_mpim) return "mpim";
  if (c.is_private) return "private";
  return "channel";
}

function conversationLabel(
  c: SlackConversation,
  imUserLabels: Record<string, string>,
): string {
  const kind = classifyConversation(c);
  if (kind === "im") {
    const u = (c as unknown as { user?: string }).user;
    if (u && imUserLabels[u]) return `@${imUserLabels[u]}`;
    return "DM";
  }
  if (kind === "mpim") return c.name || "Mensaje grupal";
  if (kind === "private") return `🔒 ${c.name || "privado"}`;
  return `#${c.name || "canal"}`;
}

function kindIcon(kind: ChannelKind) {
  switch (kind) {
    case "im":
      return MessageCircle;
    case "mpim":
      return Users;
    case "private":
      return Lock;
    default:
      return Hash;
  }
}

function buildDefaultMessage(opts: {
  subject: string;
  senderLabel: string;
  aiSummary?: string | null;
  aiSuggestedAction?: string | null;
  webLink?: string | null;
}): string {
  const lines: string[] = [];
  lines.push(`*Compartiendo correo de ${opts.senderLabel}*`);
  lines.push(`📧 _${opts.subject || "(sin asunto)"}_`);
  lines.push("");
  if (opts.aiSummary && opts.aiSummary.trim().length > 0) {
    lines.push(`*Resumen:* ${opts.aiSummary.trim()}`);
  }
  if (opts.aiSuggestedAction && opts.aiSuggestedAction.trim().length > 0) {
    lines.push("");
    lines.push(`*Acción sugerida:* ${opts.aiSuggestedAction.trim()}`);
  }
  if (opts.webLink) {
    lines.push("");
    lines.push(`🔗 ${opts.webLink}`);
  }
  return lines.join("\n");
}

export function SendEmailToSlackDialog({
  open,
  onOpenChange,
  subject,
  senderLabel,
  webLink,
  aiSummary,
  aiSuggestedAction,
}: SendEmailToSlackDialogProps) {
  const { isConnected } = useSlackConnection();
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [message, setMessage] = useState<string>("");
  const [sending, setSending] = useState(false);

  const { data: conversations = [], isLoading } = useQuery({
    queryKey: ["slack", "send-email-conversations"],
    queryFn: fetchAllSlackConversations,
    enabled: open && isConnected,
    staleTime: 5 * 60 * 1000,
  });

  const imUserIds = useMemo(
    () =>
      conversations
        .filter((c) => c.is_im && (c as unknown as { user?: string }).user)
        .map((c) => (c as unknown as { user: string }).user),
    [conversations],
  );

  const { data: imProfiles = {} } = useSlackUserProfiles(imUserIds);
  const imUserLabels = useMemo<Record<string, string>>(() => {
    const out: Record<string, string> = {};
    for (const id of imUserIds) {
      const p = imProfiles[id];
      out[id] = p?.display_name || p?.real_name || "Usuario";
    }
    return out;
  }, [imUserIds, imProfiles]);

  useEffect(() => {
    if (open) {
      setMessage(
        buildDefaultMessage({ subject, senderLabel, aiSummary, aiSuggestedAction, webLink }),
      );
      setSelectedId(null);
      setSearch("");
    }
  }, [open, subject, senderLabel, aiSummary, aiSuggestedAction, webLink]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    const sortable = conversations
      .filter((c) => !(c as unknown as { is_archived?: boolean }).is_archived)
      .map((c) => ({
        c,
        kind: classifyConversation(c),
        label: conversationLabel(c, imUserLabels),
      }));
    const filteredList = q
      ? sortable.filter(({ label }) => label.toLowerCase().includes(q))
      : sortable;
    const order: Record<ChannelKind, number> = { channel: 0, private: 1, mpim: 2, im: 3 };
    filteredList.sort((a, b) => {
      const k = order[a.kind] - order[b.kind];
      if (k !== 0) return k;
      return a.label.localeCompare(b.label);
    });
    return filteredList.slice(0, 200);
  }, [conversations, search, imUserLabels]);

  const handleSend = async () => {
    if (!selectedId) {
      toast.error("Elige un canal o conversación");
      return;
    }
    const text = message.trim();
    if (!text) {
      toast.error("Escribe el mensaje a enviar");
      return;
    }
    setSending(true);
    try {
      const res = await invokeSlackApi<{ ok: boolean; error?: string }>({
        action: "chat.postMessage",
        channel: selectedId,
        text,
        unfurl_links: true,
        unfurl_media: true,
      });
      if (!res?.ok) {
        throw new Error(res?.error || "No se pudo enviar a Slack");
      }
      toast.success("Enviado a Slack");
      onOpenChange(false);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Error enviando a Slack");
    } finally {
      setSending(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="flex max-h-[88vh] w-[min(100vw-2rem,42rem)] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl rounded-2xl border-sky-200/40 dark:border-sky-900/40 [&>button.absolute]:hidden"
      >
        <DialogHeader
          className="shrink-0 px-4 sm:px-5 py-3 text-left text-white"
          style={{ background: KAWIIL_AI_HEADER_BG }}
        >
          <DialogTitle className="flex items-center gap-2 text-sm font-semibold text-white">
            <span className="grid h-7 w-7 place-items-center rounded-lg bg-white/15">
              <Send className="h-3.5 w-3.5" />
            </span>
            Enviar correo a Slack
          </DialogTitle>
          <p className="text-[11px] text-white/85">
            Comparte este correo con un canal o persona del workspace
          </p>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-1 sm:grid-cols-[260px_1fr]">
          {/* Selector de conversación */}
          <aside className="border-b sm:border-b-0 sm:border-r border-border/60 flex min-h-0 flex-col">
            <div className="shrink-0 p-3">
              <div className="relative">
                <Search className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground/70" />
                <Input
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Buscar canal o persona…"
                  className="h-9 pl-8 text-xs bg-background"
                />
              </div>
            </div>
            <ScrollArea className="flex-1 min-h-0 px-2 pb-2">
              {isLoading ? (
                <div className="flex items-center justify-center py-6 text-xs text-muted-foreground">
                  <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                  Cargando conversaciones…
                </div>
              ) : filtered.length === 0 ? (
                <p className="px-2 py-4 text-center text-xs text-muted-foreground">
                  Sin resultados
                </p>
              ) : (
                <ul className="space-y-0.5">
                  {filtered.map(({ c, kind, label }) => {
                    const Icon = kindIcon(kind);
                    const active = selectedId === c.id;
                    return (
                      <li key={c.id}>
                        <button
                          type="button"
                          onClick={() => setSelectedId(c.id)}
                          className={cn(
                            "flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs transition-colors",
                            active
                              ? "bg-sky-100 text-sky-900 ring-1 ring-sky-300/60 dark:bg-sky-900/30 dark:text-sky-200 dark:ring-sky-700/40"
                              : "hover:bg-accent",
                          )}
                        >
                          <Icon className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                          <span className="truncate">{label}</span>
                        </button>
                      </li>
                    );
                  })}
                </ul>
              )}
            </ScrollArea>
          </aside>

          {/* Mensaje */}
          <section className="flex min-h-0 flex-col">
            <div className="shrink-0 px-4 pt-3 pb-1.5">
              <p className="inline-flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-sky-700 dark:text-sky-300">
                <Sparkles className="h-3 w-3" />
                Mensaje
                {aiSummary ? <span className="text-muted-foreground normal-case font-normal">· prefilled con resumen IA</span> : null}
              </p>
            </div>
            <div className="flex min-h-0 flex-1 flex-col px-4 pb-3">
              <Textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={10}
                className="flex-1 min-h-[180px] resize-none text-sm font-mono"
                placeholder="Escribe el mensaje a enviar…"
              />
              <p className="mt-1.5 text-[10.5px] text-muted-foreground">
                Soporta mrkdwn de Slack (*negritas*, _cursiva_, &lt;url|texto&gt;).
              </p>
            </div>
          </section>
        </div>

        <DialogFooter className="shrink-0 border-t border-border/60 px-4 py-3">
          <Button variant="ghost" size="sm" onClick={() => onOpenChange(false)}>
            Cancelar
          </Button>
          <Button
            type="button"
            size="sm"
            className="gap-1.5 text-white shadow-sm hover:opacity-90 disabled:opacity-60"
            style={{ background: KAWIIL_AI_HEADER_BG }}
            onClick={() => void handleSend()}
            disabled={!selectedId || !message.trim() || sending}
          >
            {sending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
            Enviar a Slack
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
