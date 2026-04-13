const raw = (import.meta.env.VITE_MOFFIN_API_FLAVOR as string | undefined)?.trim().toLowerCase() ?? "";

/**
 * Modo Moffin Solutions (CIEC, constancia/opinión vía solutions-api) en el front.
 * Solo es false si el build define explícitamente `VITE_MOFFIN_API_FLAVOR=legacy` (FIEL + sat_rfc).
 */
export const MOFFIN_USE_SOLUTIONS = raw !== "legacy";

export function isMoffinSolutionsUiEnabled(): boolean {
  return MOFFIN_USE_SOLUTIONS;
}
