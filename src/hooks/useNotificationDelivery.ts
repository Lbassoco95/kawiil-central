import { useEffect, useRef, useLayoutEffect, useCallback, createElement } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { playNotificationBeep } from "@/lib/notificationBeep";
import { asistenteChatDeepLinkFromNotification } from "@/lib/asistenteNotificationLink";
import { slackDeepLinkFromNotification } from "@/lib/slackDeepLink";
import {
  slackDesktopNotificationTagFromEntityRef,
  slackChannelAndMessageTsFromEntityRef,
  trackSlackDesktopNotification,
  closeSlackDesktopNotificationsForChannel,
  dismissSlackChannelSystemNotifications,
} from "@/lib/slackReadNotificationDismiss";
import {
  applyRemoteSlackReadBroadcast,
  ensureSlackReadBroadcastChannel,
  getSlackReadBroadcastDeviceId,
  SLACK_READ_BROADCAST_EVENT,
  teardownSlackReadBroadcastChannel,
  type SlackReadBroadcastPayload,
} from "@/lib/slackReadBroadcast";
import {
  markRealtimeEventReceived,
  setRealtimeStatusDown,
  setRealtimeStatusReconnecting,
  setRealtimeStatusSubscribed,
} from "@/lib/realtimeStatusStore";
import { SlackNotificationToast } from "@/components/notifications/SlackNotificationToast";

type NotifRow = {
  id?: string;
  title?: string;
  body?: string | null;
  type?: string;
  entity_type?: string;
  entity_id?: string | null;
  entity_ref?: string | null;
  is_read?: boolean | null;
};

function effectiveNotificationTitle(row: NotifRow): string {
  const t = row.title?.trim();
  if (t) return t;
  const b = row.body?.trim();
  if (b) return b.length > 80 ? `${b.slice(0, 80)}…` : b;
  if (row.type) {
    const labels: Record<string, string> = {
      slack_message: "Slack · Mensaje",
      slack_mention: "Slack · Te mencionaron",
      mention: "Te mencionaron",
      task_assigned: "Tarea asignada",
      task_reassigned: "Tarea reasignada",
      expense_created: "Nuevo gasto",
      expense_status_changed: "Gasto actualizado",
      knowledge_sync: "Conocimiento sincronizado",
      deadline_overdue_task: "Tarea vencida",
      deadline_due_tomorrow_task: "Tarea vence mañana",
      improvement_suggestion: "Sugerencia de mejora",
      ai_proactive_tip: "Sugerencia de IA",
      reminders_hourly_digest: "Recordatorios pendientes",
      reminders_daily_digest: "Recordatorios (resumen diario)",
      agent_task_completed: "Asistente · Tarea de agente completada",
      agent_task_failed: "Asistente · Tarea de agente con error",
    };
    if (labels[row.type]) return labels[row.type];
    return `Nueva notificación (${row.type})`;
  }
  return "Nueva notificación";
}

function isSlackInAppNotification(row: NotifRow): boolean {
  return (
    row?.entity_type === "slack" &&
    (row?.type === "slack_message" || row?.type === "slack_mention")
  );
}

function invalidateSlackCachesFromNotifRow(qc: QueryClient, userId: string, row: NotifRow) {
  if (!isSlackInAppNotification(row)) return;
  qc.invalidateQueries({ queryKey: ["slack-channel-notification-badges", userId] });
  void qc.invalidateQueries({ queryKey: ["slack-unread-snapshot", userId] });
  // No invalidar `slack-history` / `slack-thread` desde notificaciones: INSERT/UPDATE en ráfaga
  // cancelaba el fetch inicial (p. ej. MPIM con muchos avisos). El historial se refresca en
  // Comunicación con `refetchInterval` y las mutaciones al enviar/reaccionar.
}

const SLACK_POLL_MS = 22_000;
const TOAST_DEDUPE_MS = 120_000;
/** Health-check: si Realtime no está SUBSCRIBED y la pestaña está visible, forzar refetch. */
const RT_HEALTH_CHECK_MS = 60_000;
/** Ventana en que, al montar el hook, seguimos considerando "en vivo" una fila no leída. */
const FIRST_TICK_CATCHUP_MS = 30_000;
/** Backoff exponencial para reintentar la suscripción Realtime. */
const RT_RECONNECT_BACKOFF_MS = [1_000, 2_000, 5_000, 10_000, 30_000];

