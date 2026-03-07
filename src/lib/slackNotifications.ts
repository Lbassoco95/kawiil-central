import { supabase } from "@/integrations/supabase/client";

type SlackEventType =
  | "client_created"
  | "task_created"
  | "task_updated"
  | "comment_mention"
  | "project_status_changed"
  | "deadline_created";

export async function sendSlackNotification(
  eventType: SlackEventType,
  data: Record<string, any>
) {
  try {
    const { data: result, error } = await supabase.functions.invoke(
      "slack-notify",
      {
        body: { event_type: eventType, data },
      }
    );

    if (error) {
      console.error("Slack notification error:", error);
    }

    return result;
  } catch (err) {
    // Silently fail - notifications shouldn't block operations
    console.error("Failed to send Slack notification:", err);
  }
}
