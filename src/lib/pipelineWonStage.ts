/**
 * Etapa “ganada” del pipeline (closed-won).
 *
 * En prod el board muestra **Cerrado** pero el slug histórico es `convertido`
 * (rename conversacional; el slug no cambia). Otras orgs pueden usar slug `cerrado`.
 * No hardcodear solo el literal `convertido` en gates de contrato / Savio.
 */

export const PIPELINE_WON_STAGE_SLUGS = ["convertido", "cerrado"] as const;

export type PipelineWonStageSlug = (typeof PIPELINE_WON_STAGE_SLUGS)[number];

/** Slugs de etapa perdida / no-ganada terminal. */
export const PIPELINE_LOST_STAGE_SLUGS = ["perdido"] as const;

export function normalizePipelineStageSlug(
  slug: string | null | undefined,
): string | null {
  if (slug == null) return null;
  const s = String(slug).trim().toLowerCase();
  return s.length ? s : null;
}

/**
 * ¿El slug corresponde a un trato ganado?
 * Acepta `convertido` (nombre UI: Cerrado) y `cerrado` por si el board usa esa key.
 */
export function isWonPipelineStageSlug(
  slug: string | null | undefined,
): boolean {
  const s = normalizePipelineStageSlug(slug);
  if (!s) return false;
  return (PIPELINE_WON_STAGE_SLUGS as readonly string[]).includes(s);
}

/**
 * Variante con metadatos de la fila `pipeline_stages` cuando existan.
 * - slug ganado → true
 * - terminal + no perdido → true (por si una org crea otra columna “won”)
 */
export function isWonPipelineStage(input: {
  slug?: string | null;
  name?: string | null;
  is_terminal?: boolean | null;
} | null | undefined): boolean {
  if (!input) return false;
  if (isWonPipelineStageSlug(input.slug)) return true;
  const lost = normalizePipelineStageSlug(input.slug);
  if (lost && (PIPELINE_LOST_STAGE_SLUGS as readonly string[]).includes(lost)) {
    return false;
  }
  if (input.is_terminal === true && lost && lost !== "frio") {
    return true;
  }
  const name = (input.name || "").trim().toLowerCase();
  if (
    name === "cerrado" ||
    name === "convertido" ||
    name === "cerrado ganado" ||
    name.startsWith("cerrado ")
  ) {
    return true;
  }
  return false;
}

/** Copy de UI: preferir el nombre del board (p. ej. «Cerrado»). */
export function wonStageDisplayLabel(
  stageName?: string | null,
  stageSlug?: string | null,
): string {
  const name = (stageName || "").trim();
  if (name) return name;
  const s = normalizePipelineStageSlug(stageSlug);
  if (s === "convertido" || s === "cerrado") return "Cerrado";
  return "etapa ganada";
}
