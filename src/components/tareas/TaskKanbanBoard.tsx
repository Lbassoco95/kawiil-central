import { useMemo } from "react";
import { TaskRow } from "./TaskRow";
import { cn } from "@/lib/utils";

type Status = "pendiente" | "en_progreso" | "en_revision";

const COLUMNS: { key: Status; label: string; tone: string }[] = [
  { key: "pendiente", label: "Pendiente", tone: "bg-muted/40" },
  { key: "en_progreso", label: "En progreso", tone: "bg-blue-500/10" },
  { key: "en_revision", label: "En revisión", tone: "bg-amber-500/10" },
];

interface TaskKanbanBoardProps {
  tasks: any[];
  areaColorMap: Map<string, string | undefined>;
  profileMap: Map<string, string | null>;
  /** Map opcional de user_id → avatar_url para mostrar foto en la tarjeta. */
  profileAvatarMap?: Map<string, string | null | undefined>;
  getCelulaLabel: (a: string | null) => string;
  onOpen: (t: any) => void;
}

export function TaskKanbanBoard({
  tasks,
  areaColorMap,
  profileMap,
  profileAvatarMap,
  getCelulaLabel,
  onOpen,
}: TaskKanbanBoardProps) {
  const grouped = useMemo(() => {
    const m = new Map<Status, any[]>();
    for (const c of COLUMNS) m.set(c.key, []);
    for (const t of tasks) {
      const k = (m.has(t.status) ? t.status : "pendiente") as Status;
      m.get(k)?.push(t);
    }
    return m;
  }, [tasks]);

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
      {COLUMNS.map((col) => {
        const list = grouped.get(col.key) || [];
        return (
          <div
            key={col.key}
            className={cn(
              "rounded-xl border border-border/60 bg-background/40 p-2 min-h-[120px] flex flex-col",
            )}
          >
            <div className={cn("flex items-center justify-between rounded-md px-2 py-1.5 mb-2", col.tone)}>
              <span className="text-xs font-semibold text-foreground">{col.label}</span>
              <span className="text-[10.5px] tabular-nums text-muted-foreground bg-background/60 px-1.5 py-0.5 rounded-full">
                {list.length}
              </span>
            </div>
            <div className="space-y-1.5 flex-1">
              {list.length === 0 ? (
                <div className="text-[11px] text-muted-foreground/70 text-center py-6 italic">Sin tareas</div>
              ) : (
                list.map((task) => (
                  <TaskRow
                    key={task.id}
                    task={task}
                    areaLabel={getCelulaLabel(task.area)}
                    areaColor={areaColorMap.get(task.area)}
                    assigneeName={task.assigned_to ? profileMap.get(task.assigned_to) || null : null}
                    assigneeUserId={task.assigned_to ?? null}
                    assigneeAvatarUrl={task.assigned_to ? profileAvatarMap?.get(task.assigned_to) ?? null : null}
                    onOpen={() => onOpen(task)}
                  />
                ))
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
