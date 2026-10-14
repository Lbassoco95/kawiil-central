import { Mail, Paperclip } from "lucide-react";
import { useClientEmailHistory } from "@/hooks/useClientEmailHistory";
import { formatDateMX } from "@/lib/dateUtils";

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
                <span className="shrink-0 text-[11px] text-muted-foreground">{formatDateMX(it.created_at)}</span>
              </div>
              <p className="text-[12px] text-muted-foreground truncate">
                Para: {it.to.join(", ") || "—"}
                {it.cc.length > 0 && ` · Cc: ${it.cc.join(", ")}`}
              </p>
              <p className="text-[11px] text-muted-foreground/80 flex items-center gap-1.5">
                <span>
                  Enviado por {(it.user_id && profilesByUserId.get(it.user_id)?.full_name) || "—"}
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
