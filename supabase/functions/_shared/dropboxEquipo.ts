// Dropbox para los agentes: reglas puras (sin red) de la función `agente-dropbox` y de sus pruebas.
// El puente es de SOLO LECTURA y solo entrega lo que cuelga de las carpetas raíz autorizadas (por defecto, /Kawiil Mx/CLIENTES).
// La decisión de «está dentro» se toma con la ruta que Dropbox devuelve del propio archivo (path_lower), nunca con la que manda quien pregunta.

export const RAICES_POR_DEFECTO = ["/kawiil mx/clientes"];
export const MAX_ENTRADAS = 400;                 // elementos por carpeta (con paginación acotada)
export const MAX_BYTES_LEER = 8 * 1024 * 1024;   // el contenido viaja en base64 por una respuesta de función
export const MAX_PAGINAS = 4;

// Raíces desde un valor de entorno (separadas por «;»). Se normalizan a minúsculas y sin «/» final. Lo inválido se descarta.
export function normalizarRaices(valor: string | undefined | null): string[] {
  const lista = (valor ?? "").split(";").map((s) => s.trim()).filter(Boolean);
  const out: string[] = [];
  for (const r of lista) {
    const n = "/" + r.toLowerCase().replace(/\\/g, "/").split("/").filter((p) => p !== "").join("/");
    if (n === "/" || n.includes("..") || /[\u0000-\u001f]/.test(n)) continue;   // jamás la raíz de todo Dropbox
    if (!out.includes(n)) out.push(n);
  }
  return out.length ? out : [...RAICES_POR_DEFECTO];
}

// ¿Esta ruta (path_lower de Dropbox) es una raíz autorizada o cuelga de una? Por segmentos: «/kawiil mx/clientes-viejos» NO cuenta.
export function dentroDeRaices(pathLower: unknown, raices: string[]): boolean {
  if (typeof pathLower !== "string" || !pathLower.startsWith("/") || pathLower.includes("..") || /[\u0000-\u001f]/.test(pathLower)) return false;
  const p = pathLower.toLowerCase().replace(/\/+$/, "");
  return raices.some((r) => p === r || p.startsWith(r + "/"));
}

// Un id de Dropbox («id:AbC…») o la palabra «raiz». Una ruta escrita a mano también se acepta, pero igual se valida contra la raíz.
export function referenciaValida(v: unknown): v is string {
  if (typeof v !== "string") return false;
  if (v === "raiz") return true;
  if (/^id:[A-Za-z0-9_\-]{5,200}$/.test(v)) return true;
  return v.startsWith("/") && v.length <= 500 && !v.includes("..") && !/[\u0000-\u001f]/.test(v);
}

// Comparación de tokens en tiempo constante (el puente se protege con un secreto compartido con la VM).
export function tokensIguales(a: unknown, b: unknown): boolean {
  if (typeof a !== "string" || typeof b !== "string" || a.length === 0 || b.length === 0) return false;
  const x = new TextEncoder().encode(a), y = new TextEncoder().encode(b);
  let diff = x.length ^ y.length;
  for (let i = 0; i < Math.max(x.length, y.length); i++) diff |= (x[i] ?? 0) ^ (y[i] ?? 0);
  return diff === 0;
}

const MIMES: Record<string, string> = {
  pdf: "application/pdf",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  txt: "text/plain", csv: "text/csv", md: "text/plain",
  png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg",
};
export const mimePorNombre = (nombre: string): string | null => MIMES[(nombre.split(".").pop() ?? "").toLowerCase()] ?? null;

export const recortar = (v: unknown, max: number): string => {
  const s = typeof v === "string" ? v.replace(/[\u0000-\u001f\u007f]/g, " ").trim() : "";
  return s.length > max ? s.slice(0, max - 1) + "…" : s;
};

export interface EntradaPublica { id: string; nombre: string; tipo: "carpeta" | "archivo"; tamano: number | null; modificado: string | null; ruta: string }

// Lo que sale hacia la VM de cada elemento: solo lo necesario. Ignora lo que no es archivo ni carpeta (p. ej. eliminados) o no está dentro.
export function entradaPublica(e: Record<string, unknown>, raices: string[]): EntradaPublica | null {
  const tag = e[".tag"];
  if ((tag !== "folder" && tag !== "file") || typeof e.id !== "string" || !dentroDeRaices(e.path_lower, raices)) return null;
  return {
    id: e.id, nombre: recortar(e.name, 200), tipo: tag === "folder" ? "carpeta" : "archivo",
    tamano: typeof e.size === "number" ? e.size : null,
    modificado: typeof e.server_modified === "string" ? e.server_modified : (typeof e.client_modified === "string" ? e.client_modified : null),
    ruta: recortar(e.path_display, 500),
  };
}
