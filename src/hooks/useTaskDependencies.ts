import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export type TaskDependencyKind = "blocks" | "relates";

export interface TaskDependencyRow {
  id: string;
  task_id: string;
  depends_on_task_id: string;
  kind: TaskDependencyKind;
  created_at: string;
  organization_id: string;
}

export interface TaskDependencyWithTitle extends TaskDependencyRow {
  related_task: {
    id: string;
    title: string;
    status: string;
    due_date: string | null;
  } | null;
}

/**
 * Devuelve dependencias en ambas direcciones para una tarea:
 * - `dependsOn`: tareas que bloquean a `taskId` (filas donde task_id = taskId)
 * - `blocks`:    tareas que dependen de `taskId` (filas donde depends_on_task_id = taskId)
 */
export function useTaskDependencies(taskId: string | undefined) {
  const { user } = useAuth();

  const dependsOnQuery = useQuery({
    queryKey: ["task-dependencies-depends-on", taskId],
    enabled: !!user && !!taskId,
    queryFn: async (): Promise<TaskDependencyWithTitle[]> => {
      const { data, error } = await supabase
        .from("task_dependencies")
        .select("*")
        .eq("task_id", taskId!);
      if (error) throw error;
      const rows = (data ?? []) as TaskDependencyRow[];
      if (rows.length === 0) return [];
      const ids = [...new Set(rows.map((r) => r.depends_on_task_id))];
      const { data: tasks } = await supabase
        .from("tasks")
        .select("id, title, status, due_date")
        .in("id", ids);
      const byId = new Map((tasks ?? []).map((t: any) => [t.id, t]));
      return rows.map((r) => ({
        ...r,
        related_task: byId.get(r.depends_on_task_id) ?? null,
      }));
    },
  });

  const blocksQuery = useQuery({
    queryKey: ["task-dependencies-blocks", taskId],
    enabled: !!user && !!taskId,
    queryFn: async (): Promise<TaskDependencyWithTitle[]> => {
      const { data, error } = await supabase
        .from("task_dependencies")
        .select("*")
        .eq("depends_on_task_id", taskId!);
      if (error) throw error;
      const rows = (data ?? []) as TaskDependencyRow[];
      if (rows.length === 0) return [];
      const ids = [...new Set(rows.map((r) => r.task_id))];
      const { data: tasks } = await supabase
        .from("tasks")
        .select("id, title, status, due_date")
        .in("id", ids);
      const byId = new Map((tasks ?? []).map((t: any) => [t.id, t]));
      return rows.map((r) => ({
        ...r,
        related_task: byId.get(r.task_id) ?? null,
      }));
    },
  });

  return {
    dependsOn: dependsOnQuery.data ?? [],
    blocks: blocksQuery.data ?? [],
    isLoading: dependsOnQuery.isLoading || blocksQuery.isLoading,
  };
}

export function useAddTaskDependency() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({
      taskId,
      dependsOnTaskId,
      kind = "blocks",
    }: {
      taskId: string;
      dependsOnTaskId: string;
      kind?: TaskDependencyKind;
    }) => {
      if (taskId === dependsOnTaskId) {
        throw new Error("Una tarea no puede depender de sí misma.");
      }
      const { data: profile } = await supabase
        .from("profiles")
        .select("organization_id")
        .eq("user_id", user!.id)
        .single();
      if (!profile?.organization_id) throw new Error("Sin organización activa.");
      const { error } = await supabase.from("task_dependencies").insert({
        task_id: taskId,
        depends_on_task_id: dependsOnTaskId,
        kind,
        organization_id: profile.organization_id,
        created_by: user!.id,
      });
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["task-dependencies-depends-on", vars.taskId] });
      queryClient.invalidateQueries({ queryKey: ["task-dependencies-blocks", vars.dependsOnTaskId] });
      toast.success("Dependencia agregada");
    },
    onError: (err: Error) => {
      toast.error("Error al agregar dependencia: " + err.message);
    },
  });
}

export function useRemoveTaskDependency() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id }: { id: string; taskId: string; dependsOnTaskId: string }) => {
      const { error } = await supabase.from("task_dependencies").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["task-dependencies-depends-on", vars.taskId] });
      queryClient.invalidateQueries({ queryKey: ["task-dependencies-blocks", vars.dependsOnTaskId] });
      toast.success("Dependencia eliminada");
    },
    onError: (err: Error) => {
      toast.error("Error al eliminar dependencia: " + err.message);
    },
  });
}
