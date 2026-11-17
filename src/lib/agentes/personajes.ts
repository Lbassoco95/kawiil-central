// Personajes de la oficina: un solo formato para todos los agentes (cara y cabello propios, escritorio de madera con patas, monitor de pantalla azul, nombre debajo y la
// playera según el estado). Lo que distingue a cada agente son sus rasgos y sus accesorios. Aquí viven los tipos, el nivel (se calcula, no se asigna) y el dibujo de los
// accesorios; los datos de los 29 agentes actuales están en personajesDatos.ts, con las claves reales del registro (`agent_registry.name`).
import { ASPECTOS, PERFILES } from "./personajesDatos";

export type EstiloPelo = "corto" | "largo" | "mono" | "rizado";
export interface AspectoFijo { piel: string; pelo: string; estilo: EstiloPelo; accesorios: string[] }
export interface PerfilAgente { arquetipo: string; habla: string; frase: string; rasgos: string[]; cuida: string; aspecto: string }

/** Aspecto fijo del agente si está en el diseño; si no, el generador determinista por id lo inventa (ver sprites.ts). */
export const aspectoFijoDe = (clave: string | null | undefined): AspectoFijo | undefined => (clave ? ASPECTOS[clave] : undefined);
/** Perfil (personalidad) propuesto del agente, o undefined si es nuevo y aún no tiene. */
export const perfilDe = (clave: string | null | undefined): PerfilAgente | undefined => (clave ? PERFILES[clave] : undefined);

// ── Nivel: se calcula con las tareas hechas; no se asigna a mano ──────────────────────────────────────────────────────────────────
export type Nivel = "aprendiz" | "oficial" | "experto";
export const NIVELES: Record<Nivel, { etiqueta: string; estrellas: string; regla: string }> = {
  aprendiz: { etiqueta: "Aprendiz", estrellas: "★☆☆", regla: "Menos de 10 tareas hechas" },
  oficial: { etiqueta: "Oficial", estrellas: "★★☆", regla: "De 10 a 24 tareas hechas" },
  experto: { etiqueta: "Experto", estrellas: "★★★", regla: "25 tareas hechas o más" },
};
export const nivelDe = (tareasHechas: number | null | undefined): Nivel => { const n = Math.max(0, Math.floor(tareasHechas ?? 0)); return n >= 25 ? "experto" : n >= 10 ? "oficial" : "aprendiz"; };

// ── Accesorios: se dibujan en las mismas unidades del sprite (5 px por celda), encima de la cara ──────────────────────────────────
export interface DibujoAccesorio { x: number; y: number; w: number; h: number; fill: string; rx?: number; stroke?: string; sw?: number }
export const ACCESORIOS = ["glasses", "glasses_sq", "beard", "mustache", "headband", "scarf", "badge", "earring"] as const;
export const ETIQUETA_ACCESORIO: Record<string, string> = {
  glasses: "lentes redondos", glasses_sq: "lentes cuadrados", beard: "barba", mustache: "bigote", headband: "diadema", scarf: "bufanda", badge: "gafete", earring: "arete",
};
const LENTE = "rgba(255,255,255,.18)";

/** Rectángulos de un accesorio (`tipo` o `tipo:#color`). `pelo` es el color del cabello (la barba y el bigote lo usan). */
export function dibujoAccesorio(spec: string, pelo: string): DibujoAccesorio[] {
  const [n, c] = spec.split(":");
  switch (n) {
    case "glasses": return [
      { x: 36, y: 27, w: 13, h: 11, rx: 3, fill: LENTE, stroke: "#2f2a25", sw: 2 }, { x: 52, y: 27, w: 13, h: 11, rx: 3, fill: LENTE, stroke: "#2f2a25", sw: 2 }, { x: 49, y: 31, w: 3, h: 2, fill: "#2f2a25" }];
    case "glasses_sq": return [
      { x: 35, y: 27, w: 14, h: 10, fill: LENTE, stroke: "#3a3a46", sw: 2.5 }, { x: 51, y: 27, w: 14, h: 10, fill: LENTE, stroke: "#3a3a46", sw: 2.5 }, { x: 49, y: 31, w: 2, h: 2, fill: "#3a3a46" }];
    case "beard": return [{ x: 32, y: 45, w: 36, h: 9, fill: pelo }, { x: 30, y: 38, w: 4, h: 10, fill: pelo }, { x: 66, y: 38, w: 4, h: 10, fill: pelo }, { x: 45, y: 40, w: 10, h: 4, fill: "#8a4b43" }];
    case "mustache": return [{ x: 41, y: 36, w: 18, h: 4, fill: pelo }];
    case "headband": return [{ x: 28, y: 18, w: 44, h: 4, fill: c || "#d0605a" }];
    case "scarf": return [{ x: 28, y: 55, w: 44, h: 6, fill: c || "#d0605a" }, { x: 58, y: 60, w: 6, h: 12, fill: c || "#d0605a" }];
    case "badge": return [{ x: 58, y: 64, w: 7, h: 7, fill: c || "#d94a4a" }, { x: 60, y: 66, w: 3, h: 3, fill: "#ffffff" }];
    case "earring": return [{ x: 24, y: 40, w: 4, h: 6, fill: c || "#e0b030" }, { x: 72, y: 40, w: 4, h: 6, fill: c || "#e0b030" }];
    default: return [];
  }
}
export const dibujoAccesorios = (specs: string[], pelo: string): DibujoAccesorio[] => specs.flatMap((s) => dibujoAccesorio(s, pelo));
/** «lentes redondos y gafete» para el aria-label / la ficha. */
export const textoAccesorios = (specs: string[]): string => specs.map((s) => ETIQUETA_ACCESORIO[s.split(":")[0]] ?? "").filter(Boolean).join(" y ");
