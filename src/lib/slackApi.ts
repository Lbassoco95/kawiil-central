import { FunctionsHttpError } from "@supabase/functions-js";
import { supabase } from "@/integrations/supabase/client";

async function readInvokeFailureMessage(error: unknown): Promise<string | null> {
  if (!(error instanceof FunctionsHttpError)) return null;
  const ctx = error.context;
  if (!(ctx instanceof Response)) return null;
  try {
    const j = (await ctx.clone().json()) as { error?: string; message?: string };
    return j.message || j.error || null;
  } catch {
    try {
      return await ctx.clone().text();
    } catch {
      return null;
    }
  }
}

export async function invokeSlackApi<T = Record<string, unknown>>(
  body: Record<string, unknown>,
): Promise<T> {
  const { data, error } = await supabase.functions.invoke("slack-api", { body });
  if (error) {
    const parsed = await readInvokeFailureMessage(error);
    throw new Error(parsed || error.message || "Error al llamar a Slack");
  }
  const d = data as { error?: string; message?: string } | null;
  if (d?.error === "slack_not_connected") {
    throw new Error(d.message || "Conecta Slack primero.");
  }
  return data as T;
}

/** Subida de archivo sin base64 (menor tamaño de petición, evita límites del gateway). */
export async function invokeSlackFileUpload(formData: FormData): Promise<Record<string, unknown>> {
  const { data, error } = await supabase.functions.invoke("slack-api", { body: formData });
  if (error) {
    const parsed = await readInvokeFailureMessage(error);
    throw new Error(parsed || error.message || "Error al subir el archivo");
  }
  const d = data as { error?: string; message?: string; ok?: boolean } | null;
  if (d?.error === "slack_not_connected") {
    throw new Error(d.message || "Conecta Slack primero.");
  }
  return (data || {}) as Record<string, unknown>;
}

export type SlackConversation = {
  id: string;
  name?: string;
  user?: string;
  is_im?: boolean;
  is_mpim?: boolean;
  is_private?: boolean;
};

export type SlackFile = {
  id?: string;
  name?: string;
  title?: string;
  mimetype?: string;
  filetype?: string;
  size?: number;
  url_private?: string;
  thumb_360?: string;
  thumb_80?: string;
  permalink?: string;
};

export type SlackReaction = {
  name: string;
  count: number;
  users?: string[];
};

export type SlackMessage = {
  ts: string;
  thread_ts?: string;
  user?: string;
  text?: string;
  bot_id?: string;
  subtype?: string;
  type?: string;
  reply_count?: number;
  reply_users_count?: number;
  reactions?: SlackReaction[];
  files?: SlackFile[];
  attachments?: Record<string, unknown>[];
  blocks?: unknown[];
};
