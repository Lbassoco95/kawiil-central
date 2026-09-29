/**
 * Portal del cliente — qué entra desde Dropbox y qué no (M5).
 *
 * Lista BLANCA, no lista negra:
 *   · Solo se recorren las áreas FISCAL y CONTABILIDAD de cada carpeta de cliente.
 *   · LEGAL y RECURSOS HUMANOS no se sincronizan en masa: entran solo por subida
 *     expresa de una persona (portal_staff_register_upload).
 *   · ADMINISTRATIVO no se lee NUNCA (guarda e.firma, CIEC y CSD): el
 *     sincronizador ni siquiera lista su contenido.
 *   · Solo tipos de documento (PDF, XML, XLSX, DOCX, imágenes). Se rechazan
 *     .key, .cer, .dec, .pfx, .p12, .req, .sdg y cualquier nombre que indique
 *     credencial (FIEL, e.firma, CIEC, CSD, contraseña, clave…).
 *
 * Módulo puro (sin Deno ni Node): lo usan la Edge portal-dropbox-sync, la
 * pantalla de mapeo y las pruebas. La base tiene el espejo
 * `portal_is_forbidden_filename()`; una prueba compara ambos.
 */

export const SYNC_AREAS = ["FISCAL", "CONTABILIDAD"] as const;
export const UPLOAD_ONLY_AREAS = ["LEGAL", "RECURSOS_HUMANOS"] as const;
export const NEVER_AREAS = ["ADMINISTRATIVO"] as const;
export type PortalArea = (typeof SYNC_AREAS)[number] | (typeof UPLOAD_ONLY_AREAS)[number];

export const ALLOWED_EXTENSIONS = ["pdf", "xml", "xlsx", "xls", "docx", "doc", "jpg", "jpeg", "png", "heic", "webp"] as const;

/** Extensiones de credenciales SAT y afines. */
export const FORBIDDEN_EXTENSIONS = ["key", "cer", "dec", "pfx", "p12", "req", "sdg"] as const;

/**
 * Palabras que delatan una credencial en el nombre. Espejo EXACTO de la
 * segunda expresión de `portal_is_forbidden_filename()` (migración
 * 20260929110200_portal_documents.sql).
 */
export const FORBIDDEN_NAME_PATTERN =
  /(fiel|e[.\-_ ]?firma|ciec|csd|contrase|password|passwd|clave|llave privada|sello digital)/i;

export const MAX_SYNC_FILE_BYTES = 25 * 1024 * 1024;

/** Quita acentos, espacios y mayúsculas: «Recursos Humanos» → «RECURSOS_HUMANOS». */
export function normalizeAreaName(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, "_");
}

export function areaOf(folderName: string): PortalArea | "ADMINISTRATIVO" | null {
  const n = normalizeAreaName(folderName);
  if (n === "ADMINISTRATIVO" || n === "ADMINISTRATIVA") return "ADMINISTRATIVO";
  if (n === "FISCAL") return "FISCAL";
  if (n === "CONTABILIDAD" || n === "CONTABLE") return "CONTABILIDAD";
  if (n === "LEGAL") return "LEGAL";
  if (n === "RECURSOS_HUMANOS" || n === "RH" || n === "RRHH") return "RECURSOS_HUMANOS";
  return null;
}

/** ¿Se recorre esta carpeta de área en la sincronización masiva? */
export function isSyncArea(folderName: string): boolean {
  const a = areaOf(folderName);
  return a === "FISCAL" || a === "CONTABILIDAD";
}

export function extensionOf(fileName: string): string {
  const i = fileName.lastIndexOf(".");
  return i < 0 ? "" : fileName.slice(i + 1).toLowerCase();
}

export function isForbiddenFileName(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  if ((FORBIDDEN_EXTENSIONS as readonly string[]).includes(extensionOf(lower))) return true;
  return FORBIDDEN_NAME_PATTERN.test(lower);
}

/** Copias en conflicto de Dropbox, accesos directos y temporales. */
export function isSyncNoise(fileName: string): boolean {
  const lower = fileName.toLowerCase();
  return (
    /\((conflicted copy|copia en conflicto|copia con conflicto)[^)]*\)/i.test(fileName) ||
    lower.endsWith(".web") ||
    lower.endsWith(".url") ||
    lower.endsWith(".lnk") ||
    lower.endsWith(".webloc") ||
    lower.endsWith(".paper") ||
    lower.startsWith("~$") ||
    lower.startsWith(".") ||
    lower === "desktop.ini" ||
    lower === "thumbs.db"
  );
}

export type RejectReason =
  | "area_prohibida"
  | "area_solo_subida_expresa"
  | "fuera_de_area"
  | "credencial"
  | "tipo_no_permitido"
  | "ruido_de_sincronizacion"
  | "demasiado_grande"
  | "acceso_directo";

export interface FileVerdict {
  accept: boolean;
  reason?: RejectReason;
}

export interface DropboxFileLike {
  name: string;
  size?: number;
  /** Dropbox marca los accesos directos como «is_downloadable: false» o con export_info. */
  isDownloadable?: boolean;
}

/** Decide si un ARCHIVO dentro de un área ya permitida entra. */
export function classifyFile(file: DropboxFileLike): FileVerdict {
  if (isForbiddenFileName(file.name)) return { accept: false, reason: "credencial" };
  if (isSyncNoise(file.name)) return { accept: false, reason: "ruido_de_sincronizacion" };
  if (file.isDownloadable === false) return { accept: false, reason: "acceso_directo" };
  if (!(ALLOWED_EXTENSIONS as readonly string[]).includes(extensionOf(file.name))) {
    return { accept: false, reason: "tipo_no_permitido" };
  }
  if (typeof file.size === "number" && file.size > MAX_SYNC_FILE_BYTES) return { accept: false, reason: "demasiado_grande" };
  return { accept: true };
}

/** Decide si una carpeta de primer nivel dentro del cliente se recorre. */
export function classifyAreaFolder(folderName: string): FileVerdict {
  const a = areaOf(folderName);
  if (a === "ADMINISTRATIVO") return { accept: false, reason: "area_prohibida" };
  if (a === "LEGAL" || a === "RECURSOS_HUMANOS") return { accept: false, reason: "area_solo_subida_expresa" };
  if (a === "FISCAL" || a === "CONTABILIDAD") return { accept: true };
  return { accept: false, reason: "fuera_de_area" };
}

/** Periodo sugerido por la ruta: CONTABILIDAD/<año>/<mes>. Solo sugerencia; lo fija una persona. */
const MESES: Record<string, number> = {
  enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8,
  septiembre: 9, setiembre: 9, octubre: 10, noviembre: 11, diciembre: 12,
};
export function suggestPeriod(pathSegments: string[]): { year: number | null; month: number | null } {
  let year: number | null = null;
  let month: number | null = null;
  for (const seg of pathSegments) {
    const s = seg.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
    const y = s.match(/^(20\d{2})$/);
    if (y) { year = Number(y[1]); continue; }
    const m = s.match(/^(\d{1,2})(?:[\s._-].*)?$/);
    if (m && year !== null && Number(m[1]) >= 1 && Number(m[1]) <= 12) { month = Number(m[1]); continue; }
    const name = Object.keys(MESES).find((k) => s === k || s.startsWith(k) || s.endsWith(k));
    if (name) month = MESES[name];
  }
  return { year, month };
}
