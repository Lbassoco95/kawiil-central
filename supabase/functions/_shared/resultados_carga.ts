// Carga de resultados de Metricool a la base (Marketing, Entrega 2, paso 5). Lógica pura: la base y el conector se inyectan, así se prueba sin red.
// Reglas (Dirección):
// - SOLO lee de Metricool (por el conector, lista cerrada). Lo único que escribe es en la base de Marketing, y solo en estas tablas:
//   mk_resultado (fuente «metricool», corte «acumulado»), mk_pieza_red (solo piezas de Instagram anteriores al calendario que hoy no tienen fila),
//   mk_cobertura_fuente y una entrada en mk_bitacora con los ids creados (para poder revertir).
// - Por omisión es VISTA PREVIA: devuelve exactamente lo que escribiría y no escribe nada. Escribir exige `escribir: true` y la lista explícita de redes.
// - Nunca se guarda texto de la publicación, título, hashtags, enlaces, nombres ni ubicación: solo red, identificador de Metricool, fecha, hora y números.
// - Es idempotente: repetirla no duplica filas (resultados por (pieza, corte, fuente); piezas por (pieza, red); cobertura por (red, fuente)).
import { emparejar, fechaHoraCDMX, leerRed, REDES, type AlmacenSimulacro, type LecturaInforme, type LecturaRed, type PiezaArchivo, type PubApi, type Red } from "./resultados.ts";

/** Redes que se pueden cargar. LinkedIn queda fuera hasta que la API devuelva sus publicaciones (decisión de Dirección). */
export const REDES_CARGABLES: readonly Red[] = ["instagram", "facebook"];
export const MAX_FILAS_POR_RED = 200;
export const FUENTE = "metricool", CORTE = "acumulado";

/** Pieza del calendario publicada en otra red que no tiene fila en la red que se carga. `referencia_at` es cuándo salió en esa otra red. */
export interface PiezaSinFila { pieza_id: string; codigo: string; red_referencia: string; referencia_at: string }

export interface FilaResultado {
  pieza_red_id: string; medida: "alcance" | "impresiones"; valor: number | null; guardados: number | null; compartidos: number | null;
  clics: number | null; reacciones: number | null; comentarios: number | null; extra: { metricool_id: string | null; hora_cdmx: string; zona_origen: string; carga: string };
}
export interface PiezaRedNueva { pieza_id: string; red: Red; publicada_at: string; metricool_id: string | null }
export interface SinVincular { fecha: string; hora: string; motivo: "sin_pieza_ese_dia" | "mas_publicaciones_que_piezas" }

export interface PlanRed {
  red: Red;
  pares: Array<{ pieza_red_id: string; codigo: string; pub: PubApi }>;        // ya existe la fila de la pieza en esta red
  nuevas: Array<{ pieza_id: string; codigo: string; pub: PubApi }>;           // hay que crear la fila de la pieza en esta red (solo con `escribir`)
  sin_vincular: SinVincular[];                                                  // publicaciones de Metricool que no se cargan
  cobertura: { desde: string; hasta: string } | null;
}

const isoDe = (p: PubApi) => new Date(p.minutos * 60_000).toISOString();

/** Decide qué se carga de una red: emparejadas con el calendario, más (solo si hay pieza clara ese día) las que no tienen fila. */
export function planificarCarga(red: Red, archivo: PiezaArchivo[], api: PubApi[], sinFila: PiezaSinFila[]): PlanRed {
  const { pares, sobraB } = emparejar(archivo, api);
  // Las que sobran se intentan vincular con piezas del calendario SIN fila en esta red, por día y hora más cercana (la de su publicación en otra red).
  const pseudo: PiezaArchivo[] = sinFila.map((s) => ({ pieza_red_id: s.pieza_id, codigo: s.codigo, red, publicada_at: s.referencia_at, valor: null }));
  const v = emparejar(pseudo, sobraB);
  const fechasConPieza = new Set(pseudo.map((x) => fechaHoraCDMX(new Date(x.publicada_at)).fecha));
  const sin_vincular: SinVincular[] = v.sobraB.map((p) => ({ fecha: p.fecha, hora: p.hora, motivo: fechasConPieza.has(p.fecha) ? "mas_publicaciones_que_piezas" : "sin_pieza_ese_dia" }));
  const cargadas = [...pares.map((x) => x.b), ...v.pares.map((x) => x.b)];
  const fechas = cargadas.map((p) => p.fecha).sort();
  return {
    red,
    pares: pares.map((x) => ({ pieza_red_id: x.a.pieza_red_id, codigo: x.a.codigo, pub: x.b })),
    nuevas: v.pares.map((x) => ({ pieza_id: x.a.pieza_red_id, codigo: x.a.codigo, pub: x.b })),
    sin_vincular,
    cobertura: fechas.length ? { desde: fechas[0], hasta: fechas[fechas.length - 1] } : null,
  };
}

export const medidaDe = (red: Red): "alcance" | "impresiones" => (red === "linkedin" ? "impresiones" : "alcance");

/** Fila de resultado: solo números y el identificador de Metricool (sin texto de ningún tipo). */
export function filaResultado(pieza_red_id: string, p: PubApi, red: Red): FilaResultado {
  return {
    pieza_red_id, medida: medidaDe(red), valor: p.valor, guardados: p.guardados, compartidos: p.compartidos, clics: p.clics, reacciones: p.reacciones, comentarios: p.comentarios,
    extra: { metricool_id: p.id, hora_cdmx: p.hora, zona_origen: p.zona, carga: "historica_2026-11" },
  };
}

