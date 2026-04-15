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

export const SLACK_REACTIONS_PERMISSION_HINT =
  "Slack no pudo añadir o quitar la reacción. En api.slack.com → tu app → OAuth & Permissions → User Token Scopes añade reactions:write (y reactions:read si Slack lo pide). Si existe SLACK_USER_SCOPES en Supabase, inclúyelos ahí o elimina el secret. Después usa «Actualizar permisos Slack» en Comunicación.";

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

function isAbortLikeFunctionsError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const name = "name" in error && typeof (error as { name?: string }).name === "string"
    ? (error as { name: string }).name
    : "";
  const msg = "message" in error && typeof (error as { message?: string }).message === "string"
    ? String((error as { message: string }).message)
    : "";
  if (name === "AbortError") return true;
  const m = msg.toLowerCase();
  return m.includes("abort") || m.includes("timed out") || m.includes("timeout");
}

export type InvokeSlackApiOptions = {
  signal?: AbortSignal;
  /** Aborta el fetch si supera este tiempo (ms). Evita spinners eternos si la Edge o la red cuelgan. */
  timeoutMs?: number;
};

export async function invokeSlackApi<T = Record<string, unknown>>(
  body: Record<string, unknown>,
  opts?: InvokeSlackApiOptions,
): Promise<T> {
  const { data, error } = await supabase.functions.invoke("slack-api", {
    body,
    ...(opts?.signal ? { signal: opts.signal } : {}),
    ...(opts?.timeoutMs != null && opts.timeoutMs > 0 ? { timeout: opts.timeoutMs } : {}),
  });
  if (error) {
    if (isAbortLikeFunctionsError(error)) {
      throw new Error(
        "La petición a Slack tardó demasiado o se canceló. Comprueba tu red o vuelve a abrir el canal.",
      );
    }
    const parsed = await readInvokeFailureMessage(error);
    throw new Error(parsed || (error instanceof Error ? error.message : "Error al llamar a Slack"));
  }
  const d = data as { error?: string; message?: string } | null;
  if (d?.error === "slack_not_connected") {
    throw new Error(d.message || "Conecta Slack primero.");
  }
  return data as T;
}

function base64ToBlob(base64: string, contentType: string): Blob {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) {
    bytes[i] = bin.charCodeAt(i);
  }
  return new Blob([bytes], { type: contentType || "application/octet-stream" });
}

export async function markSlackConversationRead(channel: string, ts?: string): Promise<void> {
  const data = await invokeSlackApi<{ ok: boolean; error?: string }>({
    action: "conversations.mark",
    channel,
    ts,
  });
  if (!data.ok) throw new Error(data.error || "No se pudo marcar leído en Slack");
}

export type SlackUnreadSnapshotParams = {
  /** Canales a comprobar (máx. 24 en servidor). */
  channelIds: string[];
  /** Por canal: último ts visto en Kawiil (localStorage); sin entrada no se usa history para ese canal. */
  readState: Record<string, string>;
};

export async function fetchSlackUnreadSnapshot(params: SlackUnreadSnapshotParams): Promise<Record<string, number>> {
  const data = await invokeSlackApi<{
    ok: boolean;
    error?: string;
    unread_by_channel?: Record<string, number>;
  }>({
    action: "conversations.unread.snapshot",
    channel_ids: [...new Set(params.channelIds.map(String))].filter(Boolean).slice(0, 24),
    read_state: params.readState,
  });
  if (!data.ok) throw new Error(data.error || "No se pudo leer estado de no leídos de Slack");
  return data.unread_by_channel || {};
}

export async function fetchSlackPrivateFileBlob(url: string): Promise<Blob> {
  const data = await invokeSlackApi<{
    ok: boolean;
    error?: string;
    base64?: string;
    content_type?: string;
  }>({
    action: "files.fetch_private",
    url,
  });
  if (!data.ok || !data.base64) {
    throw new Error(data.error || "No se pudo recuperar el adjunto de Slack");
  }
  return base64ToBlob(data.base64, data.content_type || "application/octet-stream");
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

/**
 * `id` es el channel de Slack (`conversations.history`, etc.).
 * Prefijos habituales: `C…` canal público, `G…` canal privado o MPIM, `D…` DM 1:1.
 * MPIM y canal privado comparten forma `G…`; se distinguen por `is_mpim` / `is_im` en `conversations.list`.
 */
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
  url_private_download?: string;
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
