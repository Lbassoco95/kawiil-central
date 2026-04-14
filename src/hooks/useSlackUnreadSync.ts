import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchSlackUnreadSnapshot } from "@/lib/slackApi";
import { markSlackChannelNotificationsRead } from "@/hooks/useSlackChannelNotificationBadges";

type Params = {
  enabled: boolean;
  userId: string | undefined;
  selectedChannel: string;
  localUnreadByChannel: Record<string, number>;
};

/**
 * Reconciliación periódica Slack -> Kawiil:
 * - Si Slack ya no tiene no-leídos en un canal, limpia pendientes locales.
 * - Si Slack reporta no-leídos donde Kawiil no ve nada, fuerza refresh de queries.
 */
export function useSlackUnreadSync({
  enabled,
  userId,
  selectedChannel,
  localUnreadByChannel,
}: Params) {
  const qc = useQueryClient();
  const inFlightReadRef = useRef<Set<string>>(new Set());

  const unreadSnapshotQuery = useQuery({
    queryKey: ["slack-unread-snapshot", userId],
    queryFn: () => fetchSlackUnreadSnapshot(),
    enabled: enabled && !!userId,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
    refetchInterval: () => {
      if (typeof document === "undefined") return 30_000;
      return document.visibilityState === "visible" ? 15_000 : 60_000;
    },
  });

  useEffect(() => {
    if (!userId) return;
    const remote = unreadSnapshotQuery.data;
    if (!remote) return;

    for (const [channelId, localCount] of Object.entries(localUnreadByChannel)) {
      if (localCount <= 0) continue;
      const remoteCount = remote[channelId] ?? 0;
      if (remoteCount !== 0) continue;
      if (inFlightReadRef.current.has(channelId)) continue;

      inFlightReadRef.current.add(channelId);
      void markSlackChannelNotificationsRead(userId, channelId)
        .then(async () => {
          await qc.invalidateQueries({ queryKey: ["slack-channel-notification-badges", userId] });
          await qc.invalidateQueries({ queryKey: ["user-notifications", userId] });
          await qc.invalidateQueries({ queryKey: ["unread-notifications-count", userId] });
        })
        .finally(() => {
          inFlightReadRef.current.delete(channelId);
        });
    }

    if (!selectedChannel) return;
    const remoteCurrent = remote[selectedChannel] ?? 0;
    const localCurrent = localUnreadByChannel[selectedChannel] ?? 0;
    if (remoteCurrent > 0 && localCurrent === 0) {
      void qc.invalidateQueries({ queryKey: ["slack-history", selectedChannel] });
      void qc.invalidateQueries({ queryKey: ["slack-channel-notification-badges", userId] });
      void qc.invalidateQueries({ queryKey: ["user-notifications", userId] });
      void qc.invalidateQueries({ queryKey: ["unread-notifications-count", userId] });
    }
  }, [unreadSnapshotQuery.data, localUnreadByChannel, selectedChannel, userId, qc]);

  return unreadSnapshotQuery;
}
