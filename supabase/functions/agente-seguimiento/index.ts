import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ORG_AGENTES } from "../_shared/agenteConstructor.ts";
import {
  BUCKET_ENTREGABLES,
  MAX_REVISIONES_POR_AGENTE,
  MAX_REVISIONES_POR_HILO,
  TIPO_REVISION,
  TIPO_UNIDAD,
  aprobarPlan,
  cancelarPlan,
  contextoRevision,
  detalleTarea,
  dominiosEscritura,
  entregablesDe,
  esUuid,
  estadosDelGrupo,
  limpiarActividad,
  limpiarEvento,
  mensajesDelHilo,
  planEnMarcha,
  planPublico,
  raizDelHilo,
  resumirTarea,
  revisionesPendientes,
  truncar,
  validarRevision,
} from "../_shared/seguimiento.ts";

/**
 * agente-seguimiento
 * ------------------
 * Seguimiento de las tareas que se le mandan a los agentes y descarga de los documentos que entregan.
 *
 *   action "listar"    → { grupo?: en_curso|terminadas|con_error|canceladas, agent_id?, limite? } → { tareas }
 *   action "detalle"   → { task_id } → { tarea, eventos, actividad }
 *   action "descargar" → { task_id, indice } → { url, nombre, expira_en }   (enlace firmado de 5 minutos)
 *   action "hilo"      → { task_id } → { hilo, mensajes, revisiones, en_curso }   (la solicitud y su conversación; cualquier tarea del hilo sirve)
 *   action "programar_revision" → { task_id, cuando, repetir?, veces?, instruccion? } → { revision }   (una tarea pendiente que la VM ejecuta a su hora)
 *   action "cancelar_revision"  → { task_id } → { ok }   (task_id = la revisión)
 *   action "aprobar_plan"       → { task_id } → { ok, fase }   (task_id = el encargo; aprueba un plan propuesto o reanuda uno pausado)
 *   action "cancelar_encargo"   → { task_id } → { ok }   (cancela el encargo y los clientes que no han empezado)
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
const nombreDe = (nombres: Map<string, string>, id: string) => nombres.get(id) ?? "Agente";

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
        .select("id, agent_id, task_type, title, status, priority, created_at, started_at, completed_at, result_summary, entregables:result->entregables, hilo:input_context->>hilo_id")
        .eq("organization_id", ORG_AGENTES).in("agent_id", [...nombres.keys()]).neq("task_type", TIPO_UNIDAD)
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

    // ── Hilos y revisiones programadas ──
    if (["hilo", "programar_revision", "cancelar_revision", "aprobar_plan", "cancelar_encargo"].includes(body.action as string)) {
      if (!esUuid(body.task_id)) return json({ error: "Tarea no válida." }, 400);
      const { data: t0 } = await admin.from("agent_tasks").select("id, agent_id, title, task_type, status, input_context")
        .eq("id", body.task_id).eq("organization_id", ORG_AGENTES).maybeSingle();
      if (!t0 || !nombres.has(t0.agent_id)) return json({ error: "No encontramos esa tarea." }, 404);

      if (body.action === "cancelar_revision") {
        if (t0.task_type !== TIPO_REVISION || t0.status !== "pending") return json({ error: "Esa revisión ya no está pendiente." }, 409);
        const { error: errC } = await admin.from("agent_tasks").update({ status: "cancelled", error_message: "Cancelada por Dirección.", updated_at: new Date().toISOString() })
          .eq("id", t0.id).eq("status", "pending");
        if (errC) { console.error("agente-seguimiento cancelar", errC.message); return json({ error: "No se pudo cancelar." }, 500); }
        return json({ ok: true });
      }

      if (body.action === "aprobar_plan" || body.action === "cancelar_encargo") {
        const { data: fila } = await admin.from("agent_tasks").select("id, status, result").eq("id", t0.id).eq("organization_id", ORG_AGENTES).maybeSingle();
        const result = (fila?.result && typeof fila.result === "object" ? fila.result : {}) as Record<string, unknown>;
        const ahora = new Date().toISOString();
        if (body.action === "aprobar_plan") {
          const nuevo = aprobarPlan(result, userData.user.id, ahora);
          if (!nuevo || !fila) return json({ error: "Ese plan ya no está esperando tu aprobación." }, 409);
          // Solo si el estado no cambió desde que se leyó (dos personas aprobando a la vez, o un plan reemplazado).
          const { data: upd, error: errA } = await admin.from("agent_tasks")
            .update({ status: "in_progress", result: nuevo, updated_at: ahora }).eq("id", t0.id).eq("status", fila.status).select("id");
          if (errA) { console.error("agente-seguimiento aprobar", errA.message); return json({ error: "No se pudo aprobar el plan." }, 500); }
          if (!upd?.length) return json({ error: "Ese plan cambió mientras lo revisabas. Vuelve a abrirlo." }, 409);
          await admin.from("agent_activity_logs").insert({
            organization_id: ORG_AGENTES, agent_id: t0.agent_id, task_id: t0.id, action: "plan_aprobado", level: "info",
            message: "Dirección aprobó el plan del encargo.", details: { por: userData.user.id },
          });
          return json({ ok: true, fase: planPublico(nuevo)?.fase });
        }
        const nuevo = cancelarPlan(result, "Cancelado por Dirección.");
        if (!nuevo || !fila) return json({ error: "Ese encargo ya no se puede cancelar." }, 409);
        const { data: upd, error: errX } = await admin.from("agent_tasks")
          .update({ status: "cancelled", error_message: "Cancelado por Dirección.", result: nuevo, updated_at: ahora }).eq("id", t0.id).eq("status", fila.status).select("id");
        if (errX) { console.error("agente-seguimiento cancelar encargo", errX.message); return json({ error: "No se pudo cancelar el encargo." }, 500); }
        if (!upd?.length) return json({ error: "Ese encargo cambió mientras lo revisabas. Vuelve a abrirlo." }, 409);
        // Los clientes que no han empezado se cancelan; el que ya corre termina solo y su resultado no se usa.
        await admin.from("agent_tasks").update({ status: "cancelled", error_message: "Encargo cancelado por Dirección.", updated_at: ahora })
          .eq("organization_id", ORG_AGENTES).eq("task_type", TIPO_UNIDAD).eq("status", "pending").eq("input_context->>encargo_id", t0.id);
        return json({ ok: true });
      }

      const raiz = raizDelHilo(t0);
      if (!esUuid(raiz)) return json({ error: "Tarea no válida." }, 400);   // la raíz se interpola en el filtro: solo un uuid pasa
      const { data: tareas, error: errT } = await admin.from("agent_tasks").select("*").eq("organization_id", ORG_AGENTES)
        .or(`id.eq.${raiz},input_context->>hilo_id.eq.${raiz}`).order("created_at", { ascending: true }).limit(80);
      if (errT) { console.error("agente-seguimiento hilo", errT.message); return json({ error: "No se pudo leer el hilo." }, 500); }
      const lista = (tareas ?? []) as Record<string, unknown>[];
      const original = lista.find((x) => x.id === raiz) ?? t0;

      if (body.action === "hilo") {
        const mensajes = mensajesDelHilo(lista);
        const { data: ag } = await admin.from("agent_registry").select("config").eq("id", t0.agent_id).maybeSingle();
        return json({
          escritura_dominios: dominiosEscritura(ag?.config),
          hilo: { id: raiz, titulo: truncar(original.title, 200), agent_id: t0.agent_id, agente: nombreDe(nombres, t0.agent_id) },
          mensajes, revisiones: revisionesPendientes(lista),
          // Un plan esperando aprobación no es «trabajando»: la persona puede escribir. Un encargo aprobado sí sigue en marcha.
          en_curso: mensajes.some((m) => m.rol === "agente" && (m.plan ? planEnMarcha(m.plan) : ["pending", "queued", "in_progress", "waiting_approval"].includes(m.estado))),
        });
      }

      // programar_revision
      const v = validarRevision(body, Date.now());
      if (!v.ok) return json({ error: "La revisión no es válida.", errores: v.errores }, 422);
      const pendientes = (filtro: Record<string, string>) => {
        let q = admin.from("agent_tasks").select("id", { count: "exact", head: true }).eq("organization_id", ORG_AGENTES).eq("task_type", TIPO_REVISION).eq("status", "pending");
        for (const [k, val] of Object.entries(filtro)) q = q.eq(k, val);
        return q;
      };
      const [{ count: enHilo }, { count: enAgente }] = await Promise.all([pendientes({ "input_context->>hilo_id": raiz }), pendientes({ agent_id: t0.agent_id })]);
      if ((enHilo ?? 0) >= MAX_REVISIONES_POR_HILO) return json({ error: `Este hilo ya tiene ${MAX_REVISIONES_POR_HILO} revisiones pendientes. Cancela alguna primero.` }, 409);
      if ((enAgente ?? 0) >= MAX_REVISIONES_POR_AGENTE) return json({ error: `Este agente ya tiene ${MAX_REVISIONES_POR_AGENTE} revisiones pendientes. Cancela alguna primero.` }, 409);
      const { data: nueva, error: errI } = await admin.from("agent_tasks").insert({
        organization_id: ORG_AGENTES, agent_id: t0.agent_id, task_type: TIPO_REVISION, status: "pending", priority: "normal",
        title: truncar(`Revisión programada · ${original.title ?? "solicitud"}`, 200), description: "Revisión programada por Dirección desde la Oficina.",
        instructions: v.revision.instruccion, input_context: contextoRevision(raiz, v.revision, userData.user.id), created_by: userData.user.id,
      }).select("id").single();
      if (errI) { console.error("agente-seguimiento programar", errI.message); return json({ error: "No se pudo programar la revisión." }, 500); }
      return json({ revision: { id: nueva.id, cuando: v.revision.cuando, repetir: v.revision.repetir, veces: v.revision.veces } });
    }

    return json({ error: "Acción no válida." }, 400);
  } catch (e) {
    console.error("agente-seguimiento", e instanceof Error ? e.message : e);
    return json({ error: "Error interno." }, 500);
  }
});
