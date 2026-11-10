// Cuentas vinculadas (Google / Microsoft) para los agentes: reglas puras (sin red ni base) de la función `agente-cuentas` y de sus pruebas.
// El puente es de SOLO LECTURA: busca y lee correo y eventos de calendario. Nunca entrega tokens, y todo lo que devuelve son DATOS de terceros
// (correos, invitaciones), nunca instrucciones: la VM se lo dice así al modelo.

export const MAX_RESULTADOS = 15;
export const MAX_TEXTO = 12_000;
export const MAX_DIAS_EVENTOS = 400;
export const MAX_CONSULTA = 200;

export type Proveedor = "google" | "microsoft";
const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
// Una cuenta es una fila de linked_accounts (uuid) o el Microsoft principal de una persona («ms-<user_id>», fila de microsoft_tokens).
export const refCuentaValida = (v: unknown): v is string => typeof v === "string" && new RegExp(`^(ms-)?${UUID}$`, "i").test(v);
export const idMensajeValido = (v: unknown): v is string => typeof v === "string" && /^[A-Za-z0-9_\-=+.]{4,300}$/.test(v);

const recorta = (v: unknown, max: number): string => {
  const s = typeof v === "string" ? v.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, " ").trim() : "";
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
};

// Texto de búsqueda: una sola línea, sin comillas ni barras (no se puede salir de la frase buscada) y acotado.
export function consultaSegura(v: unknown): string {
  return recorta(v, MAX_CONSULTA * 2).replace(/["\\]/g, " ").replace(/\s+/g, " ").trim().slice(0, MAX_CONSULTA);
}

export function fechaIso(v: unknown): string | null {
  if (typeof v !== "string" || !/^\d{4}-\d{2}-\d{2}/.test(v)) return null;
  const ms = Date.parse(v);
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export function limite(v: unknown, tope = MAX_RESULTADOS): number {
  const n = Number(v);
  return Number.isInteger(n) && n >= 1 ? Math.min(n, tope) : Math.min(10, tope);
}

// Gmail: «"<frase>" after:AAAA/MM/DD before:AAAA/MM/DD». La frase va entre comillas para que cuente como una sola búsqueda de texto.
export function consultaGmail(consulta: unknown, desde?: unknown, hasta?: unknown): string {
  const partes: string[] = [];
  const c = consultaSegura(consulta);
  if (c) partes.push(`"${c}"`);
  const f = (v: unknown) => { const i = fechaIso(v); return i ? i.slice(0, 10).replace(/-/g, "/") : null; };
  const d = f(desde), h = f(hasta);
  if (d) partes.push(`after:${d}`);
  if (h) partes.push(`before:${h}`);
  return partes.join(" ");
}

export const consultaGraph = (consulta: unknown): string => { const c = consultaSegura(consulta); return c ? `"${c}"` : ""; };

// HTML de un correo → texto plano acotado. No se interpreta nada: se quitan las etiquetas y los bloques de script/estilo.
export function aTextoPlano(html: unknown, max = MAX_TEXTO): string {
  let t = typeof html === "string" ? html : "";
  t = t.replace(/<(script|style|head)[\s\S]*?<\/\1>/gi, " ").replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, "\n").replace(/<[^>]+>/g, " ");
  t = t.replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, "\"").replace(/&#39;/g, "'");
  t = t.replace(/[ \t\u00a0]+/g, " ").replace(/ *\n */g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  return recorta(t, max);
}

export interface CorreoPublico { id: string; de: string; para: string; asunto: string; fecha: string; fragmento: string; adjuntos: boolean }
export interface AdjuntoPublico { id: string; nombre: string; tamano: number | null; tipo: string }
export interface EventoPublico { id: string; titulo: string; inicio: string; fin: string; lugar: string; organizador: string; asistentes: string[]; todo_el_dia: boolean }

const cabecera = (m: any, nombre: string): string => {
  const h = (m?.payload?.headers ?? []).find((x: any) => String(x?.name).toLowerCase() === nombre.toLowerCase());
  return recorta(h?.value, 300);
};

export function correoDeGmail(m: any): CorreoPublico {
  const adj = (parte: any): boolean => !!parte?.filename && !!parte?.body?.attachmentId || (parte?.parts ?? []).some(adj);
  return {
    id: recorta(m?.id, 300), de: cabecera(m, "From"), para: cabecera(m, "To"), asunto: cabecera(m, "Subject") || "(sin asunto)",
    fecha: m?.internalDate ? new Date(Number(m.internalDate)).toISOString() : cabecera(m, "Date"), fragmento: recorta(m?.snippet, 300), adjuntos: adj(m?.payload),
  };
}

const dir = (x: any): string => { const e = x?.emailAddress; return recorta(e?.name ? `${e.name} <${e.address ?? ""}>` : e?.address, 200); };
export function correoDeGraph(m: any): CorreoPublico {
  return {
    id: recorta(m?.id, 300), de: dir(m?.from), para: (m?.toRecipients ?? []).slice(0, 10).map(dir).filter(Boolean).join(", ").slice(0, 400),
    asunto: recorta(m?.subject, 300) || "(sin asunto)", fecha: recorta(m?.receivedDateTime, 40), fragmento: recorta(m?.bodyPreview, 300), adjuntos: !!m?.hasAttachments,
  };
}

// Cuerpo de un mensaje de Gmail (format=full): prefiere text/plain; si solo hay HTML lo pasa a texto. Los adjuntos solo se listan.
const b64url = (s: string): string => {
  try { const b = atob(s.replace(/-/g, "+").replace(/_/g, "/")); return new TextDecoder().decode(Uint8Array.from(b, (c) => c.charCodeAt(0))); } catch { return ""; }
};
export function cuerpoDeGmail(m: any): { texto: string; adjuntos: AdjuntoPublico[] } {
  let plano = "", html = "";
  const adjuntos: AdjuntoPublico[] = [];
  const recorre = (p: any, prof = 0) => {
    if (!p || prof > 8) return;
    if (p.filename && p.body?.attachmentId) {
      if (adjuntos.length < 30) adjuntos.push({ id: recorta(p.body.attachmentId, 300), nombre: recorta(p.filename, 200), tamano: typeof p.body.size === "number" ? p.body.size : null, tipo: recorta(p.mimeType, 100) });
    } else if (p.mimeType === "text/plain" && p.body?.data && !plano) plano = b64url(p.body.data);
    else if (p.mimeType === "text/html" && p.body?.data && !html) html = b64url(p.body.data);
    for (const q of p.parts ?? []) recorre(q, prof + 1);
  };
  recorre(m?.payload);
  return { texto: plano ? recorta(plano, MAX_TEXTO) : aTextoPlano(html), adjuntos };
}

export const adjuntosDeGraph = (lista: any[]): AdjuntoPublico[] =>
  (lista ?? []).filter((a) => a && !a.isInline).slice(0, 30).map((a) => ({ id: recorta(a.id, 300), nombre: recorta(a.name, 200), tamano: typeof a.size === "number" ? a.size : null, tipo: recorta(a.contentType, 100) }));

export function eventoDeGoogle(e: any): EventoPublico {
  const todo = !!e?.start?.date && !e?.start?.dateTime;
  return {
    id: recorta(e?.id, 300), titulo: recorta(e?.summary, 300) || "(sin título)", inicio: recorta(e?.start?.dateTime ?? e?.start?.date, 40), fin: recorta(e?.end?.dateTime ?? e?.end?.date, 40),
    lugar: recorta(e?.location, 200), organizador: recorta(e?.organizer?.email, 200), todo_el_dia: todo,
    asistentes: (e?.attendees ?? []).slice(0, 20).map((a: any) => recorta(a?.email, 120)).filter(Boolean),
  };
}

export function eventoDeGraph(e: any): EventoPublico {
  return {
    id: recorta(e?.id, 300), titulo: recorta(e?.subject, 300) || "(sin título)", inicio: recorta(e?.start?.dateTime, 40), fin: recorta(e?.end?.dateTime, 40),
    lugar: recorta(e?.location?.displayName, 200), organizador: recorta(e?.organizer?.emailAddress?.address, 200), todo_el_dia: !!e?.isAllDay,
    asistentes: (e?.attendees ?? []).slice(0, 20).map((a: any) => recorta(a?.emailAddress?.address, 120)).filter(Boolean),
  };
}

// Filtro de texto para los eventos de Graph (calendarView no admite búsqueda): título, lugar y asistentes.
export function coincideEvento(e: EventoPublico, consulta: string): boolean {
  const c = consulta.toLowerCase().trim();
  if (!c) return true;
  return [e.titulo, e.lugar, e.organizador, ...e.asistentes].some((x) => x.toLowerCase().includes(c));
}

// Rango de eventos: por defecto, de hoy a 30 días; nunca más de MAX_DIAS_EVENTOS.
export function rangoEventos(desde: unknown, hasta: unknown, ahoraMs: number): { desde: string; hasta: string } | null {
  const d = fechaIso(desde) ?? new Date(ahoraMs).toISOString();
  const h = fechaIso(hasta) ?? new Date(Date.parse(d) + 30 * 86_400_000).toISOString();
  const dias = (Date.parse(h) - Date.parse(d)) / 86_400_000;
  return dias > 0 && dias <= MAX_DIAS_EVENTOS ? { desde: d, hasta: h } : null;
}

export interface CuentaPublica { cuenta: string; proveedor: Proveedor; correo: string; nombre: string; correo_activo: boolean; calendario_activo: boolean }
// Lo que sale de una cuenta hacia la VM: nunca tokens ni credenciales IMAP. Las cuentas IMAP no se ofrecen (el puente no las lee).
export function cuentaPublica(f: Record<string, unknown>): CuentaPublica | null {
  if ((f.provider !== "google" && f.provider !== "microsoft") || f.status !== "connected" || !refCuentaValida(f.id)) return null;
  return {
    cuenta: f.id as string, proveedor: f.provider as Proveedor, correo: recorta(f.email, 200), nombre: recorta(f.display_name, 120),
    correo_activo: f.mail_enabled !== false, calendario_activo: f.calendar_enabled !== false,
  };
}
