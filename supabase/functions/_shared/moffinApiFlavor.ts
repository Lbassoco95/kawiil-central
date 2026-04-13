/**
 * Modo API Moffin: legacy (app.moffin.mx + Token + sat_rfc/FIEL) vs solutions (solutions-api + Bearer + CIEC).
 * Por defecto es `solutions`; solo `MOFFIN_API_FLAVOR=legacy` fuerza legacy (alinear con VITE_MOFFIN_API_FLAVOR en front).
 */
export type MoffinApiFlavor = "legacy" | "solutions";

/** Evita Bearer duplicado o saltos de línea al pegar el secreto en Supabase. */
function normalizeSolutionsBearer(value: string): string {
  let v = value.trim().replace(/\r?\n/g, "").replace(/\s+/g, " ");
  if (/^bearer\s+/i.test(v)) v = v.replace(/^bearer\s+/i, "").trim();
  return v;
}

export function getMoffinApiFlavor(): MoffinApiFlavor {
  const raw = Deno.env.get("MOFFIN_API_FLAVOR")?.trim().toLowerCase() ?? "";
  if (raw === "legacy") return "legacy";
  if (raw === "solutions") return "solutions";
  const base = (Deno.env.get("MOFFIN_BASE_URL") ?? "").toLowerCase();
  if (base.includes("solutions-api.moffin.mx")) return "solutions";
  return "solutions";
}

export function moffinSolutionsBaseUrl(): string {
  const explicit = Deno.env.get("MOFFIN_SOLUTIONS_BASE_URL")?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  const base = (Deno.env.get("MOFFIN_BASE_URL") ?? "").trim();
  if (base.toLowerCase().includes("solutions-api.moffin.mx")) return base.replace(/\/$/, "");
  return "https://solutions-api.moffin.mx/api";
}

/** Lista 69-B y otros endpoints legacy cuando el flavor es solutions. */
export function moffinLegacyBaseUrl(): string {
  const explicit = Deno.env.get("MOFFIN_LEGACY_BASE_URL")?.trim();
  if (explicit) return explicit.replace(/\/$/, "");
  return "https://app.moffin.mx/api/v1";
}

export function moffinLegacyApiKey(): string {
  const legacy = Deno.env.get("MOFFIN_LEGACY_API_KEY")?.trim();
  const raw = (legacy || Deno.env.get("MOFFIN_API_KEY") || "").trim().replace(/\r?\n/g, "");
  if (/^token\s+/i.test(raw)) return raw.replace(/^token\s+/i, "").trim();
  if (/^bearer\s+/i.test(raw)) return raw.replace(/^bearer\s+/i, "").trim();
  return raw;
}

export function moffinSolutionsBearerToken(): string {
  const explicit = Deno.env.get("MOFFIN_SOLUTIONS_BEARER")?.trim() ?? "";
  if (explicit) return normalizeSolutionsBearer(explicit);
  return normalizeSolutionsBearer(Deno.env.get("MOFFIN_API_KEY")?.trim() ?? "");
}
