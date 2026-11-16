import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { COLUMNAS_MEMORIA, MAX_MEMORIAS, ORG_AGENTES, esUuid, memoriaPublica, memoriasPublicas, validarCambio } from "../_shared/memoria.ts";

/**
 * agente-memoria
 * --------------
 * Revisar la memoria de los agentes (tabla agent_memories) y apagar la que esté mal. NUNCA devuelve el texto de una memoria.
 *
 *   action "listar" → { agent_id? } → { memorias: [{ id, agent_id, tipo, categoria, importancia, activa, usos, ultimo_uso, vence, creada }] }
 *   action "cambiar" → { id, activa: boolean } → { memoria }   (solo enciende o apaga: columna `enabled`; no borra ni edita nada más)
 *
 * Seguridad:
 *   - verify_jwt=true; el usuario sale del JWT. Solo admin/manager (is_admin_or_manager): decidir qué recuerda un agente es de Dirección.
 *   - agent_memories solo permite service_role (RLS), por eso la función lee y escribe con la llave de servicio, acotada a la organización de agentes.
 *   - La lectura nombra sus columnas y NO incluye `content` ni `source_description`; la escritura solo toca `enabled` y `updated_at`.
 *   - Una memoria apagada deja de usarse cuando la VM respete `enabled` (la tabla ya tiene la columna); encenderla la devuelve. Reversible.
 *
 * Secrets: SUPABASE_URL, SUPABASE_ANON_KEY, SUPABASE_SERVICE_ROLE_KEY.
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};
const json = (payload: unknown, status = 200) =>
  new Response(JSON.stringify(payload), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

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

    const admin = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: esAdmin } = await admin.rpc("is_admin_or_manager", { _user_id: userData.user.id });
    if (!esAdmin) return json({ error: "Solo Dirección puede revisar la memoria de los agentes." }, 403);

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }

    if (body.action === "listar") {
      let q = admin.from("agent_memories").select(COLUMNAS_MEMORIA).eq("organization_id", ORG_AGENTES)
        .order("importance", { ascending: false }).order("created_at", { ascending: false }).limit(MAX_MEMORIAS);
      if (body.agent_id !== undefined) {
        if (!esUuid(body.agent_id)) return json({ error: "Agente no válido." }, 400);
        q = q.eq("agent_id", body.agent_id);
      }
      const { data, error } = await q;
      if (error) { console.error("agente-memoria listar", error.message); return json({ error: "No se pudo leer la memoria." }, 500); }
      return json({ memorias: memoriasPublicas(data) });
    }

    if (body.action === "cambiar") {
      const v = validarCambio(body);
      if (!v.ok) return json({ error: v.error }, 400);
      const { data, error } = await admin.from("agent_memories").update({ enabled: v.activa, updated_at: new Date().toISOString() })
        .eq("id", v.id).eq("organization_id", ORG_AGENTES).select(COLUMNAS_MEMORIA).maybeSingle();
      if (error) { console.error("agente-memoria cambiar", error.message); return json({ error: "No se pudo cambiar la memoria." }, 500); }
      const memoria = data ? memoriaPublica(data as Record<string, unknown>) : null;
      if (!memoria) return json({ error: "No encontramos esa memoria." }, 404);
      return json({ memoria });
    }

    return json({ error: "Acción no válida." }, 400);
  } catch (e) {
    console.error("agente-memoria", e instanceof Error ? e.message : "error");
    return json({ error: "Error inesperado." }, 500);
  }
});
