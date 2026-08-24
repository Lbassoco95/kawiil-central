/**
 * Catálogos del SAT que Ju'un necesita para llenar formularios de portales de
 * facturación de terceros.
 *
 * **La fuente son los JSON de `./catalogs/`, no este archivo.** Se generan del
 * catálogo oficial del Anexo 20 (`catCFDI_V_4_*.xls`) con
 * `node scripts/juun/build-sat-catalogs.mjs <archivo.xls>`. Cuando el SAT
 * publique una versión nueva es reemplazar el JSON, no teclear claves.
 *
 * Mientras `_meta.fuente` de un JSON diga `"provisional"`, ese catálogo sigue
 * siendo el capturado a mano: sirve para trabajar, pero está incompleto (a
 * `c_RegimenFiscal` le faltan al menos 609, 628, 629 y 630) y no debe usarse
 * para decidir nada fiscal por sí solo.
 */

import regimenFiscalRaw from "./catalogs/c_RegimenFiscal.json";
import usoCfdiRaw from "./catalogs/c_UsoCFDI.json";

export interface SatCatalogEntry {
  clave: string;
  descripcion: string;
}

export interface SatCatalogMeta {
  catalogo: string;
  /** Nombre del .xls del que salió, o "provisional" si todavía es el capturado a mano. */
  fuente: string;
  publicado: string | null;
  generado_por: string | null;
  nota: string;
}

interface SatCatalogFile {
  _meta: SatCatalogMeta;
  entries: SatCatalogEntry[];
}

const regimenFiscalFile = regimenFiscalRaw as SatCatalogFile;
const usoCfdiFile = usoCfdiRaw as SatCatalogFile;

export const C_REGIMEN_FISCAL: readonly SatCatalogEntry[] = regimenFiscalFile.entries;
export const C_USO_CFDI: readonly SatCatalogEntry[] = usoCfdiFile.entries;

export const C_REGIMEN_FISCAL_META = regimenFiscalFile._meta;
export const C_USO_CFDI_META = usoCfdiFile._meta;

/** ¿Este catálogo todavía es el capturado a mano? */
export function esCatalogoProvisional(meta: SatCatalogMeta): boolean {
  return meta.fuente === "provisional";
}

/** Uso de CFDI por defecto para un gasto de operación. */
export const USO_CFDI_DEFAULT = "G03";

export const REGIMEN_FISCAL_CLAVES: readonly string[] = C_REGIMEN_FISCAL.map((r) => r.clave);
export const USO_CFDI_CLAVES: readonly string[] = C_USO_CFDI.map((u) => u.clave);

const REGIMEN_BY_CLAVE = new Map(C_REGIMEN_FISCAL.map((r) => [r.clave, r]));
const USO_BY_CLAVE = new Map(C_USO_CFDI.map((u) => [u.clave, u]));

export function getRegimenFiscal(clave: string | null | undefined): SatCatalogEntry | null {
  return (clave && REGIMEN_BY_CLAVE.get(clave)) || null;
}

export function getUsoCfdi(clave: string | null | undefined): SatCatalogEntry | null {
  return (clave && USO_BY_CLAVE.get(clave)) || null;
}

export function isRegimenFiscalValido(clave: string | null | undefined): boolean {
  return !!clave && REGIMEN_BY_CLAVE.has(clave);
}

export function isUsoCfdiValido(clave: string | null | undefined): boolean {
  return !!clave && USO_BY_CLAVE.has(clave);
}

/** Etiqueta «601 — General de Ley Personas Morales» para selects y resúmenes. */
export function etiquetaCatalogo(entry: SatCatalogEntry): string {
  return `${entry.clave} — ${entry.descripcion}`;
}

/**
 * Los únicos regímenes sobre los que hay CERTEZA de que son de persona moral.
 *
 * Deliberadamente corto. Las fuentes secundarias se contradicen entre sí sobre
 * varios regímenes (el 607, por ejemplo, aparece como moral en unas y como
 * física en otras), así que la lista se limita a los que no admiten
 * discusión, y todo lo demás no genera advertencia hasta que el catálogo
 * oficial esté cargado.
 *
 * El criterio: una advertencia que se equivoca es peor que no advertir, porque
 * la gente aprende a ignorarla.
 *
 * El 628 todavía no está en `c_RegimenFiscal.json` (le falta al catálogo
 * provisional). Se deja aquí a propósito: el día que se cargue el archivo
 * oficial, la advertencia empieza a cubrirlo sin tocar código.
 */
export const REGIMENES_PERSONA_MORAL_CIERTOS: readonly string[] = [
  "601", // General de Ley Personas Morales
  "603", // Personas Morales con Fines no Lucrativos
  "620", // Sociedades Cooperativas de Producción que optan por diferir sus ingresos
  "623", // Opcional para Grupos de Sociedades
  "624", // Coordinados
  "628", // Hidrocarburos
];

const MORALES_CIERTOS = new Set(REGIMENES_PERSONA_MORAL_CIERTOS);

/**
 * Qué sabemos del tipo de persona de un régimen. `sin_verificar` no significa
 * "es de persona física": significa que no lo sabemos con certeza y que nadie
 * debe decidir nada con eso.
 */
export type CertezaPersona = "moral" | "sin_verificar";

export function personaDelRegimen(clave: string | null | undefined): CertezaPersona {
  return clave && MORALES_CIERTOS.has(clave) ? "moral" : "sin_verificar";
}

/**
 * TODO(Ju'un/fiscal): matriz de compatibilidad régimen × uso de CFDI.
 *
 * El SAT publica qué usos de CFDI acepta cada régimen del receptor, y el PAC
 * del comercio RECHAZA la factura si la combinación no es válida. Hoy solo
 * validamos que cada clave exista en su catálogo.
 *
 * La matriz viene en el mismo `catCFDI_V_4_*.xls` (hoja c_UsoCFDI, columnas de
 * régimen del receptor). Se carga de ahí, nunca a ojo: inventarla haría que
 * rechacemos combinaciones válidas, o que quememos la ventana de facturación
 * de un ticket con una inválida.
 */
export const MATRIZ_REGIMEN_USO_PENDIENTE = true;
