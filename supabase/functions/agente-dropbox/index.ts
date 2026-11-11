import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { encode as base64 } from "https://deno.land/std@0.168.0/encoding/base64.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  MAX_BYTES_LEER,
  MAX_ENTRADAS,
  MAX_PAGINAS,
  dentroDeRaices,
  entradaPublica,
  limiteValido,
  mimePorNombre,
  normalizarRaices,
  recortar,
  raicesEfectivas,
  referenciaValida,
  tokensIguales,
} from "../_shared/dropboxEquipo.ts";

/**
 * agente-dropbox
 * --------------
 * Puente de SOLO LECTURA entre los agentes (VM kawiil-agents) y el Dropbox de equipo que Kawiil Central ya tiene conectado.
 * Así la VM no guarda ninguna credencial de Dropbox: el token, el contexto de equipo y la app viven solo aquí.
 *
 *   action "probar"  → {}                          → { ok, raices, en_la_raiz }    (diagnóstico de la conexión)
 *   Todas las acciones aceptan `limite` (un id de Dropbox «id:…»): acota la consulta a ESA carpeta (la de un cliente). "raiz" pasa a ser el límite.
 *   action "listar"  → { ref: "raiz"|id|ruta }     → { carpeta, entradas, truncado }
 *   action "leer"    → { ref: id }                 → { nombre, mime, tamano, modificado, base64 }
 *
 * Seguridad:
 *   - Solo la VM puede llamarla: exige `X-Kawiil-Bridge-Token` (secreto KAWIIL_BRIDGE_TOKEN, comparado en tiempo constante) además del JWT de la puerta de entrada.
 *   - Solo lectura: únicamente get_metadata, list_folder y download. Nada de subir, mover, borrar ni compartir.
 *   - Alcance: solo carpetas raíz autorizadas (DROPBOX_AGENTES_RAICES, por defecto /Kawiil Mx/CLIENTES). Antes de listar o leer se pide a Dropbox
 *     la metadata del elemento y se decide con SU path_lower; lo que quede fuera (o no traiga ruta) se rechaza. Aquí no se confía en la ruta que manda quien pregunta.
 *   - El contenido tiene tope de 8 MB y solo de tipos legibles (pdf, docx, xlsx, texto, imágenes). No se guarda nada ni se escribe en la base.
 *   - Se registra la acción y el id; nunca el contenido ni los nombres de archivo.
 *
 * Secrets: DROPBOX_APP_KEY, DROPBOX_APP_SECRET, DROPBOX_REFRESH_TOKEN (o la fila de `integrations`), KAWIIL_BRIDGE_TOKEN, opcional DROPBOX_AGENTES_RAICES.
 */

const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { "Content-Type": "application/json" } });

class ErrorPuente extends Error { constructor(public estado: number, m: string) { super(m); } }

// ── Token y contexto de equipo (misma lógica que dropbox-browse; aquí solo lectura) ──
let tokenEnCache: string | null = null, expiraEn = 0;
let adminEnCache: string | null = null, raizEnCache: string | null = null;

async function refreshTokenDeLaBase(): Promise<string | null> {
  try {
    const url = Deno.env.get("SUPABASE_URL"), clave = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!url || !clave) return null;
    const { data } = await createClient(url, clave).from("integrations").select("config").eq("provider", "dropbox").eq("is_active", true).single();
    return data?.config?.refresh_token || null;
  } catch { return null; }
}

async function tokenDeAcceso(): Promise<string> {
  if (tokenEnCache && Date.now() < expiraEn - 300_000) return tokenEnCache;
  let refresh = Deno.env.get("DROPBOX_REFRESH_TOKEN");
  const key = Deno.env.get("DROPBOX_APP_KEY"), secret = Deno.env.get("DROPBOX_APP_SECRET");
  if (!refresh || refresh.length < 50) refresh = (await refreshTokenDeLaBase()) ?? refresh;
  if (!refresh || !key || !secret) {
    const fijo = Deno.env.get("DROPBOX_ACCESS_TOKEN");
    if (!fijo) throw new ErrorPuente(503, "Dropbox no está configurado.");
    return fijo;
  }
  const r = await fetch("https://api.dropboxapi.com/oauth2/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Authorization: `Basic ${btoa(`${key}:${secret}`)}` },
    body: new URLSearchParams({ grant_type: "refresh_token", refresh_token: refresh }),
  });
  if (!r.ok) { console.error("agente-dropbox: no se pudo renovar el token", r.status); throw new ErrorPuente(502, "No se pudo conectar con Dropbox."); }
  const d = await r.json();
  tokenEnCache = d.access_token; expiraEn = Date.now() + d.expires_in * 1000;
  return tokenEnCache!;
}

