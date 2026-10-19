import { useMemo } from "react";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/contexts/AuthContext";
import { useSlackConnection } from "@/hooks/useSlackConnection";
import { useSlackChannelNotificationBadges } from "@/hooks/useSlackChannelNotificationBadges";
import { useSlackUnreadSync } from "@/hooks/useSlackUnreadSync";

/** Igual criterio que SlackView: canales con badge, tope 18, priorizando mayor conteo. */
const SYNC_CHANNEL_CAP = 18;

/**
 * Reconciliación global Slack → Kawiil, fuera de la vista de Comunicación.
 *
 * `useSlackUnreadSync` (que limpia las notificaciones de Slack ya leídas en la app nativa,
 * usando el `unread_count_display` autoritativo de Slack) solo se monta dentro de SlackView.
 * Por eso, si el usuario estaba en Notificaciones o en cualquier otra página, leer en la app
 * oficial de Slack NO vaciaba su bandeja en Kawiil hasta que abría Comunicación: las menciones
 * y mensajes seguían apareciendo como no leídos.
 *
 * Este hook cubre ese hueco montándose en AppLayout (junto a useNotificationDelivery), de modo
 * que el estado de lectura se sincroniza en segundos sin importar en qué pantalla estés.
 *
 * Coste controlado:
 * - Solo consulta a slack-api cuando hay al menos una notificación de Slack sin leer; si la
 *   bandeja está limpia, `pollChannelIds` queda vacío y no se dispara ningún snapshot.
 * - Reutiliza la query `slack-channel-notification-badges` que ya corre global (AppSidebar) y
 *   comparte `queryKey` de snapshot con SlackView → React Query deduplica la llamada de red.
 * - En /comunicacion se desactiva para no duplicar el sync que ya hace SlackView.
 */
export function useGlobalSlackReadSync() {
  const { user } = useAuth();
  const { isConnected } = useSlackConnection();
  const { pathname } = useLocation();
  const unreadBadges = useSlackChannelNotificationBadges(user?.id);

  const onSlackView = pathname.startsWith("/comunicacion");

  const pollChannelIds = useMemo(
    () =>
      Object.entries(unreadBadges)
        .filter(([, n]) => n > 0)
        .sort(([, a], [, b]) => b - a)
        .slice(0, SYNC_CHANNEL_CAP)
        .map(([id]) => id),
    [unreadBadges],
  );

  useSlackUnreadSync({
    enabled: !!user?.id && isConnected && !onSlackView && pollChannelIds.length > 0,
    userId: user?.id,
    selectedChannel: "",
    localUnreadByChannel: unreadBadges,
    pollChannelIds,
  });
}
