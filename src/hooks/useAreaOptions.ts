/**
 * @deprecated Use useCelulaOptions instead.
 * This file exists for backward compatibility during migration.
 */
import { useCelulaOptions, formatCelulaLabel } from "@/hooks/useCelulaOptions";

export { formatCelulaLabel };

export function useAreaOptions() {
  const { celulaOptions, celulaLabelMap, getCelulaLabel, isLoading } = useCelulaOptions();
  return {
    areaOptions: celulaOptions,
    areaLabelMap: celulaLabelMap,
    getCelulaLabel,
    isLoading,
  };
}
