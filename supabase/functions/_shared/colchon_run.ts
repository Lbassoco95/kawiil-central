// Corrida del Vigilante del colchón con la base de datos inyectada (Almacen): así se puede probar sin Supabase.
// Solo lectura de Metricool (la lectura llega ya hecha por el conector). Nada de aquí habla con Metricool.
// Regla de oro: ningún error se calla. Cada fallo (lectura, guardado, caso, bitácora) se acumula en `fallas`,
// deja fila en la bitácora cuando se puede y mantiene abierto un único caso falla_monitoreo hasta que una corrida salga bien.
import {
  armarInforme, calcularColchon, decidirCaso, extraerPublicaciones, fechaHoraCDMX, PARAMS_INICIALES, REDES, sumarDias,
  type CasoAbierto, type Params, type PiezaEsperada, type Red,
} from "./colchon.ts";

export interface CasoNuevo { tipo: string; regla_codigo: string; red: Red | null; titulo: string; descripcion: string; evidencia: unknown; responsable: string }
export interface PiezaDb { id: string; codigo: string; pilar: string | null; formato: string | null; programada_at: string | null }
export interface PiezaRedDb { pieza_id: string; red: string; programada_at: string | null }

export interface Almacen {
  leerRegla(): Promise<Partial<Params> | null>;
  insertarColchon(filas: Array<Record<string, unknown>>): Promise<void>;
  casoAbierto(tipo: string, red: Red | null, reglaCodigo: string): Promise<CasoAbierto | undefined>;
  crearCaso(c: CasoNuevo): Promise<{ id: string; numero: number }>;
  actualizarCaso(id: string, cambios: Record<string, unknown>): Promise<void>;
  piezasVentana(desde: string, hasta: string): Promise<{ piezas: PiezaDb[]; porRed: PiezaRedDb[] }>;
  insertarInforme(fecha: string, contenido: unknown, simulada: boolean): Promise<string | null>;
  bitacora(agente: string, accion: string, resultado: string, detalle: unknown, casoId?: string | null): Promise<void>;
}
export type LecturaMetricool = { ok: true; datos: unknown } | { ok: false; motivo: string };

export interface Resultado {
  ok: boolean; estado: number; fecha: string; simulada: boolean; lectura_ok: boolean;
  colchon: ReturnType<typeof calcularColchon>;
  casos_nuevos: Array<{ red: Red; numero: number }>; casos_actualizados: Array<{ red: Red; numero: number; dias: number }>;
  casos_cerrados: Array<{ red: Red; numero: number; dias: number }>;
  falla_monitoreo: "abierta" | "actualizada" | "cerrada" | "sin_cambio" | "ninguna";
  fallas: string[]; informe_id: string | null;
}

const mensaje = (e: unknown) => (e instanceof Error ? e.message : String(e));
export const TIPO_FALLA = "falla_monitoreo";
export const REGLA = "colchon";

