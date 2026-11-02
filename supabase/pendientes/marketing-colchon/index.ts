// Vigilante del colchón de programación + informe diario de faltantes (Marketing, solo lectura). Versión 5.
// - Lee Metricool únicamente a través del conector marketing-metricool (lista cerrada, marca fija).
// - Esta función NO habla con Metricool ni conoce el token: no puede crear, editar ni borrar nada allá.
// - Autenticación propia: cabecera x-marketing-secret = MARKETING_CONNECTOR_SECRET (no acepta cron_secret ni la llave de servicio).
// - Guarda solo red, fecha, hora y estado de cada publicación; nunca textos, correos ni enlaces.
// - La lógica vive en _shared/colchon_run.ts (con la base inyectada y probada); aquí solo se conecta con Supabase.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import { hoyCDMX } from "../../functions/_shared/colchon.ts";
import { correrColchon, type Almacen, type LecturaMetricool } from "../../functions/_shared/colchon_run.ts";

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

  let cuerpo: { fecha_simulada?: string } = {};
  try { cuerpo = await req.json(); } catch { /* sin cuerpo: corrida normal */ }
  const simulada = typeof cuerpo.fecha_simulada === "string" && /^\d{4}-\d{2}-\d{2}$/.test(cuerpo.fecha_simulada);
  const hoy = simulada ? cuerpo.fecha_simulada! : hoyCDMX();

  const db = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
  const { data: orgs } = await db.from("organizations").select("id").limit(2);
  if (!orgs || orgs.length !== 1) return json({ error: "organización ambigua" }, 500);
  const org = orgs[0].id as string;

  // Cada operación lanza si Supabase devuelve error: la lógica de correrColchon lo registra, nunca lo calla.
  const ok = <T>(r: { data: T; error: { message: string } | null }): T => { if (r.error) throw new Error(r.error.message); return r.data; };
  const almacen: Almacen = {
    async leerRegla() {
      const d = ok(await db.from("mk_regla").select("parametros").eq("organization_id", org).eq("codigo", "colchon").maybeSingle());
      return (d?.parametros as Record<string, number> | undefined) ?? null;
    },
    async insertarColchon(filas) { ok(await db.from("mk_colchon").insert(filas.map((f) => ({ organization_id: org, ...f })))); },
    async casoAbierto(tipo, red, reglaCodigo) {
      let q = db.from("mk_caso").select("id, numero, evidencia").eq("organization_id", org).eq("tipo", tipo).eq("regla_codigo", reglaCodigo)
        .neq("estado", "cerrado").order("numero", { ascending: true }).limit(1);
      q = red === null ? q.is("red", null) : q.eq("red", red);
      return ok(await q)?.[0] ?? undefined;
    },
    async crearCaso(c) {
      // numero es una columna de identidad: no se envía, la base lo asigna.
      return ok(await db.from("mk_caso").insert({ organization_id: org, ...c }).select("id, numero").single());
    },
    async actualizarCaso(id, cambios) { ok(await db.from("mk_caso").update(cambios).eq("id", id)); },
    async piezasVentana(desde, hasta) {
      const piezas = ok(await db.from("mk_pieza").select("id, codigo, pilar, formato, programada_at").gte("fecha", desde).lte("fecha", hasta));
      const porRed = ok(await db.from("mk_pieza_red").select("pieza_id, red, programada_at"));
      return { piezas: piezas ?? [], porRed: porRed ?? [] };
    },
    async insertarInforme(fecha, contenido, sim) {
      return ok(await db.from("mk_informe_diario").insert({ organization_id: org, fecha, contenido, simulada: sim }).select("id").single())?.id ?? null;
    },
    async bitacora(agente, accion, resultado, detalle, casoId = null) {
      ok(await db.from("mk_bitacora").insert({ organization_id: org, agente, accion, resultado, detalle, caso_id: casoId }));
    },
  };

  const leerMetricool = async (inicio: string, fin: string): Promise<LecturaMetricool> => {
    const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/marketing-metricool`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-marketing-secret": secreto },
      body: JSON.stringify({ operacion: "scheduler_posts", entrada: { start: inicio, end: fin, timezone: "America/Mexico_City" } }),
      signal: AbortSignal.timeout(40_000),
    }).catch(() => null);
    const respuesta = r ? await r.json().catch(() => null) : null;
    if (!r || !r.ok || !respuesta?.ok) return { ok: false, motivo: respuesta?.error ?? respuesta?.motivo ?? (r ? `HTTP ${r.status}` : "sin respuesta del conector") };
    return { ok: true, datos: respuesta.datos };
  };

  const res = await correrColchon({ hoy, simulada, almacen, leerMetricool });
  return json(res, res.estado);
});
