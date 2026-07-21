import { useMemo } from "react";
import { useEmailLabelAssignments } from "@/hooks/useMicrosoft";
import { useOutlookEmails } from "@/hooks/useMicrosoft";
import { useRoutedEmailDetail } from "@/hooks/useLinkedAccounts";
import { inferEmailChips, emailListTimestamp, formatEmailDate } from "@/lib/emailChips";
import { cn } from "@/lib/utils";
import { Sparkles, Mail, CheckSquare, Link2, Filter, Tag } from "lucide-react";
import { MailLabelPicker, getLabelStyle } from "./MailLabelPicker";

interface Props {
  emailId: string | null;
  onAskAI?: () => void;
  onCreateTask?: () => void;
  onCreateRule?: () => void;
}

function getInitials(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length >= 2) return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
  return name.slice(0, 2).toUpperCase();
}

const AVATAR_COLORS = [
  "hsl(217 91% 55%)", "hsl(142 71% 45%)", "hsl(38 85% 55%)",
  "hsl(280 65% 55%)", "hsl(0 72% 51%)", "hsl(200 85% 50%)",
];

function avatarColor(email: string): string {
  let h = 0;
  for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) % AVATAR_COLORS.length;
  return AVATAR_COLORS[Math.abs(h) % AVATAR_COLORS.length];
}

const CHIP_STYLES: Record<string, { bg: string; text: string }> = {
  urgente: { bg: "hsl(0 72% 51% / 0.15)", text: "hsl(0 72% 51%)" },
  sat:     { bg: "hsl(0 72% 51% / 0.15)", text: "hsl(0 72% 51%)" },
  factura: { bg: "hsl(32 90% 48% / 0.15)", text: "hsl(32 90% 48%)" },
  cliente: { bg: "hsl(210 100% 47% / 0.15)", text: "hsl(210 100% 47%)" },
  interno: { bg: "hsl(157 72% 36% / 0.15)", text: "hsl(157 72% 36%)" },
};

