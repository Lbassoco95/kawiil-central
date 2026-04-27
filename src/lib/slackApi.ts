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

/**
 * Extrae texto de error de respuestas `slack-api` / Slack (`error`, `message`, `response_metadata.messages`).
 */
export function extractSlackInvokeError(data: unknown): string {
  if (data == null || typeof data !== "object") return "";
  const o = data as Record<string, unknown>;
  const errRaw = o.error;
  let base = "";
  if (typeof errRaw === "string" && errRaw.trim()) base = errRaw.trim();
  else if (Array.isArray(errRaw)) {
    const j = errRaw.map((x) => String(x)).filter(Boolean).join(", ");
    if (j) base = j;
  } else if (errRaw != null && typeof errRaw !== "object") base = String(errRaw);
  if (!base && typeof o.message === "string" && o.message.trim()) base = o.message.trim();

  let detail = "";
  const meta = o.response_metadata;
  if (meta && typeof meta === "object" && !Array.isArray(meta)) {
    const messages = (meta as { messages?: unknown }).messages;
    if (Array.isArray(messages) && messages[0] != null) {
      const m0 = messages[0];
      if (typeof m0 === "string" && m0.trim()) detail = m0.trim();
    }
  }
  if (detail) {
    if (!base) return detail;
    if (base === "invalid_arguments") return `${base}: ${detail}`;
    return `${base} — ${detail}`;
  }
  return base;
}

/**
 * Convierte códigos de Slack (envío, edición, borrado) en mensaje legible en español para toasts.
 */
export function formatSlackChatWriteError(raw: string): string {
  const t = (raw || "").trim();
  if (!t) {
    return "No se pudo completar la acción en Slack. Vuelve a intentar o comprueba en el cliente de Slack.";
  }
  if (t === "unknown_action") {
    return "La app usó una acción de Slack no reconocida. Despliega la edge «slack-api» en Supabase o pide a soporte, y vuelve a cargar Comunicación.";
  }
  if (t === "unknown" || t === "unknown_error" || t === "internal_error" || t === "fatal_error") {
    return "Slack no describió el fallo. Reintenta; si pasa, prueba en la app de Slack o revisa la conexión en Comunicación.";
  }
  const map: Record<string, string> = {
    not_in_channel:
      "Slack indica que no estás en esta conversación. Ábrela en Slack o «Actualizar permisos» en Comunicación.",
    channel_not_found: "Slack no encontró el canal. Puede haberse archivado o el id dejó de ser válido.",
    message_not_found: "Slack no encontró el mensaje. Recarga el canal o el hilo e inténtalo de nuevo.",
    cant_update_message: "Slack no permite editar este mensaje (permisos, ventana de edición o mensaje de otra app).",
    cant_delete_message: "Slack no permite borrar este mensaje (permisos, mensaje de otra app o hilo restringido).",
    is_archived: "Esta conversación está archivada en Slack.",
    edit_window_closed: "En tu espacio de Slack el tiempo de edición del mensaje ya no permite cambios.",
    no_text: "Falta el texto del mensaje que Slack acepta para esta acción.",
    msg_too_long: "El texto supera el límite de Slack. Acórtalo e inténtalo otra vez.",
    rate_limited: "Slack pidió limitar el ritmo. Espera unos segundos y vuelve a intentar.",
    ratelimited: "Slack pidió limitar el ritmo. Espera unos segundos y vuelve a intentar.",
    restricted_action: "La organización o Slack restringe esta acción en esta conversación.",
    not_authed: "No hay token de Slack válido. Vuelve a conectar desde Comunicación.",
    account_inactive: "La cuenta de Slack no está activa. Revisa con un administrador.",
    token_revoked: "Slack revocó el acceso. Vuelve a conectar desde Comunicación.",
    invalid_auth: "Slack no aceptó el token. Vuelve a conectar desde Comunicación.",
    slack_timeout: "Slack tardó demasiado. Reintenta o comprueba la red.",
    slack_network_error: "No se pudo conectar con Slack. Comprueba la red.",
    slack_http_429: "Slack devolvió demasiadas peticiones. Espera unos segundos y reintenta.",
    slack_function_error: "Error interno al llamar a la función de Slack. Vuelve a intentar o pide a soporte.",
  };
  if (map[t]) return map[t];
  if (t.startsWith("missing_scope") || t.includes("scopes requeridos")) {
    return t;
  }
  if (t === "invalid_arguments" || t.includes("invalid_arguments")) {
    return "Slack rechazó los datos enviados. Si al editar faltan bloques o adjuntos, prueba en el cliente de Slack.";
  }
  if (/^slack_http_\d+$/i.test(t)) {
    return `Error HTTP al hablar con Slack (${t.replace(/^slack_http_/i, "")}). Vuelve a intentar.`;
  }
  return t;
}