type NotificationDeliveryPrefs = {
  desktop_browser_notifications?: boolean | null;
  in_app_toast_notifications?: boolean | null;
  notification_sound_enabled?: boolean | null;
  slack_message_sound_enabled?: boolean | null;
};

function isMandatoryMention(row: NotifRow): boolean {
  return row.type === "mention" || row.type === "slack_mention";
}

/**
 * DMs de Slack: tratamos como semi-obligatorios para que siempre abran toast + notificación
 * de escritorio aunque el usuario apague otros toggles genéricos. El beep sigue respetando
 * `slack_message_sound_enabled`.
 */
function isMandatorySlackDirect(row: NotifRow): boolean {
  if (row.type !== "slack_message") return false;
  if (row.entity_type !== "slack") return false;
  const t = row.title?.trim() ?? "";
  return t.startsWith("Slack · Mensaje directo") || t.startsWith("Slack · Grupo privado");
}

/**
 * Toasts (Sonner) + Notification API del sistema según perfil; pitido opcional.
 * Invalida historial Slack al insertar notificación de mensajería para refrescar Comunicación.
 *
 * Requiere que `public.notifications` esté en la publicación Realtime de Supabase
 * (migración `20260416190000_notifications_realtime_and_delivery_prefs.sql`) y URL de
 * eventos Slack + `SLACK_SIGNING_SECRET` para inserts vía `slack-events`.
 * Además hace polling ligero de las últimas filas para toasts si Realtime falla.
 * INSERT invalida también historial/hilos Slack; UPDATE solo badges/snapshot (evita bucles al marcar leídas).
 */
function scheduleToastDedupe(id: string, dedupe: Set<string>) {
  dedupe.add(id);
  window.setTimeout(() => dedupe.delete(id), TOAST_DEDUPE_MS);
}

