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
export type TaskPeople = { responsables: string[]; equipo: string[] };

/** Responsables adicionales y equipo (task_assignees) de las tareas dadas: taskId → personas. */
export function useActivityTaskAssignees(taskIds: string[]) {
  const { user } = useAuth();
  const key = [...taskIds].sort().join(",");
  return useQuery({
    queryKey: ["task-assignees-bulk", "activity", key],
    queryFn: async () => {
      const map: Record<string, TaskPeople> = {};
      if (taskIds.length === 0) return map;
      const { data, error } = await supabase
        .from("task_assignees").select("task_id, user_id, assignment_role").in("task_id", taskIds);
      if (error) throw error;
      for (const r of data ?? []) {
        const e = (map[r.task_id] ??= { responsables: [], equipo: [] });
        (r.assignment_role === "responsable" ? e.responsables : e.equipo).push(r.user_id);
      }
      return map;
    },
    enabled: !!user && taskIds.length > 0,
  });
}

/** Usuarios con acceso al módulo de Actividades (G4 / transformador): los únicos que pueden ser responsables. */
export function useActivityManagerIds() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["activity-manager-ids"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_roles").select("user_id").eq("role", "transformador");
      if (error) throw error;
      return new Set((data ?? []).map((r) => r.user_id));
    },
    enabled: !!user,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Deja a `responsables` y `equipo` como las personas de la tarea: el primer responsable va en
 * tasks.assigned_to (así sigue saliendo en el perfil y en "Mis tareas"); el resto de responsables
 * y el equipo van en task_assignees con su assignment_role.
 * Devuelve los user_id que se sumaron (para avisarles).
 */
export async function syncTaskAssignees(
  taskId: string, responsables: string[], equipo: string[],
): Promise<string[]> {
  const resp = [...new Set(responsables)];
  const [primary, ...extraResp] = resp;
  const team = [...new Set(equipo)].filter((u) => !resp.includes(u));
  const wanted = new Map<string, string>([
    ...extraResp.map((u) => [u, "responsable"] as [string, string]),
    ...team.map((u) => [u, "equipo"] as [string, string]),
  ]);
  const { data: current, error } = await supabase
    .from("task_assignees").select("user_id, assignment_role").eq("task_id", taskId);
  if (error) throw error;
  const have = new Map((current ?? []).map((r) => [r.user_id, r.assignment_role]));
  const toRemove = [...have].filter(([u, r]) => wanted.get(u) !== r).map(([u]) => u);
  const toAdd = [...wanted].filter(([u, r]) => have.get(u) !== r);
  if (toRemove.length) {
    const { error: e } = await supabase
      .from("task_assignees").delete().eq("task_id", taskId).in("user_id", toRemove);
    if (e) throw e;
  }
  if (toAdd.length) {
    const { error: e } = await supabase.from("task_assignees").insert(
      toAdd.map(([user_id, assignment_role]) => ({ task_id: taskId, user_id, assignment_role })),
    );
    if (e) throw e;
  }
  const { error: e2 } = await supabase
    .from("tasks").update({ assigned_to: primary ?? null }).eq("id", taskId);
  if (e2) throw e2;
  return toAdd.map(([u]) => u).filter((u) => !have.has(u));
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
