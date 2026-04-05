import { supabase } from "@/integrations/supabase/client";

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
