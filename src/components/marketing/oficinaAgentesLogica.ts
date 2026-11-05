// Oficina de agentes de Marketing (fase 1, solo lectura): qué personaje se dibuja y con qué estado, según los datos reales.
// Funciones puras: reciben los agentes, sus tareas y la hora; no leen ni escriben nada.
import {
  cumplimiento, nombreAgente, senalAgente, ultimaTareaDe,
  type AgenteRegistro, type Cumplimiento, type Senal, type TareaMarketing,
} from "./agentesRegistroLogica";

export type Animacion = "escribiendo" | "leyendo" | "descansando" | "error" | "sin_datos";
export type ColorPastilla = "verde" | "amarillo" | "rojo" | "gris";

// Una corrida de estos agentes dura segundos: durante los 30 minutos siguientes el personaje «acaba de trabajar».
export const VENTANA_RECIENTE_MS = 30 * 60_000;

// Aspecto de cada personaje (dibujado aparte; no se usa arte de terceros) y su sitio en la oficina.
export interface Aspecto { corto: string; pelo: string; ropa: string; x: number; y: number; trabajo: Exclude<Animacion, "descansando" | "error" | "sin_datos"> }
export const ASPECTO: Record<string, Aspecto> = {
  marketing_vigilante: { corto: "Vigilante", pelo: "#5a3b25", ropa: "#6f9d7a", x: 120, y: 84, trabajo: "escribiendo" },
  marketing_informe_diario: { corto: "Informe", pelo: "#222222", ropa: "#6d9bc3", x: 300, y: 84, trabajo: "leyendo" },
  marketing_vigia: { corto: "Vigía", pelo: "#b07a3a", ropa: "#b8a98a", x: 480, y: 84, trabajo: "leyendo" },
};
const ASPECTO_POR_DEFECTO: Aspecto = { corto: "Agente", pelo: "#444444", ropa: "#999999", x: 300, y: 84, trabajo: "leyendo" };
export const aspectoDe = (a: Pick<AgenteRegistro, "name">): Aspecto => ASPECTO[a.name] ?? ASPECTO_POR_DEFECTO;

export interface EstadoVisual {
  animacion: Animacion; etiqueta: string; color: ColorPastilla;
  burbuja: "!" | null;             // pide atención: error, atraso o meta sin cumplir
  senal: Senal; cumple: Cumplimiento; detalle: string;
}

export function estadoVisual(a: AgenteRegistro, ultima: TareaMarketing | undefined, ahora: Date): EstadoVisual {
  const senal = senalAgente(a, ahora);
  const cumple = cumplimiento(a, ultima, ahora);
  const ref = [ultima?.completed_at, a.last_heartbeat].filter((x): x is string => !!x).sort().at(-1) ?? null;
  const reciente = ref !== null && ahora.getTime() - new Date(ref).getTime() <= VENTANA_RECIENTE_MS;
  const base = { senal, cumple };

  if (senal === "sin_latido") return { ...base, animacion: "sin_datos", etiqueta: "Sin datos", color: "gris", burbuja: null, detalle: "Todavía no ha dejado ninguna corrida." };
  if (senal === "con_error") return { ...base, animacion: "error", etiqueta: "Con error", color: "rojo", burbuja: "!", detalle: "Su última corrida terminó con error." };
  if (senal === "atrasado") return { ...base, animacion: "error", etiqueta: "Atrasado", color: "rojo", burbuja: "!", detalle: "Lleva más de 26 horas sin correr." };
  const atencion = cumple.estado === "no_cumple";
  if (reciente) return { ...base, animacion: aspectoDe(a).trabajo, etiqueta: atencion ? "Atención" : "Acaba de trabajar", color: atencion ? "amarillo" : "verde", burbuja: atencion ? "!" : null, detalle: "Corrió hace poco." };
  return { ...base, animacion: "descansando", etiqueta: atencion ? "Atención" : "Al día", color: atencion ? "amarillo" : "verde", burbuja: atencion ? "!" : null, detalle: "Esperando su próxima corrida." };
}

export interface PersonajeOficina {
  id: string; nombre: string; aspecto: Aspecto; estado: EstadoVisual; ultima: TareaMarketing | undefined; historial: TareaMarketing[];
}

const ORDEN = ["marketing_vigilante", "marketing_informe_diario", "marketing_vigia"];

// Los agentes de Marketing, en orden fijo, con su estado. No se inventan agentes que no están en el registro.
export function personajes(agentes: AgenteRegistro[], tareas: TareaMarketing[], ahora: Date): PersonajeOficina[] {
  return agentes
    .filter((a) => a.name.startsWith("marketing_") && a.kind === "system" && a.status !== "archived")
    .sort((x, y) => (ORDEN.indexOf(x.name) + 99) % 99 - (ORDEN.indexOf(y.name) + 99) % 99 || x.name.localeCompare(y.name))
    .map((a) => {
      const propias = tareas.filter((t) => t.agent_id === a.id).sort((p, q) => (q.completed_at ?? "").localeCompare(p.completed_at ?? ""));
      const ultima = ultimaTareaDe(a, tareas);
      return { id: a.id, nombre: nombreAgente(a), aspecto: aspectoDe(a), estado: estadoVisual(a, ultima, ahora), ultima, historial: propias.slice(0, 5) };
    });
}

// ¿Qué personaje está bajo el clic? (coordenadas del lienzo lógico)
export const ANCHO = 640, ALTO = 210;
export function personajeEn(x: number, y: number, lista: PersonajeOficina[]): PersonajeOficina | undefined {
  return lista.find((p) => x >= p.aspecto.x - 22 && x <= p.aspecto.x + 38 && y >= p.aspecto.y - 34 && y <= p.aspecto.y + 62);
}
