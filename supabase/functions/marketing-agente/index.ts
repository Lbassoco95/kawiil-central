// Analista de resultados de Marketing (agente con IA, SOLO LECTURA). Versión 1.
// - Requiere sesión de usuario (verify_jwt = true) y el permiso de ver Marketing (mk_can_view): sin él, 403.
// - Lee datos únicamente por la función SQL mk_analista_datos (lista cerrada, solo lectura). No habla con Metricool ni conoce su token.
// - Las cifras salen de la base; cada respuesta se verifica contra lo que leyó (_shared/analista.ts) y se marca si no se pudo verificar.
// - Topes de uso por usuario y por mes; cada pregunta queda en mk_consulta y deja tarea y latido en el registro de agentes.
// - Secretos por nombre: ANTHROPIC_API_KEY (ya existe en el proyecto). Opcionales: MARKETING_AGENTE_MODELO, MARKETING_AGENTE_MAX_DIA,
//   MARKETING_AGENTE_MAX_TOKENS_MES.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  correrConsulta, evaluarLimites, inicioDiaCDMX, inicioMesCDMX, leerLimites, MODELO_POR_DEFECTO, validarPregunta,
  type Herramienta, type Herramientas, type Llm, type Mensaje, type ResultadoConsulta,
} from "../_shared/analista.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });
const AGENTE = "marketing_analista";

