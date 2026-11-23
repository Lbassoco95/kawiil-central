/**
 * Hooks de datos del módulo de Actividades internas.
 * RLS acota las filas a la organización del usuario automáticamente.
 */
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import type { Tables, TablesInsert, TablesUpdate } from "@/integrations/supabase/types";

export type Activity = Tables<"activities">;

export type ActivityCreateInput = Omit<
  TablesInsert<"activities">,
  "organization_id" | "created_by" | "id" | "created_at" | "updated_at"
>;

async function getOrgId(userId: string): Promise<string> {
  const { data: orgId, error } = await supabase.rpc("get_user_org_id", { _user_id: userId });
  if (error) throw error;
  if (!orgId) throw new Error("No se encontró la organización del usuario.");
  return orgId as string;
}

// ─── Actividades ────────────────────────────────────────────────────────────
export function useActivities() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["activities"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activities")
        .select("*")
        .order("event_date", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as Activity[];
    },
    enabled: !!user,
  });
}

export function useActivity(activityId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["activity", activityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activities")
        .select("*")
        .eq("id", activityId!)
        .single();
      if (error) throw error;
      return data as Activity;
    },
    enabled: !!user && !!activityId,
  });
}

export function useCreateActivity() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (input: ActivityCreateInput) => {
      const organization_id = await getOrgId(user!.id);
      const { data, error } = await supabase
        .from("activities")
        .insert({ ...input, organization_id, created_by: user!.id })
        .select()
        .single();
      if (error) throw error;
      return data as Activity;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["activities"] });
      toast.success("Actividad creada");
    },
    onError: (e: Error) => toast.error("Error al crear la actividad: " + e.message),
  });
}

export function useUpdateActivity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: TablesUpdate<"activities"> & { id: string }) => {
      const { data, error } = await supabase
        .from("activities")
        .update(updates)
        .eq("id", id)
        .select()
        .single();
      if (error) throw error;
      return data as Activity;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ["activities"] });
      queryClient.invalidateQueries({ queryKey: ["activity", data.id] });
      toast.success("Actividad actualizada");
    },
    onError: (e: Error) => toast.error("Error al actualizar: " + e.message),
  });
}

export function useDeleteActivity() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("activities").delete().eq("id", id);
      if (error) throw error;
      return id;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["activities"] });
      toast.success("Actividad eliminada");
    },
    onError: (e: Error) => toast.error("Error al eliminar: " + e.message),
  });
}

// ─── Pendientes / seguimiento (son TAREAS reales ligadas a la actividad) ─────
export type ActivityTask = Tables<"tasks">;

/**
 * Tareas de una actividad. La queryKey empieza con ["tasks", ...] a propósito:
 * así las invalidaciones de useCreateTask/useUpdateTask/useDeleteTask (que
 * invalidan ["tasks"]) refrescan también esta lista automáticamente.
 */
/** Responsables adicionales (task_assignees) de las tareas dadas: taskId → user_ids. */
export function useActivityTaskAssignees(taskIds: string[]) {
  const { user } = useAuth();
  const key = [...taskIds].sort().join(",");
  return useQuery({
    queryKey: ["task-assignees-bulk", "activity", key],
    queryFn: async () => {
      const map: Record<string, string[]> = {};
      if (taskIds.length === 0) return map;
      const { data, error } = await supabase
        .from("task_assignees").select("task_id, user_id").in("task_id", taskIds);
      if (error) throw error;
      for (const r of data ?? []) (map[r.task_id] ??= []).push(r.user_id);
      return map;
    },
    enabled: !!user && taskIds.length > 0,
  });
}

/**
 * Deja a `userIds` como los responsables de la tarea: el primero va en tasks.assigned_to
 * (así sigue saliendo en el perfil y en "Mis tareas") y el resto en task_assignees.
 * Devuelve los user_id que se agregaron, para avisarles.
 */
export async function syncTaskAssignees(taskId: string, userIds: string[]): Promise<string[]> {
  const [primary, ...extra] = [...new Set(userIds)];
  const { data: current, error } = await supabase
    .from("task_assignees").select("user_id").eq("task_id", taskId);
  if (error) throw error;
  const have = new Set((current ?? []).map((r) => r.user_id));
  const want = new Set(extra);
  const toAdd = extra.filter((u) => !have.has(u));
  const toRemove = [...have].filter((u) => !want.has(u));
  if (toRemove.length) {
    const { error: e } = await supabase
      .from("task_assignees").delete().eq("task_id", taskId).in("user_id", toRemove);
    if (e) throw e;
  }
  if (toAdd.length) {
    const { error: e } = await supabase
      .from("task_assignees").insert(toAdd.map((user_id) => ({ task_id: taskId, user_id })));
    if (e) throw e;
  }
  const { error: e2 } = await supabase
    .from("tasks").update({ assigned_to: primary ?? null }).eq("id", taskId);
  if (e2) throw e2;
  return toAdd;
}

export function useActivityTasks(activityId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["tasks", "activity", activityId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("*")
        .eq("activity_id", activityId!)
        .order("due_date", { ascending: true, nullsFirst: false })
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data as ActivityTask[];
    },
    enabled: !!user && !!activityId,
  });
}
