// Lógica de la vista «Agentes» (solo lectura): estado de cada agente, próxima ejecución, línea de tiempo y flujo.
// Todo sale de lo que ya existe en la bitácora, los casos, las propuestas y (si está aplicada) la función mk_agentes_estado.
import type { Caso, FilaBitacora, TrabajoCron } from "@/hooks/useMarketing";
import { corridaConFalla } from "./monitoreo";

// ── Horarios (expresiones cron de pg_cron, en UTC) ──────────────────────────────────────────────────────────────────
interface Cron { min: Set<number>; hora: Set<number>; dom: Set<number> | null; mes: Set<number> | null; dow: Set<number> | null }
function campo(txt: string, min: number, max: number): Set<number> | null {
  if (txt === "*") return null;
  const salida = new Set<number>();
  for (const parte of txt.split(",")) {
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(parte);
    if (!m) throw new Error("cron no soportado");
    const paso = m[2] ? Number(m[2]) : 1;
    const [a, b] = m[1] === "*" ? [min, max] : m[1].includes("-") ? m[1].split("-").map(Number) : [Number(m[1]), m[2] ? max : Number(m[1])];
    if (!(paso >= 1) || a < min || b > max || a > b) throw new Error("cron fuera de rango");
    for (let x = a; x <= b; x += paso) salida.add(x);
  }
  return salida;
}
export function leerCron(expr: string): Cron | null {
  try {
    const p = expr.trim().split(/\s+/);
    if (p.length !== 5) return null;
    const dow = campo(p[4], 0, 7);
    if (dow?.has(7)) { dow.delete(7); dow.add(0); }
    return { min: campo(p[0], 0, 59) ?? new Set(Array.from({ length: 60 }, (_, i) => i)), hora: campo(p[1], 0, 23) ?? new Set(Array.from({ length: 24 }, (_, i) => i)), dom: campo(p[2], 1, 31), mes: campo(p[3], 1, 12), dow };
  } catch { return null; }
}
function coincide(c: Cron, d: Date): boolean {
  if (!c.min.has(d.getUTCMinutes()) || !c.hora.has(d.getUTCHours())) return false;
  if (c.mes && !c.mes.has(d.getUTCMonth() + 1)) return false;
  const okDom = !c.dom || c.dom.has(d.getUTCDate()), okDow = !c.dow || c.dow.has(d.getUTCDay());
  return c.dom && c.dow ? okDom || okDow : okDom && okDow; // regla estándar de cron
}
const MINUTO = 60_000, LIMITE_MIN = 8 * 24 * 60; // se busca hasta 8 días: suficiente para horarios diarios y semanales
export function proximaEjecucion(expr: string, desde: Date): Date | null {
  const c = leerCron(expr); if (!c) return null;
  const t0 = Math.floor(desde.getTime() / MINUTO) * MINUTO;
  for (let i = 1; i <= LIMITE_MIN; i++) { const d = new Date(t0 + i * MINUTO); if (coincide(c, d)) return d; }
  return null;
}
export function ejecucionPrevia(expr: string, hasta: Date): Date | null {
  const c = leerCron(expr); if (!c) return null;
  const t0 = Math.floor(hasta.getTime() / MINUTO) * MINUTO;
  for (let i = 0; i <= LIMITE_MIN; i++) { const d = new Date(t0 - i * MINUTO); if (coincide(c, d)) return d; }
  return null;
}

// ── Fechas en Ciudad de México ──────────────────────────────────────────────────────────────────────────────────────
const ZONA = "America/Mexico_City";
export function partesCDMX(d: Date) {
  const p = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: ZONA, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(d).map((x) => [x.type, x.value]));
  return { dia: `${p.year}-${p.month}-${p.day}`, hora: `${p.hour}:${p.minute}` };
}
const sumaDia = (dia: string, n: number) => new Date(Date.UTC(+dia.slice(0, 4), +dia.slice(5, 7) - 1, +dia.slice(8, 10) + n)).toISOString().slice(0, 10);
export function cuandoLegible(d: Date, ahora: Date): string {
  const { dia, hora } = partesCDMX(d), hoy = partesCDMX(ahora).dia;
  const etiqueta = dia === hoy ? "hoy" : dia === sumaDia(hoy, 1) ? "mañana" : dia === sumaDia(hoy, -1) ? "ayer"
    : new Date(`${dia}T12:00:00Z`).toLocaleDateString("es-MX", { day: "numeric", month: "short", timeZone: "UTC" });
  return `${etiqueta} ${hora}`;
}