/** Ayuda de Slack: lista publicada de tipos bloqueados en Slack Connect (no es un catálogo de “permitidos”). */
export const SLACK_HELP_RESTRICTED_FILE_TYPES_URL =
  "https://slack.com/help/articles/1500002249342-Restricted-file-types-in-Slack-Connect";

export const SLACK_HELP_MANAGE_CONNECT_FILE_UPLOADS_URL =
  "https://slack.com/help/articles/1500005777562-Manage-file-uploads-canvas-sharing-and-list-sharing-for-Slack-Connect";

/**
 * Convierte el `error` devuelto por `files.*` de Slack (o nuestro edge) en un mensaje para el usuario.
 * Incluye pistas cuando el fallo apunta a política de org o tipos, sin sustituir el código original.
 */
export function formatSlackFileUploadError(raw: string | undefined): string {
  const e0 = (raw || "").trim();
  if (!e0) {
    return `No se pudo subir el archivo. Más: ${SLACK_HELP_RESTRICTED_FILE_TYPES_URL}`;
  }
  const e = e0.toLowerCase();
  const tail = ` Documentación: ${SLACK_HELP_RESTRICTED_FILE_TYPES_URL}`;

  if (e.includes("missing_scope") || e.includes("scopes requeridos")) {
    return (
      "Faltan permisos (files:read / files:write) en la app de Slack. Pulsa «Actualizar permisos Slack» en Comunicación."
    );
  }
  if (
    e === "not_allowed_token" ||
    e === "invalid_auth" ||
    e === "token_revoked" ||
    e === "account_inactive"
  ) {
    return "El acceso a Slack dejó de ser válido. Vuelve a conectar desde Comunicación.";
  }
  if (e === "restricted_action" || e.includes("restricted_action")) {
    return `Slack o tu organización restringe esta subida. Si el archivo es un documento normal (.docx, .pdf), pide a un admin de Slack. ${tail}`;
  }
  if (e.includes("file_too") || e.includes("too_large") || e.includes("file too large")) {
    return "El archivo supera el tamaño máximo que permite Slack o Kawiil (revisa 50 MB por archivo en Comunicación).";
  }
  if (e === "ratelimited" || e === "rate_limited" || e.includes("slack_http_429")) {
    return "Slack pidió limitar el ritmo. Espera unos segundos y vuelve a intentar.";
  }
  if (e.startsWith("upload_to_slack_url_failed_")) {
    return "No se pudo completar la subida a los servidores de Slack. Reintenta; si falla, prueba con el cliente de Slack o un archivo más pequeño.";
  }
  if (e.includes("not in channel") || e === "channel_not_found") {
    return "No se pudo publicar en esta conversación. Comprueba que el canal exista y que tengas acceso en Slack.";
  }
  if (e.includes("permit") && e.includes("file")) {
    return `Slack o tu organización no permiten este adjunto. ${tail} Si aplica, revisa política DLP/IT.`;
  }
  if (e.includes("file_upload") && e.includes("disabled")) {
    return `Las subidas de archivos están desactivadas en este workspace o canal. Pide a un admin de Slack. ${tail}`;
  }
  if (e.includes("external") && (e.includes("upload") || e.includes("file"))) {
    return `Slack no permite este adjunto en conversaciones externas (p. ej. Slack Connect) o con cuentas invitadas. ${tail}`;
  }
  if (e.includes("filetype") || e.includes("file_type") || e.includes("invalid_file")) {
    return `Slack rechazó el tipo de archivo. En Slack Connect hay extensiones bloqueadas; en canales internos puede ser política de la org. ${tail}`;
  }
  if (e.includes("cannot_add") && e.includes("file")) {
    return `Slack no permite añadir archivos en este contexto (permisos del canal o mensaje). ${tail}`;
  }

  return e0.includes("http") || e0.length > 160
    ? `${e0} — ${SLACK_HELP_RESTRICTED_FILE_TYPES_URL}`
    : `${e0}${tail}`;
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

/** Capa extra de tiempo límite además de `invokeSlackApi` (por si el abort del cliente no llega a cortar). */
export function withHardTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const tid = setTimeout(() => reject(new Error(message)), timeoutMs);
    promise.then(
      (value) => {
        clearTimeout(tid);
        resolve(value);
      },
      (error) => {
        clearTimeout(tid);
        reject(error);
      },
    );
  });
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
  /** Nombre publicado en mensajes de bot/integración (API Slack). */
  username?: string;
  bot_profile?: { name?: string; icons?: Record<string, unknown> };
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