async function contextoEquipo(token: string): Promise<{ admin: string | null; raiz: string | null }> {
  if (adminEnCache && raizEnCache) return { admin: adminEnCache, raiz: raizEnCache };
  if (!adminEnCache) {
    try {
      const r = await fetch("https://api.dropboxapi.com/2/team/members/list_v2", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify({ limit: 50 }),
      });
      if (r.ok) {
        const miembros = (await r.json())?.members ?? [];
        const a = miembros.find((m: any) => m?.role?.[".tag"] === "team_admin");
        adminEnCache = a?.profile?.team_member_id || miembros[0]?.profile?.team_member_id || null;
      }
    } catch (e) { console.error("agente-dropbox: miembros", e instanceof Error ? e.message : e); }
  }
  if (!raizEnCache) {
    try {
      const h: Record<string, string> = { Authorization: `Bearer ${token}` };
      if (adminEnCache) h["Dropbox-API-Select-Admin"] = adminEnCache;
      const r = await fetch("https://api.dropboxapi.com/2/users/get_current_account", { method: "POST", headers: h });
      if (r.ok) raizEnCache = (await r.json())?.root_info?.root_namespace_id || null;
    } catch (e) { console.error("agente-dropbox: cuenta", e instanceof Error ? e.message : e); }
  }
  return { admin: adminEnCache, raiz: raizEnCache };
}

function cabeceras(token: string, ctx: { admin: string | null; raiz: string | null }, json = true): Record<string, string> {
  const h: Record<string, string> = { Authorization: `Bearer ${token}` };
  if (json) h["Content-Type"] = "application/json";
  if (ctx.admin) h["Dropbox-API-Select-Admin"] = ctx.admin;
  if (ctx.raiz) h["Dropbox-API-Path-Root"] = JSON.stringify({ ".tag": "root", root: ctx.raiz });
  return h;
}

async function api(h: Record<string, string>, endpoint: string, cuerpo: unknown): Promise<any> {
  const r = await fetch(`https://api.dropboxapi.com/2/${endpoint}`, { method: "POST", headers: h, body: JSON.stringify(cuerpo) });
  if (!r.ok) {
    console.error("agente-dropbox:", endpoint, r.status);
    if (r.status === 409) throw new ErrorPuente(404, "No se encontró esa carpeta o archivo en Dropbox.");
    throw new ErrorPuente(502, "Dropbox no respondió correctamente.");
  }
  return await r.json();
}

