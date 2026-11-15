// Barra única de tareas: sugiere a qué agente le toca lo que la persona escribe. Es una sugerencia determinista (coincidencia de palabras con el nombre,
// la descripción y el departamento de cada agente): no llama a ningún modelo y no envía nada. La persona siempre confirma el agente.
import { nombreAgente, descripcionAgente, type AgenteRegistro } from "./registro";
import { departamentoDe } from "./departamentos";

export interface Sugerencia { agente: AgenteRegistro; puntos: number; motivo: string }

const SIN_VALOR = new Set(("para por con sin sobre entre desde hasta como cual cuales esto esta este estos estas esos esas que los las del una uno unos unas " +
  "mas muy pero porque cuando donde quien favor puedes puede podrias necesito necesitamos quiero quieres hacer haz hacerme revisa revisar dame dime nuestro nuestra nuestros nuestras " +
  "todo todos toda todas algo hay son fue ser esta estan tiene tienen hoy ahora").split(" "));

const limpia = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
/** Palabras con valor del texto: sin acentos, sin palabras vacías, de 3+ letras y sin repetir. */
export function palabrasClave(texto: string): string[] {
  return [...new Set(limpia(texto).split(/[^a-z0-9ñ]+/).filter((w) => w.length >= 3 && !SIN_VALOR.has(w)))];
}
const raiz = (w: string) => (w.length > 6 ? w.slice(0, 6) : w.length > 4 ? w.slice(0, w.length - 1) : w);
const coincide = (w: string, bolsa: string[]) => { const r = raiz(w); return bolsa.some((b) => b === w || (r.length >= 4 && (b.startsWith(r) || raiz(b) === r))); };

/** Hasta 3 agentes, del que mejor encaja al que menos; vacío si el texto no se parece a ninguno. */
export function sugerirAgentes(texto: string, agentes: AgenteRegistro[], max = 3): Sugerencia[] {
  const palabras = palabrasClave(texto);
  if (palabras.length === 0) return [];
  const lista: Sugerencia[] = [];
  for (const a of agentes) {
    if (a.status === "archived" || a.kind === "system") continue;
    const nombre = nombreAgente(a), nombres = palabrasClave(`${nombre} ${a.name.replace(/_/g, " ")}`);
    const desc = palabrasClave(`${descripcionAgente(a)} ${a.role ?? ""} ${departamentoDe(a).nombre}`);
    let puntos = 0; const motivos: string[] = [];
    const citado = nombres.some((n) => palabras.includes(n));
    if (citado) { puntos += 10; motivos.push("lo mencionaste"); }
    const comunes = palabras.filter((w) => coincide(w, desc));
    if (comunes.length) { puntos += comunes.length * 2; motivos.push(`coincide en «${comunes.slice(0, 3).join("», «")}»`); }
    if (puntos > 0) lista.push({ agente: a, puntos, motivo: motivos.join(" y ") });
  }
  return lista.sort((x, y) => y.puntos - x.puntos || nombreAgente(x.agente).localeCompare(nombreAgente(y.agente))).slice(0, max);
}

/** Título corto de la tarea a partir de lo escrito (primera frase, hasta 80 caracteres). */
export function tituloDe(texto: string): string {
  const t = texto.trim().replace(/\s+/g, " ");
  const frase = t.split(/(?<=[.!?])\s/)[0] || t;
  return frase.length <= 80 ? frase : frase.slice(0, 79).replace(/\s+\S*$/, "") + "…";
}
