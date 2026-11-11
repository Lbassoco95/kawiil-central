import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encode as base64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { tokensIguales } from "../_shared/dropboxEquipo.ts";
import {
  adjuntosDeGraph,
  aTextoPlano,
  coincideEvento,
  consultaGmail,
  consultaGraph,
  consultaSegura,
  correoDeGmail,
  correoDeGraph,
  cuentaPublica,
  cuerpoDeGmail,
  eventoDeGoogle,
  eventoDeGraph,
  idMensajeValido,
  limite,
  rangoEventos,
  refCuentaValida,
  fechaIso,
  type CuentaPublica,
  MAX_BYTES_DRIVE,
  MAX_ENTRADAS_DRIVE,
  MIME_CARPETA,
  dentroDeCarpeta,
  entradaDrive,
  idDriveValido,
  tipoLegibleDrive,
} from "../_shared/cuentasAgentes.ts";

/**
 * agente-cuentas
 * --------------
 * Puente de SOLO LECTURA entre los agentes (VM kawiil-agents) y las cuentas de Google y Microsoft que las personas ya vincularon en Kawiil Central.
 * La VM no guarda ningún token: se quedan aquí, en `linked_accounts` / `microsoft_tokens`, y nunca salen.
 *
 *   action "cuentas"        → {}                                          → { cuentas }
 *   action "correo_buscar"  → { cuenta, consulta, desde?, hasta?, limite? } → { correos }
 *   action "correo_leer"    → { cuenta, id }                              → { correo, texto, adjuntos }   (adjuntos: solo nombres)
 *   action "eventos"        → { cuenta, consulta?, desde?, hasta?, limite? } → { eventos }
 *   action "drive_listar"   → { cuenta, limite, ref? } → { carpeta, entradas, truncado }   (Google Drive; `limite` = carpeta de la fuente, obligatoria)
 *   action "drive_leer"     → { cuenta, limite, ref } → { nombre, mime, tamano, modificado, base64 }   (texto exportado o archivo legible, tope 8 MB)
 *
 * Seguridad:
 *   - Solo la VM: exige `X-Kawiil-Bridge-Token` (KAWIIL_BRIDGE_TOKEN, tiempo constante) además del JWT de la puerta de entrada.
 *   - Solo lectura: Gmail (messages.list/get), Calendar (events.list), Graph (messages, calendarView). Nada de enviar, responder, mover, archivar ni borrar.
 *   - Quién puede usarlo lo decide la VM por agente (config.cuentas.activa), que Dirección activa desde Kawiil Central. Aquí no hay datos de nadie hasta que se pregunta.
 *   - Lo devuelto son datos de terceros acotados (texto plano, sin HTML, con tope); nunca tokens ni credenciales IMAP.
 *   - Drive: solo lectura (permiso drive.readonly que cada persona concede aparte) y SIEMPRE dentro de la carpeta de la fuente: antes de listar o leer se
 *     suben los `parents` que Google devuelve hasta llegar a esa carpeta; lo que no llega (o excede el tope de consultas) se rechaza.
 *   - Se registra la acción y la cuenta; nunca el contenido ni las búsquedas.
 *
 * Secrets: KAWIIL_BRIDGE_TOKEN, GOOGLE_CLIENT_ID/SECRET, MICROSOFT_CLIENT_ID/SECRET, MICROSOFT_TENANT_ID, opcional MICROSOFT_LINKED_TENANT_ID.
 */

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });
class ErrorPuente extends Error { constructor(public estado: number, m: string, public codigo?: string) { super(m); } }

type Admin = ReturnType<typeof createClient>;
interface Cuenta { proveedor: "google" | "microsoft"; token: string; correo: boolean; calendario: boolean; etiqueta: string }

const refrescar = async (url: string, datos: Record<string, string>) => {
  const r = await fetch(url, { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(datos) });
  const d = await r.json().catch(() => ({}));
  return r.ok && d.access_token ? d : null;
};