serve(async (req: Request) => {
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const esperado = Deno.env.get("KAWIIL_BRIDGE_TOKEN");
    if (!esperado) return json({ error: "El puente no está configurado." }, 503);
    if (!tokensIguales(req.headers.get("X-Kawiil-Bridge-Token") ?? "", esperado)) return json({ error: "No autorizado." }, 401);

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }

    const autorizadas = normalizarRaices(Deno.env.get("DROPBOX_AGENTES_RAICES"));
    if (body.limite !== undefined && body.limite !== null && !limiteValido(body.limite)) return json({ error: "Límite no válido." }, 400);
    const token = await tokenDeAcceso();
    const ctx = await contextoEquipo(token);
    const h = cabeceras(token, ctx);

    // Límite por fuente (p. ej. la carpeta de UN cliente): se toma el path_lower que Dropbox devuelve para ese id y, desde aquí, TODO se decide
    // contra esa carpeta. Si el id no es una carpeta dentro de las autorizadas, no se consulta nada.
    let raices = autorizadas;
    if (typeof body.limite === "string") {
      const lm = await api(h, "files/get_metadata", { path: body.limite, include_deleted: false });
      const efectivas = lm?.[".tag"] === "folder" ? raicesEfectivas(autorizadas, lm.path_lower) : null;
      if (!efectivas) throw new ErrorPuente(403, "La carpeta de esta fuente está fuera de las autorizadas para los agentes.");
      raices = efectivas;
    }

    // Metadata del elemento pedido; decide el alcance con la ruta que devuelve Dropbox.
    const metadata = async (ref: string): Promise<any> => {
      const path = ref === "raiz" ? raices[0] : ref;
      const m = await api(h, "files/get_metadata", { path, include_deleted: false });
      if (!dentroDeRaices(m?.path_lower, raices)) throw new ErrorPuente(403, "Ese elemento está fuera de las carpetas autorizadas para los agentes.");
      return m;
    };

    if (body.action === "probar") {
      const m = await metadata("raiz");
      const l = await api(h, "files/list_folder", { path: m.path_lower, recursive: false, limit: 50 });
      return json({ ok: true, raices, en_la_raiz: (l.entries ?? []).length, hay_mas: !!l.has_more, equipo: !!ctx.raiz });
    }

    if (!referenciaValida(body.ref)) return json({ error: "Referencia no válida." }, 400);
    const ref = body.ref as string;

    if (body.action === "listar") {
      const m = await metadata(ref);
      if (m[".tag"] !== "folder") throw new ErrorPuente(400, "Eso no es una carpeta; usa leer.");
      const entradas = [];
      let pagina = await api(h, "files/list_folder", { path: m.path_lower, recursive: false, include_deleted: false, limit: 200 });
      for (let i = 0; ; i++) {
        for (const e of pagina.entries ?? []) { const p = entradaPublica(e, raices); if (p) entradas.push(p); }
        if (!pagina.has_more || i + 1 >= MAX_PAGINAS || entradas.length >= MAX_ENTRADAS) break;
        pagina = await api(h, "files/list_folder/continue", { cursor: pagina.cursor });
      }
      const truncado = entradas.length > MAX_ENTRADAS || !!pagina.has_more;
      console.log(`agente-dropbox listar ${m.id} entradas=${entradas.length}`);
      return json({ carpeta: { id: m.id, nombre: recortar(m.name, 200), ruta: recortar(m.path_display, 500) }, entradas: entradas.slice(0, MAX_ENTRADAS), truncado });
    }

    if (body.action === "leer") {
      const m = await metadata(ref);
      if (m[".tag"] !== "file") throw new ErrorPuente(400, "Eso es una carpeta; usa listar.");
      const nombre = recortar(m.name, 200), mime = mimePorNombre(nombre);
      if (!mime) throw new ErrorPuente(415, "Ese tipo de archivo no se puede leer (se aceptan pdf, docx, xlsx, texto e imágenes).");
      if (typeof m.size === "number" && m.size > MAX_BYTES_LEER) throw new ErrorPuente(413, "El archivo es demasiado grande para leerlo.");
      const hd = cabeceras(token, ctx, false);
      hd["Dropbox-API-Arg"] = JSON.stringify({ path: m.id });   // los ids son ASCII; nunca se manda el nombre en la cabecera
      const r = await fetch("https://content.dropboxapi.com/2/files/download", { method: "POST", headers: hd });
      if (!r.ok) { console.error("agente-dropbox: download", r.status); throw new ErrorPuente(502, "No se pudo descargar el archivo."); }
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (bytes.length > MAX_BYTES_LEER) throw new ErrorPuente(413, "El archivo es demasiado grande para leerlo.");
      console.log(`agente-dropbox leer ${m.id} bytes=${bytes.length}`);
      return json({ nombre, mime, tamano: bytes.length, modificado: m.server_modified ?? null, base64: base64(bytes) });
    }

    return json({ error: "Acción no válida." }, 400);
  } catch (e) {
    if (e instanceof ErrorPuente) return json({ error: e.message }, e.estado);
    console.error("agente-dropbox", e instanceof Error ? e.message : e);
    return json({ error: "Error interno." }, 500);
  }
});
