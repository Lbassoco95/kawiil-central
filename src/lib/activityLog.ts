import { supabase } from "@/integrations/supabase/client";

export type EntityType = "client" | "project" | "task" | "document" | "accounting_period" | "annual_declaration";
export type ActionType = "created" | "updated" | "deleted" | "status_changed" | "assigned" | "file_uploaded" | "step_completed";

interface LogActivityParams {
  entityType: EntityType;
  entityId: string;
  action: ActionType;
  details?: Record<string, any>;
}

export async function logActivity({ entityType, entityId, action, details }: LogActivityParams) {
  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: orgId } = await supabase.rpc("get_user_org_id", { _user_id: user.id });
    if (!orgId) return;

    await supabase.from("activity_log").insert({
      entity_type: entityType,
      entity_id: entityId,
      action,
      user_id: user.id,
      organization_id: orgId,
      details: details || {},
    });
  } catch (err) {
    console.error("Error logging activity:", err);
  }
}
