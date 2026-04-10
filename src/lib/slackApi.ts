import { supabase } from "@/integrations/supabase/client";

export async function invokeSlackApi<T = Record<string, unknown>>(
  body: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.functions.invoke("slack-api", { body });
  if (error) throw error;
  const d = data as { error?: string; message?: string } | null;
  if (d?.error === "slack_not_connected") {
    throw new Error(d.message || "Conecta Slack primero.");
  }
  return data as T;
}

export type SlackConversation = {
  id: string;
  name?: string;
  user?: string;
  is_im?: boolean;
  is_mpim?: boolean;
  is_private?: boolean;
};

export type SlackMessage = {
  ts: string;
  thread_ts?: string;
  user?: string;
  text?: string;
  bot_id?: string;
};
