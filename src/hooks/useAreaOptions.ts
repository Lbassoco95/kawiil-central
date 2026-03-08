/**
 * @deprecated Use useCelulaOptions instead.
 * This file exists for backward compatibility during migration.
 */
import { useCelulaOptions } from "@/hooks/useCelulaOptions";

export function useAreaOptions() {
  const { celulaOptions, celulaLabelMap, isLoading } = useCelulaOptions();
  return {
    areaOptions: celulaOptions,
    areaLabelMap: celulaLabelMap,
    isLoading,
  };
}
