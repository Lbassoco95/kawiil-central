import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

const SLACK_NOTIF_TYPES = ["slack_message", "slack_mention"] as const;

/** Misma referencia siempre: evita que `?? {}` dispare efectos en cada render (p. ej. useSlackUnreadSync). */
const EMPTY_SLACK_BADGE_COUNTS: Record<string, number> = Object.freeze({});

/**
 * Conteo de notificaciones Slack no leídas por channel_id.
 *
 * Slack guarda `channel|ts` (texto, no UUID) en `entity_ref`. La columna `entity_id`
 * es UUID y queda nula para notificaciones de Slack.
 */
export function useSlackChannelNotificationBadges(userId: string | undefined) {
  const query = useQuery({
    queryKey: ["slack-channel-notification-badges", userId],
    queryFn: async (): Promise<Record<string, number>> => {
      if (!userId) return {};
      const { data, error } = await supabase
        .from("notifications")
        .select("entity_ref")
        .eq("user_id", userId)
        .eq("entity_type", "slack")
        .eq("is_read", false)
        .not("entity_ref", "is", null)
        .in("type", [...SLACK_NOTIF_TYPES]);
      if (error) throw error;
      const counts: Record<string, number> = {};
      for (const row of (data || []) as Array<{ entity_ref: string | null }>) {
        const ref = row.entity_ref;
        if (!ref) continue;
        const pipe = ref.indexOf("|");
        const ch = pipe > 0 ? ref.slice(0, pipe) : ref;
        counts[ch] = (counts[ch] || 0) + 1;
      }
      return counts;
    },
    enabled: !!userId,
    staleTime: 15_000,
    refetchInterval: 90_000,
    refetchIntervalInBackground: false,
  });

  return query.data ?? EMPTY_SLACK_BADGE_COUNTS;
}

export async function markSlackChannelNotificationsRead(userId: string, channelId: string) {
  const { error } = await supabase
    .from("notifications")
    .update({ is_read: true })
    .eq("user_id", userId)
    .eq("entity_type", "slack")
    .in("type", [...SLACK_NOTIF_TYPES])
    .like("entity_ref", `${channelId}|%`);
  if (error) throw error;
}
