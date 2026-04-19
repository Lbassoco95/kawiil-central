import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: string;
  /** Icon shown before title (optional). Para variant="hero" se pinta dentro de un cuadro 52px con gradient. */
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
  /**
   * - `default` / `minimal`: header inline (versión legacy, título con gradient text).
   * - `hero`: banner con dual radial-gradient + icono cuadrado grande + título con gradient text + acciones a la derecha
   *   (estilo `modules-polished.html` / handoff v3).
   */
  variant?: "default" | "minimal" | "hero";
}

export function PageHeader({
  title,
  description,
  icon,
  actions,
  className,
  variant = "default",
}: PageHeaderProps) {
  if (variant === "hero") {
    return (
      <header
        className={cn(
          "relative overflow-hidden rounded-2xl border border-border/70 px-5 py-4 sm:px-6 sm:py-5 animate-fade-in",
          className,
        )}
        style={{
          background:
            "radial-gradient(ellipse 520px 180px at 0% 0%, hsl(var(--primary) / 0.09), transparent 70%), " +
            "radial-gradient(ellipse 380px 140px at 100% 100%, hsl(var(--accent) / 0.08), transparent 70%), " +
            "hsl(var(--card))",
        }}
      >
        {/* sutil patrón diagonal */}
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-50"
          style={{
            backgroundImage:
              "repeating-linear-gradient(45deg, transparent, transparent 18px, hsl(var(--primary) / 0.015) 18px, hsl(var(--primary) / 0.015) 36px)",
          }}
        />
        <div className="relative flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-5">
          <div className="flex min-w-0 items-center gap-3 sm:gap-4">
            {icon ? (
              <div
                className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-primary/20 text-primary sm:h-[52px] sm:w-[52px]"
                style={{
                  background:
                    "linear-gradient(135deg, hsl(var(--primary) / 0.15), hsl(var(--accent) / 0.15))",
                }}
                aria-hidden
              >
                <span className="grid h-6 w-6 place-items-center [&_svg]:h-6 [&_svg]:w-6">
                  {icon}
                </span>
              </div>
            ) : null}
            <div className="min-w-0">
              <h1 className="truncate bg-gradient-to-r from-primary to-accent bg-clip-text text-xl font-bold tracking-tight text-transparent sm:text-2xl">
                {title}
              </h1>
              {description ? (
                <p className="mt-0.5 max-w-2xl text-xs text-muted-foreground sm:text-sm">
                  {description}
                </p>
              ) : null}
            </div>
          </div>
          {actions ? (
            <div className="flex shrink-0 flex-wrap items-center gap-2 sm:justify-end">
              {actions}
            </div>
          ) : null}
        </div>
      </header>
    );
  }

  // default / minimal — versión legacy, mantiene compatibilidad
  return (
    <div
      className={cn(
        "flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between animate-fade-in",
        className,
      )}
    >
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {icon ? <span className="shrink-0 text-primary">{icon}</span> : null}
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight gradient-text">
            {title}
          </h1>
        </div>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm sm:text-base leading-relaxed text-muted-foreground">
            {description}
          </p>
        ) : null}
      </div>
      {actions ? (
        <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div>
      ) : null}
    </div>
  );
}
