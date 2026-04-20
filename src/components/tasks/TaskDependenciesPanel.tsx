import { useMemo, useState } from "react";
import { GitBranch, Link2, X, Plus, AlertTriangle, ArrowRight } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import {
  useTaskDependencies,
  useAddTaskDependency,
  useRemoveTaskDependency,
} from "@/hooks/useTaskDependencies";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { Button } from "@/components/ui/button";
import { TASK_STATUS_CONFIG } from "@/lib/statusStyles";
import { isTaskClosedStatus } from "@/lib/taskStatusGroups";
import { cn } from "@/lib/utils";

interface Props {
  taskId: string;
  projectId: string | null | undefined;
  onOpenTask?: (taskId: string) => void;
}

/**
 * Panel "Dependencias" para el sidebar del TaskDetailDialog v2.5.
 * Reusa task_dependencies (depende_de / bloquea_a) y muestra chips por tarea.
 */
export function TaskDependenciesPanel({ taskId, projectId, onOpenTask }: Props) {
  const { dependsOn, blocks } = useTaskDependencies(taskId);
  const addDep = useAddTaskDependency();
  const removeDep = useRemoveTaskDependency();
  const [adding, setAdding] = useState<"dependsOn" | "blocks" | null>(null);

  const { data: candidates = [] } = useQuery({
    queryKey: ["task-dependency-candidates", projectId ?? "_no_project_", taskId],
    enabled: adding != null,
    queryFn: async () => {
      const q = supabase
        .from("tasks")
        .select("id, title, status")
        .neq("id", taskId)
        .order("created_at", { ascending: false })
        .limit(200);
      if (projectId) q.eq("project_id", projectId);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Array<{ id: string; title: string; status: string }>;
    },
  });

  const candidateOptions = useMemo(
    () =>
      candidates.map((t) => ({
        value: t.id,
        label: t.title,
      })),
    [candidates]
  );

  const handleAdd = (uid: string) => {
    if (!adding || !uid) return;
    if (adding === "dependsOn") {
      addDep.mutate({ taskId, dependsOnTaskId: uid });
    } else {
      addDep.mutate({ taskId: uid, dependsOnTaskId: taskId });
    }
    setAdding(null);
  };

  const blockingOpen = dependsOn.filter(
    (d) => d.related_task && !isTaskClosedStatus(d.related_task.status)
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h4 className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Dependencias
        </h4>
        {blockingOpen.length > 0 && (
          <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-2.5 w-2.5" />
            {blockingOpen.length} bloqueante{blockingOpen.length === 1 ? "" : "s"}
          </span>
        )}
      </div>

      {/* Depende de */}
      <div className="space-y-1.5">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80">
          Depende de
        </p>
        {dependsOn.length === 0 && adding !== "dependsOn" && (
          <p className="text-[11px] text-muted-foreground/70">Ninguna.</p>
        )}
        {dependsOn.map((d) => {
          const t = d.related_task;
          if (!t) return null;
          const closed = isTaskClosedStatus(t.status);
          return (
            <div
              key={d.id}
              className={cn(
                "group flex items-center gap-2 rounded-md border px-2 py-1.5 text-[11px]",
                closed
                  ? "border-emerald-500/30 bg-emerald-500/5"
                  : "border-amber-500/30 bg-amber-500/5"
              )}
            >
              <GitBranch className="h-3 w-3 shrink-0 text-muted-foreground" />
              <button
                type="button"
                className="flex-1 truncate text-left font-medium hover:underline"
                onClick={() => onOpenTask?.(t.id)}
              >
                {t.title}
              </button>
              <span className="text-[9px] text-muted-foreground shrink-0">
                {TASK_STATUS_CONFIG[t.status as keyof typeof TASK_STATUS_CONFIG]?.label || t.status}
              </span>
              <button
                type="button"
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                onClick={() =>
                  removeDep.mutate({
                    id: d.id,
                    taskId,
                    dependsOnTaskId: d.depends_on_task_id,
                  })
                }
                aria-label="Quitar dependencia"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
        {adding === "dependsOn" ? (
          <div className="flex gap-1.5">
            <SearchableSelect
              options={candidateOptions}
              value=""
              onValueChange={handleAdd}
              placeholder="Buscar tarea..."
              searchPlaceholder="Buscar..."
              className="h-7 flex-1 text-[11px]"
            />
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[10px]"
              onClick={() => setAdding(null)}
            >
              Cancelar
            </Button>
          </div>
        ) : (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
            onClick={() => setAdding("dependsOn")}
          >
            <Plus className="h-2.5 w-2.5" /> Agregar
          </button>
        )}
      </div>

      {/* Bloquea a */}
      <div className="space-y-1.5">
        <p className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground/80">
          Bloquea
        </p>
        {blocks.length === 0 && adding !== "blocks" && (
          <p className="text-[11px] text-muted-foreground/70">Ninguna.</p>
        )}
        {blocks.map((d) => {
          const t = d.related_task;
          if (!t) return null;
          return (
            <div
              key={d.id}
              className="group flex items-center gap-2 rounded-md border border-border/60 bg-muted/30 px-2 py-1.5 text-[11px]"
            >
              <ArrowRight className="h-3 w-3 shrink-0 text-muted-foreground" />
              <button
                type="button"
                className="flex-1 truncate text-left font-medium hover:underline"
                onClick={() => onOpenTask?.(t.id)}
              >
                {t.title}
              </button>
              <span className="text-[9px] text-muted-foreground shrink-0">
                {TASK_STATUS_CONFIG[t.status as keyof typeof TASK_STATUS_CONFIG]?.label || t.status}
              </span>
              <button
                type="button"
                className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                onClick={() =>
                  removeDep.mutate({
                    id: d.id,
                    taskId: d.task_id,
                    dependsOnTaskId: taskId,
                  })
                }
                aria-label="Quitar dependencia"
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
        {adding === "blocks" ? (
          <div className="flex gap-1.5">
            <SearchableSelect
              options={candidateOptions}
              value=""
              onValueChange={handleAdd}
              placeholder="Buscar tarea..."
              searchPlaceholder="Buscar..."
              className="h-7 flex-1 text-[11px]"
            />
            <Button
              size="sm"
              variant="ghost"
              className="h-7 px-2 text-[10px]"
              onClick={() => setAdding(null)}
            >
              Cancelar
            </Button>
          </div>
        ) : (
          <button
            type="button"
            className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
            onClick={() => setAdding("blocks")}
          >
            <Plus className="h-2.5 w-2.5" /> Agregar
          </button>
        )}
      </div>
    </div>
  );
}
