import { useCelulas } from "@/hooks/useCatalogs";

/** Slug overrides for proper Spanish display */
const SLUG_DISPLAY_OVERRIDES: Record<string, string> = {
  administracion: "Administración",
  administraci_n: "Administración",
  finanzas: "Finanzas",
  legal: "Legal",
  contabilidad: "Contabilidad",
  softlanding: "Soft Landing",
  cumplimiento: "Cumplimiento",
  gestoria: "Gestoría",
  juicios: "Juicios",
};

/** Format a célula slug into a user-friendly label. Null-safe. */
export function formatCelulaLabel(
  slug: string | null | undefined,
  labelMap?: Record<string, string>,
): string {
  if (!slug) return "Sin célula";
  if (labelMap && labelMap[slug]) return labelMap[slug];
  if (SLUG_DISPLAY_OVERRIDES[slug]) return SLUG_DISPLAY_OVERRIDES[slug];
  return slug.charAt(0).toUpperCase() + slug.slice(1).replace(/_/g, " ");
}

/**
 * Returns dynamic célula options from the database for use in Select components.
 * Falls back to empty array if células haven't loaded yet.
 */
export function useCelulaOptions() {
  const { data: celulas, isLoading } = useCelulas();

  const celulaOptions = (celulas || [])
    .filter((c) => c.is_active)
    .map((c) => ({
      value: c.slug,
      label: c.name,
      color: c.color,
    }));

  const celulaLabelMap: Record<string, string> = {};
  for (const c of celulaOptions) {
    celulaLabelMap[c.value] = c.label;
  }

  /** Safe label resolver that never returns raw slugs. Accepts null/undefined. */
  const getCelulaLabel = (slug: string | null | undefined) =>
    formatCelulaLabel(slug, celulaLabelMap);

  return { celulaOptions, celulaLabelMap, getCelulaLabel, isLoading };
}
