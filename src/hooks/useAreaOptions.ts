import { useAreas } from "@/hooks/useCatalogs";

/**
 * Returns dynamic area options from the database for use in Select components.
 * Falls back to empty array if areas haven't loaded yet.
 */
export function useAreaOptions() {
  const { data: areas, isLoading } = useAreas();

  const areaOptions = (areas || [])
    .filter((a) => a.is_active)
    .map((a) => ({
      value: a.slug,
      label: a.name,
      color: a.color,
    }));

  const areaLabelMap: Record<string, string> = {};
  for (const a of areaOptions) {
    areaLabelMap[a.value] = a.label;
  }

  return { areaOptions, areaLabelMap, isLoading };
}
