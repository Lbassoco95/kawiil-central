import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { getMonthName } from "@/hooks/useAccountingPeriods";
import {
  revertAccountingStepSync,
  syncAccountingStepAfterEmail,
  type AccountingStepSyncResult,
  type SentAccountingEmailInfo,
} from "@/lib/accountingEmailStepSync";

/**
 * Enganche único entre "envié la plantilla contable al cliente" y "el paso del
 * periodo queda cerrado". Úsalo desde CUALQUIER punto de envío de correo que
 * pueda insertar una plantilla contable (ver el contrato documentado en
 * `src/lib/accountingEmailStepSync.ts`).
 */
export function useAccountingEmailStepSync() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  return useCallback(
    async (info: SentAccountingEmailInfo): Promise<AccountingStepSyncResult> => {
      const result = await syncAccountingStepAfterEmail(info, { userId: user?.id ?? null });

      if (result.status === "completed") {
        queryClient.invalidateQueries({ queryKey: ["accounting-periods", result.projectId] });
        queryClient.invalidateQueries({ queryKey: ["my-active-projects-progress"] });
        const periodo = `${getMonthName(result.month)} ${result.year}`;
        toast.success(`«${result.stepLabel}» completado — ${periodo}`, {
          description: info.clientName
            ? `Se cerró el paso del periodo de ${info.clientName} al enviar el correo.`
            : "Se cerró el paso del periodo al enviar el correo.",
          duration: 10000,
          action: {
            label: "Deshacer",
            onClick: async () => {
              const ok = await revertAccountingStepSync(
                result.periodId,
                result.previousSteps,
                result.previousStatus,
              );
              queryClient.invalidateQueries({ queryKey: ["accounting-periods", result.projectId] });
              queryClient.invalidateQueries({ queryKey: ["my-active-projects-progress"] });
              if (ok) toast.info(`«${result.stepLabel}» volvió a quedar pendiente`);
              else toast.error("No se pudo deshacer el paso");
            },
          },
        });
      } else if (result.status === "no_period") {
        toast.info("Correo enviado. No encontré el periodo contable para cerrar el paso.", {
          description: info.clientName
            ? `Marca «Envío de acuses al cliente» a mano en el proyecto de ${info.clientName}.`
            : "Elige el cliente en «Plantillas contables» para que el paso se cierre solo.",
          duration: 8000,
        });
      } else if (result.status === "no_client") {
        toast.info("Correo enviado. No pude identificar al cliente para cerrar el paso.", {
          description: "Elige el cliente en «Plantillas contables» y el paso se cerrará solo.",
          duration: 8000,
        });
      } else if (result.status === "error") {
        toast.error(`Correo enviado, pero no se pudo cerrar el paso: ${result.message}`);
      }

      return result;
    },
    [user?.id, queryClient],
  );
}
