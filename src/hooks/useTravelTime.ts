import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface TravelResult {
  durationText: string | null;
  durationSeconds: number | null;
  distanceText: string | null;
  withTraffic: boolean;
  originResolved: string;
  destinationResolved: string;
}

/** Calcula el tiempo de trayecto (con tráfico) entre dos lugares vía Google Distance Matrix. */
export function useTravelTime() {
  return useMutation({
    mutationFn: async (params: { origin: string; destination: string; departureTime?: string }): Promise<TravelResult> => {
      const { data, error } = await supabase.functions.invoke("maps-travel", { body: params });
      if (error) {
        const msg = String(error.message || error);
        if (/edge function|failed to send|not found|non-2xx/i.test(msg)) {
          throw new Error("La función de trayectos aún no está desplegada.");
        }
        throw error;
      }
      if (data?.error) {
        if (data.error === "maps_not_configured") {
          throw new Error("Falta configurar Google Maps (GOOGLE_MAPS_API_KEY) en Supabase.");
        }
        throw new Error(data.error);
      }
      return data as TravelResult;
    },
  });
}
