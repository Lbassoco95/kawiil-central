/** Piezas visuales del portal. Estados siempre con texto + icono, nunca solo color. */
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Clock, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "info" | "ok" | "warn" | "bad" | "wait";
const TONE: Record<Tone, { cls: string; Icon: typeof Info }> = {
  info: { cls: "bg-secondary text-secondary-foreground border-primary/30", Icon: Info },
  ok: { cls: "bg-emerald-50 text-emerald-900 border-emerald-300", Icon: CheckCircle2 },
  warn: { cls: "bg-amber-50 text-amber-900 border-amber-300", Icon: AlertTriangle },
  bad: { cls: "bg-red-50 text-red-900 border-red-300", Icon: XCircle },
  wait: { cls: "bg-slate-100 text-slate-800 border-slate-300", Icon: Clock },
};

export function StatusPill({ tone, children }: { tone: Tone; children: ReactNode }) {
  const { cls, Icon } = TONE[tone];
  return (
    <span className={cn("inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-medium", cls)}>
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      {children}
    </span>
  );
}

export function Notice({ tone = "info", title, children }: { tone?: Tone; title?: string; children: ReactNode }) {
  const { cls, Icon } = TONE[tone];
  return (
    <div role={tone === "bad" || tone === "warn" ? "alert" : "status"} className={cn("flex gap-3 rounded-lg border p-3 text-sm", cls)}>
      <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <div>
        {title && <p className="font-semibold">{title}</p>}
        <div>{children}</div>
      </div>
    </div>
  );
}

export function PageTitle({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-2xl text-accent sm:text-3xl">{title}</h1>
        {subtitle && <p className="text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {actions}
    </div>
  );
}

/** Leyenda obligatoria del tablero (M4 y cumplimiento §5). */
export function ManagementLegend() {
  return (
    <p className="rounded-md border border-accent/30 bg-secondary px-3 py-2 text-sm font-medium text-secondary-foreground">
      Información de gestión, no sustituye la declaración.
    </p>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">{children}</p>;
}
