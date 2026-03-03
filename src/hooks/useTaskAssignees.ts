import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export function useAddTaskAssignee() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ taskId, userId }: { taskId: string; userId: string }) => {
      const { error } = await supabase
        .from("task_assignees")
        .insert({ task_id: taskId, user_id: userId });
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["task-assignees", vars.taskId] });
      toast.success("Colaborador agregado");
    },
    onError: (err: Error) => {
      toast.error("Error al agregar colaborador: " + err.message);
    },
  });
}

export function useRemoveTaskAssignee() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ taskId, userId }: { taskId: string; userId: string }) => {
      const { error } = await supabase
        .from("task_assignees")
        .delete()
        .eq("task_id", taskId)
        .eq("user_id", userId);
      if (error) throw error;
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["task-assignees", vars.taskId] });
      toast.success("Colaborador removido");
    },
    onError: (err: Error) => {
      toast.error("Error al remover colaborador: " + err.message);
    },
  });
}
