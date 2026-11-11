// Oficina de agentes de Marketing (fase 1, solo lectura): qué personaje se dibuja y con qué estado, según los datos reales.
// Funciones puras: reciben los agentes, sus tareas y la hora; no leen ni escriben nada.
import {
  cuandoRelativo, cumplimiento, nombreAgente, senalAgente, ultimaTareaDe,
  type AgenteRegistro, type Cumplimiento, type Senal, type TareaMarketing,
} from "./agentesRegistroLogica";

export type Animacion = "escribiendo" | "leyendo" | "descansando" | "error" | "sin_datos" | "pensando";
export type ColorPastilla = "verde" | "amarillo" | "rojo" | "gris";

// Una corrida de estos agentes dura segundos: durante los 30 minutos siguientes el personaje «acaba de trabajar».
// Solo cuenta la corrida o respuesta REAL (completed_at de su tarea). El latido no cuenta: significa «sigo vivo» y lo puede refrescar cualquier
// proceso (el 11 nov los cuatro tenían el mismo latido al microsegundo y todos aparecían «acaba de trabajar» con su última corrida de hace 8 h).
export const VENTANA_RECIENTE_MS = 30 * 60_000;

// Aspecto de cada personaje (dibujado aparte; no se usa arte de terceros) y su sitio en la oficina.
export interface Aspecto { corto: string; pelo: string; ropa: string; x: number; y: number; trabajo: Exclude<Animacion, "descansando" | "error" | "sin_datos"> }
export const ASPECTO: Record<string, Aspecto> = {
  marketing_vigilante: { corto: "Vigilante", pelo: "#5a3b25", ropa: "#6f9d7a", x: 80, y: 84, trabajo: "escribiendo" },
  marketing_informe_diario: { corto: "Informe", pelo: "#222222", ropa: "#6d9bc3", x: 215, y: 84, trabajo: "leyendo" },
  marketing_vigia: { corto: "Vigía", pelo: "#b07a3a", ropa: "#b8a98a", x: 350, y: 84, trabajo: "leyendo" },
  marketing_analista: { corto: "Analista", pelo: "#3a2a1a", ropa: "#9b7b4f", x: 520, y: 84, trabajo: "escribiendo" },
};
const ASPECTO_POR_DEFECTO: Aspecto = { corto: "Agente", pelo: "#444444", ropa: "#999999", x: 300, y: 84, trabajo: "leyendo" };
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
  // Excepción: el Vigía no deja tarea cuando todo está bien, solo actualiza su latido; para él el latido ES la revisión.
  const marca = a.name === "marketing_vigia" ? [ultima?.completed_at, a.last_heartbeat].filter((x): x is string => !!x).sort().at(-1) : ultima?.completed_at;
  const reciente = !!marca && ahora.getTime() - new Date(marca).getTime() <= VENTANA_RECIENTE_MS;
  const cuando = ultima?.completed_at ? `Su última corrida fue ${cuandoRelativo(ultima.completed_at, ahora)}.` : a.last_heartbeat ? `Su último latido fue ${cuandoRelativo(a.last_heartbeat, ahora)}.` : "";
  const base = { senal, cumple };
  if (pensando) return { ...base, animacion: "pensando", etiqueta: "Pensando", color: "amarillo", burbuja: null, detalle: "Está preparando una respuesta." };

  if (senal === "disponible") {
    const atencion = cumple.estado === "no_cumple";
    return { ...base, animacion: reciente ? aspectoDe(a).trabajo : "descansando", etiqueta: reciente ? "Acaba de responder" : atencion ? "Atención" : "Disponible", color: atencion ? "amarillo" : "verde", burbuja: atencion ? "!" : null, detalle: reciente ? "Acaba de responder una pregunta." : `Responde cuando se le pregunta.${cuando ? ` Su última respuesta fue ${cuandoRelativo(ultima?.completed_at ?? a.last_heartbeat, ahora)}.` : ""}` };
  }
  if (senal === "sin_latido") return { ...base, animacion: "sin_datos", etiqueta: "Sin datos", color: "gris", burbuja: null, detalle: "Todavía no ha dejado ninguna corrida." };
  if (senal === "con_error") return { ...base, animacion: "error", etiqueta: "Con error", color: "rojo", burbuja: "!", detalle: "Su última corrida terminó con error." };
  if (senal === "atrasado") return { ...base, animacion: "error", etiqueta: "Atrasado", color: "rojo", burbuja: "!", detalle: "Lleva más de 26 horas sin correr." };
  const atencion = cumple.estado === "no_cumple";
  if (reciente) return { ...base, animacion: aspectoDe(a).trabajo, etiqueta: atencion ? "Atención" : "Acaba de trabajar", color: atencion ? "amarillo" : "verde", burbuja: atencion ? "!" : null, detalle: "Corrió hace poco." };
  return { ...base, animacion: "descansando", etiqueta: atencion ? "Atención" : "Al día", color: atencion ? "amarillo" : "verde", burbuja: atencion ? "!" : null, detalle: `Esperando su próxima corrida. ${cuando}`.trim() };
}

// Los resúmenes guardados antes del 11 nov decían «1 cifras sin verificar; 8 consultas de datos». Se muestran con singular/plural y sin jerga;
// el resto de los resúmenes (colchón, informe) ya se entienden y pasan tal cual.
export function resumenLegible(resumen: string | null | undefined): string {
  if (!resumen) return "";
  return resumen
    .replace(/(\d+) cifras? sin verificar/gi, (_m, n: string) => `${n} ${Number(n) === 1 ? "cifra" : "cifras"} sin comprobar`)
    .replace(/cifras verificadas/gi, "cifras comprobadas contra la base")
    .replace(/(\d+) consultas? de datos/gi, (_m, n: string) => `consultó ${n} ${Number(n) === 1 ? "fuente" : "fuentes"} de datos`);
}

export interface PersonajeOficina {
  id: string; clave: string; nombre: string; aspecto: Aspecto; estado: EstadoVisual; ultima: TareaMarketing | undefined; historial: TareaMarketing[];
}

const ORDEN = ["marketing_vigilante", "marketing_informe_diario", "marketing_vigia", "marketing_analista"];

// Los agentes de Marketing, en orden fijo, con su estado. No se inventan agentes que no están en el registro.
export function personajes(agentes: AgenteRegistro[], tareas: TareaMarketing[], ahora: Date, pensandoId: string | null = null): PersonajeOficina[] {
  return agentes
    .filter((a) => a.name.startsWith("marketing_") && a.kind === "system" && a.status !== "archived")
    .sort((x, y) => (ORDEN.indexOf(x.name) + 99) % 99 - (ORDEN.indexOf(y.name) + 99) % 99 || x.name.localeCompare(y.name))
    .map((a) => {
      const propias = tareas.filter((t) => t.agent_id === a.id).sort((p, q) => (q.completed_at ?? "").localeCompare(p.completed_at ?? ""));
      const ultima = ultimaTareaDe(a, tareas);
      return { id: a.id, clave: a.name, nombre: nombreAgente(a), aspecto: aspectoDe(a), estado: estadoVisual(a, ultima, ahora, a.id === pensandoId), ultima, historial: propias.slice(0, 5) };
    });
}

// ¿Qué personaje está bajo el clic? (coordenadas del lienzo lógico)
export const ANCHO = 640, ALTO = 210;
export function personajeEn(x: number, y: number, lista: PersonajeOficina[]): PersonajeOficina | undefined {
  return lista.find((p) => x >= p.aspecto.x - 22 && x <= p.aspecto.x + 38 && y >= p.aspecto.y - 34 && y <= p.aspecto.y + 62);
}
