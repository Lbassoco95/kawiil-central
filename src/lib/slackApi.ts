import { FunctionsHttpError } from "@supabase/functions-js";
import { supabase } from "@/integrations/supabase/client";

/** Duración del toast cuando falta reautorizar Slack (OAuth & Permissions). */
export const SLACK_PERMISSION_TOAST_MS = 22_000;

/** Mensaje legible cuando `conversations.history` devuelve `ok: false`. */
export function formatSlackHistoryLoadError(slackError: string | undefined): string {
  const e = (slackError || "").trim();
  const hints: Record<string, string> = {
    not_in_channel:
      "Slack indica que no estás en esta conversación (p. ej. grupo privado o canal). Ábrela en Slack o pulsa «Actualizar permisos Slack» en Comunicación.",
    channel_not_found: "Slack no encuentra este canal. Puede haberse eliminado o el id ya no es válido.",
    is_archived: "Esta conversación está archivada en Slack.",
    ratelimited: "Slack pidió esperar un momento por límite de uso. Vuelve a abrir el canal en unos segundos.",
    slack_timeout: "Slack tardó demasiado en responder. Vuelve a intentar o comprueba tu red.",
    slack_network_error: "No se pudo conectar con Slack. Comprueba tu red.",
    slack_http_429: "Slack devolvió demasiadas peticiones (429). Espera unos segundos y vuelve a intentar.",
    member_of_max_number_of_channels:
      "Slack indica que alcanzaste el máximo de canales en los que puedes estar. Sal de algunos en Slack y vuelve a intentar.",
    restricted_action: "Tu organización o Slack restringe esta acción en esta conversación.",
  };
  if (hints[e]) return hints[e];
  if (e.includes("missing_scope")) {
    return "Faltan permisos en la app de Slack. Pulsa «Actualizar permisos Slack» en Comunicación y acepta de nuevo.";
  }
  return e ? `No se pudo cargar el historial (${e}).` : "No se pudo cargar el historial.";
}

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

function sleepMsSlackApi(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** Cuerpo JSON de slack-api con ok:false por límite de Slack (a veces HTTP 200). */
function isSlackRateLimitPayload(d: unknown): boolean {
  if (!d || typeof d !== "object") return false;
  const o = d as { ok?: boolean; error?: string };
  if (o.ok !== false) return false;
  const e = String(o.error || "").toLowerCase();
  return e === "ratelimited" || e === "rate_limited" || e.includes("slack_http_429");
}

function retryAfterMsFromSlackPayload(d: unknown): number | null {
  if (!d || typeof d !== "object") return null;
  const o = d as { retry_after?: number };
  if (typeof o.retry_after === "number" && o.retry_after > 0) {
    return Math.min(60_000, (o.retry_after + 1) * 1000);
  }
  return null;
}

function isInvokeFailureRetryableRateLimit(message: string): boolean {
  const m = (message || "").toLowerCase();
  return (
    m.includes("429") ||
    m.includes("too many") ||
    m.includes("rate limit") ||
    m.includes("ratelimited")
  );
}

const MAX_SLACK_INVOKE_RATE_RETRIES = 2;

export type InvokeSlackApiOptions = {
  signal?: AbortSignal;
  /** Aborta el fetch si supera este tiempo (ms). Evita spinners eternos si la Edge o la red cuelgan. */
  timeoutMs?: number;
};

export async function invokeSlackApi<T = Record<string, unknown>>(
  body: Record<string, unknown>,
  opts?: InvokeSlackApiOptions,
): Promise<T> {
  const timeoutMs = opts?.timeoutMs ?? 0;
  const upstreamAbort = opts?.signal;

  for (let attempt = 0; attempt <= MAX_SLACK_INVOKE_RATE_RETRIES; attempt++) {
    const timeoutController = new AbortController();
    let timedOut = false;
    let timeoutId: ReturnType<typeof setTimeout> | null = null;
    const onUpstreamAbort = () => timeoutController.abort();
    if (upstreamAbort) {
      if (upstreamAbort.aborted) {
        timeoutController.abort();
      } else {
        upstreamAbort.addEventListener("abort", onUpstreamAbort, { once: true });
      }
    }
    if (timeoutMs > 0) {
      timeoutId = setTimeout(() => {
        timedOut = true;
        timeoutController.abort();
      }, timeoutMs);
    }

    let data: unknown;
    let error: unknown;
    try {
      const res = await supabase.functions.invoke("slack-api", {
        body,
        signal: timeoutController.signal,
      });
      data = res.data;
      error = res.error;
    } finally {
      if (timeoutId) clearTimeout(timeoutId);
      if (upstreamAbort && !upstreamAbort.aborted) {
        upstreamAbort.removeEventListener("abort", onUpstreamAbort);
      }
    }

    if (error) {
      if (isAbortLikeFunctionsError(error)) {
        if (timedOut) {
          throw new Error(
            "La petición a Slack tardó demasiado. Comprueba tu red o vuelve a abrir el canal.",
          );
        }
        if (upstreamAbort?.aborted) {
          throw new Error("La petición a Slack se canceló al cambiar de canal o recargar la vista.");
        }
        throw new Error("La petición a Slack se canceló. Vuelve a intentarlo.");
      }
      const parsed = await readInvokeFailureMessage(error);
      const msg = parsed || (error instanceof Error ? error.message : "Error al llamar a Slack");
      if (attempt < MAX_SLACK_INVOKE_RATE_RETRIES && isInvokeFailureRetryableRateLimit(msg)) {
        await sleepMsSlackApi(2000 * (attempt + 1));
        continue;
      }
      throw new Error(msg);
    }

    const d = data as { error?: string; message?: string } | null;
    if (d?.error === "slack_not_connected") {
      throw new Error(d.message || "Conecta Slack primero.");
    }
    if (isSlackRateLimitPayload(data) && attempt < MAX_SLACK_INVOKE_RATE_RETRIES) {
      const wait = retryAfterMsFromSlackPayload(data) ?? 2000 * (attempt + 1);
      await sleepMsSlackApi(wait);
      continue;
    }
    return data as T;
  }

  throw new Error("No se pudo completar la petición a Slack tras reintentos.");
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
  /** IDs Slack de los autores del hilo (máx. ~5 que devuelve Slack). */
  reply_users?: string[];
  /** ts del último reply del hilo, útil para mostrar "hace X". */
  latest_reply?: string;
  reactions?: SlackReaction[];
  files?: SlackFile[];
  attachments?: Record<string, unknown>[];
  blocks?: unknown[];
};
