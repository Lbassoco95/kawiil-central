// Sprites de pixel art propios de la oficina (dibujados aquí, sin imágenes externas: no hay licencias de terceros).
// Cada sprite es una cuadrícula de 20 × 21 píxeles que se arma con rectángulos; la figura cambia según el estado.
import type { EstadoOficina } from "./oficina";

export interface Pix { x: number; y: number; c: string }
export interface Rect { x: number; y: number; w: number; h: number; c: string }
export interface SpriteAgente { ancho: number; alto: number; frames: Rect[][]; emote: Rect[] }

export const ANCHO = 20, ALTO = 21;

const PIELES = ["#f1dcc2", "#e6c29a", "#c99468", "#8f5d3d"];
const PELOS = ["#4a3b2c", "#2b2723", "#8b5a2b", "#b0652a", "#6e6a66"];
const OJO = "#3d3226", BOCA = "#8a4b43", ESCRITORIO = "#d9c7a8", ESCRITORIO_SOMBRA = "#bfa882", PORTATIL = "#9aa3ad", PORTATIL_SOMBRA = "#7c858f";
export type EstiloPelo = "corto" | "largo" | "mono" | "rizado";
const ESTILOS: EstiloPelo[] = ["corto", "largo", "mono", "rizado"];

function hash(s: string): number { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; }

export function oscurecer(hex: string, f: number): string {
  const n = parseInt(hex.slice(1), 16);
  const c = (v: number) => Math.max(0, Math.min(255, Math.round(v * f))).toString(16).padStart(2, "0");
  return `#${c((n >> 16) & 255)}${c((n >> 8) & 255)}${c(n & 255)}`;
}

// Mezcla píxeles sueltos en rectángulos horizontales del mismo color (menos elementos SVG).
export function aRects(pix: Pix[]): Rect[] {
  const mapa = new Map<string, string>();
  for (const p of pix) mapa.set(`${p.x},${p.y}`, p.c);   // el último dibujado gana
  const filas = new Map<number, Pix[]>();
  for (const [k, c] of mapa) { const [x, y] = k.split(",").map(Number); (filas.get(y) ?? filas.set(y, []).get(y)!).push({ x, y, c }); }
  const out: Rect[] = [];
  for (const [y, fila] of [...filas.entries()].sort((a, b) => a[0] - b[0])) {
    fila.sort((a, b) => a.x - b.x);
    let ini = fila[0];
    let w = 1;
    for (let i = 1; i <= fila.length; i++) {
      const p = fila[i];
      if (p && p.c === ini.c && p.x === ini.x + w) { w++; continue; }
      out.push({ x: ini.x, y, w, h: 1, c: ini.c });
      if (p) { ini = p; w = 1; }
    }
  }
  return out;
}

const rect = (x0: number, y0: number, x1: number, y1: number, c: string): Pix[] => {
  const o: Pix[] = [];
  for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) o.push({ x, y, c });
  return o;
};
const dot = (x: number, y: number, c: string): Pix[] => [{ x, y, c }];

type Ojos = "abiertos" | "cerrados";
type Boca = "neutra" | "sonrisa" | "triste" | "dormida";
type Brazos = "teclea_a" | "teclea_b" | "reposo" | "arriba_a" | "arriba_b";

interface Aspecto { piel: string; pelo: string; estilo: EstiloPelo; camisa: string }

function personaje(a: Aspecto, ojos: Ojos, boca: Boca, brazos: Brazos, dy = 0): Pix[] {
  const sombraPiel = oscurecer(a.piel, 0.88), sombraCamisa = oscurecer(a.camisa, 0.85), sombraPelo = oscurecer(a.pelo, 0.8);
  const p: Pix[] = [];
  const Y = (y: number) => y + dy;
  // Pelo detrás (largo cae por los lados) y moño
  if (a.estilo === "largo") { p.push(...rect(5, Y(3), 6, Y(10), a.pelo), ...rect(13, Y(3), 14, Y(10), a.pelo)); }
  if (a.estilo === "mono") p.push(...rect(9, Y(0), 10, Y(1), sombraPelo));
  // Cabeza
  p.push(...rect(6, Y(3), 13, Y(9), a.piel), ...rect(6, Y(9), 13, Y(9), sombraPiel));
  // Pelo arriba
  p.push(...rect(7, Y(1), 12, Y(1), a.pelo), ...rect(6, Y(2), 13, Y(2), a.pelo), ...rect(6, Y(3), 7, Y(3), a.pelo), ...rect(12, Y(3), 13, Y(3), a.pelo));
  if (a.estilo === "rizado") p.push(...rect(5, Y(2), 14, Y(4), a.pelo), ...rect(6, Y(1), 13, Y(1), a.pelo));
  if (a.estilo === "corto") p.push(...dot(8, Y(3), sombraPelo));
  // Ojos
  if (ojos === "abiertos") p.push(...dot(8, Y(6), OJO), ...dot(11, Y(6), OJO));
  else p.push(...rect(7, Y(6), 8, Y(6), OJO), ...rect(11, Y(6), 12, Y(6), OJO));
  // Boca
  if (boca === "neutra") p.push(...rect(9, Y(8), 10, Y(8), BOCA));
  else if (boca === "sonrisa") p.push(...dot(8, Y(7), BOCA), ...dot(11, Y(7), BOCA), ...rect(9, Y(8), 10, Y(8), BOCA));
  else if (boca === "triste") p.push(...rect(9, Y(7), 10, Y(7), BOCA), ...dot(8, Y(8), BOCA), ...dot(11, Y(8), BOCA));
  else p.push(...dot(10, Y(8), BOCA));
  // Cuello y torso
  p.push(...rect(9, Y(10), 10, Y(10), sombraPiel));
  p.push(...rect(6, Y(11), 13, Y(11), a.camisa), ...rect(5, Y(12), 14, Y(17), a.camisa), ...rect(5, Y(12), 5, Y(17), sombraCamisa), ...rect(14, Y(12), 14, Y(17), sombraCamisa));
  // Brazos
  const manga = a.camisa;
  const baja = (x: number, alto: number) => [...rect(x, Y(12), x + 1, Y(alto), manga), ...rect(x, Y(alto + 1), x + 1, Y(alto + 1), a.piel)];
  const alta = (x: number, tope: number) => [...rect(x, Y(tope + 1), x + 1, Y(12), manga), ...rect(x, Y(tope), x + 1, Y(tope), a.piel)];
  if (brazos === "teclea_a") p.push(...baja(3, 14), ...baja(15, 15));
  else if (brazos === "teclea_b") p.push(...baja(3, 15), ...baja(15, 14));
  else if (brazos === "reposo") p.push(...baja(3, 15), ...baja(15, 15));
  else if (brazos === "arriba_a") p.push(...alta(3, 6), ...alta(15, 8));
  else p.push(...alta(3, 8), ...alta(15, 6));
  return p.filter((q) => q.y >= 0 && q.y < ALTO);   // el salto de «celebrando» puede sacar el moño de la cuadrícula
}