export async function correrColchon(
  d: { hoy: string; simulada: boolean; almacen: Almacen; leerMetricool: (inicio: string, fin: string, p: Params) => Promise<LecturaMetricool> },
): Promise<Resultado> {
  const { hoy, simulada, almacen: a } = d;
  const fallas: string[] = [];
  const paso = async <T>(nombre: string, fn: () => Promise<T>): Promise<T | undefined> => {
    try { return await fn(); } catch (e) { fallas.push(`${nombre}: ${mensaje(e)}`); return undefined; }
  };
  const bit = (agente: string, accion: string, resultado: string, detalle: unknown, casoId: string | null = null) =>
    paso("bitácora", () => a.bitacora(agente, accion, resultado, detalle, casoId));

  const res: Resultado = {
    ok: true, estado: 200, fecha: hoy, simulada, lectura_ok: true, colchon: [], casos_nuevos: [], casos_actualizados: [], casos_cerrados: [],
    falla_monitoreo: "ninguna", fallas, informe_id: null,
  };

  const regla = await paso("leer la regla del colchón", () => a.leerRegla());
  const p: Params = { ...PARAMS_INICIALES, ...(regla ?? {}) };

  // 1) Lectura de Metricool (vía conector). Si falla: sin datos nuevos, pero con rastro y con caso de falla.
  const lectura = await d.leerMetricool(`${hoy}T00:00:00`, `${sumarDias(hoy, p.ventana_dias)}T23:59:59`, p)
    .catch((e): LecturaMetricool => ({ ok: false, motivo: `sin respuesta del conector: ${mensaje(e)}` }));
  if (!lectura.ok) {
    res.lectura_ok = false;
    fallas.unshift(`lectura de Metricool: ${lectura.motivo}`);
    await bit("vigilante", "colchon", `falla de lectura: ${lectura.motivo}`, { fecha: hoy, simulada });
    res.falla_monitoreo = await gestionarFalla(a, hoy, simulada, fallas, paso, bit);
    res.ok = false; res.estado = 502;
    return res;
  }
  const pubs = extraerPublicaciones(lectura.datos); // aquí se descarta todo menos red, fecha, hora y estado

  // 2) Colchón por red.
  res.colchon = calcularColchon(pubs, hoy, p);
  await paso("guardar el colchón", () => a.insertarColchon(res.colchon.map((c) => ({
    fecha: hoy, red: c.red, ultima_programada: c.ultima, dias: c.dias, color: c.color, tope: c.tope, programadas: c.programadas, simulada,
  }))));

  // 3) Un solo caso abierto por red mientras el colchón siga bajo la meta: se abre, se actualiza o se cierra al recuperarse.
  for (const c of res.colchon) {
    const abierto = await paso(`leer el caso de ${c.red}`, () => a.casoAbierto("colchon", c.red, REGLA));
    if (abierto === undefined && fallas.some((f) => f.startsWith(`leer el caso de ${c.red}`))) continue; // no se decide a ciegas
    const decision = decidirCaso(c, p, abierto);
    const evidencia = { fecha: hoy, simulada, dias: c.dias, ultima_programada: c.ultima, programadas: c.programadas, meta: p.verde_desde };
    const titulo = `Colchón de programación bajo en ${c.red}: ${c.dias} días`;
    const descripcion = `La última pieza programada en ${c.red} es ${c.ultima ?? "ninguna"}; el colchón es de ${c.dias} días y la meta es ${p.verde_desde}. Programar piezas en Metricool hasta cubrir la meta.`;
    if (decision.accion === "abrir") {
      const caso = await paso(`abrir el caso de ${c.red}`, () => a.crearCaso({ tipo: "colchon", regla_codigo: REGLA, red: c.red, titulo, descripcion, evidencia, responsable: "vigilante" }));
      if (!caso) continue;
      res.casos_nuevos.push({ red: c.red, numero: caso.numero });
      await bit("vigilante", "caso_colchon", `caso #${caso.numero} abierto en ${c.red}`, { fecha: hoy, dias: c.dias }, caso.id);
    } else if (decision.accion === "actualizar") {
      const hecho = await paso(`actualizar el caso de ${c.red}`, () => a.actualizarCaso(decision.id, { titulo, descripcion, evidencia }).then(() => true));
      if (!hecho) continue;
      res.casos_actualizados.push({ red: c.red, numero: decision.numero, dias: c.dias });
      if (decision.cambio) await bit("vigilante", "caso_colchon", `caso #${decision.numero} actualizado en ${c.red}: ${decision.dias_anterior ?? "?"} → ${c.dias} días`, { fecha: hoy, dias: c.dias }, decision.id);
    } else if (decision.accion === "cerrar") {
      const hecho = await paso(`cerrar el caso de ${c.red}`, () => a.actualizarCaso(decision.id, {
        estado: "cerrado", cerrado_at: new Date().toISOString(), evidencia: { ...evidencia, cierre: "colchón recuperado" },
      }).then(() => true));
      if (!hecho) continue;
      res.casos_cerrados.push({ red: c.red, numero: decision.numero, dias: c.dias });
      await bit("vigilante", "caso_colchon", `caso #${decision.numero} cerrado en ${c.red}: colchón recuperado a ${c.dias} días`, { fecha: hoy, dias: c.dias }, decision.id);
    }
  }

  // 4) Informe: piezas del calendario en los próximos 14 días contra lo programado. Sin calendario legible no hay informe (no se inventa "0 faltantes").
  const hasta = sumarDias(hoy, 13);
  const cal = await paso("leer el Calendario Maestro", () => a.piezasVentana(hoy, hasta));
  if (cal) {
    const esperadas: PiezaEsperada[] = [];
    for (const pz of cal.piezas) {
      const propias = cal.porRed.filter((x) => x.pieza_id === pz.id);
      const redes: Array<{ red: Red; cuando: string | null }> = propias.length > 0
        ? propias.map((x) => ({ red: x.red as Red, cuando: x.programada_at ?? pz.programada_at }))
        : REDES.map((red) => ({ red, cuando: pz.programada_at }));
      for (const { red, cuando } of redes) {
        if (!cuando) continue;
        const { fecha, hora } = fechaHoraCDMX(cuando);
        if (fecha >= hoy && fecha <= hasta) esperadas.push({ red, fecha, hora, codigo: pz.codigo, pilar: pz.pilar, formato: pz.formato });
      }
    }
    const informe = armarInforme({ hoy, simulada, colchon: res.colchon, pubs, esperadas, p, piezasEnVentana: cal.piezas.length });
    const id = await paso("guardar el informe", () => a.insertarInforme(hoy, informe, simulada));
    res.informe_id = id ?? null;
    if (id !== undefined) {
      await bit("informe_diario", "informe", `informe del ${hoy}: ${informe.faltantes.length} faltantes, ${informe.con_error.length} con error, ${informe.desconocidos.length} con estado desconocido`, { informe_id: id, simulada });
    }
  }

  // 5) Caso único de falla: se abre/actualiza si hubo errores y se cierra solo cuando la corrida sale limpia.
  res.falla_monitoreo = await gestionarFalla(a, hoy, simulada, fallas, paso, bit);

  const resumen = res.colchon.map((c) => `${c.red} ${c.dias}${c.tope ? "+" : ""} ${c.color}`).join("; ");
  await bit("vigilante", "colchon",
    `${resumen}; ${res.casos_nuevos.length} casos nuevos, ${res.casos_actualizados.length} actualizados, ${res.casos_cerrados.length} cerrados${fallas.length ? `; ${fallas.length} errores` : ""}`,
    { fecha: hoy, simulada, publicaciones_leidas: pubs.length, casos: res.casos_nuevos, actualizados: res.casos_actualizados, cerrados: res.casos_cerrados, errores: fallas });
  res.ok = fallas.length === 0; res.estado = res.ok ? 200 : 500;
  return res;
}

