import { useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { useAuth } from "@/contexts/AuthContext";
import { getMonthName } from "@/hooks/useAccountingPeriods";
import { useUpdateTask } from "@/hooks/useTasks";
import {
  fetchAcusesTasksForPeriod,
  revertAccountingStepSync,
  syncAccountingStepAfterEmail,
  type AccountingStepSyncResult,
  type PeriodTaskLike,
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
  const updateTask = useUpdateTask();

  return useCallback(
    async (info: SentAccountingEmailInfo): Promise<AccountingStepSyncResult> => {
      const result = await syncAccountingStepAfterEmail(info, { userId: user?.id ?? null });

      if (result.status === "completed") {
        // Además del paso, se cierran las tareas del periodo que hablan del
        // envío de acuses. Se usa `useUpdateTask` para respetar sus reglas
        // (subtareas abiertas, `completed_at`, recurrencia).
        const closedTasks: PeriodTaskLike[] = [];
        for (const task of await fetchAcusesTasksForPeriod(result.projectId, result.periodId)) {
          try {
            await updateTask.mutateAsync({ id: task.id, status: "completada" });
            closedTasks.push(task);
          } catch {
            // Una tarea con subtareas abiertas no se puede cerrar: se deja como
            // está y el resto del flujo continúa.
          }
        }

        queryClient.invalidateQueries({ queryKey: ["accounting-periods", result.projectId] });
        queryClient.invalidateQueries({ queryKey: ["my-active-projects-progress"] });
        const periodo = `${getMonthName(result.month)} ${result.year}`;
        const tareasTxt = closedTasks.length
          ? ` También se ${closedTasks.length === 1 ? "cerró 1 tarea" : `cerraron ${closedTasks.length} tareas`} del periodo.`
          : "";
        toast.success(`«${result.stepLabel}» completado — ${periodo}`, {
          description:
            (info.clientName
              ? `Se cerró el paso del periodo de ${info.clientName} al enviar el correo.`
              : "Se cerró el paso del periodo al enviar el correo.") + tareasTxt,
          duration: 10000,
          action: {
            label: "Deshacer",
            onClick: async () => {
              const ok = await revertAccountingStepSync(
                result.periodId,
                result.previousSteps,
                result.previousStatus,
              );
              for (const task of closedTasks) {
                try {
                  await updateTask.mutateAsync({ id: task.id, status: task.status });
                } catch {
                  // Si no se puede reabrir, el paso ya se revirtió: no se bloquea.
                }
              }
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
    [user?.id, queryClient, updateTask],
  );
}
