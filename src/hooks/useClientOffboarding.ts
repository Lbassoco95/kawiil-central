import { useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import type { ClientOffboarding } from "@/lib/clientOffboarding";
import type { Database } from "@/integrations/supabase/types";

type ClientStatus = Database["public"]["Enums"]["client_status"];
type ClientOffboardingColumn = Database["public"]["Tables"]["clients"]["Update"]["offboarding"];

interface UpdateOffboardingParams {
  clientId: string;
  /** Objeto de seguimiento; `null` cancela / limpia el proceso de baja. */
  offboarding: ClientOffboarding | null;
  /** Cambio opcional del estatus del cliente (p. ej. pasar a "inactivo" al cerrar). */
  status?: ClientStatus;
}

/**
 * Actualiza únicamente el seguimiento de cierre del cliente (y opcionalmente su
 * estatus). No dispara los efectos secundarios de useUpdateClient (renombrado de
 * proyectos, servicios, etc.).
 */
export function useUpdateClientOffboarding() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ clientId, offboarding, status }: UpdateOffboardingParams) => {
      const updates: Database["public"]["Tables"]["clients"]["Update"] = {
        offboarding: (offboarding ?? null) as unknown as ClientOffboardingColumn,
      };
      if (status) updates.status = status;
      const { error } = await supabase.from("clients").update(updates).eq("id", clientId);
      if (error) throw error;
      return { clientId };
    },
    onSuccess: ({ clientId }) => {
      queryClient.invalidateQueries({ queryKey: ["client", clientId] });
      queryClient.invalidateQueries({ queryKey: ["clients"] });
    },
    onError: (error: Error) => {
      toast.error("No se pudo guardar el seguimiento de cierre: " + error.message);
    },
  });
}
