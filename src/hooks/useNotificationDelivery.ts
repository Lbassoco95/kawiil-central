import { useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

/**
 * Toasts (existentes) + Notification API del sistema cuando el perfil lo permite.
 */
export function useNotificationDelivery() {
  const { user } = useAuth();
  const qc = useQueryClient();

  const { data: prefs } = useQuery({
    queryKey: ["notification-delivery-prefs", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("profiles")
        .select("desktop_browser_notifications")
        .eq("user_id", user!.id)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!user?.id,
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
          const row = payload.new as { id?: string; title?: string; body?: string | null; type?: string };
          qc.invalidateQueries({ queryKey: ["user-notifications", user.id] });
          qc.invalidateQueries({ queryKey: ["unread-notifications-count", user.id] });
          if (row?.type === "slack_message" || row?.type === "slack_mention") {
            qc.invalidateQueries({ queryKey: ["slack-channel-notification-badges", user.id] });
          }
          if (row?.title) {
            toast.info(row.title, { description: row.body || undefined });
            const allowDesktop = prefs?.desktop_browser_notifications !== false;
            if (
              allowDesktop &&
              typeof Notification !== "undefined" &&
              Notification.permission === "granted"
            ) {
              try {
                const tag = row.id ? `kawiil-${row.id}` : `kawiil-${row.type || "notif"}-${Date.now()}`;
                new Notification(row.title, {
                  body: row.body || undefined,
                  tag,
                  silent: false,
                  requireInteraction: false,
                });
              } catch {
                /* ignore */
              }
            }
          }
        },
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user?.id, qc, prefs?.desktop_browser_notifications]);
}
