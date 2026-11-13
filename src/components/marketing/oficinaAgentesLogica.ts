// Oficina de agentes de Marketing (fase 1, solo lectura): qué personaje se dibuja y con qué estado, según los datos reales.
// Funciones puras: reciben los agentes, sus tareas y la hora; no leen ni escriben nada.
import {
  cumplimiento, nombreAgente, senalAgente, ultimaTareaDe,
  type AgenteRegistro, type Cumplimiento, type Senal, type TareaMarketing,
} from "./agentesRegistroLogica";

export type Animacion = "escribiendo" | "leyendo" | "descansando" | "error" | "sin_datos" | "pensando";
export type ColorPastilla = "verde" | "amarillo" | "rojo" | "gris";

// Una corrida de estos agentes dura segundos: durante los 30 minutos siguientes el personaje «acaba de trabajar».
export const VENTANA_RECIENTE_MS = 30 * 60_000;

// Aspecto de cada personaje (dibujado aparte; no se usa arte de terceros) y su sitio en la oficina.
export interface Aspecto { corto: string; pelo: string; ropa: string; x: number; y: number; trabajo: Exclude<Animacion, "descansando" | "error" | "sin_datos"> }
export const ASPECTO: Record<string, Aspecto> = {
  marketing_vigilante: { corto: "Vigilante", pelo: "#5a3b25", ropa: "#6f9d7a", x: 80, y: 84, trabajo: "escribiendo" },
  marketing_informe_diario: { corto: "Informe", pelo: "#222222", ropa: "#6d9bc3", x: 215, y: 84, trabajo: "leyendo" },
  marketing_vigia: { corto: "Vigía", pelo: "#b07a3a", ropa: "#b8a98a", x: 350, y: 84, trabajo: "leyendo" },
  marketing_analista: { corto: "Analista", pelo: "#3a2a1a", ropa: "#9b7b4f", x: 520, y: 84, trabajo: "escribiendo" },
  // El CMO se sienta en su propia franja «Dirección», encima del Analista; el resto del equipo baja DESPLAZA_CMO píxeles (ver personajes()).
  marketing_cmo: { corto: "CMO", pelo: "#2a1f3a", ropa: "#6b5b95", x: 520, y: 48, trabajo: "escribiendo" },
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

const ORDEN = ["marketing_cmo", "marketing_vigilante", "marketing_informe_diario", "marketing_vigia", "marketing_analista"];

// Los agentes de Marketing, en orden fijo, con su estado. No se inventan agentes que no están en el registro.
export function personajes(agentes: AgenteRegistro[], tareas: TareaMarketing[], ahora: Date, pensandoId: string | null = null): PersonajeOficina[] {
  return agentes
    .filter((a) => a.name.startsWith("marketing_") && a.kind === "system" && a.status !== "archived")
    .sort((x, y) => (ORDEN.indexOf(x.name) + 99) % 99 - (ORDEN.indexOf(y.name) + 99) % 99 || x.name.localeCompare(y.name))
    .map((a, _i, todos) => {
      const hayCmo = todos.some((x) => x.name === "marketing_cmo");
      const propias = tareas.filter((t) => t.agent_id === a.id).sort((p, q) => (q.completed_at ?? "").localeCompare(p.completed_at ?? ""));
      const ultima = ultimaTareaDe(a, tareas);
      const base = aspectoDe(a), aspecto = hayCmo && a.name !== "marketing_cmo" ? { ...base, y: base.y + DESPLAZA_CMO } : base;
      return { id: a.id, clave: a.name, nombre: nombreAgente(a), aspecto, estado: estadoVisual(a, ultima, ahora, a.id === pensandoId), ultima, historial: propias.slice(0, 5) };
    });
}

// ¿Qué personaje está bajo el clic? (coordenadas del lienzo lógico)
export const ANCHO = 640, ALTO = 210, DESPLAZA_CMO = 90;
// Con el CMO la oficina gana una franja arriba («Dirección»): el lienzo es DESPLAZA_CMO píxeles más alto.
export const hayCmo = (lista: Array<Pick<PersonajeOficina, "clave">>): boolean => lista.some((p) => p.clave === "marketing_cmo");
export const altoOficina = (lista: Array<Pick<PersonajeOficina, "clave">>): number => ALTO + (hayCmo(lista) ? DESPLAZA_CMO : 0);
export function personajeEn(x: number, y: number, lista: PersonajeOficina[]): PersonajeOficina | undefined {
  return lista.find((p) => x >= p.aspecto.x - 22 && x <= p.aspecto.x + 38 && y >= p.aspecto.y - 34 && y <= p.aspecto.y + 62);
}