function escritorio(estado: EstadoOficina): Pix[] {
  const p: Pix[] = [...rect(1, 17, 18, 17, ESCRITORIO), ...rect(1, 18, 18, 20, ESCRITORIO_SOMBRA)];
  // Portátil visto por detrás (la pantalla mira al agente)
  p.push(...rect(7, 14, 12, 16, PORTATIL), ...rect(7, 16, 12, 16, PORTATIL_SOMBRA));
  if (estado === "trabajando") p.push(...dot(9, 15, "#7fd1a0"), ...dot(10, 15, "#7fd1a0"));
  if (estado === "sentado" || estado === "celebrando") p.push(...rect(16, 15, 17, 16, "#b5835a"), ...dot(18, 15, "#b5835a"));  // taza
  return p;
}

// Emoticonos de 5 × 7 (bitmaps) sobre la cabeza del agente.
const GLIFOS: Record<string, string[]> = {
  "!": ["..#..", "..#..", "..#..", "..#..", "..#..", ".....", "..#.."],
  "?": [".###.", "#...#", "....#", "...#.", "..#..", ".....", "..#.."],
  "z": ["#####", "...#.", "..#..", ".#...", "#####", ".....", "....."],
  "*": ["..#..", "..#..", "#####", ".###.", "#...#", ".....", "....."],
};
function glifo(g: string, x0: number, y0: number, c: string): Pix[] {
  const o: Pix[] = [];
  GLIFOS[g].forEach((fila, y) => [...fila].forEach((ch, x) => { if (ch === "#") o.push({ x: x0 + x, y: y0 + y, c }); }));
  return o;
}

export function aspectoDe(id: string, camisa: string): Aspecto {
  const h = hash(id);
  return { piel: PIELES[h % PIELES.length], pelo: PELOS[(h >>> 3) % PELOS.length], estilo: ESTILOS[(h >>> 6) % ESTILOS.length], camisa };
}

export function spriteAgente(estado: EstadoOficina, id: string, camisa: string): SpriteAgente {
  const a = aspectoDe(id, camisa), esc = escritorio(estado);
  const arma = (...capas: Pix[][]) => aRects(capas.flat());
  let frames: Rect[][], emote: Pix[] = [];
  switch (estado) {
    case "trabajando":
      frames = [arma(personaje(a, "abiertos", "neutra", "teclea_a"), esc), arma(personaje(a, "abiertos", "neutra", "teclea_b"), esc)]; break;
    case "celebrando":
      frames = [arma(personaje(a, "abiertos", "sonrisa", "arriba_a"), esc), arma(personaje(a, "abiertos", "sonrisa", "arriba_b", -1), esc)];
      emote = glifo("*", 0, 0, "#e0b341"); break;
    case "sentado":
      frames = [arma(personaje(a, "abiertos", "neutra", "reposo"), esc), arma(personaje(a, "cerrados", "neutra", "reposo"), esc)]; break;
    case "descansando":
      frames = [arma(personaje(a, "cerrados", "dormida", "reposo", 1), esc)];
      emote = glifo("z", 15, 0, "#9a8d78"); break;
    case "atascado":
      frames = [arma(personaje(a, "abiertos", "triste", "reposo"), esc)];
      emote = glifo("?", 15, 0, "#d98a93"); break;
    case "con_error":
      frames = [arma(personaje(a, "abiertos", "triste", "reposo"), esc)];
      emote = glifo("!", 15, 0, "#d98a93"); break;
    default: // apagado
      frames = [arma(personaje(a, "cerrados", "dormida", "reposo", 1), esc)];
  }
  return { ancho: ANCHO, alto: ALTO, frames, emote: aRects(emote) };
}
