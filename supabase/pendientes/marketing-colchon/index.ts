// Vigilante del colchón de programación + informe diario de faltantes (Marketing, solo lectura).
// - Lee Metricool únicamente a través del conector marketing-metricool (lista cerrada, marca fija).
// - Esta función NO habla con Metricool ni conoce el token: no puede crear, editar ni borrar nada allá.
// - Autenticación propia: cabecera x-marketing-secret = MARKETING_CONNECTOR_SECRET (no acepta cron_secret ni la llave de servicio).
// - Guarda solo red, fecha, hora y estado de cada publicación; nunca textos, correos ni enlaces.
// - Escribe en mk_colchon, mk_caso (tipo colchon), mk_informe_diario y mk_bitacora.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.4";
import {
  armarInforme, calcularColchon, decidirCaso, extraerPublicaciones, fechaHoraCDMX, hoyCDMX, PARAMS_INICIALES, REDES, sumarDias,
  type CasoAbierto, type Params, type PiezaEsperada, type Red,
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

  // 3) Un solo caso abierto por red mientras el colchón siga bajo la meta: se abre, se actualiza o se cierra al recuperarse.
  const casosNuevos: Array<{ red: Red; numero: number }> = [];
  const casosActualizados: Array<{ red: Red; numero: number; dias: number }> = [];
  const casosCerrados: Array<{ red: Red; numero: number; dias: number }> = [];
  const erroresCaso: string[] = [];
  const fallo = async (red: Red, que: string, mensaje: string, dias: number) => {
    // Un fallo con un caso nunca se calla: queda en la bitácora y en la respuesta.
    erroresCaso.push(`${red}: ${que}: ${mensaje}`);
    await bitacora("vigilante", "caso_colchon", `ERROR al ${que} caso en ${red}: ${mensaje}`, { fecha: hoy, dias });
  };
  for (const c of colchon) {
    const { data: abiertos, error: errLeer } = await db.from("mk_caso").select("id, numero, evidencia").eq("organization_id", organization_id)
      .eq("tipo", "colchon").eq("red", c.red).neq("estado", "cerrado").order("numero", { ascending: true }).limit(1);
    if (errLeer) { await fallo(c.red, "leer", errLeer.message, c.dias); continue; }
    const decision = decidirCaso(c, p, abiertos?.[0] as CasoAbierto | undefined);
    const evidencia = { fecha: hoy, simulada, dias: c.dias, ultima_programada: c.ultima, programadas: c.programadas, meta: p.verde_desde };
    const titulo = `Colchón de programación bajo en ${c.red}: ${c.dias} días`;
    const descripcion = `La última pieza programada en ${c.red} es ${c.ultima ?? "ninguna"}; el colchón es de ${c.dias} días y la meta es ${p.verde_desde}. Programar piezas en Metricool hasta cubrir la meta.`;

    if (decision.accion === "abrir") {
      // numero es una columna de identidad: no se envía, la base lo asigna.
      const { data: caso, error } = await db.from("mk_caso").insert({
        organization_id, tipo: "colchon", regla_codigo: "colchon", red: c.red, titulo, descripcion, evidencia, responsable: "vigilante",
      }).select("id, numero").single();
      if (error || !caso) { await fallo(c.red, "abrir", error?.message ?? "sin respuesta", c.dias); continue; }
      casosNuevos.push({ red: c.red, numero: caso.numero });
      await bitacora("vigilante", "caso_colchon", `caso #${caso.numero} abierto en ${c.red}`, { fecha: hoy, dias: c.dias }, caso.id);
    } else if (decision.accion === "actualizar") {
      // Se conserva el estado del caso (abierto, en investigación o en decisión); solo se refrescan los datos.
      const { error } = await db.from("mk_caso").update({ titulo, descripcion, evidencia }).eq("id", decision.id);
      if (error) { await fallo(c.red, "actualizar", error.message, c.dias); continue; }
      casosActualizados.push({ red: c.red, numero: decision.numero, dias: c.dias });
      if (decision.cambio) {
        await bitacora("vigilante", "caso_colchon", `caso #${decision.numero} actualizado en ${c.red}: ${decision.dias_anterior ?? "?"} → ${c.dias} días`, { fecha: hoy, dias: c.dias }, decision.id);
      }
    } else if (decision.accion === "cerrar") {
      const { error } = await db.from("mk_caso").update({
        estado: "cerrado", cerrado_at: new Date().toISOString(),
        evidencia: { fecha: hoy, simulada, dias: c.dias, ultima_programada: c.ultima, programadas: c.programadas, meta: p.verde_desde, cierre: "colchón recuperado" },
      }).eq("id", decision.id);
      if (error) { await fallo(c.red, "cerrar", error.message, c.dias); continue; }
      casosCerrados.push({ red: c.red, numero: decision.numero, dias: c.dias });
      await bitacora("vigilante", "caso_colchon", `caso #${decision.numero} cerrado en ${c.red}: colchón recuperado a ${c.dias} días`, { fecha: hoy, dias: c.dias }, decision.id);
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
  await bitacora("vigilante", "colchon", `${resumen}; ${casosNuevos.length} casos nuevos, ${casosActualizados.length} actualizados, ${casosCerrados.length} cerrados${erroresCaso.length ? `; ${erroresCaso.length} errores con casos` : ""}`, { fecha: hoy, simulada, publicaciones_leidas: pubs.length, casos: casosNuevos, actualizados: casosActualizados, cerrados: casosCerrados, errores: erroresCaso });
  return json({ ok: erroresCaso.length === 0, fecha: hoy, simulada, colchon, casos_nuevos: casosNuevos, casos_actualizados: casosActualizados, casos_cerrados: casosCerrados, errores: erroresCaso, informe_id: inf?.id ?? null });
});
