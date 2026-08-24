/**
 * Catálogos del SAT que Ju'un necesita para llenar formularios de portales de
 * facturación de terceros.
 *
 * No existían en el repo. Van como constantes tipadas porque son catálogos
 * cerrados y de cambio lento: si el SAT publica una versión nueva, se edita
 * este archivo y el CHECK equivalente en la migración
 * `20260824220000_juun_fis_schema.sql` (las dos listas tienen que coincidir).
 */

export interface SatCatalogEntry {
  clave: string;
  descripcion: string;
}

/** A quién aplica un régimen fiscal según el catálogo del SAT. */
export type PersonaFiscal = "fisica" | "moral" | "ambas";

export interface RegimenFiscalEntry extends SatCatalogEntry {
  /**
   * Tipo de persona al que aplica el régimen.
   *
   * Se usa SOLO para una advertencia no bloqueante en el formulario (un RFC de
   * 13 caracteres con un régimen de persona moral casi siempre es un dedazo).
   * Nunca impide guardar: si el SAT y este archivo discrepan, manda el SAT.
   */
  persona: PersonaFiscal;
}

/** c_RegimenFiscal. */
export const C_REGIMEN_FISCAL: readonly RegimenFiscalEntry[] = [
  { clave: "601", descripcion: "General de Ley Personas Morales", persona: "moral" },
  { clave: "603", descripcion: "Personas Morales con Fines no Lucrativos", persona: "moral" },
  { clave: "605", descripcion: "Sueldos y Salarios e Ingresos Asimilados a Salarios", persona: "fisica" },
  { clave: "606", descripcion: "Arrendamiento", persona: "fisica" },
  { clave: "607", descripcion: "Régimen de Enajenación o Adquisición de Bienes", persona: "fisica" },
  { clave: "608", descripcion: "Demás ingresos", persona: "fisica" },
  { clave: "610", descripcion: "Residentes en el Extranjero sin Establecimiento Permanente en México", persona: "ambas" },
  { clave: "611", descripcion: "Ingresos por Dividendos (socios y accionistas)", persona: "fisica" },
  { clave: "612", descripcion: "Personas Físicas con Actividades Empresariales y Profesionales", persona: "fisica" },
  { clave: "614", descripcion: "Ingresos por intereses", persona: "fisica" },
  { clave: "615", descripcion: "Régimen de los ingresos por obtención de premios", persona: "fisica" },
  { clave: "616", descripcion: "Sin obligaciones fiscales", persona: "ambas" },
  { clave: "620", descripcion: "Sociedades Cooperativas de Producción que optan por diferir sus ingresos", persona: "moral" },
  { clave: "621", descripcion: "Incorporación Fiscal", persona: "fisica" },
  { clave: "622", descripcion: "Actividades Agrícolas, Ganaderas, Silvícolas y Pesqueras", persona: "ambas" },
  { clave: "623", descripcion: "Opcional para Grupos de Sociedades", persona: "moral" },
  { clave: "624", descripcion: "Coordinados", persona: "moral" },
  { clave: "625", descripcion: "Régimen de las Actividades Empresariales con ingresos a través de Plataformas Tecnológicas", persona: "fisica" },
  { clave: "626", descripcion: "Régimen Simplificado de Confianza", persona: "ambas" },
] as const;

/** c_UsoCFDI. */
export const C_USO_CFDI: readonly SatCatalogEntry[] = [
  { clave: "G01", descripcion: "Adquisición de mercancías" },
  { clave: "G02", descripcion: "Devoluciones, descuentos o bonificaciones" },
  { clave: "G03", descripcion: "Gastos en general" },
  { clave: "I01", descripcion: "Construcciones" },
  { clave: "I02", descripcion: "Mobiliario y equipo de oficina por inversiones" },
  { clave: "I03", descripcion: "Equipo de transporte" },
  { clave: "I04", descripcion: "Equipo de cómputo y accesorios" },
  { clave: "I05", descripcion: "Dados, troqueles, moldes, matrices y herramental" },
  { clave: "I06", descripcion: "Comunicaciones telefónicas" },
  { clave: "I07", descripcion: "Comunicaciones satelitales" },
  { clave: "I08", descripcion: "Otra maquinaria y equipo" },
  { clave: "D01", descripcion: "Honorarios médicos, dentales y gastos hospitalarios" },
  { clave: "D02", descripcion: "Gastos médicos por incapacidad o discapacidad" },
  { clave: "D03", descripcion: "Gastos funerales" },
  { clave: "D04", descripcion: "Donativos" },
  { clave: "D05", descripcion: "Intereses reales efectivamente pagados por créditos hipotecarios (casa habitación)" },
  { clave: "D06", descripcion: "Aportaciones voluntarias al SAR" },
  { clave: "D07", descripcion: "Primas por seguros de gastos médicos" },
  { clave: "D08", descripcion: "Gastos de transportación escolar obligatoria" },
  { clave: "D09", descripcion: "Depósitos en cuentas para el ahorro, primas que tengan como base planes de pensiones" },
  { clave: "D10", descripcion: "Pagos por servicios educativos (colegiaturas)" },
  { clave: "S01", descripcion: "Sin efectos fiscales" },
  { clave: "CP01", descripcion: "Pagos" },
  { clave: "CN01", descripcion: "Nómina" },
] as const;

/** Uso de CFDI por defecto para un gasto de operación. */
export const USO_CFDI_DEFAULT = "G03";

export const REGIMEN_FISCAL_CLAVES: readonly string[] = C_REGIMEN_FISCAL.map((r) => r.clave);
export const USO_CFDI_CLAVES: readonly string[] = C_USO_CFDI.map((u) => u.clave);

const REGIMEN_BY_CLAVE = new Map(C_REGIMEN_FISCAL.map((r) => [r.clave, r]));
const USO_BY_CLAVE = new Map(C_USO_CFDI.map((u) => [u.clave, u]));

export function getRegimenFiscal(clave: string | null | undefined): RegimenFiscalEntry | null {
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
 * TODO(Ju'un/fiscal): matriz de compatibilidad régimen × uso de CFDI.
 *
 * El SAT publica qué usos de CFDI acepta cada régimen del receptor, y el PAC
 * del comercio RECHAZA la factura si la combinación no es válida. Hoy solo
 * validamos que cada clave exista en su catálogo, que es lo que el Bloque 1
 * necesita.
 *
 * La matriz NO se implementa a ojo: hay que cargarla del catálogo oficial
 * vigente (c_UsoCFDI, columnas «Régimen Fiscal Receptor») antes de que el
 * agente empiece a enviar formularios de verdad. Inventarla haría que
 * rechacemos combinaciones válidas o que quememos la ventana de facturación
 * de un ticket con una inválida.
 */
export const MATRIZ_REGIMEN_USO_PENDIENTE = true;
