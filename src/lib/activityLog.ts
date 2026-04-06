import { supabase } from "@/integrations/supabase/client";

export type EntityActivityPayload = {
  entityType: string;
  entityId: string;
  action: string;
  details?: Record<string, unknown> | null;
};

/**
 * Registra navegación o acción en activity_log (entity_type = sección, action = verbo).
 */
export async function logActivity(
  userId: string,
  organizationId: string,
  section: string,
  action: string,
  metadata?: Record<string, unknown>,
): Promise<void> {
  const { error } = await supabase.from("activity_log").insert({
    user_id: userId,
    organization_id: organizationId,
    entity_type: section,
    entity_id: crypto.randomUUID(),
    action,
    details: metadata ?? null,
  });
  if (error) console.warn("[activity_log]", error.message);
}

/**
 * Registra una acción sobre una entidad concreta (tarea, cliente, documento).
 * entity_id debe ser el UUID real de la fila.
 */
export async function logEntityActivity(
  userId: string,
  organizationId: string,
  payload: EntityActivityPayload,
): Promise<void> {
  const { error } = await supabase.from("activity_log").insert({
    user_id: userId,
    organization_id: organizationId,
    entity_type: payload.entityType,
    entity_id: payload.entityId,
    action: payload.action,
    details: payload.details ?? null,
  });
  if (error) console.warn("[activity_log]", error.message);
}
