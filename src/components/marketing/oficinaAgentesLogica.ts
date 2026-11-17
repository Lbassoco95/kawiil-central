// Oficina de agentes de Marketing (fase 1, solo lectura): qué personaje se dibuja y con qué estado, según los datos reales.
// Funciones puras: reciben los agentes, sus tareas y la hora; no leen ni escriben nada.
import {
  cumplimiento, nombreAgente, senalAgente, ultimaTareaDe,
  type AgenteRegistro, type Cumplimiento, type Senal, type TareaMarketing,
} from "./agentesRegistroLogica";
import type { EstadoOficina, FiguraOficina } from "@/lib/agentes/oficina";

export type Animacion = "escribiendo" | "leyendo" | "descansando" | "error" | "sin_datos" | "pensando";
export type ColorPastilla = "verde" | "amarillo" | "rojo" | "gris";

// Una corrida de estos agentes dura segundos: durante los 30 minutos siguientes el personaje «acaba de trabajar».
export const VENTANA_RECIENTE_MS = 30 * 60_000;

// Nombre corto y tipo de trabajo de cada personaje. El dibujo y el sitio en la sala son los de la sala isométrica (lib/agentes/personajes y salas).
export interface Aspecto { corto: string; trabajo: Exclude<Animacion, "descansando" | "error" | "sin_datos"> }
export const ASPECTO: Record<string, Aspecto> = {
  marketing_vigilante: { corto: "Vigilante", trabajo: "escribiendo" },
  marketing_informe_diario: { corto: "Informe", trabajo: "leyendo" },
  marketing_vigia: { corto: "Vigía", trabajo: "leyendo" },
  marketing_analista: { corto: "Analista", trabajo: "escribiendo" },
  marketing_cmo: { corto: "CMO", trabajo: "escribiendo" },
  marketing_investigador: { corto: "Investigador", trabajo: "leyendo" },
  marketing_comunicacion_interna: { corto: "Comunicación", trabajo: "escribiendo" },
};
const ASPECTO_POR_DEFECTO: Aspecto = { corto: "Agente", trabajo: "leyendo" };
export const aspectoDe = (a: Pick<AgenteRegistro, "name">): Aspecto => ASPECTO[a.name] ?? ASPECTO_POR_DEFECTO;

export interface EstadoVisual {
  animacion: Animacion; etiqueta: string; color: ColorPastilla;
  burbuja: "!" | null;             // pide atención: error, atraso o meta sin cumplir
  senal: Senal; cumple: Cumplimiento; detalle: string;
}

// `pensando`: el agente está respondiendo una pregunta en este momento (lo sabe la pantalla, no la base de datos).
export function estadoVisual(a: AgenteRegistro, ultima: TareaMarketing | undefined, ahora: Date, pensando = false): EstadoVisual {
  const senal = senalAgente(a, ahora);
  const cumple = cumplimiento(a, ultima, ahora);
  const ref = [ultima?.completed_at, a.last_heartbeat].filter((x): x is string => !!x).sort().at(-1) ?? null;
  const reciente = ref !== null && ahora.getTime() - new Date(ref).getTime() <= VENTANA_RECIENTE_MS;
  const base = { senal, cumple };
  if (pensando) return { ...base, animacion: "pensando", etiqueta: "Pensando", color: "amarillo", burbuja: null, detalle: "Está preparando una respuesta." };

  if (senal === "disponible") {
    const atencion = cumple.estado === "no_cumple";
    return { ...base, animacion: reciente ? aspectoDe(a).trabajo : "descansando", etiqueta: reciente ? "Acaba de responder" : atencion ? "Atención" : "Disponible", color: atencion ? "amarillo" : "verde", burbuja: atencion ? "!" : null, detalle: "Responde cuando se le pregunta." };
  }
  if (senal === "sin_latido") return { ...base, animacion: "sin_datos", etiqueta: "Sin datos", color: "gris", burbuja: null, detalle: "Todavía no ha dejado ninguna corrida." };
  if (senal === "con_error") return { ...base, animacion: "error", etiqueta: "Con error", color: "rojo", burbuja: "!", detalle: "Su última corrida terminó con error." };
  if (senal === "atrasado") return { ...base, animacion: "error", etiqueta: "Atrasado", color: "rojo", burbuja: "!", detalle: "Lleva más de 26 horas sin correr." };
  const atencion = cumple.estado === "no_cumple";
  if (reciente) return { ...base, animacion: aspectoDe(a).trabajo, etiqueta: atencion ? "Atención" : "Acaba de trabajar", color: atencion ? "amarillo" : "verde", burbuja: atencion ? "!" : null, detalle: "Corrió hace poco." };
  return { ...base, animacion: "descansando", etiqueta: atencion ? "Atención" : "Al día", color: atencion ? "amarillo" : "verde", burbuja: atencion ? "!" : null, detalle: "Esperando su próxima corrida." };
}

export interface PersonajeOficina {
  id: string; clave: string; nombre: string; aspecto: Aspecto; estado: EstadoVisual; ultima: TareaMarketing | undefined; historial: TareaMarketing[];
}

const ORDEN = ["marketing_cmo", "marketing_vigilante", "marketing_informe_diario", "marketing_vigia", "marketing_analista", "marketing_investigador", "marketing_comunicacion_interna"];

// Los agentes de Marketing, en orden fijo, con su estado. No se inventan agentes que no están en el registro.
export function personajes(agentes: AgenteRegistro[], tareas: TareaMarketing[], ahora: Date, pensandoId: string | null = null): PersonajeOficina[] {
  return agentes
    .filter((a) => a.name.startsWith("marketing_") && a.kind === "system" && a.status !== "archived")
    .sort((x, y) => (ORDEN.indexOf(x.name) + 99) % 99 - (ORDEN.indexOf(y.name) + 99) % 99 || x.name.localeCompare(y.name))
    .map((a) => {
      const propias = tareas.filter((t) => t.agent_id === a.id).sort((p, q) => (q.completed_at ?? "").localeCompare(p.completed_at ?? ""));
      const ultima = ultimaTareaDe(a, tareas);
      const aspecto = aspectoDe(a);
      return { id: a.id, clave: a.name, nombre: nombreAgente(a), aspecto, estado: estadoVisual(a, ultima, ahora, a.id === pensandoId), ultima, historial: propias.slice(0, 5) };
    });
}

// Marketing en la sala isométrica: cada personaje se dibuja con el estado de oficina que más se le parece; la etiqueta que se lee sigue siendo la de Marketing.
//   pensando → trabajando · acaba de trabajar → terminó · con «!» (error, atraso, meta sin cumplir) → algo falló · sin datos → sin señal · el resto → disponible.
export function estadoDeSala(e: EstadoVisual): EstadoOficina {
  if (e.animacion === "pensando") return "trabajando";
  if (e.burbuja === "!" || e.animacion === "error") return "con_error";
  if (e.animacion === "sin_datos") return "apagado";
  if (e.animacion === "escribiendo" || e.animacion === "leyendo") return "celebrando";
  return "sentado";
}
export function figurasDeSala(lista: PersonajeOficina[]): FiguraOficina[] {
  return lista.map((p) => ({ id: p.id, clave: p.clave, nombre: p.nombre, estado: estadoDeSala(p.estado), ultimoLatido: null, ultimaTareaAt: p.ultima?.completed_at ?? null, tareasBien: 0, tareasMal: 0, descripcion: "", rol: "" }));
}
