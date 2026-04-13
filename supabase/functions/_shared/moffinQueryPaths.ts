/** Rutas POST bajo MOFFIN_BASE_URL. Por defecto alineadas con OpenAPI pública de Moffin. */

export type MoffinQueryConsultType =
  | "lista_69b"
  | "constancia_situacion_fiscal"
  | "opinion_cumplimiento";

function ensureLeadingSlash(path: string, defaultPath: string): string {
  const t = (path || defaultPath).trim();
  return t.startsWith("/") ? t : `/${t}`;
}

/** Último segmento de la ruta POST (p. ej. `sat_rfc`, `sat_blacklist`) para `moffin_consults.moffin_service`. */
export function moffinQueryServiceSegment(path: string): string {
  const parts = path.replace(/\/+$/, "").split("/").filter((s) => s.length > 0);
  return parts[parts.length - 1] ?? "sat_rfc";
}

/**
 * Mapeo consultType → path. Si Moffin indica paths distintos para constancia/opinión (p. ej. PDF),
 * define secretos en Edge Functions:
 * - MOFFIN_QUERY_PATH_CONSTANCIA_SITUACION_FISCAL
 * - MOFFIN_QUERY_PATH_OPINION_CUMPLIMIENTO
 * Opcional: MOFFIN_QUERY_PATH_SAT_BLACKLIST (default /query/sat_blacklist).
 */
export function moffinQueryPathForConsult(consultType: MoffinQueryConsultType): string {
  if (consultType === "lista_69b") {
    return ensureLeadingSlash(
      Deno.env.get("MOFFIN_QUERY_PATH_SAT_BLACKLIST") ?? "/query/sat_blacklist",
      "/query/sat_blacklist",
    );
  }
  const envKey =
    consultType === "constancia_situacion_fiscal"
      ? "MOFFIN_QUERY_PATH_CONSTANCIA_SITUACION_FISCAL"
      : "MOFFIN_QUERY_PATH_OPINION_CUMPLIMIENTO";
  const raw = Deno.env.get(envKey)?.trim();
  if (raw) return ensureLeadingSlash(raw, "/query/sat_rfc");
  return "/query/sat_rfc";
}

/** Rutas POST Moffin Solutions API (Bearer): CSF y opinión 32D. */
export function moffinSolutionsQueryPathForConsult(
  consultType: "constancia_situacion_fiscal" | "opinion_cumplimiento",
): string {
  if (consultType === "constancia_situacion_fiscal") {
    return ensureLeadingSlash(
      Deno.env.get("MOFFIN_SOLUTIONS_PATH_CSF") ?? "/query/sat/csf",
      "/query/sat/csf",
    );
  }
  return ensureLeadingSlash(
    Deno.env.get("MOFFIN_SOLUTIONS_PATH_32D") ?? "/query/sat/compliance-opinion",
    "/query/sat/compliance-opinion",
  );
}

export function moffinSolutionsProfilePath(): string {
  return ensureLeadingSlash(
    Deno.env.get("MOFFIN_SOLUTIONS_PATH_PROFILE") ?? "/query/sat/profile",
    "/query/sat/profile",
  );
}
