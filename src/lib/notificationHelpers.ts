import { supabase } from "@/integrations/supabase/client";

interface NotificationItem {
  user_id: string;
  type: string;
  title: string;
  body?: string;
  entity_type: string;
  entity_id: string;
  source_user_id: string;
}

export async function createNotifications(items: NotificationItem[]) {
  if (items.length === 0) return;

  try {
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return;

    const { data: orgId } = await supabase.rpc("get_user_org_id", { _user_id: user.id });
    if (!orgId) return;

    // Filter out self-notifications
    const filtered = items.filter((i) => i.user_id !== user.id);
    if (filtered.length === 0) return;

    const rows = filtered.map((i) => ({
      user_id: i.user_id,
      type: i.type,
      title: i.title,
      body: i.body || null,
      entity_type: i.entity_type,
      entity_id: i.entity_id,
      source_user_id: i.source_user_id,
      organization_id: orgId,
    }));

    await supabase.from("notifications").insert(rows);
  } catch (err) {
    console.error("Error creating notifications:", err);
  }
}

/**
 * Get user IDs in finance/admin cells for the current org
 */
export async function getFinanceCelulaUserIds(): Promise<string[]> {
  try {
    const { data, error } = await supabase
      .from("user_celulas")
      .select("user_id, celulas!inner(slug)")
      .filter("celulas.slug", "in", '("finanzas","administracion")');

    if (error || !data) return [];
    return [...new Set(data.map((uc: any) => uc.user_id))];
  } catch {
    return [];
  }
}
