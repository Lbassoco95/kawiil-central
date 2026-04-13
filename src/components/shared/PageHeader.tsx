import { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface PageHeaderProps {
  title: string;
  description?: string;
  /** Icon shown before title (optional) */
  icon?: ReactNode;
  actions?: ReactNode;
  className?: string;
  /** Reservado para afinar layout; el título usa siempre el gradiente de marca. */
  variant?: "default" | "minimal";
}

export function PageHeader({
  title,
  description,
  icon,
  actions,
  className,
  variant: _variant = "default",
}: PageHeaderProps) {
  return (
    <div className={cn("flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between animate-fade-in", className)}>
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          {icon ? <span className="shrink-0 text-primary">{icon}</span> : null}
          <h1 className="text-2xl sm:text-3xl font-bold tracking-tight gradient-text">
            {title}
          </h1>
        </div>
        {description ? (
          <p className="mt-1 max-w-2xl text-sm sm:text-base leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2 shrink-0">{actions}</div> : null}
    </div>
  );
}