// Resuelve la cuenta (uuid de linked_accounts o ms-<user_id>) y deja un token de acceso vigente. No devuelve nada más de la fila.
async function abrirCuenta(admin: Admin, ref: string): Promise<Cuenta> {
  const ahora = Date.now();
  if (ref.toLowerCase().startsWith("ms-")) {
    const userId = ref.slice(3);
    const { data: t } = await admin.from("microsoft_tokens").select("access_token, refresh_token, expires_at").eq("user_id", userId).maybeSingle();
    if (!t) throw new ErrorPuente(404, "No encontramos esa cuenta.");
    let token = t.access_token as string;
    if (new Date(t.expires_at).getTime() - ahora < 300_000) {
      const d = await refrescar(`https://login.microsoftonline.com/${Deno.env.get("MICROSOFT_TENANT_ID")!.trim()}/oauth2/v2.0/token`, {
        client_id: Deno.env.get("MICROSOFT_CLIENT_ID")!.trim(), client_secret: Deno.env.get("MICROSOFT_CLIENT_SECRET")!.trim(), refresh_token: t.refresh_token, grant_type: "refresh_token",
      });
      if (!d) throw new ErrorPuente(409, "Esa cuenta necesita reconectarse en Kawiil Central.", "REAUTH_REQUIRED");
      token = d.access_token;
      await admin.from("microsoft_tokens").update({ access_token: d.access_token, refresh_token: d.refresh_token || t.refresh_token, expires_at: new Date(ahora + d.expires_in * 1000).toISOString() }).eq("user_id", userId);
    }
    return { proveedor: "microsoft", token, correo: true, calendario: true, etiqueta: ref };
  }
  const { data: f } = await admin.from("linked_accounts").select("id, provider, status, access_token, refresh_token, token_expires_at, mail_enabled, calendar_enabled").eq("id", ref).maybeSingle();
  if (!f || (f.provider !== "google" && f.provider !== "microsoft")) throw new ErrorPuente(404, "No encontramos esa cuenta.");
  if (f.status !== "connected") throw new ErrorPuente(409, "Esa cuenta necesita reconectarse en Kawiil Central.", "REAUTH_REQUIRED");
  let token = f.access_token as string | null;
  const vence = f.token_expires_at ? new Date(f.token_expires_at).getTime() : 0;
  if (!token || vence - 60_000 < ahora) {
    if (!f.refresh_token) throw new ErrorPuente(409, "Esa cuenta necesita reconectarse en Kawiil Central.", "REAUTH_REQUIRED");
    const d = f.provider === "google"
      ? await refrescar("https://oauth2.googleapis.com/token", { client_id: Deno.env.get("GOOGLE_CLIENT_ID")!.trim(), client_secret: Deno.env.get("GOOGLE_CLIENT_SECRET")!.trim(), refresh_token: f.refresh_token, grant_type: "refresh_token" })
      : await refrescar(`https://login.microsoftonline.com/${Deno.env.get("MICROSOFT_LINKED_TENANT_ID")?.trim() || "common"}/oauth2/v2.0/token`, {
        client_id: Deno.env.get("MICROSOFT_CLIENT_ID")!.trim(), client_secret: Deno.env.get("MICROSOFT_CLIENT_SECRET")!.trim(), refresh_token: f.refresh_token, grant_type: "refresh_token" });
    if (!d) {
      await admin.from("linked_accounts").update({ status: "error", last_error: "refresh_failed" }).eq("id", f.id);
      throw new ErrorPuente(409, "Esa cuenta necesita reconectarse en Kawiil Central.", "REAUTH_REQUIRED");
    }
    token = d.access_token;
    await admin.from("linked_accounts").update({ access_token: d.access_token, refresh_token: d.refresh_token ?? f.refresh_token, token_expires_at: new Date(ahora + (d.expires_in ?? 3600) * 1000).toISOString(), status: "connected", last_error: null }).eq("id", f.id);
  }
  return { proveedor: f.provider, token: token!, correo: f.mail_enabled !== false, calendario: f.calendar_enabled !== false, etiqueta: f.id };
}

