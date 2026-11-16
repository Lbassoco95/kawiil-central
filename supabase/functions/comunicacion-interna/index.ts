import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { pareceSecreto, AVISO_SECRETO } from "../_shared/agenteConstructor.ts";
import { AGENTE_COMUNICACION, HERRAMIENTA_AVISO, borradorDeRespuesta, hoyEnMexico, systemRedactor, validarAviso } from "../_shared/avisos.ts";

/**
 * comunicacion-interna
 * --------------------
 * Comunicación interna de Kawiil: el agente «Comunicación interna» redacta un aviso para el equipo (por ejemplo, un día en que no se trabaja)
 * y, tras la aprobación de una persona de Dirección, una función del sistema lo publica. El aviso se ve en pantalla al entrar al sistema esos días.
 *
 *   action "redactar" → { instruccion } → { borrador }        (el modelo propone; NO escribe nada)
 *   action "publicar" → { aviso, redactado_por? } → { aviso }  (lo aprueba la persona: inserta UNA fila en aviso_equipo)
 *   action "cancelar" → { id } → { ok }                       (el aviso deja de verse; queda en el historial)
 *   action "listar"   → {} → { avisos }                       (publicados y cancelados recientes)
 *
 * Seguridad:
 *   - verify_jwt=true; el usuario sale del JWT. Solo admin/manager (is_admin_or_manager).
 *   - El modelo no tiene ninguna herramienta que escriba: solo `proponer_aviso`. Lo que propone se revalida igual que lo que manda el navegador.
 *   - Solo panel: no manda correo, Slack ni WhatsApp. Un texto que parezca una contraseña o clave se rechaza y no se manda al modelo.
 *   - Cada redacción y cada publicación quedan como corrida del agente (mk_registrar_corrida). Un fallo al registrar no tumba la respuesta.
 *
 * Secrets: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const MODELO = "claude-sonnet-4-6";
const COLUMNAS = "id, tipo, titulo, mensaje, desde, hasta, estado, redactado_por, aprobado_at, cancelado_at, created_at";
const esUuid = (v: unknown): v is string => typeof v === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v);

serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return json({ error: "Missing or invalid Authorization header" }, 401);

    const url = Deno.env.get("SUPABASE_URL")!;
    const supabaseUser = createClient(url, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: userData, error: userError } = await supabaseUser.auth.getUser();
    if (userError || !userData.user) return json({ error: "Invalid or expired JWT" }, 401);
    const userId = userData.user.id;

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: esAdmin } = await admin.rpc("is_admin_or_manager", { _user_id: userId });
    if (!esAdmin) return json({ error: "Solo Dirección puede publicar avisos para el equipo." }, 403);

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }
    const hoy = hoyEnMexico();
    const registrar = async (estado: "completed" | "error", titulo: string, resumen: string, inicio: string) => {
      const { error } = await admin.rpc("mk_registrar_corrida", { p_agente: AGENTE_COMUNICACION, p_estado: estado, p_titulo: titulo, p_resumen: resumen, p_resultado: { origen: "comunicacion-interna" }, p_inicio: inicio });
      if (error) console.error("comunicacion-interna: no se pudo registrar la corrida", error.message);
    };

    if (body.action === "redactar") {
      const instruccion = typeof body.instruccion === "string" ? body.instruccion.replace(/\s+/g, " ").trim() : "";
      if (instruccion.length < 8) return json({ error: "Cuéntame qué quieres avisar (por ejemplo: «el lunes 16 no se trabaja»)." }, 400);
      if (instruccion.length > 800) return json({ error: "La instrucción es muy larga (máximo 800 caracteres)." }, 400);
      if (pareceSecreto(instruccion)) return json({ error: AVISO_SECRETO }, 400);
      const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
      if (!apiKey) return json({ error: "El servicio de IA no está configurado." }, 503);

      const inicio = new Date().toISOString();
      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: MODELO, max_tokens: 1024, system: systemRedactor(hoy), messages: [{ role: "user", content: instruccion }],
          tools: [HERRAMIENTA_AVISO], tool_choice: { type: "tool", name: HERRAMIENTA_AVISO.name },
        }),
      });
      if (!r.ok) {
        console.error("comunicacion-interna: falla del modelo", r.status);
        await registrar("error", `Redacción ${hoy}`, "no se pudo redactar", inicio);
        return json({ error: "No se pudo redactar ahora. Inténtalo de nuevo en un momento." }, 502);
      }
      const data = await r.json();
      const v = borradorDeRespuesta(data?.content, hoy);
      if (!v || !v.ok) {
        await registrar("error", `Redacción ${hoy}`, "el borrador no era válido", inicio);
        return json({ error: v && !v.ok ? `El borrador no quedó bien: ${v.errores.join(" ")}` : "No se pudo redactar un aviso con esa instrucción. Dame más detalle." }, 422);
      }
      await registrar("completed", `Redacción ${hoy}`, "borrador propuesto; falta la aprobación de Dirección", inicio);
      return json({ borrador: v.aviso });
    }

    if (body.action === "publicar") {
      const v = validarAviso(body.aviso, hoy);
      if (!v.ok) return json({ error: v.errores.join(" ") }, 400);
      const inicio = new Date().toISOString();
      const { data, error } = await admin.from("aviso_equipo").insert({
        tipo: v.aviso.tipo, titulo: v.aviso.titulo, mensaje: v.aviso.mensaje, desde: v.aviso.desde, hasta: v.aviso.hasta,
        redactado_por: body.redactado_por === "agente" ? "agente" : "direccion", aprobado_por: userId, estado: "publicado",
      }).select(COLUMNAS).single();
      if (error) { console.error("comunicacion-interna publicar", error.message); return json({ error: "No se pudo publicar el aviso." }, 500); }
      await registrar("completed", `Aviso publicado ${hoy}`, `aviso del ${v.aviso.desde} al ${v.aviso.hasta} publicado con aprobación de Dirección`, inicio);
      return json({ aviso: data });
    }

    if (body.action === "cancelar") {
      if (!esUuid(body.id)) return json({ error: "Aviso no válido." }, 400);
      const { data, error } = await admin.from("aviso_equipo").update({ estado: "cancelado", cancelado_at: new Date().toISOString() })
        .eq("id", body.id).eq("estado", "publicado").select("id").maybeSingle();
      if (error) { console.error("comunicacion-interna cancelar", error.message); return json({ error: "No se pudo cancelar el aviso." }, 500); }
      if (!data) return json({ error: "No encontramos ese aviso o ya estaba cancelado." }, 404);
      return json({ ok: true });
    }

    if (body.action === "listar") {
      const { data, error } = await admin.from("aviso_equipo").select(COLUMNAS).order("created_at", { ascending: false }).limit(30);
      if (error) { console.error("comunicacion-interna listar", error.message); return json({ error: "No se pudieron leer los avisos." }, 500); }
      return json({ avisos: data ?? [] });
    }

    return json({ error: "Acción no válida." }, 400);
  } catch (e) {
    console.error("comunicacion-interna", e instanceof Error ? e.message : "error");
    return json({ error: "Error inesperado." }, 500);
  }
});
