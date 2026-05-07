/** Etapa en la que el trato se considera ganado y se permite alta en Savio desde el lead. */
export const SAVIO_SEND_ALLOWED_STAGE_SLUG = "convertido";

export function canSendLeadToSavio(stageSlug: string | null | undefined): boolean {
  return stageSlug === SAVIO_SEND_ALLOWED_STAGE_SLUG;
}

export function isLeadPipelineLost(stageSlug: string | null | undefined): boolean {
  return stageSlug === "perdido";
}
