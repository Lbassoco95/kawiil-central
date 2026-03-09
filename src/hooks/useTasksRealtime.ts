import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * Subscribes to realtime changes on tasks, projects, and project_comments tables
 * and invalidates all related queries so every user sees updates instantly.
 */
export function useTasksRealtime() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const channel = supabase
      .channel("global-realtime")
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tasks" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["tasks"] });
          queryClient.invalidateQueries({ queryKey: ["task"] });
          queryClient.invalidateQueries({ queryKey: ["assigned-steps"] });
          queryClient.invalidateQueries({ queryKey: ["project-tasks"] });
          queryClient.invalidateQueries({ queryKey: ["projects"] });
          queryClient.invalidateQueries({ queryKey: ["project"] });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "projects" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["projects"] });
          queryClient.invalidateQueries({ queryKey: ["project"] });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "project_comments" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["project-comments"] });
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "notifications" },
        () => {
          queryClient.invalidateQueries({ queryKey: ["user-notifications"] });
          queryClient.invalidateQueries({ queryKey: ["unread-notifications-count"] });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [queryClient]);
}
