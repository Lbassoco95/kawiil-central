/**
 * Servicio interno de notificaciones reutilizable (P0.1).
 *
 * Un solo punto de entrada, `sendNotification`, enruta un mensaje al canal
 * indicado (slack | email | whatsapp | in_app) reusando la infraestructura ya
 * existente del repo:
 *   - Slack   → Web API chat.postMessage (SLACK_BOT_TOKEN).
 *   - Email   → Microsoft Graph app-only + /users/{SENDER_EMAIL}/sendMail.
 *   - WhatsApp→ interfaz lista (WhatsApp Business Cloud API), con stub si no hay
 *               credenciales todavía.
 *   - in_app  → tabla notifications existente.
 * Cada envío queda registrado en notification_log.
 *
 * Diseño: la lógica pura (validación, plantillas, construcción de payloads) no
 * depende de Deno ni de Supabase; el cliente y la configuración se inyectan como
 * dependencias. Así este módulo se reusa desde cualquier Edge Function y a la vez
 * es 100% testeable con vitest desde src/ (ver src/lib/notify.test.ts).
 *
 * Consumo desde otra Edge Function:
 *   import { sendNotification } from "../_shared/notify.ts";
 *   import { loadNotifyConfigFromEnv } from "../_shared/notifyEnv.ts";
 *   const config = loadNotifyConfigFromEnv();
 *   await sendNotification({ admin, config }, { canal, destino, plantilla, datos });
 */

export type NotificationChannel = "slack" | "whatsapp" | "email" | "in_app";

export const SUPPORTED_CHANNELS: NotificationChannel[] = ["slack", "whatsapp", "email", "in_app"];

export type NotificationStatus = "enviado" | "error" | "omitido";

export interface NotificationRequest {
  /** Canal de salida. */
  canal: NotificationChannel;
  /**
   * Destino según el canal:
   *  - slack: ID de canal (#general) o de usuario (Uxxxx, abre DM). Vacío = canal por defecto.
   *  - email: dirección de correo.
   *  - whatsapp: teléfono en formato E.164 (521...).
   *  - in_app: user_id (uuid) del destinatario.
   */
  destino?: string;
  /** Clave de plantilla (ver NOTIFICATION_TEMPLATES) o 'raw' para pasar contenido directo. */
  plantilla: string;
  /** Datos para renderizar la plantilla. */
  datos?: Record<string, unknown>;
  /** Organización dueña (para RLS del log y notificaciones in-app). */
  organization_id?: string | null;
  /** Usuario que origina la notificación (para in-app). */
  source_user_id?: string | null;
}

export interface RenderedMessage {
  subject: string;
  text: string;
  html: string;
}

export type TemplateRenderer = (datos: Record<string, unknown>) => RenderedMessage;

export interface NotifyConfig {
  slackBotToken?: string;
  slackDefaultChannel?: string;
  graph?: {
    tenant?: string;
    clientId?: string;
    clientSecret?: string;
    sender?: string;
  };
  whatsapp?: {
    token?: string;
    phoneNumberId?: string;
    apiVersion?: string;
  };
}

export interface NotifyDeps {
  /** Cliente Supabase con service-role (para log e in-app). */
  admin: {
    from: (table: string) => {
      insert: (rows: unknown) => Promise<{ error: { message: string } | null }>;
    };
  };
  config: NotifyConfig;
  /** Inyectable para pruebas; por defecto el fetch global (existe en Deno y Node 18+). */
  fetchImpl?: typeof fetch;
  /** Inyectable para pruebas; ISO timestamp actual. */
  now?: () => string;
}

export interface NotifyResult {
  ok: boolean;
  canal: NotificationChannel | string;
  estado: NotificationStatus;
  error?: string;
  detail?: unknown;
}

// ─────────────────────────────────────────────────────────────────────────────
// Utilidades puras
// ─────────────────────────────────────────────────────────────────────────────

const str = (v: unknown, fallback = ""): string =>
  v === null || v === undefined ? fallback : String(v);