// ── Catálogo de agentes conocidos y cuáles existen ──────────────────────────────────────────────────────────────────
export interface AgenteDef {
  id: "vigilante" | "informe_diario" | "vigia" | "revisor"; nombre: string; descripcion: string;
  agente: string; accion: string | null; trabajo: string | null; horarioRespaldo: string | null;
  soloEscribeSiFalla?: boolean; // el vigía no deja fila cuando todo está bien (decisión de Dirección)
}
export const CATALOGO: AgenteDef[] = [
  { id: "vigilante", nombre: "Vigilante del colchón", descripcion: "Lee el calendario de Metricool, calcula el colchón por red y mantiene los casos.", agente: "vigilante", accion: "colchon", trabajo: "marketing-colchon-diario-0700-cdmx", horarioRespaldo: "0 13 * * *" },
  { id: "informe_diario", nombre: "Informe diario", descripcion: "Redacta qué falta programar, qué tiene error y qué necesita Dirección.", agente: "informe_diario", accion: "informe", trabajo: "marketing-colchon-diario-0700-cdmx", horarioRespaldo: "0 13 * * *" },
  { id: "vigia", nombre: "Vigía de las 7:30", descripcion: "Comprueba que el Vigilante corrió; si no, deja constancia y abre el caso de falla.", agente: "sistema", accion: "vigia_colchon", trabajo: "marketing-colchon-vigia-0730-cdmx", horarioRespaldo: "30 13 * * *", soloEscribeSiFalla: true },
  { id: "revisor", nombre: "Revisor", descripcion: "Investiga los casos y propone correcciones a Dirección.", agente: "revisor", accion: null, trabajo: null, horarioRespaldo: null },
];

const esPrueba = (f: FilaBitacora) => f.detalle?.simulada === true;
const filasDe = (d: AgenteDef, filas: FilaBitacora[]) => filas.filter((f) => f.agente === d.agente && (d.accion === null || f.accion === d.accion));

// Un agente aparece solo si existe: tiene filas en la bitácora, o un trabajo programado, o (el Revisor) propuestas.
export function agenteExiste(d: AgenteDef, filas: FilaBitacora[], trabajos: TrabajoCron[], hayPropuestas: boolean): boolean {
  if (d.id === "revisor") return filasDe(d, filas).length > 0 || hayPropuestas;
  return filasDe(d, filas).length > 0 || (d.trabajo !== null && trabajos.some((t) => t.trabajo === d.trabajo));
}

export type EstadoAgente = "correcta" | "con_falla" | "no_corrio" | "pausado" | "sin_datos";
export interface TarjetaAgente {
  def: AgenteDef; estado: EstadoAgente; ultima: Date | null; resultado: string | null; proxima: Date | null; horario: string | null;
  pausado: boolean; origen: "bitacora" | "trabajo" | "ninguno"; fueDePrueba: boolean;
}
const TOLERANCIA_MIN = 30; // pasada la hora prevista + 30 min sin registro: «no corrió»

