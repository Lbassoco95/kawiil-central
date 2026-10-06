/** Piezas visuales del portal — alineadas a superficies de Kawiil Central. Estados con texto + icono. */
import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, Clock, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

type Tone = "info" | "ok" | "warn" | "bad" | "wait";
const TONE: Record<Tone, { cls: string; Icon: typeof Info }> = {
  info: { cls: "border-sky-200 bg-sky-50 text-sky-900", Icon: Info },
  ok: { cls: "border-emerald-200 bg-emerald-50 text-emerald-900", Icon: CheckCircle2 },
  warn: { cls: "border-amber-200 bg-amber-50 text-amber-900", Icon: AlertTriangle },
  bad: { cls: "border-red-200 bg-red-50 text-red-900", Icon: XCircle },
  wait: { cls: "border-slate-200 bg-slate-100 text-slate-800", Icon: Clock },
};

const PORTAL_ICON_ACCENT =
  "linear-gradient(135deg, hsl(200 100% 50%), hsl(220 100% 55%))";

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
    <div role={tone === "bad" || tone === "warn" ? "alert" : "status"} className={cn("flex gap-3 rounded-xl border p-3 text-sm", cls)}>
      <Icon className="mt-0.5 h-5 w-5 shrink-0" aria-hidden="true" />
      <div>
        {title && <p className="font-semibold">{title}</p>}
        <div>{children}</div>
      </div>
    </div>
  );
}

export function PageTitle({
  title,
  subtitle,
  actions,
  icon,
  breadcrumb,
}: {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  icon?: ReactNode;
  breadcrumb?: string[];
}) {
  return (
    <header className="portal-hero mb-4">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-50"
        style={{
          backgroundImage:
            "repeating-linear-gradient(45deg, transparent, transparent 18px, hsl(var(--primary) / 0.015) 18px, hsl(var(--primary) / 0.015) 36px)",
        }}
      />
      <div className="relative flex flex-col gap-3">
        {breadcrumb && breadcrumb.length > 0 && (
          <nav aria-label="Migajas" className="flex flex-wrap items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">
            {breadcrumb.map((c, i) => (
              <span key={c} className="flex items-center gap-1.5">
                <span className={cn(i === breadcrumb.length - 1 && "text-foreground")}>{c}</span>
                {i < breadcrumb.length - 1 ? <span aria-hidden className="opacity-40">·</span> : null}
              </span>
            ))}
          </nav>
        )}
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-5">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            {icon ? (
              <div
                className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-primary/20 text-white sm:h-[52px] sm:w-[52px]"
                style={{ background: PORTAL_ICON_ACCENT }}
                aria-hidden
              >
                <span className="grid h-6 w-6 place-items-center [&_svg]:h-6 [&_svg]:w-6">{icon}</span>
              </div>
            ) : null}
            <div className="min-w-0">
              <h1 className="truncate text-xl font-bold tracking-tight gradient-text sm:text-2xl">{title}</h1>
              {subtitle && <p className="mt-0.5 max-w-2xl text-xs text-muted-foreground sm:text-sm">{subtitle}</p>}
            </div>
          </div>
          {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">{actions}</div> : null}
        </div>
      </div>
    </header>
  );
}

/** Leyenda obligatoria del tablero (M4 y cumplimiento §5). */
export function ManagementLegend() {
  return (
    <p className="rounded-xl border border-sky-200/80 bg-sky-50/80 px-3 py-2 text-sm font-medium text-sky-900">
      Información de gestión, no sustituye la declaración.
    </p>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <p className="rounded-xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground">{children}</p>;
}
