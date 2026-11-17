// Lógica pura del aviso de correos nuevos (push-email-poller): agrupar, resumir y no repetir.
// Sin red ni base de datos: la usa la función y se prueba aparte (emailPush.test.ts).

export type Mensaje = { received: string; from: string; subject: string };
export type Grupo = { key: string; from: string; subject: string; count: number; latest: string };

/** Solo se avisan correos recibidos en la última hora, aunque la marca de agua sea más vieja. */
export const VENTANA_MAX_MIN = 60;
/** Un mismo remitente con el mismo asunto no vuelve a generar aviso durante este tiempo. */
export const SILENCIO_REPETIDOS_MIN = 30;

const MAX_ASUNTO = 48;
const MAX_CUERPO = 170;
const MAX_GRUPOS_EN_TEXTO = 3;

/** Asunto sin «RE:/FW:/RV:», espacios repetidos ni mayúsculas, para comparar. */
export function normalizarAsunto(s: string): string {
  let t = (s ?? "").trim();
  let previo: string;
  do {
    previo = t;
    t = t.replace(/^\s*(re|rv|fw|fwd)\s*:\s*/i, "");
  } while (t !== previo);
  return t.replace(/\s+/g, " ").trim().toLowerCase();
}

/** Hash corto y estable (FNV-1a de 32 bits) de remitente + asunto normalizado. */
export function claveGrupo(m: Pick<Mensaje, "from" | "subject">): string {
  const base = `${(m.from ?? "").trim().toLowerCase()}|${normalizarAsunto(m.subject)}`;
  let h = 0x811c9dc5;
  for (let i = 0; i < base.length; i++) {
    h ^= base.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Agrupa por remitente + asunto. Orden: el grupo con el correo más reciente primero. */
export function agruparMensajes(msgs: Mensaje[]): Grupo[] {
  const por = new Map<string, Grupo>();
  for (const m of msgs) {
    const key = claveGrupo(m);
    const g = por.get(key);
    if (!g) {
      por.set(key, { key, from: m.from, subject: m.subject, count: 1, latest: m.received });
    } else {
      g.count += 1;
      if (m.received > g.latest) {
        g.latest = m.received;
        g.from = m.from;
        g.subject = m.subject;
      }
    }
  }
  return [...por.values()].sort((a, b) => (a.latest < b.latest ? 1 : a.latest > b.latest ? -1 : 0));
}

/** Desde cuándo buscar: la marca de agua, pero nunca más atrás que la ventana máxima. ISO UTC. */
export function desdeEfectivo(marcaIso: string, ahoraMs: number, maxMin = VENTANA_MAX_MIN): string {
  const marca = new Date(marcaIso).getTime();
  const piso = ahoraMs - maxMin * 60_000;
  return new Date(Number.isNaN(marca) ? piso : Math.max(marca, piso)).toISOString();
}

/** Separa lo que ya se avisó hace poco de lo que sí es noticia. */
export function separarRepetidos(grupos: Grupo[], yaAvisadas: Set<string>): { nuevos: Grupo[]; repetidos: Grupo[] } {
  const nuevos: Grupo[] = [];
  const repetidos: Grupo[] = [];
  for (const g of grupos) (yaAvisadas.has(g.key) ? repetidos : nuevos).push(g);
  return { nuevos, repetidos };
}

function cortar(s: string, max: number): string {
  const t = (s ?? "").replace(/\s+/g, " ").trim();
  return t.length <= max ? t : `${t.slice(0, max - 1).trimEnd()}…`;
}

function lineaGrupo(g: Grupo): string {
  const asunto = cortar(g.subject || "(sin asunto)", MAX_ASUNTO);
  return g.count > 1 ? `${g.from}: ${asunto} (×${g.count})` : `${g.from}: ${asunto}`;
}

/** Título y cuerpo del aviso para los grupos que sí son noticia. */
export function armarAviso(nuevos: Grupo[]): { title: string; body: string } {
  const total = nuevos.reduce((n, g) => n + g.count, 0);
  if (nuevos.length === 1) {
    const g = nuevos[0];
    if (g.count === 1) return { title: "Correo nuevo", body: cortar(lineaGrupo(g), MAX_CUERPO) };
    return {
      title: `${g.count} correos nuevos de ${cortar(g.from, 30)}`,
      body: cortar(g.subject || "(sin asunto)", MAX_CUERPO),
    };
  }
  const visibles = nuevos.slice(0, MAX_GRUPOS_EN_TEXTO).map(lineaGrupo);
  const resto = nuevos.length - visibles.length;
  const partes = resto > 0 ? [...visibles, `y ${resto} más`] : visibles;
  return { title: `${total} correos nuevos`, body: cortar(partes.join(" · "), MAX_CUERPO) };
}
