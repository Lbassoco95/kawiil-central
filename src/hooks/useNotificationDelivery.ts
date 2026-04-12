import { useEffect } from "react";
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
    };
    if (labels[row.type]) return labels[row.type];
    return `Nueva notificación (${row.type})`;
  }
  return "Nueva notificación";
}

/**
 * Toasts (Sonner) + Notification API del sistema según perfil; pitido opcional.
 */
export function useNotificationDelivery() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: prefs } = useQuery({
    queryKey: ["notification-delivery-prefs", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("desktop_browser_notifications, in_app_toast_notifications, notification_sound_enabled")
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
          if (row?.type === "slack_message" || row?.type === "slack_mention") {
            qc.invalidateQueries({ queryKey: ["slack-channel-notification-badges", user.id] });
          }

          const title = effectiveNotificationTitle(row);
          const allowToast = prefs?.in_app_toast_notifications !== false;
          const allowDesktop = prefs?.desktop_browser_notifications !== false;
          const soundOn = prefs?.notification_sound_enabled === true;

          let surfaced = false;
          if (allowToast) {
            toast.info(title, { description: row.body?.trim() || undefined });
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
          if (soundOn && surfaced) {
            playNotificationBeep();
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [
    user?.id,
    qc,
    prefs?.desktop_browser_notifications,
    prefs?.in_app_toast_notifications,
    prefs?.notification_sound_enabled,
  ]);
}
