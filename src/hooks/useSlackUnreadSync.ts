import { useEffect, useMemo, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { fetchSlackUnreadSnapshot } from "@/lib/slackApi";
import { loadSlackReadMap } from "@/lib/slackReadCursor";
import { markSlackChannelNotificationsRead } from "@/hooks/useSlackChannelNotificationBadges";

/** Throttle entre invalidaciones por `visibilitychange` para no machacar slack-api al alternar pestañas. */
const VISIBILITY_REFETCH_THROTTLE_MS = 10_000;

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
  /** Pausa el snapshot mientras carga el historial del canal (evita ráfaga concurrente a slack-api). */
  holdUnreadSnapshot?: boolean;
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
  holdUnreadSnapshot = false,
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
    enabled: enabled && !!userId && pollChannelIds.length > 0 && !holdUnreadSnapshot,
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    refetchInterval: () => {
      if (typeof document === "undefined") return 180_000;
      return document.visibilityState === "visible" ? 30_000 : 180_000;
    },
  });

  /**
   * `visibilitychange`: si el usuario vuelve a la pestaña, forzar invalidación con throttle.
   * Cubre el caso en que leyó en Slack oficial mientras Kawiil estaba en background; al volver,
   * los badges deben actualizarse cuanto antes sin esperar al refetchInterval (30 s).
   */
  useEffect(() => {
    if (!enabled || !userId) return;
    if (typeof document === "undefined") return;
    let lastInvalidatedAt = 0;
    const handler = () => {
      if (document.visibilityState !== "visible") return;
      const now = Date.now();
      if (now - lastInvalidatedAt < VISIBILITY_REFETCH_THROTTLE_MS) return;
      lastInvalidatedAt = now;
      void qc.invalidateQueries({ queryKey: ["slack-unread-snapshot", userId] });
      void qc.invalidateQueries({ queryKey: ["slack-channel-notification-badges", userId] });
    };
    document.addEventListener("visibilitychange", handler);
    return () => document.removeEventListener("visibilitychange", handler);
  }, [enabled, userId, qc]);

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

    const toMark: string[] = [];
    for (const ch of pollChannelIds) {
      const localCount = localUnreadByChannel[ch] ?? 0;
      const remoteCount = remote[ch] ?? 0;
      if (localCount > 0 && remoteCount === 0 && !inFlightReadRef.current.has(ch)) {
        toMark.push(ch);
      }
    }

    if (toMark.length > 0) {
      for (const ch of toMark) inFlightReadRef.current.add(ch);
      void Promise.all(toMark.map((ch) => markSlackChannelNotificationsRead(userId, ch)))
        .then(async () => {
          for (const ch of toMark) {
            void qc.invalidateQueries({ queryKey: ["slack-channel-info", ch] });
          }
          await qc.invalidateQueries({ queryKey: ["slack-channel-notification-badges", userId] });
          await qc.invalidateQueries({ queryKey: ["user-notifications", userId] });
          await qc.invalidateQueries({ queryKey: ["unread-notifications-count", userId] });
        })
        .catch((err) => {
          console.warn("[slack-unread-sync] markRead falló (silenciado):", err);
        })
        .finally(() => {
          for (const ch of toMark) inFlightReadRef.current.delete(ch);
        });
    }

    if (selectedChannel) {
      const remoteCurrent = remote[selectedChannel] ?? 0;
      const localCurrent = localUnreadByChannel[selectedChannel] ?? 0;
      if (remoteCurrent > 0 && localCurrent === 0) {
        // No invalidar `slack-history` del canal abierto: el snapshot de no leídos puede dispararse en bucle
        // (remoto > 0, badges locales aún 0) y cada invalidación cancela/refetch del historial → spinner perpetuo.
        void qc.invalidateQueries({ queryKey: ["slack-channel-info", selectedChannel] });
        void qc.invalidateQueries({ queryKey: ["slack-channel-notification-badges", userId] });
        void qc.invalidateQueries({ queryKey: ["user-notifications", userId] });
        void qc.invalidateQueries({ queryKey: ["unread-notifications-count", userId] });
      }
    }
    // `localUnreadByChannel`: solo nos importan cambios de conteos → `localUnreadSig`.
    // eslint-disable-next-line react-hooks/exhaustive-deps -- firmas arriba cubren maps por contenido
  }, [localUnreadSig, remoteUnreadSig, pollKey, selectedChannel, userId, qc, pollChannelIds]);

  return unreadSnapshotQuery;
}
