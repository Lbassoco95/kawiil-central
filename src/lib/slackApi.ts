import { FunctionsHttpError } from "@supabase/functions-js";
import { supabase } from "@/integrations/supabase/client";

/** Duración del toast cuando falta reautorizar Slack (OAuth & Permissions). */
export const SLACK_PERMISSION_TOAST_MS = 22_000;

/**
 * Errores típicos de permisos devueltos por slack-api (incluye `missing_scope — scopes requeridos: …`).
 */
export function isSlackPermissionDeniedMessage(message: string): boolean {
  const m = message || "";
  return (
    m.includes("missing_scope") ||
    m.includes("scopes requeridos") ||
    m.includes("invalid_scope") ||
    m.includes("not_allowed_token")
  );
}

export const SLACK_FILE_UPLOAD_PERMISSION_HINT =
  "Slack no permite subir archivos o audio con tu sesión actual. Un admin debe añadir en api.slack.com → tu app → OAuth & Permissions → User Token Scopes: files:write y files:read (y aceptar la app si pide revisión). Si en Supabase existe el secret SLACK_USER_SCOPES, debe incluir esos permisos o elimínalo. Después pulsa «Actualizar permisos Slack» en la barra lateral y vuelve a aceptar en Slack.";

export const SLACK_CHAT_API_PERMISSION_HINT =
  "Slack rechazó el envío o la programación del mensaje. Revisa en api.slack.com → tu app → OAuth & Permissions → User Token Scopes: al menos chat:write (y chat:write.public si escribes en canales donde no eres miembro). Para archivos y notas de voz hacen falta además files:write y files:read; para abrir DMs, im:write y mpim:write. Si en Supabase existe SLACK_USER_SCOPES, alinéalo o elimínalo. Luego pulsa «Actualizar permisos Slack» en Comunicación y acepta de nuevo en Slack.";

async function readInvokeFailureMessage(error: unknown): Promise<string | null> {
  const ctx = error instanceof FunctionsHttpError
    ? error.context
    : (error && typeof error === "object" && "context" in error
      ? (error as { context?: unknown }).context
      : undefined);
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