export function estadoAgente(d: AgenteDef, filas: FilaBitacora[], trabajos: TrabajoCron[], ahora: Date): TarjetaAgente {
  const trabajo = d.trabajo ? trabajos.find((t) => t.trabajo === d.trabajo) : undefined;
  const reales = filasDe(d, filas).filter((f) => !esPrueba(f));
  const ultimaFila = reales[0] ?? filasDe(d, filas)[0];
  const horario = trabajo?.horario ?? d.horarioRespaldo;
  const proxima = horario ? proximaEjecucion(horario, ahora) : null;
  const previa = horario ? ejecucionPrevia(horario, ahora) : null;
  const ejecJob = trabajo?.ultima_ejecucion ? new Date(trabajo.ultima_ejecucion) : null;
  const pausado = trabajo ? !trabajo.activo : false;
  const vencida = previa !== null && ahora.getTime() > previa.getTime() + TOLERANCIA_MIN * MINUTO;

  let estado: EstadoAgente = "sin_datos", ultima: Date | null = null, resultado: string | null = null, origen: TarjetaAgente["origen"] = "ninguno";

  if (d.soloEscribeSiFalla) {
    // La última corrida sale del trabajo; el resultado, de la fila SIN CORRIDA si ya se activó el aviso de esa vuelta.
    ultima = ejecJob; origen = ejecJob ? "trabajo" : "ninguno";
    const aviso = reales.find((f) => /SIN CORRIDA/i.test(f.resultado));
    const avisoDeEstaVuelta = aviso && previa && new Date(aviso.registrado_at).getTime() >= previa.getTime() - 5 * MINUTO;
    if (trabajo) {
      resultado = avisoDeEstaVuelta ? aviso!.resultado : "Sin novedad: el Vigilante dejó registro";
      estado = avisoDeEstaVuelta || trabajo.ultima_estado === "failed" ? "con_falla" : vencida && (!ejecJob || ejecJob.getTime() < previa!.getTime()) ? "no_corrio" : ejecJob ? "correcta" : "sin_datos";
    } else if (aviso) {
      ultima = new Date(aviso.registrado_at); origen = "bitacora"; resultado = aviso.resultado; estado = avisoDeEstaVuelta ? "con_falla" : "correcta";
    }
  } else if (ultimaFila) {
    ultima = new Date(ultimaFila.registrado_at); origen = "bitacora"; resultado = ultimaFila.resultado;
    const faltaRegistro = vencida && ultima.getTime() < previa!.getTime();
    estado = corridaConFalla(ultimaFila) || trabajo?.ultima_estado === "failed" ? "con_falla" : faltaRegistro && !esPrueba(ultimaFila) ? "no_corrio" : "correcta";
    if (esPrueba(ultimaFila) && reales.length === 0) estado = "sin_datos";
  } else if (trabajo) {
    ultima = ejecJob; origen = ejecJob ? "trabajo" : "ninguno"; estado = trabajo.ultima_estado === "failed" ? "con_falla" : vencida ? "no_corrio" : "sin_datos";
  }
  if (pausado) estado = "pausado";
  return { def: d, estado, ultima, resultado, proxima, horario, pausado, origen, fueDePrueba: !!ultimaFila && esPrueba(ultimaFila) && reales.length === 0 };
}

export function tarjetas(filas: FilaBitacora[], trabajos: TrabajoCron[], hayPropuestas: boolean, ahora: Date): TarjetaAgente[] {
  return CATALOGO.filter((d) => agenteExiste(d, filas, trabajos, hayPropuestas)).map((d) => estadoAgente(d, filas, trabajos, ahora));
}

// ── Línea de tiempo ─────────────────────────────────────────────────────────────────────────────────────────────────
const ACCIONES: Record<string, string> = {
  colchon: "Corrida del colchón", caso_colchon: "Caso de colchón", informe: "Informe diario", caso_falla_monitoreo: "Caso de falla de monitoreo",
  vigia_colchon: "Vigía de las 7:30", carga_historial_calendario_maestro: "Carga histórica del calendario", metricool_consulta_perfiles: "Consulta de perfiles",
};
const AGENTES: Record<string, string> = { vigilante: "Vigilante", informe_diario: "Informe diario", sistema: "Sistema", revisor: "Revisor", direccion: "Dirección" };
export const etiquetaAccion = (a: string) => ACCIONES[a] ?? a.replace(/_/g, " ");
export const etiquetaAgente = (a: string) => AGENTES[a] ?? a;
export const filaConFalla = (f: Pick<FilaBitacora, "accion" | "resultado">) =>
  corridaConFalla(f) || /SIN CORRIDA|^ERROR/i.test(f.resultado);

