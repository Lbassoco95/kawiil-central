// Seguimientos del Analista de resultados (Marketing, SOLO LECTURA). Versión 1.
// - Lo invoca el trabajo diario de las 7:45 (pg_cron/pg_net) con su propio secreto: cabecera x-marketing-secret = MARKETING_CONNECTOR_SECRET.
//   No acepta JWT de usuario, cron_secret ni la llave de servicio como credencial.
// - Reclama los seguimientos vencidos por la función SQL mk_seguimiento_reclamar (adelanta su fecha antes de correrlos: una llamada repetida no duplica).
// - Responde cada uno con el mismo Analista (herramientas de lista cerrada, cifras verificadas) a nombre de quien lo pidió y lo guarda en mk_consulta
//   con su seguimiento_id. Cuenta para el tope mensual de tokens. Solo panel: sin correo, Slack ni WhatsApp.
// - No habla con Metricool ni conoce su token. Secretos por nombre: MARKETING_CONNECTOR_SECRET, ANTHROPIC_API_KEY.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { correrConsulta, evaluarLimites, inicioDiaCDMX, inicioMesCDMX, leerLimites, MODELO_POR_DEFECTO, type ResultadoConsulta } from "../_shared/analista.ts";
import { herramientasDe, llmAnthropic } from "../_shared/analista_servidor.ts";

const AGENTE = "marketing_analista";
const MAX_POR_CORRIDA = 5;

function igual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let d = 0;
  for (let i = 0; i < a.length; i++) d |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return d === 0;
}

Deno.serve(async (req) => {
  const json = (o: unknown, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { "Content-Type": "application/json" } });
  if (req.method !== "POST") return json({ error: "método no permitido" }, 405);
  const secreto = Deno.env.get("MARKETING_CONNECTOR_SECRET") ?? "";
  if (!secreto || !igual(secreto, req.headers.get("x-marketing-secret") ?? "")) return json({ error: "no autorizado" }, 401);

  const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
  if (!apiKey) { console.error("marketing-seguimientos: falta ANTHROPIC_API_KEY"); return json({ ok: false, error: "falta configuración" }, 500); }
  const modelo = Deno.env.get("MARKETING_AGENTE_MODELO") || MODELO_POR_DEFECTO;
  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const limites = leerLimites((k) => Deno.env.get(k));
  const ahora = new Date();

  const { data: tomados, error: errReclamar } = await db.rpc("mk_seguimiento_reclamar", { p_limite: MAX_POR_CORRIDA });
  if (errReclamar) { console.error("marketing-seguimientos: no se pudo reclamar", errReclamar.message); return json({ ok: false, error: "no se pudo leer los seguimientos" }, 500); }
  const lista = (tomados ?? []) as Array<{ id: string; organization_id: string; user_id: string; pregunta: string }>;

  const tokensPorOrg = new Map<string, number>();
  const tokensMes = async (org: string): Promise<number> => {
    if (!tokensPorOrg.has(org)) {
      const { data } = await db.from("mk_consulta").select("tokens_entrada, tokens_salida").eq("organization_id", org).gte("created_at", inicioMesCDMX(ahora)).limit(5000);
      tokensPorOrg.set(org, (data ?? []).reduce((s: number, f: { tokens_entrada: number; tokens_salida: number }) => s + f.tokens_entrada + f.tokens_salida, 0));
    }
    return tokensPorOrg.get(org)!;
  };

  const resumen = { reclamados: lista.length, respondidos: 0, con_error: 0, rechazados_por_tope: 0 };
  for (const s of lista) {
    const t0 = Date.now(), inicio = new Date().toISOString();
    const limite = evaluarLimites({ consultasHoyUsuario: 0, tokensMes: await tokensMes(s.organization_id) }, limites);
    if (!limite.permitido) {
      resumen.rechazados_por_tope++;
      await db.from("mk_consulta").insert({ organization_id: s.organization_id, user_id: s.user_id, pregunta: s.pregunta, estado: "rechazada_limite", modelo, seguimiento_id: s.id });
      continue;
    }
    let res: ResultadoConsulta | null = null, fallo = false;
    try { res = await correrConsulta({ pregunta: s.pregunta, herramientas: herramientasDe(db, s.organization_id), llm: llmAnthropic(apiKey, modelo) }); } catch (e) {
      fallo = true; console.error("marketing-seguimientos: falla del modelo", e instanceof Error ? e.message : "error");
    }
    const ok = !fallo && !!res?.ok;
    if (!ok && !fallo) console.error("marketing-seguimientos: el modelo no redactó respuesta", res?.motivo, "pasos", res?.pasos, res?.detalle ?? "");
    if (ok) resumen.respondidos++; else resumen.con_error++;
    const usados = (res?.tokens.entrada ?? 0) + (res?.tokens.salida ?? 0);
    tokensPorOrg.set(s.organization_id, (await tokensMes(s.organization_id)) + usados);

    const { error: errGuardar } = await db.from("mk_consulta").insert({
      organization_id: s.organization_id, user_id: s.user_id, pregunta: s.pregunta, respuesta: ok ? res!.respuesta : null, estado: ok ? "respondida" : "error",
      verificada: ok ? res!.verificada : null, no_verificadas: ok ? res!.no_verificadas : [],
      herramientas: (res?.fuentes ?? []).map((f) => ({ herramienta: f.herramienta, filas: f.filas })), modelo,
      tokens_entrada: res?.tokens.entrada ?? 0, tokens_salida: res?.tokens.salida ?? 0, duracion_ms: Date.now() - t0, seguimiento_id: s.id,
    });
    const { error: errRegistro } = await db.rpc("mk_registrar_corrida", {
      p_agente: AGENTE, p_estado: ok ? "completed" : "error", p_titulo: `Seguimiento ${inicioDiaCDMX(ahora).slice(0, 10)}`,
      p_resumen: ok ? `${res!.verificada ? "cifras verificadas" : `${res!.no_verificadas.length} cifras sin verificar`}; ${res!.fuentes.length} consultas de datos` : "no se pudo responder",
      p_resultado: { seguimiento: true, herramientas: (res?.fuentes ?? []).map((f) => f.herramienta), tokens: res?.tokens ?? null, verificada: ok ? res!.verificada : null }, p_inicio: inicio,
    });
    if (errGuardar) console.error("marketing-seguimientos: no se pudo guardar la consulta", errGuardar.message);
    if (errRegistro) console.error("marketing-seguimientos: no se pudo registrar la corrida", errRegistro.message);
  }
  return json({ ok: true, ...resumen });
});
