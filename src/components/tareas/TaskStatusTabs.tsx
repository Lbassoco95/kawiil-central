import { LayoutList, Kanban, CalendarDays, GanttChartSquare } from "lucide-react";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

export type TaskStatusFilter = "todas" | "pendientes" | "en_curso" | "vencidas" | "criticas";
export type TaskViewMode = "lista" | "kanban" | "calendario" | "timeline";

const TABS: { key: TaskStatusFilter; label: string; activeColor: string }[] = [
  { key: "todas", label: "Todas", activeColor: "bg-primary/10 text-primary border-primary/30" },
  { key: "pendientes", label: "Pendientes", activeColor: "bg-amber-500/10 text-amber-600 border-amber-500/30 dark:text-amber-400" },
  { key: "en_curso", label: "En curso", activeColor: "bg-sky-500/10 text-sky-600 border-sky-500/30 dark:text-sky-400" },
  { key: "vencidas", label: "Vencidas", activeColor: "bg-destructive/10 text-destructive border-destructive/30" },
  { key: "criticas", label: "Críticas", activeColor: "bg-rose-500/10 text-rose-600 border-rose-500/30 dark:text-rose-400" },
];

interface TaskStatusTabsProps {
  value: TaskStatusFilter;
  onChange: (next: TaskStatusFilter) => void;
  counts: Record<TaskStatusFilter, number>;
  viewMode: TaskViewMode;
  onViewModeChange: (next: TaskViewMode) => void;
  className?: string;
}

export function TaskStatusTabs({
  value,
  onChange,
  counts,
  viewMode,
  onViewModeChange,
  className,
}: TaskStatusTabsProps) {
  return (
    <TooltipProvider delayDuration={250}>
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border/60 bg-background/60 p-2",
          className,
        )}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          {TABS.map((tab) => {
            const active = value === tab.key;
            return (
              <button
                key={tab.key}
                type="button"
                onClick={() => onChange(tab.key)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium transition-all",
                  active
                    ? tab.activeColor
                    : "border-border/60 bg-background text-muted-foreground hover:bg-muted hover:text-foreground",
                )}
              >
                <span>{tab.label}</span>
                <span
                  className={cn(
                    "tabular-nums rounded-full px-1.5 text-[10px] font-semibold",
                    active ? "bg-background/60" : "bg-muted text-muted-foreground",
                  )}
                >
                  {counts[tab.key] ?? 0}
                </span>
              </button>
            );
          })}
        </div>

        <ToggleGroup
          type="single"
          size="sm"
          value={viewMode}
          onValueChange={(v) => v && onViewModeChange(v as TaskViewMode)}
          className="rounded-lg border border-border/60 bg-background"
        >
          <ToggleGroupItem value="lista" aria-label="Vista lista" className="h-8 px-2.5 data-[state=on]:bg-muted">
            <LayoutList className="h-3.5 w-3.5" />
            <span className="ml-1.5 hidden sm:inline text-[11px]">Lista</span>
          </ToggleGroupItem>
          <ToggleGroupItem value="kanban" aria-label="Vista Kanban" className="h-8 px-2.5 data-[state=on]:bg-muted">
            <Kanban className="h-3.5 w-3.5" />
            <span className="ml-1.5 hidden sm:inline text-[11px]">Kanban</span>
          </ToggleGroupItem>
          <Tooltip>
            <TooltipTrigger asChild>
              <ToggleGroupItem value="calendario" disabled aria-label="Vista calendario" className="h-8 px-2.5 opacity-50">
                <CalendarDays className="h-3.5 w-3.5" />
                <span className="ml-1.5 hidden sm:inline text-[11px]">Calendario</span>
              </ToggleGroupItem>
            </TooltipTrigger>
            <TooltipContent>Próximamente</TooltipContent>
          </Tooltip>
          <ToggleGroupItem value="timeline" aria-label="Vista timeline" className="h-8 px-2.5 data-[state=on]:bg-muted">
            <GanttChartSquare className="h-3.5 w-3.5" />
            <span className="ml-1.5 hidden sm:inline text-[11px]">Timeline</span>
          </ToggleGroupItem>
        </ToggleGroup>
      </div>
    </TooltipProvider>
  );
}