async function get(c: Cuenta, url: string, extra: Record<string, string> = {}): Promise<any> {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${c.token}`, ...extra } });
  if (r.status === 401 || r.status === 403) {
    const t = await r.text().catch(() => "");
    console.error("agente-cuentas: permiso", c.proveedor, r.status);
    if (/accessNotConfigured|SERVICE_DISABLED/i.test(t)) throw new ErrorPuente(503, "La API de esa cuenta no está habilitada en el proyecto de Kawiil.");
    throw new ErrorPuente(409, "Esa cuenta no tiene permiso para esto. Hay que reconectarla en Kawiil Central.", "REAUTH_REQUIRED");
  }
  if (r.status === 404) throw new ErrorPuente(404, "No se encontró ese elemento.");
  if (!r.ok) { console.error("agente-cuentas:", c.proveedor, r.status); throw new ErrorPuente(502, "La cuenta no respondió correctamente."); }
  return await r.json();
}

const G = "https://gmail.googleapis.com/gmail/v1/users/me";
const GRAPH = "https://graph.microsoft.com/v1.0/me";

serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const esperado = Deno.env.get("KAWIIL_BRIDGE_TOKEN");
    if (!esperado) return json({ error: "El puente no está configurado." }, 503);
    if (!tokensIguales(req.headers.get("X-Kawiil-Bridge-Token") ?? "", esperado)) return json({ error: "No autorizado." }, 401);
    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    if (body.action === "cuentas") {
      const { data: filas } = await admin.from("linked_accounts").select("id, provider, status, email, display_name, mail_enabled, calendar_enabled").in("provider", ["google", "microsoft"]).eq("status", "connected").limit(100);
      const cuentas: CuentaPublica[] = (filas ?? []).map((f: Record<string, unknown>) => cuentaPublica(f)).filter((x: CuentaPublica | null): x is CuentaPublica => !!x);
      const { data: ms } = await admin.from("microsoft_tokens").select("user_id").limit(100);
      const ids = (ms ?? []).map((m: { user_id: string }) => m.user_id);
      const { data: perfiles } = ids.length ? await admin.from("profiles").select("user_id, full_name").in("user_id", ids) : { data: [] as { user_id: string; full_name: string | null }[] };
      for (const m of ms ?? []) {
        const p = (perfiles ?? []).find((x: { user_id: string }) => x.user_id === m.user_id);
        const pub = cuentaPublica({ id: `ms-${m.user_id}`, provider: "microsoft", status: "connected", display_name: p?.full_name ?? "Microsoft 365" });
        if (pub) cuentas.push(pub);
      }
      console.log(`agente-cuentas cuentas n=${cuentas.length}`);
      return json({ cuentas });
    }

    if (!refCuentaValida(body.cuenta)) return json({ error: "Cuenta no válida." }, 400);
    const ref = body.cuenta;
    const c = await abrirCuenta(admin, ref);

    if (body.action === "drive_listar" || body.action === "drive_leer") {
      if (c.proveedor !== "google") throw new ErrorPuente(400, "Drive solo está disponible para cuentas de Google.");
      if (!idDriveValido(body.limite)) return json({ error: "Falta la carpeta autorizada para esta fuente." }, 400);
      const limite = body.limite;
      const objetivo = body.ref === undefined || body.ref === "raiz" ? limite : body.ref;
      if (!idDriveValido(objetivo)) return json({ error: "Referencia no válida." }, 400);
      const D = "https://www.googleapis.com/drive/v3";
      const permiso = async <T,>(f: () => Promise<T>): Promise<T> => {
        try { return await f(); } catch (e) {
          if (e instanceof ErrorPuente && e.codigo === "REAUTH_REQUIRED") throw new ErrorPuente(409, "Esa cuenta no ha dado permiso de Drive. Hay que permitirlo en Kawiil Central (Agentes → Documentos).", "DRIVE_PERMISO");
          throw e;
        }
      };
      const cache = new Map<string, any>();
      const meta = (id: string) => permiso(async () => {
        if (!cache.has(id)) cache.set(id, await get(c, `${D}/files/${encodeURIComponent(id)}?fields=id,name,mimeType,size,modifiedTime,parents&supportsAllDrives=true`));
        return cache.get(id);
      });
      if (!(await dentroDeCarpeta(objetivo, limite, async (id) => ((await meta(id)).parents ?? []) as string[]))) {
        throw new ErrorPuente(403, "Ese elemento está fuera de la carpeta autorizada para este agente.");
      }
      const m = await meta(objetivo);

      if (body.action === "drive_listar") {
        if (m.mimeType !== MIME_CARPETA) throw new ErrorPuente(400, "Eso no es una carpeta; usa leer.");
        const entradas = [];
        let pagina: string | undefined, paginas = 0;
        do {
          const qs = new URLSearchParams({ q: `'${objetivo}' in parents and trashed = false`, fields: "nextPageToken,files(id,name,mimeType,size,modifiedTime)", pageSize: "200", orderBy: "folder,name", supportsAllDrives: "true", includeItemsFromAllDrives: "true" });
          if (pagina) qs.set("pageToken", pagina);
          const r = await permiso(() => get(c, `${D}/files?${qs}`));
          for (const f of r.files ?? []) { const e = entradaDrive(f); if (e) entradas.push(e); }
          pagina = r.nextPageToken; paginas++;
        } while (pagina && paginas < 4 && entradas.length < MAX_ENTRADAS_DRIVE);
        console.log(`agente-cuentas drive_listar ${c.etiqueta} entradas=${entradas.length}`);
        return json({ carpeta: { id: objetivo, nombre: m.name }, entradas: entradas.slice(0, MAX_ENTRADAS_DRIVE), truncado: !!pagina || entradas.length > MAX_ENTRADAS_DRIVE });
      }

      if (m.mimeType === MIME_CARPETA) throw new ErrorPuente(400, "Eso es una carpeta; usa listar.");
      const tipo = tipoLegibleDrive(m.mimeType);
      if (!tipo) throw new ErrorPuente(415, "Ese tipo de archivo no se puede leer (se aceptan Docs, Sheets, Slides, pdf, docx, xlsx y texto).");
      if (!tipo.exportar && Number(m.size) > MAX_BYTES_DRIVE) throw new ErrorPuente(413, "El archivo es demasiado grande para leerlo.");
      const url = tipo.exportar ? `${D}/files/${encodeURIComponent(objetivo)}/export?mimeType=${encodeURIComponent(tipo.exportar)}` : `${D}/files/${encodeURIComponent(objetivo)}?alt=media&supportsAllDrives=true`;
      const r = await permiso(async () => {
        const x = await fetch(url, { headers: { Authorization: `Bearer ${c.token}` } });
        if (x.status === 401 || x.status === 403) throw new ErrorPuente(409, "x", "REAUTH_REQUIRED");
        if (!x.ok) { console.error("agente-cuentas drive contenido", x.status); throw new ErrorPuente(x.status === 404 ? 404 : 502, x.status === 404 ? "No se encontró ese archivo." : "No se pudo descargar el archivo."); }
        return new Uint8Array(await x.arrayBuffer());
      });
      if (r.length > MAX_BYTES_DRIVE) throw new ErrorPuente(413, "El archivo es demasiado grande para leerlo.");
      console.log(`agente-cuentas drive_leer ${c.etiqueta} bytes=${r.length}`);
      return json({ nombre: m.name, mime: tipo.mime, tamano: r.length, modificado: m.modifiedTime ?? null, base64: base64(r) });
    }

    if (body.action === "correo_buscar") {
      if (!c.correo) throw new ErrorPuente(409, "Esa cuenta no tiene el correo activado.");
      const n = limite(body.limite);
      if (!consultaSegura(body.consulta) && !fechaIso(body.desde)) return json({ error: "Escribe qué buscar (cliente, asunto, persona) o desde qué fecha." }, 400);
      let correos;
      if (c.proveedor === "google") {
        const qs = new URLSearchParams({ maxResults: String(n), q: consultaGmail(body.consulta, body.desde, body.hasta) });
        const lista = await get(c, `${G}/messages?${qs}`);
        const ids: string[] = (lista.messages ?? []).slice(0, n).map((m: { id: string }) => m.id);
        correos = await Promise.all(ids.map(async (id) => {
          const m = await get(c, `${G}/messages/${encodeURIComponent(id)}?format=full`);   // full: para saber si trae adjuntos
          return correoDeGmail(m);
        }));
      } else {
        const filtros: string[] = [];
        const d = fechaIso(body.desde), h = fechaIso(body.hasta);
        const q = consultaGraph(body.consulta);
        // Graph no combina $search con $filter: con texto se busca y las fechas se aplican después.
        const qs = new URLSearchParams({ "$top": String(Math.min(n * 3, 45)), "$select": "id,subject,from,toRecipients,receivedDateTime,bodyPreview,hasAttachments" });
        if (q) qs.set("$search", q); else { if (d) filtros.push(`receivedDateTime ge ${d}`); if (h) filtros.push(`receivedDateTime le ${h}`); if (filtros.length) qs.set("$filter", filtros.join(" and ")); }
        const lista = await get(c, `${GRAPH}/messages?${qs}`, { ConsistencyLevel: "eventual" });
        correos = (lista.value ?? []).map(correoDeGraph).filter((m: { fecha: string }) => (!q || ((!d || m.fecha >= d) && (!h || m.fecha <= h)))).slice(0, n);
      }
      console.log(`agente-cuentas correo_buscar ${ref} n=${correos.length}`);
      return json({ correos });
    }

    if (body.action === "correo_leer") {
      if (!c.correo) throw new ErrorPuente(409, "Esa cuenta no tiene el correo activado.");
      if (!idMensajeValido(body.id)) return json({ error: "Mensaje no válido." }, 400);
      const id = encodeURIComponent(body.id);
      if (c.proveedor === "google") {
        const m = await get(c, `${G}/messages/${id}?format=full`);
        const { texto, adjuntos } = cuerpoDeGmail(m);
        console.log(`agente-cuentas correo_leer ${ref}`);
        return json({ correo: correoDeGmail(m), texto, adjuntos });
      }
      const m = await get(c, `${GRAPH}/messages/${id}?$select=id,subject,from,toRecipients,receivedDateTime,bodyPreview,hasAttachments,body`, { Prefer: 'outlook.body-content-type="text"' });
      const adj = m.hasAttachments ? adjuntosDeGraph((await get(c, `${GRAPH}/messages/${id}/attachments?$select=id,name,size,contentType,isInline&$top=30`)).value ?? []) : [];
      console.log(`agente-cuentas correo_leer ${ref}`);
      return json({ correo: correoDeGraph(m), texto: m.body?.contentType === "html" ? aTextoPlano(m.body?.content) : aTextoPlano(String(m.body?.content ?? "")), adjuntos: adj });
    }

    if (body.action === "eventos") {
      if (!c.calendario) throw new ErrorPuente(409, "Esa cuenta no tiene el calendario activado.");
      const rango = rangoEventos(body.desde, body.hasta, Date.now());
      if (!rango) return json({ error: "El rango de fechas no es válido (máximo 400 días)." }, 400);
      const n = limite(body.limite, 50), texto = consultaSegura(body.consulta);
      let eventos;
      if (c.proveedor === "google") {
        const qs = new URLSearchParams({ timeMin: rango.desde, timeMax: rango.hasta, singleEvents: "true", orderBy: "startTime", maxResults: String(n) });
        if (texto) qs.set("q", texto);
        eventos = ((await get(c, `https://www.googleapis.com/calendar/v3/calendars/primary/events?${qs}`)).items ?? []).map(eventoDeGoogle);
      } else {
        const qs = new URLSearchParams({ startDateTime: rango.desde, endDateTime: rango.hasta, "$top": "100", "$orderby": "start/dateTime", "$select": "id,subject,start,end,location,organizer,attendees,isAllDay" });
        eventos = ((await get(c, `${GRAPH}/calendarView?${qs}`, { Prefer: 'outlook.timezone="UTC"' })).value ?? []).map(eventoDeGraph).filter((e: ReturnType<typeof eventoDeGraph>) => coincideEvento(e, texto)).slice(0, n);
      }
      console.log(`agente-cuentas eventos ${ref} n=${eventos.length}`);
      return json({ eventos });
    }

    return json({ error: "Acción no válida." }, 400);
  } catch (e) {
    if (e instanceof ErrorPuente) return json({ error: e.message, ...(e.codigo ? { code: e.codigo } : {}) }, e.estado);
    console.error("agente-cuentas", e instanceof Error ? e.message : e);
    return json({ error: "Error interno." }, 500);
  }
});
