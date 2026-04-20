import { useEffect, useMemo, useState } from "react";
import { ChevronRight, AlertTriangle, Clock, CalendarRange, CalendarDays } from "lucide-react";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { TaskRow } from "./TaskRow";
import { cn } from "@/lib/utils";
import type { Task } from "@/hooks/useTasks";
import { isPastDueCalendarMX, toDateStringMX, nowMX } from "@/lib/dateUtils";

type Bucket = "vencidas" | "hoy" | "semana" | "futuro" | "sin_fecha";

const BUCKETS: { key: Bucket; label: string; icon: typeof Clock; tone: string }[] = [
  { key: "vencidas", label: "Vencidas", icon: AlertTriangle, tone: "text-destructive" },
  { key: "hoy", label: "Hoy", icon: Clock, tone: "text-primary" },
  { key: "semana", label: "Esta semana", icon: CalendarRange, tone: "text-amber-600 dark:text-amber-400" },
  { key: "futuro", label: "Más adelante", icon: CalendarDays, tone: "text-muted-foreground" },
  { key: "sin_fecha", label: "Sin fecha", icon: CalendarDays, tone: "text-muted-foreground" },
];

const STORAGE_KEY = "kawiil-tareas-groups";

function readCollapsed(): Record<Bucket, boolean> {
  if (typeof window === "undefined") return {} as Record<Bucket, boolean>;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {} as Record<Bucket, boolean>;
    return JSON.parse(raw);
  } catch {
    return {} as Record<Bucket, boolean>;
  }
}

function bucketize(task: Task, todayYmd: string, weekEndYmd: string): Bucket {
  if (!task.due_date) return "sin_fecha";
  const dueYmd = task.due_date.slice(0, 10);
  if (isPastDueCalendarMX(task.due_date) && dueYmd !== todayYmd) return "vencidas";
  if (dueYmd === todayYmd) return "hoy";
  if (dueYmd <= weekEndYmd) return "semana";
  return "futuro";
}

interface TaskGroupedListProps {
  tasks: Task[];
  areaLabelMap?: Map<string, string> | { get(k: string): string | undefined };
  areaColorMap: Map<string, string | undefined>;
  profileMap: Map<string, string | null>;
  /** Map opcional de user_id → avatar_url para mostrar foto en la fila. */
  profileAvatarMap?: Map<string, string | null | undefined>;
  getCelulaLabel?: (k: string) => string;
  onOpen: (task: Task) => void;
  onDelete?: (task: Task) => void;
  canDelete?: boolean;
  emptyState?: React.ReactNode;
}

export function TaskGroupedList({
  tasks,
  areaColorMap,
  profileMap,
  profileAvatarMap,
  getCelulaLabel,
  onOpen,
  onDelete,
  canDelete,
  emptyState,
}: TaskGroupedListProps) {
  const [collapsed, setCollapsed] = useState<Record<Bucket, boolean>>(readCollapsed);

  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(collapsed));
    } catch {
      /* ignore */
    }
  }, [collapsed]);

  const grouped = useMemo(() => {
    const today = nowMX();
    const todayYmd = toDateStringMX(today);
    const weekEnd = new Date(today);
    weekEnd.setDate(weekEnd.getDate() + 7);
    const weekEndYmd = toDateStringMX(weekEnd);

    const map = new Map<Bucket, Task[]>();
    BUCKETS.forEach((b) => map.set(b.key, []));
    for (const t of tasks) {
      const b = bucketize(t, todayYmd, weekEndYmd);
      map.get(b)!.push(t);
    }
    map.get("vencidas")?.sort((a, b) => (a.due_date || "").localeCompare(b.due_date || ""));
    map.get("hoy")?.sort((a, b) => (a.priority || "").localeCompare(b.priority || ""));
    map.get("semana")?.sort((a, b) => (a.due_date || "").localeCompare(b.due_date || ""));
    map.get("futuro")?.sort((a, b) => (a.due_date || "").localeCompare(b.due_date || ""));
    return map;
  }, [tasks]);

  if (tasks.length === 0 && emptyState) return <>{emptyState}</>;

  return (
    <div className="space-y-3">
      {BUCKETS.map(({ key, label, icon: Icon, tone }) => {
        const list = grouped.get(key) || [];
        if (list.length === 0) return null;
        const isOpen = !collapsed[key];
        return (
          <Collapsible
            key={key}
            open={isOpen}
            onOpenChange={(open) => setCollapsed((prev) => ({ ...prev, [key]: !open }))}
            className="rounded-xl border border-border/50 bg-background/40"
          >
            <CollapsibleTrigger className="group flex w-full items-center gap-2 px-3 py-2 text-left">
              <ChevronRight
                className={cn(
                  "h-3.5 w-3.5 shrink-0 transition-transform",
                  isOpen && "rotate-90",
                )}
              />
              <Icon className={cn("h-3.5 w-3.5", tone)} />
              <span className="text-sm font-semibold text-foreground">{label}</span>
              <span className="rounded-full bg-muted px-1.5 text-[10px] font-medium text-muted-foreground tabular-nums">
                {list.length}
              </span>
            </CollapsibleTrigger>
            <CollapsibleContent className="p-2 pt-0 space-y-1.5">
              {list.map((task) => (
                <TaskRow
                  key={task.id}
                  task={task}
                  areaLabel={task.area ? getCelulaLabel?.(task.area) || task.area : undefined}
                  areaColor={task.area ? areaColorMap.get(task.area) : undefined}
                  assigneeName={task.assigned_to ? profileMap.get(task.assigned_to) || null : null}
                  assigneeUserId={task.assigned_to ?? null}
                  assigneeAvatarUrl={task.assigned_to ? profileAvatarMap?.get(task.assigned_to) ?? null : null}
                  onOpen={onOpen}
                  onDelete={onDelete ? () => onDelete(task) : undefined}
                  canDelete={canDelete}
                />
              ))}
            </CollapsibleContent>
          </Collapsible>
        );
      })}
    </div>
  );
}