/** Convierte **negritas** de markdown al mrkdwn de Slack (*negritas*). */
export function markdownBoldToSlackMrkdwn(text: string): string {
  return text.replace(/\*\*(.+?)\*\*/g, "*$1*");
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** Envuelve texto plano (con saltos de línea) en HTML mínimo para correo. */
function textToHtml(text: string): string {
  return `<div style="font-family:system-ui,Segoe UI,Arial,sans-serif;font-size:14px;color:#0f172a;line-height:1.5">${escapeHtml(
    text,
  ).replace(/\n/g, "<br/>")}</div>`;
}

const money = (v: unknown, currency = "MXN"): string => {
  const n = Number(v);
  if (!isFinite(n)) return str(v);
  return `$${n.toLocaleString("es-MX", { minimumFractionDigits: 2 })} ${currency}`;
};

// ─────────────────────────────────────────────────────────────────────────────
// Registro de plantillas (editable / extensible)
// ─────────────────────────────────────────────────────────────────────────────

export const NOTIFICATION_TEMPLATES: Record<string, TemplateRenderer> = {
  /** Contenido directo: usa datos.subject / datos.text / datos.html tal cual. */
  raw: (d) => {
    const text = str(d.text ?? d.body ?? d.mensaje);
    return {
      subject: str(d.subject ?? d.titulo ?? d.title, "Notificación"),
      text,
      html: str(d.html) || textToHtml(text),
    };
  },

  /** Notificación genérica título + cuerpo. */
  generico: (d) => {
    const titulo = str(d.titulo ?? d.title ?? d.subject, "Notificación de Kawiil");
    const cuerpo = str(d.cuerpo ?? d.body ?? d.text ?? d.mensaje);
    const text = cuerpo ? `${titulo}\n\n${cuerpo}` : titulo;
    return { subject: titulo, text, html: textToHtml(text) };
  },

  /** Recordatorio de cobranza (Fase 1). */
  cobranza_recordatorio: (d) => {
    const cliente = str(d.cliente ?? d.cliente_nombre, "cliente");
    const folio = str(d.folio ?? d.invoice_folio ?? d.invoice_id);
    const monto = money(d.monto, str(d.moneda, "MXN"));
    const vencimiento = str(d.vencimiento ?? d.due_date);
    const subject = `Recordatorio de pago${folio ? ` — factura ${folio}` : ""}`;
    const text =
      `Hola ${cliente}, te recordamos el pago de tu factura ${folio ? `**${folio}** ` : ""}` +
      `por **${monto}**${vencimiento ? ` con vencimiento el ${vencimiento}` : ""}.\n\n` +
      `Cualquier duda quedamos a tus órdenes.`;
    return { subject, text, html: textToHtml(text) };
  },

  /** Alerta operativa / de liquidez (Fase 2). */
  alerta_liquidez: (d) => {
    const titulo = str(d.titulo ?? d.title, "Alerta de liquidez");
    const detalle = str(d.detalle ?? d.body ?? d.mensaje);
    const monto = d.monto !== undefined ? money(d.monto, str(d.moneda, "MXN")) : "";
    const accion = str(d.accion ?? d.action);
    const text = [
      `⚠️ **${titulo}**`,
      detalle,
      monto ? `Monto: ${monto}` : "",
      accion ? `Acción sugerida: ${accion}` : "",
    ]
      .filter(Boolean)
      .join("\n");
    return { subject: titulo, text, html: textToHtml(text) };
  },
};

export function isSupportedChannel(canal: unknown): canal is NotificationChannel {
  return typeof canal === "string" && (SUPPORTED_CHANNELS as string[]).includes(canal);
}

export function isKnownTemplate(plantilla: unknown): boolean {
  return typeof plantilla === "string" && plantilla in NOTIFICATION_TEMPLATES;
}

/** Renderiza una plantilla. Lanza si la plantilla no existe. */
export function renderTemplate(plantilla: string, datos: Record<string, unknown> = {}): RenderedMessage {
  const renderer = NOTIFICATION_TEMPLATES[plantilla];
  if (!renderer) throw new Error(`Plantilla desconocida: ${plantilla}`);
  return renderer(datos ?? {});
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
}

/** Valida una solicitud de notificación (router de canal + campos mínimos). */
export function validateNotificationRequest(req: Partial<NotificationRequest>): ValidationResult {
  const errors: string[] = [];
  if (!isSupportedChannel(req.canal)) {
    errors.push(`Canal no soportado: ${str(req.canal, "(vacío)")}`);
  }
  if (!isKnownTemplate(req.plantilla)) {
    errors.push(`Plantilla desconocida: ${str(req.plantilla, "(vacío)")}`);
  }
  // Slack admite destino vacío (usa canal por defecto); el resto lo requieren.
  if (req.canal && req.canal !== "slack" && !str(req.destino).trim()) {
    errors.push("Falta 'destino' para el canal indicado.");
  }
  return { ok: errors.length === 0, errors };
}

// ─────────────────────────────────────────────────────────────────────────────
// Constructores de payload (puros)
// ─────────────────────────────────────────────────────────────────────────────

export function buildSlackBody(channel: string, msg: RenderedMessage) {
  return {
    channel,
    text: markdownBoldToSlackMrkdwn(msg.text || msg.subject),
  };
}

export function buildGraphMail(destino: string, msg: RenderedMessage) {
  return {
    message: {
      subject: msg.subject,
      body: { contentType: "HTML", content: msg.html || textToHtml(msg.text) },
      toRecipients: [{ emailAddress: { address: destino } }],
    },
    saveToSentItems: true,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Canales (I/O; dependencias inyectadas)
// ─────────────────────────────────────────────────────────────────────────────

async function sendSlack(deps: NotifyDeps, req: NotificationRequest, msg: RenderedMessage): Promise<NotifyResult> {
  const token = deps.config.slackBotToken;
  const channel = str(req.destino).trim() || str(deps.config.slackDefaultChannel).trim() || "#general";
  if (!token) return { ok: false, canal: "slack", estado: "omitido", error: "SLACK_BOT_TOKEN no configurado" };
  const doFetch = deps.fetchImpl ?? fetch;
  const res = await doFetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(buildSlackBody(channel, msg)),
  });
  const data = (await res.json()) as { ok?: boolean; error?: string };
  if (!data.ok) return { ok: false, canal: "slack", estado: "error", error: data.error || "slack_error", detail: data };
  return { ok: true, canal: "slack", estado: "enviado", detail: data };
}

async function getGraphToken(deps: NotifyDeps): Promise<string | null> {
  const g = deps.config.graph;
  if (!g?.tenant || !g?.clientId || !g?.clientSecret) return null;
  const doFetch = deps.fetchImpl ?? fetch;
  const res = await doFetch(`https://login.microsoftonline.com/${g.tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: g.clientId,
      client_secret: g.clientSecret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  const j = (await res.json()) as { access_token?: string };
  return j.access_token ?? null;
}

async function sendEmail(deps: NotifyDeps, req: NotificationRequest, msg: RenderedMessage): Promise<NotifyResult> {
  const sender = deps.config.graph?.sender;
  if (!sender) return { ok: false, canal: "email", estado: "omitido", error: "SENDER_EMAIL no configurado" };
  const destino = str(req.destino).trim();
  const token = await getGraphToken(deps);
  if (!token) return { ok: false, canal: "email", estado: "omitido", error: "Credenciales de Microsoft Graph no configuradas" };
  const doFetch = deps.fetchImpl ?? fetch;
  const res = await doFetch(
    `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`,
    {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify(buildGraphMail(destino, msg)),
    },
  );
  if (res.status >= 200 && res.status < 300) return { ok: true, canal: "email", estado: "enviado" };
  let detail: unknown = null;
  try { detail = await res.json(); } catch { /* ignore */ }
  return { ok: false, canal: "email", estado: "error", error: `graph_${res.status}`, detail };
}

async function sendWhatsapp(deps: NotifyDeps, req: NotificationRequest, msg: RenderedMessage): Promise<NotifyResult> {
  const wa = deps.config.whatsapp;
  // Interfaz lista; si no hay credenciales aún, se omite sin fallar (stub).
  if (!wa?.token || !wa?.phoneNumberId) {
    return { ok: false, canal: "whatsapp", estado: "omitido", error: "whatsapp_no_configurado" };
  }
  const destino = str(req.destino).trim();
  const version = wa.apiVersion || "v21.0";
  const doFetch = deps.fetchImpl ?? fetch;
  const res = await doFetch(`https://graph.facebook.com/${version}/${wa.phoneNumberId}/messages`, {
    method: "POST",
    headers: { Authorization: `Bearer ${wa.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      messaging_product: "whatsapp",
      to: destino,
      type: "text",
      text: { body: msg.text || msg.subject },
    }),
  });
  if (res.status >= 200 && res.status < 300) return { ok: true, canal: "whatsapp", estado: "enviado" };
  let detail: unknown = null;
  try { detail = await res.json(); } catch { /* ignore */ }
  return { ok: false, canal: "whatsapp", estado: "error", error: `whatsapp_${res.status}`, detail };
}

async function sendInApp(deps: NotifyDeps, req: NotificationRequest, msg: RenderedMessage): Promise<NotifyResult> {
  const userId = str(req.destino).trim();
  if (!userId) return { ok: false, canal: "in_app", estado: "error", error: "Falta user_id destino" };
  if (!req.organization_id) return { ok: false, canal: "in_app", estado: "error", error: "Falta organization_id" };
  const { error } = await deps.admin.from("notifications").insert([
    {
      user_id: userId,
      organization_id: req.organization_id,
      type: str((req.datos as Record<string, unknown> | undefined)?.type, "notify"),
      title: msg.subject,
      body: msg.text || null,
      source_user_id: req.source_user_id ?? null,
    },
  ]);
  if (error) return { ok: false, canal: "in_app", estado: "error", error: error.message };
  return { ok: true, canal: "in_app", estado: "enviado" };
}

const CHANNEL_HANDLERS: Record<
  NotificationChannel,
  (deps: NotifyDeps, req: NotificationRequest, msg: RenderedMessage) => Promise<NotifyResult>
> = {
  slack: sendSlack,
  email: sendEmail,
  whatsapp: sendWhatsapp,
  in_app: sendInApp,
};

// ─────────────────────────────────────────────────────────────────────────────
// Entrada principal
// ─────────────────────────────────────────────────────────────────────────────

/** Escribe una fila en notification_log; nunca lanza (best-effort). */
async function logNotification(
  deps: NotifyDeps,
  req: NotificationRequest,
  result: NotifyResult,
): Promise<void> {
  const now = deps.now ? deps.now() : new Date().toISOString();
  try {
    await deps.admin.from("notification_log").insert([
      {
        canal: str(req.canal),
        destino: str(req.destino) || null,
        plantilla: str(req.plantilla),
        estado: result.estado,
        error: result.error ?? null,
        payload: { datos: req.datos ?? {}, detail: result.detail ?? null },
        organization_id: req.organization_id ?? null,
        enviado_at: result.estado === "enviado" ? now : null,
      },
    ]);
  } catch {
    /* el log es best-effort: no debe tumbar el envío */
  }
}

/**
 * Envía una notificación por el canal indicado y la registra en notification_log.
 * Punto único de consumo para todos los módulos.
 */
export async function sendNotification(deps: NotifyDeps, req: NotificationRequest): Promise<NotifyResult> {
  const validation = validateNotificationRequest(req);
  if (!validation.ok) {
    const result: NotifyResult = {
      ok: false,
      canal: str(req.canal),
      estado: "error",
      error: validation.errors.join("; "),
    };
    await logNotification(deps, req, result);
    return result;
  }

  let msg: RenderedMessage;
  try {
    msg = renderTemplate(req.plantilla, req.datos ?? {});
  } catch (err) {
    const result: NotifyResult = {
      ok: false,
      canal: str(req.canal),
      estado: "error",
      error: err instanceof Error ? err.message : "render_error",
    };
    await logNotification(deps, req, result);
    return result;
  }

  const handler = CHANNEL_HANDLERS[req.canal];
  let result: NotifyResult;
  try {
    result = await handler(deps, req, msg);
  } catch (err) {
    result = {
      ok: false,
      canal: req.canal,
      estado: "error",
      error: err instanceof Error ? err.message : "channel_error",
    };
  }
  await logNotification(deps, req, result);
  return result;
}
