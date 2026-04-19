import { ReactNode } from "react";
import { Home } from "lucide-react";
import { cn } from "@/lib/utils";

export type PageHeaderBreadcrumb = string | { label: string; href?: string };

export interface PageHeaderStat {
  label: string;
  value: string | number;
  sub?: string;
  tone?: "default" | "success" | "warning" | "primary";
}

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
  /** Solo en variant="hero". Migajas tipo "Kawiil OS · Trabajo · Clientes". */
  breadcrumb?: PageHeaderBreadcrumb[];
  /** Solo en variant="hero". CSS background del cuadrado del icono (override del gradient primary/accent). */
  iconAccent?: string;
  /** Solo en variant="hero". Stats inline debajo del row principal. Se omiten silenciosamente los nulos. */
  stats?: Array<PageHeaderStat | null | false | undefined>;
}

const TONE_CLASS: Record<NonNullable<PageHeaderStat["tone"]>, string> = {
  default: "text-foreground",
  success: "text-emerald-600 dark:text-emerald-400",
  warning: "text-amber-600 dark:text-amber-400",
  primary: "text-primary",
};

const TONE_LABEL_CLASS: Record<NonNullable<PageHeaderStat["tone"]>, string> = {
  default: "text-muted-foreground",
  success: "text-emerald-600/80 dark:text-emerald-400/80",
  warning: "text-amber-600/80 dark:text-amber-400/80",
  primary: "text-primary/80",
};

export function PageHeader({
  title,
  description,
  icon,
  actions,
  className,
  variant = "default",
  breadcrumb,
  iconAccent,
  stats,
}: PageHeaderProps) {
  if (variant === "hero") {
    const cleanStats = (stats ?? []).filter(
      (s): s is PageHeaderStat => Boolean(s) && s !== null && s !== false,
    );
    const cleanCrumbs = (breadcrumb ?? []).map((c) =>
      typeof c === "string" ? { label: c } : c,
    );

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
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 opacity-50"
          style={{
            backgroundImage:
              "repeating-linear-gradient(45deg, transparent, transparent 18px, hsl(var(--primary) / 0.015) 18px, hsl(var(--primary) / 0.015) 36px)",
          }}
        />
        <div className="relative flex flex-col gap-3">
          {cleanCrumbs.length > 0 ? (
            <nav
              aria-label="Migajas"
              className="flex flex-wrap items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
            >
              <Home className="h-3 w-3 opacity-70" aria-hidden />
              {cleanCrumbs.map((c, i) => {
                const isLast = i === cleanCrumbs.length - 1;
                const node = c.href ? (
                  <a
                    key={`crumb-${i}`}
                    href={c.href}
                    className="hover:text-foreground transition-colors"
                  >
                    {c.label}
                  </a>
                ) : (
                  <span
                    key={`crumb-${i}`}
                    className={cn(isLast && "text-foreground")}
                  >
                    {c.label}
                  </span>
                );
                return (
                  <span key={`group-${i}`} className="flex items-center gap-1.5">
                    {node}
                    {!isLast ? (
                      <span aria-hidden className="opacity-40">
                        ·
                      </span>
                    ) : null}
                  </span>
                );
              })}
            </nav>
          ) : null}

          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between sm:gap-5">
            <div className="flex min-w-0 items-center gap-3 sm:gap-4">
              {icon ? (
                <div
                  className="grid h-12 w-12 shrink-0 place-items-center rounded-2xl border border-primary/20 text-white sm:h-[52px] sm:w-[52px]"
                  style={{
                    background:
                      iconAccent ??
                      "linear-gradient(135deg, hsl(var(--primary) / 0.15), hsl(var(--accent) / 0.15))",
                    color: iconAccent ? "white" : undefined,
                  }}
                  aria-hidden
                >
                  <span
                    className={cn(
                      "grid h-6 w-6 place-items-center [&_svg]:h-6 [&_svg]:w-6",
                      !iconAccent && "text-primary",
                    )}
                  >
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

          {cleanStats.length > 0 ? (
            <div
              className={cn(
                "mt-2 grid gap-x-6 gap-y-3",
                "grid-cols-2 sm:grid-cols-3",
                cleanStats.length >= 4 && "lg:grid-cols-4",
                cleanStats.length >= 5 && "xl:grid-cols-5",
              )}
            >
              {cleanStats.map((s, i) => {
                const tone = s.tone ?? "default";
                return (
                  <div
                    key={`stat-${i}`}
                    className="flex flex-col gap-0.5 min-w-0"
                  >
                    <div
                      className={cn(
                        "text-[10.5px] font-semibold uppercase tracking-wide",
                        TONE_LABEL_CLASS[tone],
                      )}
                    >
                      {s.label}
                    </div>
                    <div
                      className={cn(
                        "text-lg sm:text-xl font-bold tabular-nums leading-tight",
                        TONE_CLASS[tone],
                      )}
                    >
                      {s.value}
                    </div>
                    {s.sub ? (
                      <div className="text-[10.5px] text-muted-foreground truncate">
                        {s.sub}
                      </div>
                    ) : null}
                  </div>
                );
              })}
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