export interface AlmacenCarga extends AlmacenSimulacro {
  piezasSinFila(red: Red, desde: string, hasta: string): Promise<PiezaSinFila[]>;
  /** Devuelve el id de la fila (crea la de la pieza en esa red, o devuelve la que ya existe). */
  asegurarPiezaRed(x: PiezaRedNueva): Promise<{ id: string; creada: boolean }>;
  guardarResultado(f: FilaResultado): Promise<void>;
  guardarCobertura(x: { red: Red; desde: string; hasta: string; nota: string }): Promise<void>;
  bitacora(resultado: string, detalle: Record<string, unknown>): Promise<void>;
}

export interface InformeCargaRed {
  red: Red; cargada: boolean; motivo?: string; resultados: number; piezas_red_nuevas: number; sin_vincular: SinVincular[]; sin_valor: number;
  cobertura: { desde: string; hasta: string } | null;
}
export interface ReporteCarga {
  carga: true; escribio: boolean; vista_previa: boolean; periodo: { desde: string; hasta: string }; generado_at: string;
  redes: InformeCargaRed[]; lecturas: LecturaInforme[]; piezas_red_creadas: string[]; avisos: string[];
}

const FECHA = /^\d{4}-\d{2}-\d{2}$/;

export async function correrCarga(d: {
  desde: string; hasta: string; redes: unknown; escribir: boolean; ahora?: Date; almacen: AlmacenCarga;
  leerMetricool: (red: Red, operacion: string, entrada: Record<string, string>) => Promise<LecturaRed>;
}): Promise<ReporteCarga> {
  if (!FECHA.test(d.desde) || !FECHA.test(d.hasta) || d.desde > d.hasta) throw new Error("periodo inválido");
  // La lista de redes es obligatoria y explícita: nunca se carga «todo» por omisión.
  if (!Array.isArray(d.redes) || d.redes.length === 0 || d.redes.some((r) => !(REDES as readonly unknown[]).includes(r))) throw new Error("redes inválidas");
  const redes = [...new Set(d.redes as Red[])];
  const avisos: string[] = [], informes: InformeCargaRed[] = [], lecturas: LecturaInforme[] = [], creadas: string[] = [];
  const archivoTodo = await d.almacen.piezasArchivo(d.desde, d.hasta);

  for (const red of redes) {
    const vacio = (motivo: string): InformeCargaRed => ({ red, cargada: false, motivo, resultados: 0, piezas_red_nuevas: 0, sin_vincular: [], sin_valor: 0, cobertura: null });
    if (!REDES_CARGABLES.includes(red)) { informes.push(vacio("red no aprobada para cargar")); avisos.push(`${red}: no se carga (aún no aprobada).`); continue; }
    const { api: todas, informe, aviso } = await leerRed(red, d.desde, d.hasta, d.leerMetricool);
    lecturas.push(informe); if (aviso) avisos.push(aviso);
    const api = todas.filter((p) => p.fecha >= d.desde && p.fecha <= d.hasta);
    if (api.length === 0) { informes.push(vacio("Metricool no devolvió publicaciones")); continue; }
    const plan = planificarCarga(red, archivoTodo.filter((p) => p.red === red), api, await d.almacen.piezasSinFila(red, d.desde, d.hasta));
    const filas = plan.pares.length + plan.nuevas.length;
    if (filas > MAX_FILAS_POR_RED) { informes.push(vacio(`demasiadas filas (${filas} > ${MAX_FILAS_POR_RED})`)); avisos.push(`${red}: se detuvo por el tope de filas.`); continue; }

    const items = [...plan.pares.map((x) => ({ x, nueva: null as null | { pieza_id: string } })), ...plan.nuevas.map((x) => ({ x: { pieza_red_id: "", codigo: x.codigo, pub: x.pub }, nueva: { pieza_id: x.pieza_id } }))];
    const sinValor = items.filter((i) => i.x.pub.valor === null).length;
    let resultados = 0, nuevas = 0;
    if (d.escribir) {
      for (const it of items) {
        if (it.x.pub.valor === null) continue; // sin cifra de la medida no se guarda una fila vacía
        let id = it.x.pieza_red_id;
        if (it.nueva) {
          const r = await d.almacen.asegurarPiezaRed({ pieza_id: it.nueva.pieza_id, red, publicada_at: isoDe(it.x.pub), metricool_id: it.x.pub.id });
          id = r.id; if (r.creada) { nuevas++; creadas.push(r.id); }
        }
        await d.almacen.guardarResultado(filaResultado(id, it.x.pub, red)); resultados++;
      }
      if (plan.cobertura && resultados > 0) await d.almacen.guardarCobertura({ red, ...plan.cobertura, nota: "Carga histórica de Metricool (nov 2026): acumulado a la fecha de lectura" });
    } else { resultados = items.length - sinValor; nuevas = plan.nuevas.length; }
    informes.push({ red, cargada: d.escribir && resultados > 0, resultados, piezas_red_nuevas: nuevas, sin_vincular: plan.sin_vincular, sin_valor: sinValor, cobertura: plan.cobertura });
  }
  if (d.escribir && informes.some((i) => i.resultados > 0)) {
    await d.almacen.bitacora(`carga de resultados de Metricool: ${informes.map((i) => `${i.red} ${i.resultados}`).join(", ")}`,
      { periodo: { desde: d.desde, hasta: d.hasta }, redes: informes.map((i) => ({ red: i.red, resultados: i.resultados, piezas_red_nuevas: i.piezas_red_nuevas, sin_vincular: i.sin_vincular.length })), piezas_red_creadas: creadas });
  }
  return { carga: true, escribio: d.escribir, vista_previa: !d.escribir, periodo: { desde: d.desde, hasta: d.hasta }, generado_at: (d.ahora ?? new Date()).toISOString(), redes: informes, lecturas, piezas_red_creadas: creadas, avisos };
}
