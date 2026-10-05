/** Etiquetas de flags CFDI visibles al cliente (nunca jerga “espejo”). */

export type CfdiFlag = { code: string; reason: string };

/** Copy cliente para badges/avisos de fila. */
export function clientFlagReason(flag: CfdiFlag): string {
  const code = String(flag.code ?? "").toLowerCase();
  const raw = String(flag.reason ?? "").trim();
  const isDemo = /\bDEMO\b/i.test(raw) || /\(DEMO\)/i.test(raw);

  if (code === "nota_credito") {
    return "Nota de crédito sobre factura relacionada";
  }
  if (code === "complemento_pago") {
    return /parcial/i.test(raw) ? "Complemento de pago parcial" : "Complemento de pago";
  }

  if (
    code === "metadata_only"
    || /solo metadatos/i.test(raw)
    || (/metadatos/i.test(raw) && /espejo/i.test(raw))
  ) {
    return isDemo ? "Detalle pendiente (ejemplo)" : "Detalle pendiente";
  }

  // Cualquier razón residual con “espejo” → versión neutra
  if (/espejo/i.test(raw)) {
    return stripEspejoJargon(raw) || (isDemo ? "Detalle pendiente (ejemplo)" : "Detalle pendiente");
  }

  // No mostrar UUIDs crudos en razones visibles.
  if (/[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}/.test(raw)) {
    return stripEspejoJargon(raw.replace(
      /[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}/g,
      "factura relacionada",
    )).replace(/\s*\(DEMO\)\s*/gi, " ").replace(/\s{2,}/g, " ").trim() || "Atención";
  }

  return raw || "Atención";
}

/** Limpia copy de API/seed que aún diga “espejo” (p. ej. leyendas de tablero). */
export function stripEspejoJargon(text: string): string {
  return text
    .replace(/\s*en el espejo\s*/gi, " ")
    .replace(/\bdel espejo\b/gi, "")
    .replace(/\bespejo\b/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

/** Calidad de detalle (Facturación) sin jerga interna. */
export function clientDetailQualityLabel(calidad: string | undefined, detailStatus: string | undefined): string {
  if (calidad === "completa" || detailStatus === "complete") return "Detalle completo";
  return "Detalle pendiente";
}
