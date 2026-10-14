import { CalendarClock, Mail, Paperclip } from "lucide-react";
import {
  useClientEmailHistory,
  type ClientEmailHistoryItem,
  type ScheduledEmailStatus,
} from "@/hooks/useClientEmailHistory";
import { formatDateMX } from "@/lib/dateUtils";

const fmtDateTime = (iso: string) =>
  new Date(iso).toLocaleString("es-MX", { dateStyle: "short", timeStyle: "short" });

const STATUS_STYLE: Record<ScheduledEmailStatus, { label: string; className: string }> = {
  pending: { label: "Programado", className: "text-amber-700 dark:text-amber-300" },
  processing: { label: "Enviando", className: "text-amber-700 dark:text-amber-300" },
  sent: { label: "Enviado", className: "text-emerald-700 dark:text-emerald-300" },
  failed: { label: "Falló", className: "text-destructive" },
  cancelled: { label: "Cancelado", className: "text-muted-foreground" },
  unknown: { label: "Programado", className: "text-amber-700 dark:text-amber-300" },
};

function ScheduledBadge({ item }: { item: ClientEmailHistoryItem }) {
  const status = item.scheduledStatus ?? "unknown";
  const { label, className } = STATUS_STYLE[status];
  const when =
    status === "sent" && item.sentAt ? item.sentAt : (item.scheduledAt as string);
  const title =
    status === "failed" && item.errorMessage
      ? `No se pudo enviar: ${item.errorMessage}`
      : `Registrado el ${formatDateMX(item.created_at)}`;
  return (
    <span className={`inline-flex items-center gap-1 ${className}`} title={title}>
      <CalendarClock className="h-3 w-3" />
      {label} · {fmtDateTime(when)}
    </span>
  );
}

interface Props {
  clientId: string;
  /** user_id → nombre, para mostrar quién envió cada correo. */
  profilesByUserId: Map<string, { full_name?: string | null }>;
}

/** Correos enviados al cliente desde su ficha (activity_log). */
export function ClientEmailHistorySection({ clientId, profilesByUserId }: Props) {
  const { data: items = [], isLoading } = useClientEmailHistory(clientId);

  return (
    <section className="md:col-span-2 glass-card p-5">
      <h2 className="text-sm font-medium text-muted-foreground mb-3 flex items-center gap-1.5">
        <Mail className="h-3.5 w-3.5" />
        Correos enviados
      </h2>
      {isLoading ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : items.length === 0 ? (
        <p className="text-sm text-muted-foreground">Aún no se han enviado correos desde esta ficha.</p>
      ) : (
        <ul className="divide-y divide-border/60">
          {items.map((it) => (
            <li key={it.id} className="py-2.5 first:pt-0 last:pb-0">
              <div className="flex items-start justify-between gap-3">
                <p className="text-[13px] font-medium text-foreground truncate">{it.subject}</p>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {it.scheduledAt ? <ScheduledBadge item={it} /> : formatDateMX(it.created_at)}
                </span>
              </div>
              <p className="text-[12px] text-muted-foreground truncate">
                Para: {it.to.join(", ") || "—"}
                {it.cc.length > 0 && ` · Cc: ${it.cc.join(", ")}`}
              </p>
              <p className="text-[11px] text-muted-foreground/80 flex items-center gap-1.5">
                <span>
                  {it.scheduledAt ? "Programado por" : "Enviado por"} {(it.user_id && profilesByUserId.get(it.user_id)?.full_name) || "—"}
                  {it.from && ` desde ${it.from}`}
                </span>
                {it.attachments.length > 0 && (
                  <span className="inline-flex items-center gap-0.5" title={it.attachments.join(", ")}>
                    <Paperclip className="h-3 w-3" />
                    {it.attachments.length}
                  </span>
                )}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
