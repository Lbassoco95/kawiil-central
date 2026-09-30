/**
 * Portal del cliente — validaciones fiscales compartidas (navegador y Edge).
 *
 * RFC y CP siguen exactamente las reglas de Ju'un (src/lib/juun/rfc.ts) y del
 * CHECK de fis_tax_profiles. Los catálogos son copia controlada de los de Ju'un
 * (una prueba compara que no se separen) más c_FormaPago y la matriz
 * régimen × uso, que se generan del archivo oficial del SAT.
 */
import regimenFile from "./catalogs/c_RegimenFiscal.json" with { type: "json" };
import usoFile from "./catalogs/c_UsoCFDI.json" with { type: "json" };
import formaPagoFile from "./catalogs/c_FormaPago.json" with { type: "json" };
import compatFile from "./catalogs/c_UsoCFDI_RegimenReceptor.json" with { type: "json" };

export interface CatalogEntry {
  clave: string;
  descripcion: string;
  /** Solo en c_RegimenFiscal generado del SAT. */
  fisica?: boolean;
  moral?: boolean;
}
export interface CatalogMeta {
  catalogo: string;
  fuente: string;
  publicado: string | null;
  generado_por: string | null;
  nota?: string;
}
export interface CompatEntry {
  uso: string;
  regimenes: string[];
}

export const C_REGIMEN_FISCAL = regimenFile.entries as CatalogEntry[];
export const C_USO_CFDI = usoFile.entries as CatalogEntry[];
export const C_FORMA_PAGO = formaPagoFile.entries as CatalogEntry[];
export const C_USO_REGIMEN = compatFile.entries as CompatEntry[];
export const CATALOG_META = {
  regimen: regimenFile._meta as CatalogMeta,
  uso: usoFile._meta as CatalogMeta,
  formaPago: formaPagoFile._meta as CatalogMeta,
  compat: compatFile._meta as CatalogMeta,
};

export const METODOS_PAGO = ["PUE", "PPD"] as const;
export const RFC_GENERICOS = ["XAXX010101000", "XEXX010101000"];
const RFC_RE = /^[A-ZÑ&]{3,4}[0-9]{6}[A-Z0-9]{3}$/;

export function normalizeRfc(raw: string | null | undefined): string {
  return (raw ?? "").normalize("NFKC").replace(/[\s.-]/g, "").toUpperCase();
}

function fechaValida(aammdd: string): boolean {
  const anio = Number(aammdd.slice(0, 2));
  const mes = Number(aammdd.slice(2, 4));
  const dia = Number(aammdd.slice(4, 6));
  if (mes < 1 || mes > 12 || dia < 1) return false;
  const cabeEn = (siglo: number) => dia <= new Date(Date.UTC(siglo + anio, mes, 0)).getUTCDate();
  return cabeEn(1900) || cabeEn(2000);
}

/** Formato de RFC (12 moral / 13 física) con fecha interna existente. */
export function isRfcFormat(raw: string | null | undefined, opts: { allowGeneric?: boolean } = {}): boolean {
  const rfc = normalizeRfc(raw);
  if (!RFC_RE.test(rfc)) return false;
  if (RFC_GENERICOS.includes(rfc)) return !!opts.allowGeneric;
  const letras = rfc.length === 12 ? 3 : 4;
  return fechaValida(rfc.slice(letras, letras + 6));
}

export function tipoPersona(rfc: string): "fisica" | "moral" | null {
  const n = normalizeRfc(rfc);
  return n.length === 12 ? "moral" : n.length === 13 ? "fisica" : null;
}

export const isCpFiscal = (raw: string | null | undefined) => /^[0-9]{5}$/.test((raw ?? "").trim());
export const isRegimen = (c: string | null | undefined) => C_REGIMEN_FISCAL.some((e) => e.clave === c);
export const isUsoCfdi = (c: string | null | undefined) => C_USO_CFDI.some((e) => e.clave === c);
export const isFormaPago = (c: string | null | undefined) => C_FORMA_PAGO.some((e) => e.clave === c);

export type CompatResult = { ok: true } | { ok: false; reason: "matriz_no_cargada" | "incompatible" };

/** ¿El uso de CFDI es válido para el régimen del receptor? Falla cerrado si la matriz no está cargada. */
export function usoCompatibleConRegimen(uso: string, regimen: string, table: CompatEntry[] = C_USO_REGIMEN): CompatResult {
  if (table.length === 0) return { ok: false, reason: "matriz_no_cargada" };
  const row = table.find((e) => e.uso === uso);
  if (!row || !row.regimenes.includes(regimen)) return { ok: false, reason: "incompatible" };
  return { ok: true };
}
