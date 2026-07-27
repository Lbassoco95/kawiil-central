import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useEmailLabelAssignments, useEmailConversation, useMicrosoftConnection } from "@/hooks/useMicrosoft";
import { useOutlookEmails } from "@/hooks/useMicrosoft";
import { useRoutedEmailDetail } from "@/hooks/useLinkedAccounts";
import { useTasksBySourceEmail } from "@/hooks/useTasks";
import { inferEmailChips, emailListTimestamp, formatEmailDate, resolveCategory } from "@/lib/emailChips";
import { useSenderCategories, useSetSenderCategory, SENDER_CATEGORY_LABEL, type SenderCategory } from "@/hooks/useSenderCategories";
import { cn } from "@/lib/utils";
import { Sparkles, Mail, CheckSquare, Link2, Filter, Tag, Check, MessagesSquare, ArrowRight, CornerUpLeft } from "lucide-react";
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
  const { data: relatedTasks = [] } = useTasksBySourceEmail(emailId);
  const { data: learnedCategories } = useSenderCategories();
  const setSenderCategory = useSetSenderCategory();
  const { profile } = useMicrosoftConnection();

  // Hilo de conversación (incluye tus reenvíos/respuestas, que están en Enviados).
  // Solo cuenta principal: el email-conversation consulta el buzón principal por conversationId.
  const isPrimaryEmail = !!emailId && !emailId.includes(":");
  const conversationId = isPrimaryEmail ? ((emailDetail as any)?.conversationId as string | undefined) : undefined;
  const { data: thread = [] } = useEmailConversation(conversationId ?? null);
  const myEmail = (profile?.mail || profile?.userPrincipalName || "").toLowerCase();

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

  // Categoría del remitente: preferencia guardada por TI ("ninguna" = excluido), o
  // preferencia PREDEFINIDA (heurística) cuando aún no la has tocado.
  const storedCat = senderEmail ? learnedCategories?.get(senderEmail.toLowerCase()) : undefined;
  const isExcluded = storedCat === "ninguna";
  const learnedCat = (storedCat && storedCat !== "ninguna") ? (storedCat as SenderCategory) : undefined;
  const suggestedCat = useMemo(() => {
    if (!emailDetail || storedCat) return null; // ya hay preferencia guardada (incluye "ninguna")
    const c = resolveCategory({
      from: (emailDetail as any).from,
      subject: (emailDetail as any).subject,
      importance: (emailDetail as any).importance,
    }, learnedCategories);
    return (c as SenderCategory | null);
  }, [emailDetail, storedCat, learnedCategories]);
  const CATEGORY_ORDER: SenderCategory[] = ["clientes", "sat", "facturas", "interno", "notificaciones"];
  const setCategory = (cat: SenderCategory | "ninguna" | null) => {
    if (!senderEmail) return;
    setSenderCategory.mutate({ senderEmail, category: cat, senderName: senderName || senderEmail });
  };

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
        {/* Conversación / Historial — todo el hilo, incluidos tus reenvíos y respuestas */}
        {thread.length > 1 && (
          <div className="px-5 py-3.5 border-b border-border/30">
            <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2.5 flex items-center gap-1.5">
              <MessagesSquare className="w-[11px] h-[11px]" /> Conversación · {thread.length}
            </p>
            <div className="space-y-2.5">
              {[...(thread as any[])]
                .sort((a, b) => String(emailListTimestamp(a)).localeCompare(String(emailListTimestamp(b))))
                .map((m: any) => {
                  const from = m.from?.emailAddress;
                  const mine = (from?.address || "").toLowerCase() === myEmail && !!myEmail;
                  const ts = emailListTimestamp({ receivedDateTime: m.receivedDateTime, sentDateTime: m.sentDateTime, createdDateTime: m.createdDateTime });
                  const date = formatEmailDate(ts);
                  const isCurrent = m.id === emailId;
                  return (
                    <div key={m.id} className={cn("flex items-start gap-2", isCurrent && "opacity-100")}>
                      <span className={cn(
                        "w-5 h-5 rounded-full flex items-center justify-center shrink-0 mt-0.5",
                        mine ? "bg-primary/15 text-primary" : "bg-muted text-muted-foreground",
                      )}>
                        {mine ? <CornerUpLeft className="w-3 h-3" /> : <ArrowRight className="w-3 h-3" />}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p className="text-[11.5px] font-medium text-foreground truncate flex items-center gap-1">
                          {mine ? "Tú" : (from?.name || from?.address || "Remitente")}
                          {isCurrent && <span className="text-[9px] px-1 py-0.5 rounded bg-accent text-muted-foreground">este</span>}
                        </p>
                        <p className="text-[10.5px] text-muted-foreground truncate">
                          {mine ? "Enviado" : "Recibido"} · {date}
                        </p>
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        )}

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

        {/* Categoría del remitente — la confirmas una vez y se clasifica sola de ahí en adelante */}
        <div className="px-5 py-3.5 border-b border-border/30">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2 flex items-center gap-1.5">
            <Tag className="w-[11px] h-[11px]" /> Categoría del remitente
          </p>
          {suggestedCat && (
            <div className="flex items-center gap-1.5 mb-2 text-[11.5px] text-muted-foreground">
              <Sparkles className="w-3 h-3 text-primary shrink-0" />
              <span>Predefinido: <span className="font-semibold text-foreground">{SENDER_CATEGORY_LABEL[suggestedCat]}</span> — cámbialo o sácalo si no aplica.</span>
            </div>
          )}
          {learnedCat && (
            <p className="text-[11px] text-emerald-600 dark:text-emerald-400 mb-2 flex items-center gap-1">
              <Check className="w-3 h-3" /> Fijado en {SENDER_CATEGORY_LABEL[learnedCat]} — se clasifica solo
            </p>
          )}
          {isExcluded && (
            <p className="text-[11px] text-muted-foreground mb-2">Excluido de las secciones — solo en tu bandeja.</p>
          )}
          <div className="flex flex-wrap gap-1.5">
            {CATEGORY_ORDER.map((cat) => {
              const active = learnedCat === cat;
              const isSuggestion = !learnedCat && !isExcluded && suggestedCat === cat;
              return (
                <button
                  key={cat}
                  onClick={() => setCategory(active ? null : cat)}
                  disabled={setSenderCategory.isPending}
                  title={active ? "Quitar (volver a la predefinida)" : `Marcar como ${SENDER_CATEGORY_LABEL[cat]}`}
                  className={cn(
                    "px-2 py-1 rounded-full text-[11px] font-medium transition-colors border",
                    active
                      ? "bg-primary text-primary-foreground border-primary"
                      : isSuggestion
                        ? "border-primary/40 text-primary hover:bg-primary/10"
                        : "border-border/60 text-muted-foreground hover:bg-accent hover:text-foreground",
                  )}
                >
                  {SENDER_CATEGORY_LABEL[cat]}
                </button>
              );
            })}
            {/* Sacar de toda sección (anula la preferencia predefinida) */}
            <button
              onClick={() => setCategory(isExcluded ? null : "ninguna")}
              disabled={setSenderCategory.isPending}
              title={isExcluded ? "Volver a clasificar automáticamente" : "Quitar de todas las secciones (solo bandeja)"}
              className={cn(
                "px-2 py-1 rounded-full text-[11px] font-medium transition-colors border",
                isExcluded
                  ? "bg-muted text-foreground border-border"
                  : "border-border/60 text-muted-foreground hover:bg-accent hover:text-foreground",
              )}
            >
              {isExcluded ? "Reactivar" : "Ninguna"}
            </button>
          </div>
          <p className="text-[10.5px] text-muted-foreground/60 mt-1.5">
            Se clasifica automáticamente por preferencia; puedes cambiarla o sacarla de la sección cuando quieras.
          </p>
        </div>

        {/* Tareas relacionadas — creadas desde este correo */}
        <div className="px-5 py-3.5 border-b border-border/30">
          <p className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground mb-2.5 flex items-center gap-1.5">
            <CheckSquare className="w-[11px] h-[11px]" /> Tareas relacionadas
            {relatedTasks.length > 0 && (
              <span className="text-muted-foreground/60 font-medium">· {relatedTasks.length}</span>
            )}
          </p>
          {relatedTasks.length === 0 ? (
            <p className="text-[12px] text-muted-foreground/50 italic">Sin tareas vinculadas</p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {relatedTasks.map((t) => (
                <Link
                  key={t.id}
                  to={`/tareas?task=${t.id}`}
                  className="flex items-start gap-2 py-1 group"
                >
                  <span className={cn(
                    "w-1.5 h-1.5 rounded-full mt-1.5 shrink-0",
                    t.status === "completed" || t.status === "completado" ? "bg-emerald-500" : "bg-primary",
                  )} />
                  <span className="flex-1 min-w-0">
                    <span className={cn(
                      "block text-[12px] leading-snug truncate group-hover:text-primary transition-colors",
                      t.status === "completed" || t.status === "completado" ? "line-through text-muted-foreground/60" : "text-foreground",
                    )}>
                      {t.title}
                    </span>
                    {t.due_date && (
                      <span className="block text-[10.5px] text-muted-foreground">
                        Vence {formatEmailDate(t.due_date)}
                      </span>
                    )}
                  </span>
                </Link>
              ))}
            </div>
          )}
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
