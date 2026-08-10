/** Catálogo de fases/categorías estándar para proyectos de área cumplimiento (PLD/regulatorio). */

export const COMPLIANCE_CATEGORY_LABELS: Record<string, string> = {
  reportes_uif: "Reportes al SAT/UIF",
  reportes_cnbv: "Reportes a CNBV",
  capacitacion: "Capacitación y cultura de cumplimiento",
  kyc: "Gestión de expedientes y KYC",
  politicas: "Políticas y manuales",
  auditoria: "Auditoría interna",
  avisos_sat: "Avisos al SAT (SAT-AV)",
  conservacion: "Conservación de información",
  otros: "Otros",
};

/** Orden por defecto al sembrar `projects.phases` (sin incluir claves personalizadas). */
export const COMPLIANCE_CATEGORY_ORDER: string[] = [
  "reportes_uif",
  "reportes_cnbv",
  "capacitacion",
  "kyc",
  "politicas",
  "auditoria",
  "avisos_sat",
  "conservacion",
  "otros",
];

/**
 * Categorías de plantilla que son obligaciones fiscales (SAT) y que por defecto
 * NO se siembran en proyectos de cumplimiento: eso le corresponde a Contabilidad.
 * Se mantienen disponibles en el generador manual por si se contrata a Kawiil como
 * cumplimiento/control interno y se quieren incluir explícitamente, pero nunca se
 * dejan como establecidas de forma automática.
 */
export const FISCAL_COMPLIANCE_CATEGORIES: ReadonlySet<string> = new Set(["fiscal"]);

export function isFiscalComplianceCategory(category: string | null | undefined): boolean {
  return !!category && FISCAL_COMPLIANCE_CATEGORIES.has(category);
}

const ORDER_INDEX = new Map(COMPLIANCE_CATEGORY_ORDER.map((k, i) => [k, i]));

export function complianceCategoryLabel(key: string): string {
  return COMPLIANCE_CATEGORY_LABELS[key] || key;
}

export function isStandardComplianceCategoryKey(key: string): boolean {
  return key in COMPLIANCE_CATEGORY_LABELS;
}

/** Ordenar claves del catálogo; las no listadas van al final alfabéticamente. */
export function compareComplianceCategoryKeys(a: string, b: string): number {
  const ia = ORDER_INDEX.has(a) ? ORDER_INDEX.get(a)! : 999;
  const ib = ORDER_INDEX.has(b) ? ORDER_INDEX.get(b)! : 999;
  if (ia !== ib) return ia - ib;
  return a.localeCompare(b, "es");
}
