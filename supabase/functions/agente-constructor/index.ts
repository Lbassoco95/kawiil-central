import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  AVISO_SECRETO,
  HERRAMIENTA_PROPONER,
  ORG_AGENTES,
  SYSTEM_CONSTRUCTOR,
  filaDesdePropuesta,
  limpiarMensajes,
  pareceSecreto,
  validarPropuesta,
} from "../_shared/agenteConstructor.ts";

/**
 * agente-constructor
 * ------------------
 * Chat especializado para diseñar agentes de Kawiil OS y, con confirmación explícita, crearlos en `agent_registry`.
 *
 *   action "chat"  → { mensajes } → { texto, propuesta | null }   (no escribe nada)
 *   action "crear" → { propuesta } → { agente }                   (inserta UNA fila en agent_registry)
 *
 * Seguridad:
 *   - verify_jwt=true; el usuario sale del JWT, nunca del body.
 *   - Solo admin/manager (is_admin_or_manager): crear un agente es una decisión de Dirección.
 *   - "chat" solo habla con el modelo y devuelve una propuesta; el modelo no tiene ninguna herramienta que escriba.
 *   - "crear" no confía en el modelo ni en el navegador: revalida la propuesta, arma el prompt de sistema en el servidor
 *     (con las reglas fijas del despacho) y inserta con service_role una fila `kind='consultable'`, `status='idle'`.
 *   - Contraseñas: nunca se guardan ni se mandan al modelo. Solo se aceptan referencias op:// de 1Password; un mensaje que parezca contener un secreto se rechaza.
 *   - No ejecuta tareas ni toca a la VM: el agente queda registrado; la VM `kawiil-agents` lo tomará del registro.
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

const MODELO_CHAT = "claude-sonnet-4-6";

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
    if (!esAdmin) return json({ error: "Solo Dirección puede crear agentes." }, 403);

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }

    // ── Chat ──────────────────────────────────────────────────────────────────────────────────────
    if (body.action === "chat") {
      const mensajes = limpiarMensajes(body.mensajes);
      if (mensajes.length === 0) return json({ error: "Escribe un mensaje para empezar." }, 400);
      // Un secreto pegado en el chat no se manda al modelo ni se guarda: se le pide a la persona que use 1Password.
      if (pareceSecreto(mensajes[mensajes.length - 1].content)) return json({ texto: AVISO_SECRETO, propuesta: null, avisos: [], secreto: true });
      const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
      if (!apiKey) return json({ error: "El servicio de IA no está configurado." }, 503);

      const r = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
        body: JSON.stringify({
          model: MODELO_CHAT, max_tokens: 2048, system: SYSTEM_CONSTRUCTOR, messages: mensajes,
          tools: [HERRAMIENTA_PROPONER],
        }),
        signal: AbortSignal.timeout(60_000),
      });
      if (!r.ok) {
        console.error("agente-constructor: anthropic", r.status, (await r.text()).slice(0, 300));
        return json({ error: "El asistente no pudo responder. Inténtalo de nuevo." }, 502);
      }
      const d = await r.json();
      const bloques: Array<{ type: string; text?: string; name?: string; input?: unknown }> = d.content ?? [];
      const texto = bloques.filter((b) => b.type === "text").map((b) => b.text ?? "").join("\n").trim();
      const uso = bloques.find((b) => b.type === "tool_use" && b.name === HERRAMIENTA_PROPONER.name);
      let propuesta = null;
      let avisos: string[] = [];
      if (uso) {
        const v = validarPropuesta(uso.input);
        if (v.ok) propuesta = v.propuesta; else avisos = v.errores;
      }
      return json({
        texto: texto || (propuesta ? "Te dejo la propuesta para que la revises." : "Cuéntame un poco más sobre lo que necesitas."),
        propuesta,
        avisos,
      });
    }

    // ── Crear ─────────────────────────────────────────────────────────────────────────────────────
    if (body.action === "crear") {
      const v = validarPropuesta(body.propuesta);
      if (!v.ok) return json({ error: "La propuesta no está completa.", errores: v.errores }, 422);

      const ahora = new Date();
      let fila = filaDesdePropuesta(v.propuesta, userId, ahora);
      // Nombre único: si ya existe, no se sobrescribe nada; se agrega un sufijo corto.
      const { data: existentes, error: errBusca } = await admin.from("agent_registry").select("name").eq("organization_id", ORG_AGENTES).like("name", `${fila.name}%`);
      if (errBusca) { console.error("agente-constructor: busca", errBusca.message); return json({ error: "No se pudo revisar el registro." }, 500); }
      const usados = new Set((existentes ?? []).map((x: { name: string }) => x.name));
      for (let n = 2; usados.has(fila.name); n++) fila = filaDesdePropuesta(v.propuesta, userId, ahora, `_${n}`);

      const { data, error } = await admin.from("agent_registry").insert(fila).select("id, name, display_name, role, status").single();
      if (error || !data) { console.error("agente-constructor: insert", error?.message); return json({ error: "No se pudo crear el agente." }, 500); }
      return json({ agente: data }, 201);
    }

    return json({ error: "Acción no válida." }, 400);
  } catch (err) {
    console.error("agente-constructor: unexpected", (err as { message?: string })?.message ?? err);
    return json({ error: "Internal server error" }, 500);
  }
});