type Paso = <T>(nombre: string, fn: () => Promise<T>) => Promise<T | undefined>;
type Bit = (agente: string, accion: string, resultado: string, detalle: unknown, casoId?: string | null) => Promise<void | undefined>;

// Un único caso falla_monitoreo del colchón. Abre si hay fallas y no hay caso; actualiza si hay caso (y avisa solo si cambió el motivo);
// cierra cuando ya no hay fallas. Si el propio manejo del caso falla, el error se suma a `fallas` (nunca se calla).
async function gestionarFalla(a: Almacen, hoy: string, simulada: boolean, fallas: string[], paso: Paso, bit: Bit): Promise<Resultado["falla_monitoreo"]> {
  const leido = await paso("leer el caso de falla de monitoreo", async () => ({ abierto: await a.casoAbierto(TIPO_FALLA, null, REGLA) }));
  if (!leido) return "ninguna";
  const abierto = leido.abierto;
  if (fallas.length === 0) {
    if (!abierto) return "ninguna";
    const hecho = await paso("cerrar el caso de falla de monitoreo", () => a.actualizarCaso(abierto.id, {
      estado: "cerrado", cerrado_at: new Date().toISOString(), evidencia: { fecha: hoy, simulada, fallas: [], cierre: "corrida correcta" },
    }).then(() => true));
    if (!hecho) return "ninguna";
    await bit("vigilante", "caso_falla_monitoreo", `caso #${abierto.numero} de falla de monitoreo cerrado: la corrida del ${hoy} salió bien`, { fecha: hoy }, abierto.id);
    return "cerrada";
  }
  const titulo = "Falla de monitoreo del colchón";
  const descripcion = `El Vigilante del colchón no pudo completar la corrida del ${hoy}: ${fallas.join("; ")}. Mientras siga abierto, el colchón y el informe pueden estar desactualizados.`;
  const evidencia = { fecha: hoy, simulada, fallas: [...fallas] };
  if (!abierto) {
    const caso = await paso("abrir el caso de falla de monitoreo", () => a.crearCaso({ tipo: TIPO_FALLA, regla_codigo: REGLA, red: null, titulo, descripcion, evidencia, responsable: "vigilante" }));
    if (!caso) return "ninguna";
    await bit("vigilante", "caso_falla_monitoreo", `caso #${caso.numero} de falla de monitoreo abierto: ${fallas[0]}`, { fecha: hoy }, caso.id);
    return "abierta";
  }
  const cambio = JSON.stringify(abierto.evidencia?.fallas ?? []) !== JSON.stringify(fallas);
  const hecho = await paso("actualizar el caso de falla de monitoreo", () => a.actualizarCaso(abierto.id, { titulo, descripcion, evidencia }).then(() => true));
  if (!hecho) return "ninguna";
  if (cambio) await bit("vigilante", "caso_falla_monitoreo", `caso #${abierto.numero} de falla de monitoreo actualizado: ${fallas[0]}`, { fecha: hoy }, abierto.id);
  return cambio ? "actualizada" : "sin_cambio";
}
