import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useMemo } from "react";

/** user_id en task_assignees para el conjunto de tareas dado (p. ej. tareas abiertas de un cliente o proyecto). */
export function useOpenTaskAssigneeUserIds(taskIds: string[]) {
  const { user } = useAuth();
  const sortedKey = useMemo(() => [...taskIds].sort().join(","), [taskIds]);

  return useQuery({
    queryKey: ["task-assignees-bulk", sortedKey],
    queryFn: async () => {
      if (taskIds.length === 0) return [] as string[];
      const { data, error } = await supabase.from("task_assignees").select("user_id").in("task_id", taskIds);
      if (error) throw error;
      return [...new Set((data ?? []).map((r) => r.user_id))];
    },
    enabled: !!user && taskIds.length > 0,
  });
}