export function MailContactPanel({ emailId, onAskAI, onCreateTask, onCreateRule }: Props) {
  // Detalle ruteado por prefijo de ID: funciona con la cuenta principal Y las vinculadas.
  const { data: emailDetail } = useRoutedEmailDetail(emailId);
  const { data: labelAssignments = [] } = useEmailLabelAssignments(emailId);

  const senderName = (emailDetail as any)?.from?.emailAddress?.name || "";
  const senderEmail = (emailDetail as any)?.from?.emailAddress?.address || "";
  const senderDomain = senderEmail.split("@")[1] || "";

  // Get all inbox emails to find threads from this sender
  const { data: inboxData } = useOutlookEmails("inbox");
  const allInboxEmails = useMemo(
    () => (inboxData?.pages ?? []).flatMap((p) => p.emails as any[]),
    [inboxData]
  );

  const senderThreads = useMemo(() => {
    if (!senderEmail) return [];
    return allInboxEmails
      .filter((e) => (e.from?.emailAddress?.address || "").toLowerCase() === senderEmail.toLowerCase())
      .slice(0, 5);
  }, [allInboxEmails, senderEmail]);

  const chips = useMemo(() => {
    if (!emailDetail) return [];
    return inferEmailChips({
      from: (emailDetail as any).from,
      subject: (emailDetail as any).subject,
      importance: (emailDetail as any).importance,
    });
  }, [emailDetail]);

  if (!emailId || !emailDetail) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center p-6 gap-3">
        <Mail className="w-10 h-10 text-muted-foreground/30" />
        <p className="text-sm text-muted-foreground/50">Selecciona un correo</p>
      </div>
    );
  }

  const initials = getInitials(senderName || senderEmail);
  const color = avatarColor(senderEmail);

  return (
    <div className="flex flex-col h-full overflow-hidden relative">
      {/* Header */}
      <div className="px-5 pt-5 pb-4 border-b border-border/40 shrink-0">
        <div
          className="rounded-full flex items-center justify-center text-white text-[17px] font-bold mb-3"
          style={{ background: color, width: 52, height: 52 }}
        >
          {initials}
        </div>
        <p className="text-[16px] font-bold text-foreground tracking-tight mb-0.5">{senderName || senderEmail}</p>
        <p className="text-[12px] text-muted-foreground mb-0.5">{senderEmail}</p>
        {senderDomain && (
          <p className="text-[12px] text-foreground/70 mb-3">{senderDomain}</p>
        )}
        {chips.length > 0 && (
          <div className="flex gap-1.5 flex-wrap">
            {chips.map((chip) => {
              const style = CHIP_STYLES[chip.tone] || { bg: "hsl(var(--muted))", text: "hsl(var(--muted-foreground))" };
              return (
                <span
                  key={chip.label}
                  className="text-[10.5px] font-semibold px-2 py-0.5 rounded-full"
                  style={{ background: style.bg, color: style.text }}
                >
                  {chip.label}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Stats */}
      <div className="grid grid-cols-3 border-b border-border/40 shrink-0">
        {[
          { n: senderThreads.length, l: "CORREOS" },
          { n: "—", l: "TAREAS" },
          { n: "—", l: "CONTACTO" },
        ].map(({ n, l }) => (
          <div key={l} className="text-center py-3">
            <p className="text-[18px] font-bold text-foreground tracking-tight leading-none mb-1">{n}</p>
            <p className="text-[9.5px] uppercase tracking-wider text-muted-foreground">{l}</p>
          </div>
        ))}
      </div>

      {/* Action buttons */}
      <div className="px-5 py-3 border-b border-border/30 flex gap-2 shrink-0">
        <button
          onClick={onCreateTask}
          className="flex-1 flex items-center justify-center gap-1.5 h-7 rounded-md border border-border/50 text-[11.5px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          <CheckSquare className="w-3 h-3" />
          Crear tarea
        </button>
        <button
          onClick={onCreateRule}
          className="flex-1 flex items-center justify-center gap-1.5 h-7 rounded-md border border-border/50 text-[11.5px] text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
        >
          <Filter className="w-3 h-3" />
          Crear regla
        </button>
      </div>

      {/* Labels section */}
      <div className="px-5 py-3.5 border-b border-border/30">
        <div className="flex items-center justify-between mb-2">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground flex items-center gap-1.5">
            <Tag className="w-[11px] h-[11px]" /> Etiquetas
          </p>
          <MailLabelPicker emailMessageId={emailId || ""}>
            <button className="text-[11px] text-primary hover:text-primary/80 font-medium">+ Agregar</button>
          </MailLabelPicker>
        </div>
        {labelAssignments.length === 0 ? (
          <p className="text-[12px] text-muted-foreground/50 italic">Sin etiquetas</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {labelAssignments.map(a => {
              if (!a.email_user_labels) return null;
              const style = getLabelStyle(a.email_user_labels.color);
              return (
                <span key={a.id} className="flex items-center gap-1 px-2 py-0.5 rounded-full text-[11px] font-medium"
                  style={{ background: style.bg, color: style.text }}>
                  <span className="w-1.5 h-1.5 rounded-full" style={{ background: style.dot }} />
                  {a.email_user_labels.name}
                </span>
              );
            })}
          </div>
        )}
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto min-h-0">
        {/* Email threads */}
        {senderThreads.length > 0 && (
          <div className="px-5 py-3.5 border-b border-border/30">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2.5 flex items-center gap-1.5">
              <Mail className="w-[11px] h-[11px]" /> Correo
            </p>
            <div className="space-y-0">
              {senderThreads.map((thread) => {
                const ts = emailListTimestamp({
                  receivedDateTime: thread.receivedDateTime,
                  sentDateTime: thread.sentDateTime,
                });
                const date = formatEmailDate(ts);
                const isUnread = !thread.isRead;
                return (
                  <div key={thread.id} className="flex items-baseline gap-1.5 py-1.5">
                    <span className={cn(
                      "w-[5px] h-[5px] rounded-full shrink-0 mt-1.5",
                      isUnread ? "bg-primary" : "bg-muted-foreground/30"
                    )} />
                    <span className="text-[12px] text-muted-foreground truncate flex-1 min-w-0">
                      {thread.subject || "(sin asunto)"}
                    </span>
                    <span className="text-[10.5px] text-muted-foreground/60 shrink-0">{date}</span>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Tasks placeholder */}
        <div className="px-5 py-3.5 border-b border-border/30">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2.5 flex items-center gap-1.5">
            <CheckSquare className="w-[11px] h-[11px]" /> Tareas relacionadas
          </p>
          <p className="text-[12px] text-muted-foreground/50 italic">Sin tareas vinculadas</p>
        </div>

        {/* Context */}
        <div className="px-5 py-3.5">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2.5 flex items-center gap-1.5">
            <Link2 className="w-[11px] h-[11px]" /> Contexto
          </p>
          <p className="text-[12px] text-muted-foreground/50 italic">Sin contexto disponible</p>
        </div>
      </div>

      {/* AI float button */}
      <div className="p-4 border-t border-border/30 shrink-0">
        <button
          onClick={onAskAI}
          className="w-full flex items-center justify-center gap-2 h-9 rounded-full text-[12.5px] font-semibold transition-colors"
          style={{
            background: "hsl(272 65% 50% / 0.1)",
            border: "1px solid hsl(272 65% 50% / 0.3)",
            color: "hsl(272 65% 60%)",
          }}
        >
          <Sparkles className="w-3.5 h-3.5" />
          Preguntar a IA
        </button>
      </div>
    </div>
  );
}
