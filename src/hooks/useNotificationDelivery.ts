import { useEffect, useRef, useLayoutEffect, useCallback } from "react";
import { useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";
import { playNotificationBeep } from "@/lib/notificationBeep";

type NotifRow = {
  id?: string;
  title?: string;
  body?: string | null;
  type?: string;
  entity_type?: string;
  entity_id?: string | null;
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
    };
    if (labels[row.type]) return labels[row.type];
    return `Nueva notificación (${row.type})`;
  }
  return "Nueva notificación";
}

function slackChannelIdFromEntityId(entityId: string | null | undefined): string | null {
  if (!entityId) return null;
  const pipe = entityId.indexOf("|");
  return pipe > 0 ? entityId.slice(0, pipe) : null;
}

function invalidateSlackCachesFromNotifRow(qc: QueryClient, userId: string, row: NotifRow) {
  const isSlackMsg =
    row?.entity_type === "slack" &&
    (row?.type === "slack_message" || row?.type === "slack_mention");
  if (!isSlackMsg) return;
  qc.invalidateQueries({ queryKey: ["slack-channel-notification-badges", userId] });
  void qc.invalidateQueries({ queryKey: ["slack-unread-snapshot", userId] });
  const ch = slackChannelIdFromEntityId(row.entity_id ?? undefined);
  if (ch) {
    qc.invalidateQueries({ queryKey: ["slack-history", ch] });
    qc.invalidateQueries({
      predicate: (q) =>
        Array.isArray(q.queryKey) &&
        q.queryKey[0] === "slack-thread" &&
        q.queryKey[1] === ch,
    });
  }
}

const RT_ERROR_TOAST_COOLDOWN_MS = 60_000;
const SLACK_POLL_MS = 22_000;
const TOAST_DEDUPE_MS = 120_000;

type NotificationDeliveryPrefs = {
  desktop_browser_notifications?: boolean | null;
  in_app_toast_notifications?: boolean | null;
  notification_sound_enabled?: boolean | null;
  slack_message_sound_enabled?: boolean | null;
};

/**
 * Toasts (Sonner) + Notification API del sistema según perfil; pitido opcional.
 * Invalida historial Slack al insertar notificación de mensajería para refrescar Comunicación.
 *
 * Requiere que `public.notifications` esté en la publicación Realtime de Supabase
 * (migración `20260416190000_notifications_realtime_and_delivery_prefs.sql`) y URL de
 * eventos Slack + `SLACK_SIGNING_SECRET` para inserts vía `slack-events`.
 * Además hace polling ligero de las últimas filas para toasts si Realtime falla.
 * INSERT + UPDATE invalidan badges Slack (`useSlackChannelNotificationBadges`) sin un
 * canal Realtime adicional.
 */
function scheduleToastDedupe(id: string, dedupe: Set<string>) {
  dedupe.add(id);
  window.setTimeout(() => dedupe.delete(id), TOAST_DEDUPE_MS);
}

export function useNotificationDelivery() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const lastRtErrorToastAt = useRef(0);
  const prefsRef = useRef<NotificationDeliveryPrefs | undefined>(undefined);
  const toastDedupeIdsRef = useRef<Set<string>>(new Set());
  const pollCursorIsoRef = useRef<string | null>(null);

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

  const deliverNotificationRow = useCallback((row: NotifRow, _source: "realtime" | "poll") => {
    if (!user?.id || !row.id) return;
    if (toastDedupeIdsRef.current.has(row.id)) return;
    scheduleToastDedupe(row.id, toastDedupeIdsRef.current);

    const title = effectiveNotificationTitle(row);
    const p = prefsRef.current;
    const allowToast = p?.in_app_toast_notifications !== false;
    const allowDesktop = p?.desktop_browser_notifications !== false;
    const globalSoundOn = p?.notification_sound_enabled === true;
    const slackSoundOn = p?.slack_message_sound_enabled !== false;

    let surfaced = false;
    if (allowToast) {
      toast.info(title, {
        description: row.body?.trim() || undefined,
        duration: 6500,
        className:
          "!min-w-[min(100vw-1.5rem,20rem)] sm:!min-w-[22rem] !max-w-[min(100vw-1.5rem,26rem)] !shadow-xl !border-border/80",
      });
      surfaced = true;
    }
    if (
      allowDesktop &&
      typeof Notification !== "undefined" &&
      Notification.permission === "granted"
    ) {
      try {
        const tag = row.id ? `kawiil-${row.id}` : `kawiil-${row.type || "notif"}-${Date.now()}`;
        new Notification(title, {
          body: row.body?.trim() || undefined,
          tag,
          silent: false,
          requireInteraction: false,
        });
        surfaced = true;
      } catch {
        /* ignore */
      }
    }

    /** Menciones Slack: pitido siempre (independiente de `slack_message_sound_enabled`). */
    if (row?.type === "slack_mention") {
      playNotificationBeep();
    } else if (row?.type === "slack_message" && slackSoundOn) {
      playNotificationBeep();
    } else if (surfaced && globalSoundOn && row?.type !== "slack_message") {
      playNotificationBeep();
    }
  }, [user?.id]);

  /** Si Realtime falla, seguimos trayendo Slack (y el resto) por polling + toast deduplicado. */
  useEffect(() => {
    if (!user?.id) return;

    const tick = async () => {
      const { data, error } = await supabase
        .from("notifications")
        .select("id, type, entity_type, entity_id, title, body, created_at, is_read")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(15);
      if (error || !data?.length) return;

      if (pollCursorIsoRef.current === null) {
        pollCursorIsoRef.current = data[0].created_at as string;
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

  useEffect(() => {
    if (!user?.id) return;

    const channel = supabase
      .channel(`notifications-rt-${user.id}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `user_id=eq.${user.id}`,
        },
        (payload) => {
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
          const row = payload.new as NotifRow;
          qc.invalidateQueries({ queryKey: ["user-notifications", user.id] });
          qc.invalidateQueries({ queryKey: ["unread-notifications-count", user.id] });
          invalidateSlackCachesFromNotifRow(qc, user.id, row);
        },
      )
      .subscribe((status, err) => {
        if (status === "SUBSCRIBED") return;
        if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
          console.error("notifications realtime:", status, err);
          const now = Date.now();
          if (now - lastRtErrorToastAt.current > RT_ERROR_TOAST_COOLDOWN_MS) {
            lastRtErrorToastAt.current = now;
            toast.error("Avisos en vivo desconectados. Recarga la página si dejan de llegar notificaciones.", {
              duration: 8000,
            });
          }
        }
      });

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, qc, deliverNotificationRow]);
}
