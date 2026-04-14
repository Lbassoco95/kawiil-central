import { useEffect, useRef } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
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

const RT_ERROR_TOAST_COOLDOWN_MS = 60_000;

/**
 * Toasts (Sonner) + Notification API del sistema según perfil; pitido opcional.
 * Invalida historial Slack al insertar notificación de mensajería para refrescar Comunicación.
 *
 * Requiere que `public.notifications` esté en la publicación Realtime de Supabase
 * (migración `20260416190000_notifications_realtime_and_delivery_prefs.sql`) y URL de
 * eventos Slack + `SLACK_SIGNING_SECRET` para inserts vía `slack-events`.
 */
export function useNotificationDelivery() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const lastRtErrorToastAt = useRef(0);

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

          const isSlackMsg =
            row?.entity_type === "slack" &&
            (row?.type === "slack_message" || row?.type === "slack_mention");

          if (isSlackMsg) {
            qc.invalidateQueries({ queryKey: ["slack-channel-notification-badges", user.id] });
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

          const title = effectiveNotificationTitle(row);
          const allowToast = prefs?.in_app_toast_notifications !== false;
          const allowDesktop = prefs?.desktop_browser_notifications !== false;
          const globalSoundOn = prefs?.notification_sound_enabled === true;
          const slackSoundOn = prefs?.slack_message_sound_enabled !== false;

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

          const isSlackType = row?.type === "slack_message" || row?.type === "slack_mention";
          const useSlackSound = isSlackType && slackSoundOn;
          const useGlobalSound = !isSlackType && globalSoundOn;
          if (useSlackSound) {
            playNotificationBeep();
          } else if (surfaced && useGlobalSound) {
            playNotificationBeep();
          }
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
  }, [
    user?.id,
    qc,
    prefs?.desktop_browser_notifications,
    prefs?.in_app_toast_notifications,
    prefs?.notification_sound_enabled,
    prefs?.slack_message_sound_enabled,
  ]);
}
