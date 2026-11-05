import { useUserRole } from "@/hooks/useUserRole";

/**
 * Acceso a la gestión de Finanzas (gastos de toda la organización, bancos y caja, compromisos,
 * terceros y planeación): solo el rol transformador. Debe coincidir con public.has_finance_access
 * en la base. Cuando existan los perfiles administrativos / auxiliares se agregan en ambos lados.
 * Quien no lo tiene sigue viendo y creando sus propias solicitudes de gasto.
 */
export function useFinanceAccess() {
  const { isTransformador, isLoading } = useUserRole();
  return { hasFinanceAccess: isTransformador, isLoading };
}
