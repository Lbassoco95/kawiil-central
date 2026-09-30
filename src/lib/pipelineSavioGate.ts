import { isWonPipelineStageSlug } from "@/lib/pipelineWonStage";

/** @deprecated Prefer `isWonPipelineStageSlug`; slug histórico del board «Cerrado». */
export const SAVIO_SEND_ALLOWED_STAGE_SLUG = "convertido";

export function canSendLeadToSavio(stageSlug: string | null | undefined): boolean {
  return isWonPipelineStageSlug(stageSlug);
}

export function isLeadPipelineLost(stageSlug: string | null | undefined): boolean {
  return stageSlug === "perdido";
}

/**
 * Qué tanto de «Facturación y Savio» tiene sentido mostrar en la ficha del lead.
 *
 * Pedir razón social, RFC y monto durante el seguimiento sólo deja campos vacíos:
 * esos datos se piden al cliente cuando ya cerró. Por eso el bloque completo
 * aparece sólo con el trato ganado, en seguimiento queda un aviso de una línea y
 * en un lead perdido no se muestra nada.
 */
export type SavioBillingVisibility = "full" | "hint" | "hidden";

export function savioBillingVisibility(
  stageSlug: string | null | undefined,
): SavioBillingVisibility {
  if (canSendLeadToSavio(stageSlug)) return "full";
  if (isLeadPipelineLost(stageSlug)) return "hidden";
  return "hint";
}
