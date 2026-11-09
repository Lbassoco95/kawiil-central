import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ORG_AGENTES } from "../_shared/agenteConstructor.ts";
import {
  BUCKET_ENTREGABLES,
  detalleTarea,
  entregablesDe,
  esUuid,
  estadosDelGrupo,
  limpiarActividad,
  limpiarEvento,
  resumirTarea,
  truncar,
} from "../_shared/seguimiento.ts";

/**
 * agente-seguimiento
 * ------------------
 * Seguimiento de las tareas que se le mandan a los agentes y descarga de los documentos que entregan.
 *
 *   action "listar"    → { grupo?: en_curso|terminadas|con_error|canceladas, agent_id?, limite? } → { tareas }
 *   action "detalle"   → { task_id } → { tarea, eventos, actividad }
 *   action "descargar" → { task_id, indice } → { url, nombre, expira_en }   (enlace firmado de 5 minutos)
 *
 * Seguridad:
 *   - verify_jwt=true; el usuario sale del JWT. Solo admin/manager (is_admin_or_manager): las tareas traen datos de clientes.
 *   - Lee con service_role (las tablas de agentes están en otra organización que los usuarios y `ai_task_events` no es legible para ellos),
 *     pero solo tareas de la organización de agentes y solo de agentes que no son de sistema (Marketing tiene su propia vista).
 *   - Los documentos están en un bucket PRIVADO. La ruta no sale nunca hacia el navegador: se saca del registro de la tarea, se revalida
 *     (debe colgar de la carpeta de ESA tarea) y se firma por 5 minutos. El body no puede pedir una ruta arbitraria.
 *   - No escribe nada ni toca a la VM.
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

const EXPIRA_SEGUNDOS = 300;

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
    if (!esAdmin) return json({ error: "Solo Dirección puede ver el seguimiento de los agentes." }, 403);

    let body: Record<string, unknown>;
    try { body = await req.json(); } catch { return json({ error: "Invalid JSON body" }, 400); }

    // Agentes visibles (sin los de sistema) → nombre por id.
    const { data: agentes, error: errAg } = await admin.from("agent_registry")
      .select("id, name, display_name, kind").eq("organization_id", ORG_AGENTES);
    if (errAg) return json({ error: "No se pudo leer el registro de agentes." }, 500);
    const nombres = new Map<string, string>();
    for (const a of agentes ?? []) if (a.kind !== "system") nombres.set(a.id, (a.display_name || a.name || "").trim() || a.name);

    // ── Listar ──
    if (body.action === "listar") {
      const limite = Math.min(Math.max(Number(body.limite) || 60, 1), 100);
      let q = admin.from("agent_tasks")
        .select("id, agent_id, task_type, title, status, priority, created_at, started_at, completed_at, result_summary, entregables:result->entregables")
        .eq("organization_id", ORG_AGENTES).in("agent_id", [...nombres.keys()])
        .order("created_at", { ascending: false }).limit(limite);
      const estados = estadosDelGrupo(body.grupo);
      if (estados) q = q.in("status", estados);
      if (body.agent_id !== undefined) {
        if (!esUuid(body.agent_id) || !nombres.has(body.agent_id)) return json({ error: "Agente no válido." }, 400);
        q = q.eq("agent_id", body.agent_id);
      }
      const { data, error } = await q;
      if (error) { console.error("agente-seguimiento listar", error.message); return json({ error: "No se pudieron leer las tareas." }, 500); }
      const tareas = (data ?? []).map((t: Record<string, unknown>) =>
        resumirTarea({ ...t, result: { entregables: t.entregables } }, nombres.get(String(t.agent_id)) ?? "Agente"));
      return json({ tareas });
    }

    // Detalle y descarga necesitan una tarea concreta de un agente visible.
    if (body.action === "detalle" || body.action === "descargar") {
      if (!esUuid(body.task_id)) return json({ error: "Tarea no válida." }, 400);
      const { data: tarea, error } = await admin.from("agent_tasks").select("*")
        .eq("id", body.task_id).eq("organization_id", ORG_AGENTES).maybeSingle();
      if (error) { console.error("agente-seguimiento tarea", error.message); return json({ error: "No se pudo leer la tarea." }, 500); }
      if (!tarea || !nombres.has(tarea.agent_id)) return json({ error: "No encontramos esa tarea." }, 404);
      const nombreAgente = nombres.get(tarea.agent_id)!;

      if (body.action === "detalle") {
        const [ev, act] = await Promise.all([
          admin.from("ai_task_events").select("event_type, sequence, progress, payload, created_at")
            .eq("task_id", tarea.id).order("sequence", { ascending: true }).limit(200),
          admin.from("agent_activity_logs").select("action, message, level, created_at")
            .eq("task_id", tarea.id).order("created_at", { ascending: true }).limit(100),
        ]);
        return json({
          tarea: detalleTarea(tarea, nombreAgente),
          eventos: (ev.data ?? []).map(limpiarEvento),
          actividad: (act.data ?? []).map(limpiarActividad),
        });
      }

      const lista = entregablesDe(tarea.id, tarea.result);
      const indice = Number(body.indice);
      if (!Number.isInteger(indice) || indice < 0 || indice >= lista.length) return json({ error: "Ese documento no existe." }, 404);
      const e = lista[indice];
      const { data: firmado, error: errFirma } = await admin.storage.from(BUCKET_ENTREGABLES)
        .createSignedUrl(e.ruta, EXPIRA_SEGUNDOS, { download: truncar(e.nombre, 120) });
      if (errFirma || !firmado?.signedUrl) {
        console.error("agente-seguimiento firma", errFirma?.message);
        return json({ error: "El documento no está disponible todavía. Inténtalo de nuevo en un momento." }, 404);
      }
      return json({ url: firmado.signedUrl, nombre: e.nombre, expira_en: EXPIRA_SEGUNDOS });
    }

    return json({ error: "Acción no válida." }, 400);
  } catch (e) {
    console.error("agente-seguimiento", e instanceof Error ? e.message : e);
    return json({ error: "Error interno." }, 500);
  }
});
