import { supabase } from "@/integrations/supabase/client";
import { canRenameEntity } from "@/lib/kawiilerPermissions";

/**
 * Reglas de renombrado (nombre de proyecto / título de tarea).
 *
 * Solo un G4 (Kawiiler Transformador) o quien creó el registro puede cambiar
 * el nombre. Estas aserciones se ejecutan en los hooks de mutación
 * (`useUpdateProject`, `useUpdateTask`) para que la restricción se aplique sin
 * importar desde qué parte de la UI se dispare el cambio.
 */

/** Lee el grado/rol del usuario; por defecto "ejecutor" (igual que `useUserRole`). */
async function fetchUserRole(userId: string): Promise<string> {
  const { data, error } = await supabase
    .from("user_roles")
    .select("role")
    .eq("user_id", userId)
    .single();
  if (error || !data) return "ejecutor";
  return data.role;
}

export async function assertCanRenameProject(projectId: string, userId: string): Promise<void> {
  const { data } = await supabase
    .from("projects")
    .select("created_by")
    .eq("id", projectId)
    .single();
  const role = await fetchUserRole(userId);
  if (!canRenameEntity(role, data?.created_by ?? null, userId)) {
    throw new Error(
      "Solo un G4 (Transformador) o quien creó el proyecto puede cambiar su nombre.",
    );
  }
}

export async function assertCanRenameTask(taskId: string, userId: string): Promise<void> {
  const { data } = await supabase
    .from("tasks")
    .select("created_by")
    .eq("id", taskId)
    .single();
  const role = await fetchUserRole(userId);
  if (!canRenameEntity(role, data?.created_by ?? null, userId)) {
    throw new Error(
      "Solo un G4 (Transformador) o quien creó la tarea puede cambiar su nombre.",
    );
  }
}