export interface EventoLinea { id: string; cuando: Date; hora: string; agente: string; agenteEtiqueta: string; accion: string; accionEtiqueta: string; resultado: string; falla: boolean; prueba: boolean; caso: { id: string; numero: number; tipo: string; red: string | null } | null }
export interface DiaLinea { dia: string; etiqueta: string; eventos: EventoLinea[] }
export interface FiltroLinea { dias: number; agente?: string | null; soloFallas?: boolean; casoNumero?: number | null }

export function lineaDeTiempo(filas: FilaBitacora[], casos: Pick<Caso, "id" | "numero" | "tipo" | "red">[], ahora: Date, f: FiltroLinea): DiaLinea[] {
  const porId = new Map(casos.map((c) => [c.id, c]));
  const hoy = partesCDMX(ahora).dia, desde = sumaDia(hoy, -(f.dias - 1));
  const eventos: EventoLinea[] = [];
  for (const fila of filas) {
    const cuando = new Date(fila.registrado_at), { dia, hora } = partesCDMX(cuando);
    if (dia < desde) continue;
    const c = fila.caso_id ? porId.get(fila.caso_id) : undefined;
    const ev: EventoLinea = { id: fila.id, cuando, hora, agente: fila.agente, agenteEtiqueta: etiquetaAgente(fila.agente), accion: fila.accion, accionEtiqueta: etiquetaAccion(fila.accion),
      resultado: fila.resultado, falla: filaConFalla(fila), prueba: esPrueba(fila), caso: c ? { id: c.id, numero: c.numero, tipo: c.tipo, red: c.red } : null };
    if (f.agente && ev.agente !== f.agente) continue;
    if (f.soloFallas && !ev.falla) continue;
    if (f.casoNumero != null && ev.caso?.numero !== f.casoNumero) continue;
    eventos.push(ev);
  }
  eventos.sort((a, b) => b.cuando.getTime() - a.cuando.getTime());
  const grupos = new Map<string, EventoLinea[]>();
  for (const e of eventos) { const d = partesCDMX(e.cuando).dia; (grupos.get(d) ?? grupos.set(d, []).get(d)!).push(e); }
  return [...grupos.entries()].map(([dia, evs]) => ({
    dia, eventos: evs,
    etiqueta: dia === hoy ? "Hoy" : dia === sumaDia(hoy, -1) ? "Ayer" : new Date(`${dia}T12:00:00Z`).toLocaleDateString("es-MX", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }),
  }));
}

// ── Flujo caso → Revisor → propuesta → decisión de Dirección ────────────────────────────────────────────────────────
const cuenta = (xs: string[], ks: string[]) => Object.fromEntries(ks.map((k) => [k, xs.filter((x) => x === k).length])) as Record<string, number>;
export interface Flujo {
  casos: Record<"abierto" | "en_investigacion" | "en_decision" | "cerrado", number> & { total: number };
  revisor: boolean;
  propuestas: Record<"pendiente" | "aprobada" | "rechazada" | "ajuste_solicitado", number> & { total: number };
  decisiones: Record<"aprobada" | "rechazada" | "ajuste_solicitado", number> & { total: number };
}
export function flujo(casos: Pick<Caso, "estado">[], propuestas: { estado: string }[], decisiones: { decision: string }[], filas: FilaBitacora[]): Flujo {
  const c = cuenta(casos.map((x) => x.estado), ["abierto", "en_investigacion", "en_decision", "cerrado"]);
  const p = cuenta(propuestas.map((x) => x.estado), ["pendiente", "aprobada", "rechazada", "ajuste_solicitado"]);
  const d = cuenta(decisiones.map((x) => x.decision), ["aprobada", "rechazada", "ajuste_solicitado"]);
  return {
    casos: { ...c, total: casos.length } as Flujo["casos"], propuestas: { ...p, total: propuestas.length } as Flujo["propuestas"], decisiones: { ...d, total: decisiones.length } as Flujo["decisiones"],
    revisor: filas.some((f) => f.agente === "revisor") || propuestas.length > 0, // el paso del Revisor existe solo si el Revisor existe
  };
}
