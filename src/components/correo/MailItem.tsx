import { cn } from "@/lib/utils";
import { Archive, Check, Lock, Paperclip } from "lucide-react";
import { inferEmailChips, emailListTimestamp, formatEmailDate } from "@/lib/emailChips";
import { getLabelStyle } from "./MailLabelPicker";
import { MailAccountBadge } from "./MailAccountBadge";
import { useAccountColor } from "@/lib/accountColors";

interface Props {
  email: Record<string, unknown>;
  isActive: boolean;
  onClick: () => void;
  /** Doble clic / Enter: abrir la vista completa (onClick solo previsualiza). */
  onOpen?: () => void;
  onArchive?: () => void;
  onMarkRead?: () => void;
  labelChips?: { name: string; color: string }[];
}

export function MailItem({ email, isActive, onClick, onOpen, onArchive, onMarkRead, labelChips }: Props) {
  const colorForAccount = useAccountColor();
  const from = email.from as { emailAddress?: { name?: string; address?: string } } | undefined;
  const senderName = from?.emailAddress?.name || from?.emailAddress?.address || "Sin remitente";
  const subject = (email.subject as string) || "(sin asunto)";
  const bodyPreview = (email.bodyPreview as string) || "";
  const unread = !(email.isRead as boolean);
  const importance = (email.importance as string) || "";

  const sensitivity = (email.sensitivity as string) || "normal";
  const isConfidential = sensitivity === "confidential" || sensitivity === "private";
  const hasAttachments = !!(email.hasAttachments as boolean);

  const chips = inferEmailChips({
    from: email.from as { emailAddress?: { address?: string } },
    subject: email.subject as string,
    importance: email.importance as string,
  });
  const firstChip = chips[0];

  const CHIP_COLORS: Record<string, string> = {
    urgente: "hsl(0 72% 51%)",
    sat: "hsl(0 72% 51%)",
    factura: "hsl(32 90% 48%)",
    cliente: "hsl(210 100% 47%)",
    interno: "hsl(157 72% 36%)",
  };
  const chipColor = firstChip ? CHIP_COLORS[firstChip.tone] || "hsl(var(--muted-foreground))" : undefined;

  const ts = emailListTimestamp({
    receivedDateTime: email.receivedDateTime as string | undefined,
    sentDateTime: email.sentDateTime as string | undefined,
    createdDateTime: email.createdDateTime as string | undefined,
  });
  const timeLabel = formatEmailDate(ts);

  return (
    <div
      className={cn(
        "group relative grid items-center px-4 h-11 cursor-pointer transition-colors",
        labelChips && labelChips.length > 0
        ? "grid-cols-[8px_160px_minmax(0,1fr)_auto_52px]"
        : "grid-cols-[8px_160px_minmax(0,1fr)_52px]",
        "border-l-2",
        isActive
          ? "bg-accent border-l-primary"
          : "border-l-transparent hover:bg-accent/50",
        importance === "high" && !isActive && "border-l-destructive",
      )}
      onClick={onClick}
      onDoubleClick={() => (onOpen ?? onClick)()}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => e.key === "Enter" && (onOpen ?? onClick)()}
    >
      {/* Unread dot */}
      <span className={cn(
        "w-1.5 h-1.5 rounded-full bg-primary transition-opacity shrink-0",
        !unread && "opacity-0"
      )} />

      {/* Sender — with optional linked-account badge */}
      <span className={cn(
        "flex items-center gap-1.5 text-[12.5px] truncate pr-3 shrink-0",
        unread ? "font-bold text-foreground" : "font-medium text-muted-foreground"
      )}>
        {email._accountEmail && (
          <MailAccountBadge
            email={email._accountEmail as string}
            color={colorForAccount(email._accountId as string | undefined)}
            size="sm"
            className="shrink-0"
          />
        )}
        {senderName}
      </span>

      {/* Subject + preview */}
      <div className="flex items-center overflow-hidden min-w-0 gap-1.5">
        {chipColor && (
          <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: chipColor }} />
        )}
        {isConfidential && (
          <Lock className="w-3 h-3 shrink-0 text-amber-500" title="Confidencial" />
        )}
        {hasAttachments && (
          <Paperclip className="w-3 h-3 shrink-0 text-muted-foreground/60" title="Con adjuntos" />
        )}
        <span className={cn(
          "text-[12.5px] truncate shrink-0 max-w-[55%]",
          unread ? "font-semibold text-foreground" : "text-muted-foreground"
        )}>
          {subject}
        </span>
        {bodyPreview && (
          <span className="text-[12.5px] text-muted-foreground/60 truncate flex-1 min-w-0">
            —&nbsp;{bodyPreview}
          </span>
        )}
      </div>

      {/* Label chips */}
      {labelChips && labelChips.length > 0 && (
        <div className="flex items-center gap-1 px-1 overflow-hidden">
          {labelChips.slice(0, 3).map(chip => {
            const style = getLabelStyle(chip.color);
            return (
              <span
                key={chip.name}
                className="flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10.5px] font-medium whitespace-nowrap"
                style={{ background: style.bg, color: style.text }}
              >
                <span className="w-1.5 h-1.5 rounded-full shrink-0" style={{ background: style.dot }} />
                {chip.name}
              </span>
            );
          })}
        </div>
      )}

      {/* Date — hides on hover, actions appear */}
      <span className={cn(
        "text-[11.5px] text-muted-foreground text-right tabular-nums whitespace-nowrap",
        "group-hover:opacity-0 transition-opacity"
      )}>
        {timeLabel}
      </span>

      {/* Hover actions */}
      <div className="absolute right-3 top-1/2 -translate-y-1/2 hidden group-hover:flex items-center gap-0.5 bg-accent rounded-md p-0.5">
        {onMarkRead && (
          <button
            className={cn(
              "w-6 h-6 flex items-center justify-center rounded hover:bg-accent-foreground/10 transition-colors",
              unread ? "text-primary" : "text-muted-foreground hover:text-foreground"
            )}
            title={unread ? "Marcar como leído" : "Marcar como no leído"}
            onClick={(e) => { e.stopPropagation(); onMarkRead(); }}
          >
            <Check className="w-3 h-3" />
          </button>
        )}
        {onArchive && (
          <button
            className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:bg-accent-foreground/10 hover:text-foreground"
            title="Archivar"
            onClick={(e) => { e.stopPropagation(); onArchive(); }}
          >
            <Archive className="w-3 h-3" />
          </button>
        )}
      </div>
    </div>
  );
}
