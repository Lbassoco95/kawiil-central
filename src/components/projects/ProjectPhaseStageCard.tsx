import { useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ChevronDown, ChevronRight, GripVertical, Layers } from "lucide-react";
import { cn } from "@/lib/utils";
import { projectPhaseColorClass } from "./projectPhaseVisual";

export { PROJECT_PHASE_CARD_COLORS, projectPhaseColorClass } from "./projectPhaseVisual";

export interface ProjectPhaseStageCardProps {
  /** Índice para rotar color (mismo orden que PhaseManager). */
  colorIndex: number;
  title: React.ReactNode;
  /** 0–100 */
  progressPercent: number;
  completedCount: number;
  totalCount: number;
  defaultOpen?: boolean;
  children: React.ReactNode;
  className?: string;
  /** Contenido extra a la derecha del badge (ej. botón contextual) */
  headerExtra?: React.ReactNode;
}

/**
 * Contenedor visual alineado con las tarjetas de fase del tab Tareas del proyecto
 * (banda de color, colapsar, barra de progreso, contador).
 */
export function ProjectPhaseStageCard({
  colorIndex,
  title,
  progressPercent,
  completedCount,
  totalCount,
  defaultOpen = true,
  children,
  className,
  headerExtra,
}: ProjectPhaseStageCardProps) {
  const [open, setOpen] = useState(defaultOpen);
  useEffect(() => {
    setOpen(defaultOpen);
  }, [defaultOpen]);

  const colorClass = projectPhaseColorClass(colorIndex);
  const pct = Math.min(100, Math.max(0, Math.round(progressPercent)));

  return (
    <div className={cn("rounded-xl border overflow-hidden", colorClass, className)}>
      <div className="flex items-center gap-2 px-3 py-2.5">
        <button type="button" onClick={() => setOpen((v) => !v)} className="shrink-0">
          {open ? (
            <ChevronDown className="h-4 w-4 text-muted-foreground" />
          ) : (
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          )}
        </button>
        <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0" aria-hidden />
        <Layers className="h-3.5 w-3.5 text-primary shrink-0" aria-hidden />
        <span className="text-sm font-semibold flex-1 min-w-0 truncate">{title}</span>
        <div className="flex items-center gap-2 shrink-0">
          <div className="hidden sm:flex items-center gap-1.5 w-24">
            <Progress value={pct} className="h-1.5" />
            <span className="text-[10px] text-muted-foreground w-8 text-right">{pct}%</span>
          </div>
          <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
            {completedCount}/{totalCount}
          </Badge>
          {headerExtra}
        </div>
      </div>
      {open ? <div className="px-2 pb-2 space-y-1">{children}</div> : null}
    </div>
  );
}
