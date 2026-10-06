/**
 * Copy fiscal según audiencia (Polo):
 * - Clientes Kawiil (`origin: "kawiil"`): el contador del servicio orienta deducibilidad.
 * - Usuarios externos / self-serve (`origin: "basico"`, fase 2): solo estimado; consultar contador.
 */

export type FiscalAudienceOrigin = "kawiil" | "basico" | string | null | undefined;

export function isKawiilServiceClient(origin: FiscalAudienceOrigin): boolean {
  return origin === "kawiil";
}

/** Pie del cuadro IVA / KPIs brutos. */
export function ivaAudienceNote(origin: FiscalAudienceOrigin): string {
  if (isKawiilServiceClient(origin)) {
    return "Tu contador de Kawiil te orienta sobre qué es deducible y el tratamiento correcto. Estas cifras son la base publicada de tu cuenta; no sustituyen la declaración.";
  }
  return "Cifras estimadas a partir de tus CFDI publicados. No son consejo sobre deducibilidad ni una declaración. Consulta a un contador para el tratamiento fiscal correcto.";
}

/** Nota corta bajo KPI de ingreso bruto / gasto subtotal. */
export function brutoAudienceHint(origin: FiscalAudienceOrigin): string {
  if (isKawiilServiceClient(origin)) {
    return "Base gravable (subtotal). El IVA va en el cuadro aparte. Tu contador Kawiil revisa deducibilidad.";
  }
  return "Base gravable (subtotal) estimada. IVA aparte. No es consejo de deducibilidad — consulta a un contador.";
}

/** Explicación del estimado IVA por pagar / a favor. */
export function ivaEstimateExplain(origin: FiscalAudienceOrigin): string {
  const core =
    "Trasladado = IVA cobrado al cliente. Acreditable = IVA en pagos/compras (cuando pagas). "
    + "El estimado (por pagar o a favor) depende de la deducibilidad y no incluye facturas sin desglose.";
  if (isKawiilServiceClient(origin)) {
    return `${core} Tu contador de Kawiil confirma el tratamiento en tu servicio.`;
  }
  return `${core} En self-serve esto es solo un estimado; consulta a un contador.`;
}
