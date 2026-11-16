// Calendario de rutinas: qué agentes corren solos y cuándo. Dos fuentes, siempre en hora de Ciudad de México:
//  · Programadas: `config.programacion` (la pestaña «Programar»): hora, día y si está activa o pausada.
//  · Observadas: tareas con task_type = "scheduled" de los últimos 30 días, agrupadas por agente y día de la semana (solo fecha, hora, agente y estado:
//    nunca títulos, instrucciones, resultados ni mensajes de error).
// Funciones puras: reciben las filas y la hora, no leen ni escriben nada.
import { esAgenteDeMarketing, type AgenteRegistro, type TareaAgente } from "./registro";

export const ZONA = "America/Mexico_City";
export const DIAS_CORTOS = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"] as const;
export const DIAS_OBSERVADOS = 30;
const MS_DIA = 86_400_000;

const partes = new Intl.DateTimeFormat("en-US", { timeZone: ZONA, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit" });
const NUM_DIA: Record<string, number> = { Mon: 0, Tue: 1, Wed: 2, Thu: 3, Fri: 4, Sat: 5, Sun: 6 };

/** Día de la semana (0 = lunes), hora, minuto y fecha (AAAA-MM-DD) de un instante en hora de Ciudad de México. */
export function enMexico(d: Date): { dia: number; h: number; m: number; fecha: string } {
  const p = Object.fromEntries(partes.formatToParts(d).map((x) => [x.type, x.value]));
  return { dia: NUM_DIA[p.weekday] ?? 0, h: Number(p.hour) % 24, m: Number(p.minute), fecha: `${p.year}-${p.month}-${p.day}` };
}
export const horaTexto = (minutos: number): string => `${String(Math.floor(minutos / 60) % 24).padStart(2, "0")}:${String(Math.round(minutos) % 60).padStart(2, "0")}`;

export interface Celda { hora: string; corridas: number; bien: number; mal: number; programada: boolean }
export interface FilaRutina {
  agenteId: string; nombre: string; marketing: boolean;
  celdas: Array<Celda | null>;                 // 7 posiciones, lunes a domingo
  programada: "activa" | "pausada" | null;     // estado de config.programacion, si la hay
  pausadaMotivo: string | null;
  horaProgramada: string | null; diaProgramado: number | null;   // diaProgramado null = todos los días
  proxima: Date | null;                        // próxima ejecución de la rutina programada activa
  corridas30: number; ultimaCorrida: string | null; ultimaFalla: boolean;
  fuente: "programada" | "observada" | "ambas";
}

const nombreDe = (a: Pick<AgenteRegistro, "name" | "display_name">) => a.display_name?.trim() || a.name;
const esFalla = (s: string) => s === "error" || s === "failed";
const mediana = (v: number[]) => { const s = [...v].sort((x, y) => x - y), k = Math.floor(s.length / 2); return s.length % 2 ? s[k] : (s[k - 1] + s[k]) / 2; };

type Programacion = { activa?: unknown; hora?: unknown; dia_semana?: unknown; pausada_motivo?: unknown };
const progDe = (a: AgenteRegistro): Programacion | null => {
  const p = (a.config as { programacion?: unknown } | null | undefined)?.programacion;
  return p && typeof p === "object" && !Array.isArray(p) ? (p as Programacion) : null;
};
const horaValida = (h: unknown): h is string => typeof h === "string" && /^([01]\d|2[0-3]):[0-5]\d$/.test(h);

/** Próxima ejecución de una rutina programada (hora de México), a partir de `ahora`. Probando hasta 8 días hacia adelante. */
export function proximaEjecucion(hora: string, dia: number | null, ahora: Date): Date {
  const [hh, mm] = hora.split(":").map(Number);
  const base = ahora.getTime();
  for (let k = 0; k <= 8; k++) {
    const cand = new Date(base + k * MS_DIA);
    const f = enMexico(cand);
    if (dia !== null && f.dia !== dia) continue;
    // Instante de ese día a esa hora de México: se ajusta el candidato por la diferencia de minutos del día.
    const delta = (hh * 60 + mm) - (f.h * 60 + f.m);
    const t = new Date(cand.getTime() + delta * 60_000);
    if (t.getTime() > base) return t;
  }
  return new Date(base + MS_DIA);
}

export function filasDeRutinas(agentes: AgenteRegistro[], tareas: TareaAgente[], ahora: Date): FilaRutina[] {
  const desde = ahora.getTime() - DIAS_OBSERVADOS * MS_DIA;
  const porAgente = new Map<string, TareaAgente[]>();
  for (const t of tareas) {
    if (t.task_type !== "scheduled" || !t.agent_id || new Date(t.created_at).getTime() < desde) continue;
    (porAgente.get(t.agent_id) ?? porAgente.set(t.agent_id, []).get(t.agent_id)!).push(t);
  }
  const filas: FilaRutina[] = [];
  for (const a of agentes) {
    if (a.status === "archived") continue;
    const p = progDe(a), propias = porAgente.get(a.id) ?? [];
    const activa = p?.activa === true && horaValida(p.hora);
    const pausada = !!p && p.activa !== true && typeof p.pausada_motivo === "string" && p.pausada_motivo.length > 0;
    if (!activa && !pausada && propias.length === 0) continue;

    const celdas: Array<Celda | null> = Array(7).fill(null);
    const minutosPorDia: number[][] = Array.from({ length: 7 }, () => []);
    const stats = Array.from({ length: 7 }, () => ({ bien: 0, mal: 0 }));
    let ultima: TareaAgente | null = null;
    for (const t of propias) {
      const f = enMexico(new Date(t.created_at));
      minutosPorDia[f.dia].push(f.h * 60 + f.m);
      if (esFalla(t.status)) stats[f.dia].mal++; else if (t.status === "completed") stats[f.dia].bien++;
      if (!ultima || t.created_at > ultima.created_at) ultima = t;
    }
    for (let d = 0; d < 7; d++) {
      if (minutosPorDia[d].length) celdas[d] = { hora: horaTexto(mediana(minutosPorDia[d])), corridas: minutosPorDia[d].length, bien: stats[d].bien, mal: stats[d].mal, programada: false };
    }
    let horaProg: string | null = null, diaProg: number | null = null, proxima: Date | null = null;
    if (activa && p) {
      horaProg = p.hora as string;
      diaProg = typeof p.dia_semana === "number" && Number.isInteger(p.dia_semana) && p.dia_semana >= 0 && p.dia_semana <= 6 ? p.dia_semana : null;
      for (let d = 0; d < 7; d++) {
        if (diaProg !== null && d !== diaProg) continue;
        celdas[d] = celdas[d] ? { ...celdas[d]!, programada: true } : { hora: horaProg, corridas: 0, bien: 0, mal: 0, programada: true };
      }
      proxima = proximaEjecucion(horaProg, diaProg, ahora);
    }
    filas.push({
      agenteId: a.id, nombre: nombreDe(a), marketing: esAgenteDeMarketing(a), celdas,
      programada: activa ? "activa" : pausada ? "pausada" : null, pausadaMotivo: pausada ? String(p!.pausada_motivo) : null,
      horaProgramada: horaProg, diaProgramado: diaProg, proxima,
      corridas30: propias.length, ultimaCorrida: ultima?.created_at ?? null, ultimaFalla: !!ultima && esFalla(ultima.status),
      fuente: (activa || pausada) && propias.length ? "ambas" : activa || pausada ? "programada" : "observada",
    });
  }
  // Primero lo que tiene una próxima ejecución cercana, luego lo observado con más corridas, luego por nombre.
  return filas.sort((x, y) => (x.proxima && y.proxima ? x.proxima.getTime() - y.proxima.getTime() : x.proxima ? -1 : y.proxima ? 1 : 0)
    || y.corridas30 - x.corridas30 || x.nombre.localeCompare(y.nombre));
}

export interface ResumenRutinas { programadas: number; pausadas: number; conCorridas: number; corridas: number; fallas: number }
export function resumenRutinas(filas: FilaRutina[]): ResumenRutinas {
  const r: ResumenRutinas = { programadas: 0, pausadas: 0, conCorridas: 0, corridas: 0, fallas: 0 };
  for (const f of filas) {
    if (f.programada === "activa") r.programadas++;
    if (f.programada === "pausada") r.pausadas++;
    if (f.corridas30 > 0) r.conCorridas++;
    r.corridas += f.corridas30;
    r.fallas += f.celdas.reduce((n, c) => n + (c?.mal ?? 0), 0);
  }
  return r;
}
