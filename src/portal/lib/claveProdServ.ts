/** Catálogo SAT ClaveProdServ vs concepto (descripción libre). */

export type ClaveIssueCode = "faltante" | "formato_invalido" | "no_cuadra";

export interface ConceptoLinea {
  description?: string | null;
  product_service_key?: string | null;
  /** Si central/publish marca descuadre explícito. */
  key_mismatch?: boolean;
}

export interface ClaveIssue {
  code: ClaveIssueCode;
  label: string;
}

/** Formato catálogo c_ClaveProdServ: 8 dígitos. */
export function isValidClaveProdServFormat(key: string | null | undefined): boolean {
  return /^\d{8}$/.test(String(key ?? "").trim());
}

/**
 * Heurística DEMO/cliente: clave de combustible/gasolina con descripción de servicio profesional.
 * No sustituye validación de catálogo SAT completo (eso vive en central).
 */
export function looksMismatched(description: string | null | undefined, key: string | null | undefined): boolean {
  const d = String(description ?? "").toLowerCase();
  const k = String(key ?? "").trim();
  if (!k || !d) return false;
  const gasKeys = ["15101514", "15101505", "15101515"];
  const serviceWords = /consultor|servicio|asesor|honorario|contab|fiscal|legal|auditor/;
  if (gasKeys.includes(k) && serviceWords.test(d)) return true;
  return false;
}

export function assessClaveProdServ(line: ConceptoLinea): ClaveIssue | null {
  const key = String(line.product_service_key ?? "").trim();
  if (!key) {
    return { code: "faltante", label: "Sin clave de producto/servicio" };
  }
  if (!isValidClaveProdServFormat(key)) {
    return { code: "formato_invalido", label: "Clave de producto/servicio inválida" };
  }
  if (line.key_mismatch || looksMismatched(line.description, key)) {
    return { code: "no_cuadra", label: "La clave no parece corresponder al concepto" };
  }
  return null;
}

export function summarizeConceptKeyIssues(lines: ConceptoLinea[]): {
  faltante: number;
  formato_invalido: number;
  no_cuadra: number;
  total: number;
  label: string | null;
} {
  let faltante = 0;
  let formato_invalido = 0;
  let no_cuadra = 0;
  for (const line of lines) {
    const issue = assessClaveProdServ(line);
    if (!issue) continue;
    if (issue.code === "faltante") faltante += 1;
    else if (issue.code === "formato_invalido") formato_invalido += 1;
    else no_cuadra += 1;
  }
  const total = faltante + formato_invalido + no_cuadra;
  let label: string | null = null;
  if (total === 0) label = null;
  else if (faltante && !formato_invalido && !no_cuadra) {
    label = faltante === 1 ? "Falta clave de producto" : `${faltante} partidas sin clave`;
  } else if (no_cuadra && !faltante && !formato_invalido) {
    label = no_cuadra === 1 ? "Clave no cuadra con el concepto" : `${no_cuadra} claves no cuadran`;
  } else if (formato_invalido && !faltante && !no_cuadra) {
    label = formato_invalido === 1 ? "Clave inválida" : `${formato_invalido} claves inválidas`;
  } else {
    label = "Revisar claves de producto";
  }
  return { faltante, formato_invalido, no_cuadra, total, label };
}
