import { type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface KpiTileProps {
  title: string;
  subtitle?: string;
  /** Clase con `before:bg-*` (la barra de acento superior). */
  accentClass: string;
  icon: ReactNode;
  children: ReactNode;
  footer?: ReactNode;
  className?: string;
}

/**
 * Tile reutilizable para KPIs financieros y similares.
 * Sigue el patrón del handoff v3 `modules-polished.html` (kpi-card):
 * accent bar superior + icono en cuadro tenue + valor grande + subtitulo + footer.
 */
export function KpiTile({
  title,
  subtitle,
  accentClass,
  icon,
  children,
  footer,
  className,
}: KpiTileProps) {
  return (
    <div
      className={cn(
        "group relative overflow-hidden rounded-2xl border border-border/50 bg-card/90 p-4 shadow-sm transition-all duration-300",
        "hover:-translate-y-0.5 hover:border-border hover:shadow-lg",
        "before:absolute before:inset-x-0 before:top-0 before:h-1 before:rounded-t-2xl",
        accentClass,
        className,
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
            {title}
          </p>
          {subtitle ? (
            <p className="mt-0.5 text-[11px] leading-snug text-muted-foreground/90">
              {subtitle}
            </p>
          ) : null}
        </div>
        <div className="rounded-lg bg-muted/50 p-2 text-muted-foreground transition-colors group-hover:bg-muted">
          {icon}
        </div>
      </div>
      <div className="mt-3">{children}</div>
      {footer ? (
        <div className="mt-2 border-t border-border/40 pt-2">{footer}</div>
      ) : null}
    </div>
  );
}
