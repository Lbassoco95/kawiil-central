import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

/** Origen de la escritura para la bitácora (RF-08). */
export type AssignResponsibleOrigin =
  | "ui_listado"
  | "ui_detalle"
  | "ui_masivo"
  | "importacion"
  | "kawiil_ai"
  | "migracion";

export interface AssignResponsibleInput {
  clientIds: string[];
  /** null = quitar responsable ("Sin asignar"). */
  responsibleUserId: string | null;
  origin?: AssignResponsibleOrigin;
}

/**
 * Asigna el Responsable a uno o varios clientes a través del servicio único de
 * dominio (RPC `assign_client_responsible`), que aplica las reglas R1–R4, el
 * candado de grado (RF-07) y la bitácora con origen (RF-08).
 *
 * Devuelve el número de clientes efectivamente modificados (idempotente: los que
 * ya tenían ese responsable no cuentan).
 */
export function useAssignClientResponsible() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ clientIds, responsibleUserId, origin = "ui_listado" }: AssignResponsibleInput) => {
      const { data, error } = await supabase.rpc("assign_client_responsible" as any, {
        _client_ids: clientIds,
        _responsible: responsibleUserId,
        _origin: origin,
      });
      if (error) throw error;
      return (data as number) ?? 0;
    },
    onSuccess: (_changed, { clientIds }) => {
      queryClient.invalidateQueries({ queryKey: ["clients"] });
      for (const id of clientIds) {
        queryClient.invalidateQueries({ queryKey: ["client", id] });
        queryClient.invalidateQueries({ queryKey: ["client-collaborators", id] });
      }
    },
    onError: (error: unknown) => {
      const message = error instanceof Error ? error.message : "error desconocido";
      toast.error("No se pudo asignar el responsable: " + message);
    },
  });
}