// Llamada a la API de mensajes de Anthropic con herramientas. Devuelve el formato que espera correrConsulta.
function llmAnthropic(apiKey: string, modelo: string): Llm {
  return async ({ system, mensajes, herramientas }: { system: string; mensajes: Mensaje[]; herramientas: Herramienta[] }) => {
    const r = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: { "x-api-key": apiKey, "anthropic-version": "2023-06-01", "content-type": "application/json" },
      body: JSON.stringify({ model: modelo, max_tokens: 1024, system, messages: mensajes, tools: herramientas.map((h) => ({ name: h.name, description: h.description, input_schema: h.input_schema })) }),
      signal: AbortSignal.timeout(45_000),
    });
    if (!r.ok) throw new Error(`anthropic ${r.status}`);
    const d = await r.json();
    return { contenido: d.content ?? [], stop_reason: d.stop_reason ?? "end_turn", uso: { entrada: d.usage?.input_tokens ?? 0, salida: d.usage?.output_tokens ?? 0 } };
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
  if (req.method !== "POST") return json({ ok: false, error: "método no permitido" }, 405);

  const t0 = Date.now();
  const url = Deno.env.get("SUPABASE_URL")!, anon = Deno.env.get("SUPABASE_ANON_KEY")!, service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const auth = req.headers.get("Authorization") ?? "";
  if (!auth.toLowerCase().startsWith("bearer ")) return json({ ok: false, error: "Inicia sesión para preguntar." }, 401);

  // 1) Quién pregunta y si puede ver Marketing (con la sesión del propio usuario, no con la llave de servicio).
  const usuario = createClient(url, anon, { global: { headers: { Authorization: auth } }, auth: { persistSession: false } });
  const { data: u } = await usuario.auth.getUser();
  if (!u?.user) return json({ ok: false, error: "Inicia sesión para preguntar." }, 401);
  const { data: puede, error: errPermiso } = await usuario.rpc("mk_can_view");
  if (errPermiso || puede !== true) return json({ ok: false, error: "No tienes el permiso de Marketing." }, 403);
  const { data: org } = await usuario.rpc("mk_org_id");
  if (!org) return json({ ok: false, error: "No se pudo identificar tu organización." }, 403);

  // 2) La pregunta.
  let cuerpo: { pregunta?: unknown } = {};
  try { cuerpo = await req.json(); } catch { return json({ ok: false, error: "Solicitud no válida." }, 400); }
  const v = validarPregunta(cuerpo.pregunta);
  if (!v.ok) return json({ ok: false, error: v.error }, 400);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) { console.error("marketing-agente: falta ANTHROPIC_API_KEY"); return json({ ok: false, error: "El Analista no está configurado todavía." }, 500); }
  const modelo = Deno.env.get("MARKETING_AGENTE_MODELO") || MODELO_POR_DEFECTO;
  const db = createClient(url, service, { auth: { persistSession: false } });

  // 3) Topes de uso.
  const ahora = new Date();
  const [{ count: hoy }, { data: mes }] = await Promise.all([
    db.from("mk_consulta").select("id", { count: "exact", head: true }).eq("user_id", u.user.id).gte("created_at", inicioDiaCDMX(ahora)),
    db.from("mk_consulta").select("tokens_entrada, tokens_salida").eq("organization_id", org).gte("created_at", inicioMesCDMX(ahora)).limit(5000),
  ]);
  const tokensMes = (mes ?? []).reduce((s: number, f: { tokens_entrada: number; tokens_salida: number }) => s + f.tokens_entrada + f.tokens_salida, 0);
  const limite = evaluarLimites({ consultasHoyUsuario: hoy ?? 0, tokensMes }, leerLimites((k) => Deno.env.get(k)));
  if (!limite.permitido) {
    await db.from("mk_consulta").insert({ organization_id: org, user_id: u.user.id, pregunta: v.pregunta, estado: "rechazada_limite", modelo });
    return json({ ok: false, error: limite.mensaje, limite: limite.motivo }, 429);
  }

  // 4) Herramientas: cada una llama a la función SQL de lista cerrada con la organización del usuario.
  const nombres = ["colchon_actual", "resultados_semanales", "resultados_por_formato", "resultados_por_pilar", "semaforo_semanas", "casos_abiertos", "informe_hoy", "piezas_proximas", "reglas_vigentes", "cobertura_fuentes"];
  const herramientas: Herramientas = Object.fromEntries(nombres.map((n) => [n, async (entrada: Record<string, unknown>) => {
    const { data, error } = await db.rpc("mk_analista_datos", { p_org: org, p_herramienta: n, p_entrada: entrada });
    if (error) throw new Error(error.message);
    return data;
  }]));

  // 5) Consulta.
  const inicio = new Date().toISOString();
  let res: ResultadoConsulta | null = null, fallo = false;
  try { res = await correrConsulta({ pregunta: v.pregunta, herramientas, llm: llmAnthropic(apiKey, modelo) }); } catch (e) {
    fallo = true; console.error("marketing-agente: falla del modelo", e instanceof Error ? e.message : "error");
  }
  const ok = !fallo && !!res?.ok;

  const { data: fila, error: errGuardar } = await db.from("mk_consulta").insert({
    organization_id: org, user_id: u.user.id, pregunta: v.pregunta, respuesta: ok ? res!.respuesta : null, estado: ok ? "respondida" : "error",
    verificada: ok ? res!.verificada : null, no_verificadas: ok ? res!.no_verificadas : [],
    herramientas: (res?.fuentes ?? []).map((f) => ({ herramienta: f.herramienta, filas: f.filas })), modelo,
    tokens_entrada: res?.tokens.entrada ?? 0, tokens_salida: res?.tokens.salida ?? 0, duracion_ms: Date.now() - t0,
  }).select("id").single();

  // 6) Tarea y latido en el registro de agentes. Un fallo aquí no tumba la respuesta, pero no se calla: queda en el registro de la función.
  const { error: errRegistro } = await db.rpc("mk_registrar_corrida", {
    p_agente: AGENTE, p_estado: ok ? "completed" : "error", p_titulo: `Pregunta ${inicioDiaCDMX(ahora).slice(0, 10)}`,
    p_resumen: ok ? `${res!.verificada ? "cifras verificadas" : `${res!.no_verificadas.length} cifras sin verificar`}; ${res!.fuentes.length} consultas de datos` : "no se pudo responder",
    p_resultado: { herramientas: (res?.fuentes ?? []).map((f) => f.herramienta), tokens: res?.tokens ?? null, verificada: ok ? res!.verificada : null }, p_inicio: inicio,
  });
  if (errRegistro) console.error("marketing-agente: no se pudo registrar la corrida", errRegistro.message);
  if (errGuardar) console.error("marketing-agente: no se pudo guardar la consulta", errGuardar.message);

  if (!ok) return json({ ok: false, error: "El Analista no pudo responder ahora. Inténtalo de nuevo en un momento.", consulta_id: fila?.id ?? null }, 502);
  return json({
    ok: true, consulta_id: fila?.id ?? null, respuesta: res!.respuesta, verificada: res!.verificada, no_verificadas: res!.no_verificadas,
    fuentes: res!.fuentes, restantes_hoy: limite.restantesHoy - 1,
  });
});
