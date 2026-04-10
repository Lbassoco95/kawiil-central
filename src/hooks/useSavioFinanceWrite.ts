import { useMutation, useQueryClient } from "@tanstack/react-query";
import { invokeSavioFinanceWrite } from "@/lib/savioFinanceWriteInvoke";
import type { SavioWriteOperation } from "@/lib/savioWriteOperations";

export function useSavioFinanceWriteMutation() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (vars: { operation: SavioWriteOperation; payload: Record<string, unknown> }) => {
      const res = await invokeSavioFinanceWrite(vars.operation, vars.payload);
      if (res.ok !== true) {
        throw new Error(
          typeof res.message === "string" && res.message.trim()
            ? res.message
            : "No se pudo completar la operación en facturación.",
        );
      }
      return res;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["savio-finance-api"] });
      queryClient.invalidateQueries({ queryKey: ["finance-dashboard"] });
    },
  });
}
