// Vigilante del colchón de programación + informe diario de faltantes (Marketing, solo lectura).
// - Lee Metricool únicamente a través del conector marketing-metricool (lista cerrada, marca fija).
// - Esta función NO habla con Metricool ni conoce el token: no puede crear, editar ni borrar nada allá.
// - Autenticación propia: cabecera x-marketing-secret = MARKETING_CONNECTOR_SECRET (no acepta cron_secret ni la llave de servicio).
// - Guarda solo red, fecha, hora y estado de cada publicación; nunca textos, correos ni enlaces.
// - Escribe en mk_colchon, mk_caso (tipo colchon), mk_informe_diario y mk_bitacora.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  armarInforme, calcularColchon, extraerPublicaciones, fechaHoraCDMX, hoyCDMX, PARAMS_INICIALES, REDES, sumarDias,
  type Params, type PiezaEsperada, type Red,
} from "../../functions/_shared/colchon.ts";

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
  const organization_id = orgs[0].id as string;
  const bitacora = (agente: string, accion: string, resultado: string, detalle: unknown, caso_id: string | null = null) =>
    db.from("mk_bitacora").insert({ organization_id, agente, accion, resultado, detalle, caso_id });

  // Parámetros vigentes de la regla (Dirección los puede cambiar); si falta algo, los iniciales.
  const { data: regla } = await db.from("mk_regla").select("parametros, activa").eq("organization_id", organization_id).eq("codigo", "colchon").maybeSingle();
  const p: Params = { ...PARAMS_INICIALES, ...((regla?.parametros as Partial<Params>) ?? {}) };

  // 1) Piezas programadas, solo lectura, vía conector.
  const r = await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/marketing-metricool`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-marketing-secret": secreto },
    body: JSON.stringify({
      operacion: "scheduler_posts",
      entrada: { start: `${hoy}T00:00:00`, end: `${sumarDias(hoy, p.ventana_dias)}T23:59:59`, timezone: "America/Mexico_City" },
    }),
    signal: AbortSignal.timeout(40_000),
  }).catch(() => null);
  const respuesta = r ? await r.json().catch(() => null) : null;
  if (!r || !r.ok || !respuesta?.ok) {
    const motivo = respuesta?.error ?? respuesta?.motivo ?? (r ? `HTTP ${r.status}` : "sin respuesta del conector");
    await bitacora("vigilante", "colchon", `falla de lectura: ${motivo}`, { fecha: hoy, simulada });
    return json({ ok: false, error: motivo }, 502);
  }
  const pubs = extraerPublicaciones(respuesta.datos); // aquí se descarta todo menos red, fecha, hora y estado

  // 2) Colchón por red.
  const colchon = calcularColchon(pubs, hoy, p);
  await db.from("mk_colchon").insert(colchon.map((c) => ({
    organization_id, fecha: hoy, red: c.red, ultima_programada: c.ultima, dias: c.dias, color: c.color, tope: c.tope, programadas: c.programadas, simulada,
  })));

  // 3) Caso por cada red por debajo de la meta, sin duplicar casos abiertos.
  const casosNuevos: Array<{ red: Red; numero: number }> = [];
  const erroresCaso: string[] = [];
  for (const c of colchon.filter((x) => x.dias < p.verde_desde)) {
    const { data: abierto } = await db.from("mk_caso").select("id").eq("organization_id", organization_id)
      .eq("tipo", "colchon").eq("red", c.red).neq("estado", "cerrado").limit(1);
    if (abierto && abierto.length > 0) continue;
    // numero es una columna de identidad: no se envía, la base lo asigna.
    const { data: caso, error } = await db.from("mk_caso").insert({
      organization_id, tipo: "colchon", regla_codigo: "colchon", red: c.red,
      titulo: `Colchón de programación bajo en ${c.red}: ${c.dias} días`,
      descripcion: `La última pieza programada en ${c.red} es ${c.ultima ?? "ninguna"}; el colchón es de ${c.dias} días y la meta es ${p.verde_desde}. Programar piezas en Metricool hasta cubrir la meta.`,
      evidencia: { fecha: hoy, simulada, dias: c.dias, ultima_programada: c.ultima, programadas: c.programadas, meta: p.verde_desde },
      responsable: "vigilante",
    }).select("id, numero").single();
    if (error) {
      // Un fallo al abrir el caso nunca se calla: queda en la bitácora y en la respuesta.
      erroresCaso.push(`${c.red}: ${error.message}`);
      await bitacora("vigilante", "caso_colchon", `ERROR al abrir caso en ${c.red}: ${error.message}`, { fecha: hoy, dias: c.dias });
    }
    if (!error && caso) {
      casosNuevos.push({ red: c.red, numero: caso.numero });
      await bitacora("vigilante", "caso_colchon", `caso #${caso.numero} abierto en ${c.red}`, { fecha: hoy, dias: c.dias }, caso.id);
    }
  }

  // 4) Informe: piezas del calendario en los próximos 14 días contra lo programado.
  const hasta = sumarDias(hoy, 13);
  const { data: piezas } = await db.from("mk_pieza").select("id, codigo, pilar, formato, programada_at, fecha").gte("fecha", hoy).lte("fecha", hasta);
  const { data: prs } = await db.from("mk_pieza_red").select("pieza_id, red, programada_at");
  const esperadas: PiezaEsperada[] = [];
  for (const pz of piezas ?? []) {
    const propias = (prs ?? []).filter((x) => x.pieza_id === pz.id);
    const redes: Array<{ red: Red; cuando: string | null }> = propias.length > 0
      ? propias.map((x) => ({ red: x.red as Red, cuando: (x.programada_at ?? pz.programada_at) as string | null }))
      : REDES.map((red) => ({ red, cuando: pz.programada_at as string | null }));
    for (const { red, cuando } of redes) {
      if (!cuando) continue;
      const { fecha, hora } = fechaHoraCDMX(cuando);
      if (fecha >= hoy && fecha <= hasta) esperadas.push({ red, fecha, hora, codigo: pz.codigo, pilar: pz.pilar, formato: pz.formato });
    }
  }
  const informe = armarInforme({ hoy, simulada, colchon, pubs, esperadas, p, piezasEnVentana: (piezas ?? []).length });
  const { data: inf } = await db.from("mk_informe_diario").insert({ organization_id, fecha: hoy, contenido: informe, simulada }).select("id").single();

  const resumen = colchon.map((c) => `${c.red} ${c.dias}${c.tope ? "+" : ""} ${c.color}`).join("; ");
  await bitacora("informe_diario", "informe", `informe del ${hoy}: ${informe.faltantes.length} faltantes, ${informe.con_error.length} con error, ${informe.desconocidos.length} con estado desconocido`, { informe_id: inf?.id ?? null, simulada });
  await bitacora("vigilante", "colchon", `${resumen}; ${casosNuevos.length} casos nuevos${erroresCaso.length ? `; ${erroresCaso.length} errores al abrir caso` : ""}`, { fecha: hoy, simulada, publicaciones_leidas: pubs.length, casos: casosNuevos, errores: erroresCaso });
  return json({ ok: erroresCaso.length === 0, fecha: hoy, simulada, colchon, casos_nuevos: casosNuevos, errores: erroresCaso, informe_id: inf?.id ?? null });
});
