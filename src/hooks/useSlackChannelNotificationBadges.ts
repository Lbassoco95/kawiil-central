import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const SLACK_NOTIF_TYPES = ["slack_message", "slack_mention"] as const;

/**
 * Conteo de notificaciones Slack no leídas por channel_id (entity_id = channel|ts).
 *
 * No abre un segundo canal Realtime sobre `notifications` (evita CHANNEL_ERROR por
 * duplicar la suscripción de `useNotificationDelivery` + Comunicación). Las
 * invalidaciones en vivo vienen de ahí; aquí solo hay refetch periódico de respaldo.
 */
export function useSlackChannelNotificationBadges(userId: string | undefined) {
  const query = useQuery({
    queryKey: ["slack-channel-notification-badges", userId],
    queryFn: async (): Promise<Record<string, number>> => {
      if (!userId) return {};
      const { data, error } = await supabase
        .from("notifications")
        .select("entity_id")
        .eq("user_id", userId)
        .eq("entity_type", "slack")
        .eq("is_read", false)
        .in("type", [...SLACK_NOTIF_TYPES]);
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const row of data || []) {
        const eid = row.entity_id as string | null;
        if (!eid) continue;
        const pipe = eid.indexOf("|");
        const ch = pipe > 0 ? eid.slice(0, pipe) : eid;
        counts[ch] = (counts[ch] || 0) + 1;
      }
      return counts;
    },
    enabled: !!userId,
    staleTime: 15_000,
    refetchInterval: 90_000,
    refetchIntervalInBackground: false,
  });

  return query.data ?? {};
}

export async function markSlackChannelNotificationsRead(userId: string, channelId: string) {
  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("user_id", userId)
    .eq("entity_type", "slack")
    .in("type", [...SLACK_NOTIF_TYPES])
    .like("entity_id", `${channelId}|%`);
  if (error) throw error;
}