export function useNotificationDelivery() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const prefsRef = useRef<NotificationDeliveryPrefs | undefined>(undefined);
  const toastDedupeIdsRef = useRef<Set<string>>(new Set());
  const pollCursorIsoRef = useRef<string | null>(null);
  const rtSubscribedRef = useRef(false);

  const { data: prefs } = useQuery({
    queryKey: ["notification-delivery-prefs", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select(
          "desktop_browser_notifications, in_app_toast_notifications, notification_sound_enabled, slack_message_sound_enabled",
        )
        .eq("user_id", user!.id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!user?.id,
    refetchOnWindowFocus: true,
  });

  useLayoutEffect(() => {
    prefsRef.current = prefs;
  }, [prefs]);

  const deliverNotificationRow = useCallback((row: NotifRow, source: "realtime" | "poll" | "poll-catchup") => {
    if (!user?.id || !row.id) return;
    if (toastDedupeIdsRef.current.has(row.id)) return;
    scheduleToastDedupe(row.id, toastDedupeIdsRef.current);

    const title = effectiveNotificationTitle(row);
    const p = prefsRef.current;
    const mandatoryMention = isMandatoryMention(row);
    const mandatoryDm = isMandatorySlackDirect(row);
    const mandatorySurface = mandatoryMention || mandatoryDm;
    const allowToast = mandatorySurface || p?.in_app_toast_notifications !== false;
    const allowDesktop = mandatorySurface || p?.desktop_browser_notifications !== false;
    const globalSoundOn = p?.notification_sound_enabled === true;
    const slackSoundOn = p?.slack_message_sound_enabled !== false;

    console.debug("[notif] deliver", {
      id: row.id,
      type: row.type,
      entity_type: row.entity_type,
      source,
      mandatoryMention,
      mandatoryDm,
      allowToast,
      allowDesktop,
    });

    const deepLink =
      slackDeepLinkFromNotification({
        entity_type: row.entity_type,
        entity_ref: row.entity_ref,
        entity_id: row.entity_id,
        type: row.type,
      }) || asistenteChatDeepLinkFromNotification(row);
    const bodyText = row.body?.trim() || "";

    let surfaced = false;
    if (allowToast) {
      if (isSlackInAppNotification(row)) {
        toast.custom(
          (toastId) =>
            createElement(SlackNotificationToast, {
              toastId,
              row,
              title,
              bodyText,
              navigate,
            }),
          {
            duration: mandatorySurface ? 9000 : 6500,
          },
        );
      } else {
        toast.custom(
          (toastId) =>
            createElement(
              "button",
              {
                type: "button",
                onClick: () => {
                  if (deepLink) {
                    navigate(deepLink);
                  }
                  toast.dismiss(toastId);
                },
                className:
                  "group flex w-full min-w-[min(100vw-1.5rem,20rem)] sm:min-w-[22rem] max-w-[min(100vw-1.5rem,26rem)] " +
                  "cursor-pointer items-start gap-3 rounded-lg border border-border/80 bg-popover p-3 text-left " +
                  "shadow-xl transition hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring",
              },
              createElement(
                "div",
                { className: "min-w-0 flex-1" },
                createElement(
                  "p",
                  { className: "truncate text-sm font-semibold text-foreground" },
                  title,
                ),
                bodyText
                  ? createElement(
                      "p",
                      {
                        className:
                          "mt-0.5 whitespace-pre-line text-xs text-muted-foreground line-clamp-3",
                      },
                      bodyText,
                    )
                  : null,
              ),
            ),
          {
            duration: mandatorySurface ? 9000 : 6500,
          },
        );
      }
      surfaced = true;
    }
    if (
      allowDesktop &&
      typeof Notification !== "undefined" &&
      Notification.permission === "granted"
    ) {
      try {
        const slackTag = isSlackInAppNotification(row)
          ? slackDesktopNotificationTagFromEntityRef(row.entity_ref)
          : null;
        const tag =
          slackTag ??
          (row.id ? `kawiil-${row.id}` : `kawiil-${row.type || "notif"}-${Date.now()}`);
        const n = new Notification(title, {
          body: row.body?.trim() || undefined,
          tag,
          silent: false,
          // DMs y menciones son "semi-mandatory": banner sticky hasta que se atienda,
          // igual que en el Service Worker (public/sw.js).
          requireInteraction: mandatorySurface,
          data: deepLink ? { url: deepLink } : undefined,
        });
        const slackCh = slackChannelAndMessageTsFromEntityRef(row.entity_ref);
        if (slackCh) trackSlackDesktopNotification(slackCh.channelId, n);
        n.onclick = () => {
          try {
            window.focus();
            if (deepLink) {
              window.location.href = deepLink;
            }
          } finally {
            n.close();
          }
        };
        surfaced = true;
      } catch (err) {
        console.warn("[notif] desktop Notification error", err);
      }
    } else if (allowDesktop && typeof Notification !== "undefined" && Notification.permission !== "granted") {
      console.debug("[notif] desktop skipped", { permission: Notification.permission });
    }

    /** Menciones y DMs obligatorios: pitido siempre, aunque el usuario desactive otros avisos. */
    if (mandatorySurface) {
      playNotificationBeep();
    } else if (row?.type === "slack_message" && slackSoundOn) {
      playNotificationBeep();
    } else if (surfaced && globalSoundOn && row?.type !== "slack_message") {
      playNotificationBeep();
    }
  }, [user?.id, navigate]);

  /** Si Realtime falla, seguimos trayendo Slack (y el resto) por polling + toast deduplicado. */
  useEffect(() => {
    if (!user?.id) return;

    const tick = async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("id, type, entity_type, entity_id, entity_ref, title, body, created_at, is_read")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(15);
      if (error || !data?.length) return;

      const newestTs = data[0].created_at as string;

      if (pollCursorIsoRef.current === null) {
        // Primer tick: entregar filas no leídas creadas en la ventana de catch-up por si Realtime no
        // estaba listo cuando cayeron. Deduplicación por `toastDedupeIdsRef` evita doble toast si
        // Realtime también las entrega después.
        const cutoffIso = new Date(Date.now() - FIRST_TICK_CATCHUP_MS).toISOString();
        const recent = [...data].reverse().filter((r) => (r.created_at as string) >= cutoffIso);
        let delivered = 0;
        for (const row of recent) {
          if (row.is_read) continue;
          deliverNotificationRow(row as NotifRow, "poll-catchup");
          invalidateSlackCachesFromNotifRow(qc, user.id, row as NotifRow);
          delivered += 1;
        }
        if (delivered > 0) {
          console.debug("[notif] poll catch-up delivered", { count: delivered });
          qc.invalidateQueries({ queryKey: ["user-notifications", user.id] });
          qc.invalidateQueries({ queryKey: ["unread-notifications-count", user.id] });
        }
        pollCursorIsoRef.current = newestTs;
        return;
      }

      const cursor = pollCursorIsoRef.current;
      const newer = [...data].reverse().filter((r) => (r.created_at as string) > cursor);
      let maxTs = cursor;
      for (const row of newer) {
        const ts = row.created_at as string;
        if (ts > maxTs) maxTs = ts;
        if (row.is_read) continue;
        deliverNotificationRow(row as NotifRow, "poll");
        invalidateSlackCachesFromNotifRow(qc, user.id, row as NotifRow);
      }
      pollCursorIsoRef.current = maxTs;
      if (newer.length) {
        qc.invalidateQueries({ queryKey: ["user-notifications", user.id] });
        qc.invalidateQueries({ queryKey: ["unread-notifications-count", user.id] });
      }
    };

    const id = window.setInterval(() => void tick(), SLACK_POLL_MS);
    void tick();
    return () => {
      window.clearInterval(id);
      pollCursorIsoRef.current = null;
    };
  }, [user?.id, qc, deliverNotificationRow]);

  /**
   * Mensajes del Service Worker (`sw.js`) cuando el usuario hace click en una push del SO.
   * Forzamos invalidación inmediata de queries Slack para que el badge desaparezca antes
   * incluso del próximo refetch automático.
   */
  useEffect(() => {
    if (!user?.id) return;
    if (typeof navigator === "undefined" || !("serviceWorker" in navigator)) return;
    const handler = (event: MessageEvent) => {
      const d = event?.data;
      if (!d || typeof d !== "object") return;
      if (d.type !== "KAWIIL_INVALIDATE_SLACK_UNREAD") return;
      qc.invalidateQueries({ queryKey: ["slack-channel-notification-badges", user.id] });
      void qc.invalidateQueries({ queryKey: ["slack-unread-snapshot", user.id] });
      void qc.invalidateQueries({ queryKey: ["user-notifications", user.id] });
      void qc.invalidateQueries({ queryKey: ["unread-notifications-count", user.id] });
    };
    navigator.serviceWorker.addEventListener("message", handler);
    return () => navigator.serviceWorker.removeEventListener("message", handler);
  }, [user?.id, qc]);

  /**
   * Suscripción al broadcast `slack-read` propio del usuario. Cuando el usuario lee en
   * cualquiera de sus dispositivos, los demás reciben el evento e invalidan badges/snapshot
   * sin esperar al polling. Ignoramos broadcasts emitidos por este mismo dispositivo
   * (filtro por `payload.source` vs `getSlackReadBroadcastDeviceId()`).
   */
  useEffect(() => {
    if (!user?.id) return;
    const userId = user.id;
    const myDeviceId = getSlackReadBroadcastDeviceId();
    const ch = ensureSlackReadBroadcastChannel(userId);
    const handler = (msg: { payload?: unknown }) => {
      const payload = msg?.payload as SlackReadBroadcastPayload | undefined;
      if (!payload || typeof payload !== "object") return;
      if (!payload.channelId) return;
      if (payload.source === myDeviceId) return;
      console.debug("[slack-read-broadcast] aplicar remoto", {
        channelId: payload.channelId,
        from: payload.source,
      });
      applyRemoteSlackReadBroadcast(userId, payload);
      closeSlackDesktopNotificationsForChannel(payload.channelId);
      dismissSlackChannelSystemNotifications(payload.channelId);
      qc.invalidateQueries({ queryKey: ["slack-channel-notification-badges", userId] });
      void qc.invalidateQueries({ queryKey: ["slack-unread-snapshot", userId] });
      void qc.invalidateQueries({ queryKey: ["user-notifications", userId] });
      void qc.invalidateQueries({ queryKey: ["unread-notifications-count", userId] });
    };
    ch.on("broadcast", { event: SLACK_READ_BROADCAST_EVENT }, handler);
    return () => {
      // No teardown agresivo aquí: el canal puede compartirse con el helper que emite.
      // Removemos solo el listener de este efecto evitando colisiones al desmontar el hook.
      teardownSlackReadBroadcastChannel(userId);
    };
  }, [user?.id, qc]);

  useEffect(() => {
    if (!user?.id) return;

    const channelTopic = `notifications-rt-${user.id}`;
    let cancelled = false;
    let attempt = 0;
    let retryTimerId: number | null = null;
    let activeChannel: ReturnType<typeof supabase.channel> | null = null;

    const scheduleReconnect = (reason: string) => {
      if (cancelled) return;
      const delay = RT_RECONNECT_BACKOFF_MS[Math.min(attempt, RT_RECONNECT_BACKOFF_MS.length - 1)];
      attempt += 1;
      console.warn("[notif] realtime reconnect scheduled", { reason, delayMs: delay, attempt });
      // A partir del 3er reintento sin éxito asumimos caída prolongada y reportamos `down` al store.
      if (attempt >= 3) {
        setRealtimeStatusDown(reason);
      } else {
        setRealtimeStatusReconnecting(reason);
      }
      if (retryTimerId !== null) {
        window.clearTimeout(retryTimerId);
      }
      retryTimerId = window.setTimeout(() => {
        retryTimerId = null;
        connect();
      }, delay);
    };

    const connect = () => {
      if (cancelled) return;

      // Evita colisiones "already joined" si el layout se monta dos veces o reconectamos.
      for (const existing of supabase.getChannels()) {
        if (existing.topic === channelTopic) {
          supabase.removeChannel(existing);
        }
      }

      const channel = supabase
        .channel(channelTopic)
        .on(
          "postgres_changes",
          {
            event: "INSERT",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            markRealtimeEventReceived();
            const row = payload.new as NotifRow;
            qc.invalidateQueries({ queryKey: ["user-notifications", user.id] });
            qc.invalidateQueries({ queryKey: ["unread-notifications-count", user.id] });
            invalidateSlackCachesFromNotifRow(qc, user.id, row);
            deliverNotificationRow(row, "realtime");
          },
        )
        .on(
          "postgres_changes",
          {
            event: "UPDATE",
            schema: "public",
            table: "notifications",
            filter: `user_id=eq.${user.id}`,
          },
          (payload) => {
            markRealtimeEventReceived();
            const row = payload.new as NotifRow;
            qc.invalidateQueries({ queryKey: ["user-notifications", user.id] });
            qc.invalidateQueries({ queryKey: ["unread-notifications-count", user.id] });
            invalidateSlackCachesFromNotifRow(qc, user.id, row);
          },
        )
        .subscribe((status, err) => {
          if (cancelled) return;
          if (status === "SUBSCRIBED") {
            console.debug("[notif] realtime SUBSCRIBED", channelTopic);
            attempt = 0;
            rtSubscribedRef.current = true;
            setRealtimeStatusSubscribed();
            return;
          }
          if (status === "CHANNEL_ERROR" || status === "TIMED_OUT" || status === "CLOSED") {
            console.error("notifications realtime:", status, err);
            rtSubscribedRef.current = false;
            setRealtimeStatusReconnecting(status);
            // Limpia este canal y programa reintento con backoff.
            try {
              supabase.removeChannel(channel);
            } catch {
              /* ignore */
            }
            if (activeChannel === channel) activeChannel = null;
            scheduleReconnect(status);
          }
        });

      activeChannel = channel;
    };

    connect();

    return () => {
      cancelled = true;
      if (retryTimerId !== null) {
        window.clearTimeout(retryTimerId);
        retryTimerId = null;
      }
      if (activeChannel) {
        supabase.removeChannel(activeChannel);
        activeChannel = null;
      }
    };
  }, [user?.id, qc, deliverNotificationRow]);

  /**
   * Health-check Realtime: si la suscripción no está SUBSCRIBED y la pestaña está visible,
   * forzamos refetch de las queries clave cada `RT_HEALTH_CHECK_MS` para que el sidebar
   * no quede ciego mientras se reconecta. El polling de 22 s ya cubre `notifications` per se;
   * este hook agrega cobertura para badges Slack y snapshot de unread.
   */
  useEffect(() => {
    if (!user?.id) return;
    const userId = user.id;
    const id = window.setInterval(() => {
      if (rtSubscribedRef.current) return;
      if (typeof document !== "undefined" && document.visibilityState !== "visible") return;
      console.debug("[notif] realtime health-check refetch (RT no SUBSCRIBED, pestaña visible)");
      void qc.invalidateQueries({ queryKey: ["slack-channel-notification-badges", userId] });
      void qc.invalidateQueries({ queryKey: ["slack-unread-snapshot", userId] });
      void qc.invalidateQueries({ queryKey: ["user-notifications", userId] });
      void qc.invalidateQueries({ queryKey: ["unread-notifications-count", userId] });
    }, RT_HEALTH_CHECK_MS);
    return () => window.clearInterval(id);
  }, [user?.id, qc]);
}
