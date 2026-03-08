import { useCelulas } from "@/hooks/useCatalogs";

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

  return { celulaOptions, celulaLabelMap, isLoading };
}
