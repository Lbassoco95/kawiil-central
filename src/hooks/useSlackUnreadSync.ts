import { useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchSlackUnreadSnapshot } from "@/lib/slackApi";
import { loadSlackReadMap } from "@/lib/slackReadCursor";
import { markSlackChannelNotificationsRead } from "@/hooks/useSlackChannelNotificationBadges";

/** Firma estable por contenido (los refetch de React Query suelen devolver otro objeto con los mismos números). */
function unreadCountsSignature(m: Record<string, number>): string {
  if (!Object.keys(m).length) return "";
  return Object.entries(m)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([k, v]) => `${k}:${v}`)
    .join("|");
}

type Params = {
  enabled: boolean;
  userId: string | undefined;
  selectedChannel: string;
  localUnreadByChannel: Record<string, number>;
  /** Canales a consultar con history+read_state (p. ej. VIP + lista). */
  pollChannelIds: string[];
};

/**
 * Reconciliación periódica Slack -> Kawiil:
 * - Si Slack ya no tiene no-leídos en un canal, limpia pendientes locales.
 * - Si Slack reporta no-leídos donde Kawiil no ve nada, fuerza refresh de queries.
 *
 * Conteos por canal: conversations.history (oldest = cursor en localStorage) + merge con
 * conversaciones.list (DM con unread_count si Slack lo envía).
 */
export function useSlackUnreadSync({
  enabled,
  userId,
  selectedChannel,
  localUnreadByChannel,
  pollChannelIds,
}: Params) {
  const qc = useQueryClient();
  const inFlightReadRef = useRef<Set<string>>(new Set());

  const localUnreadSig = useMemo(
    () => unreadCountsSignature(localUnreadByChannel),
    [localUnreadByChannel],
  );

  const pollKey = pollChannelIds.length ? [...pollChannelIds].sort().join(",") : "";

  const unreadSnapshotQuery = useQuery({
    queryKey: ["slack-unread-snapshot", userId, pollKey],
    queryFn: async () => {
      if (!userId) return {};
      if (pollChannelIds.length === 0) return {};
      const readState = loadSlackReadMap(userId);
      return fetchSlackUnreadSnapshot({ channelIds: pollChannelIds, readState });
    },
    enabled: enabled && !!userId && pollChannelIds.length > 0,
    staleTime: 10_000,
    refetchOnWindowFocus: true,
    refetchInterval: () => {
      if (typeof document === "undefined") return 45_000;
      return document.visibilityState === "visible" ? 35_000 : 90_000;
    },
  });

  const remoteUnreadSig = useMemo(() => {
    const d = unreadSnapshotQuery.data;
    if (d === undefined) return "__pending__";
    return unreadCountsSignature(d);
  }, [unreadSnapshotQuery.data]);

  // Depende de firmas (contenido), no de nuevas referencias `{}` tras cada refetch.
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
  }, [localUnreadSig, remoteUnreadSig, selectedChannel, userId, qc]);

  return unreadSnapshotQuery;
}
