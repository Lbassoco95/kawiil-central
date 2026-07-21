import { useMutation, useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface PlacePrediction {
  placeId: string | null;
  description: string;
  mainText: string;
  secondaryText: string;
}

export interface PlacesResult {
  predictions: PlacePrediction[];
  /** Motivo cuando no hay sugerencias por un error del servicio (para diagnóstico). */
  error?: string;
  detail?: string;
}

/**
 * Autocompletado de lugares (Google Places) vía edge function. Degrada a lista
 * vacía si Places API no está habilitada, sin romper la escritura libre.
 */
export function usePlacesAutocomplete(input: string) {
  const query = input.trim();
  return useQuery({
    queryKey: ["maps-places", query],
    enabled: query.length >= 3,
    staleTime: 60_000,
    queryFn: async (): Promise<PlacesResult> => {
      const { data, error } = await supabase.functions.invoke("maps-places", { body: { input: query } });
      if (error) {
        // Intenta leer el cuerpo del error (500/403) para diagnóstico.
        const ctx = (error as { context?: unknown })?.context;
        if (ctx instanceof Response) {
          try {
            const body = await ctx.clone().json();
            return { predictions: [], error: body?.error || "invoke_error", detail: body?.detail };
          } catch { /* ignore */ }
        }
        return { predictions: [], error: "invoke_error", detail: String((error as Error)?.message || error) };
      }
      return {
        predictions: (data?.predictions ?? []) as PlacePrediction[],
        error: data?.error,
        detail: data?.detail,
      };
    },
  });
}

export interface TravelResult {
  durationText: string | null;
  durationSeconds: number | null;
  withTraffic: boolean;
  trafficDurationText: string | null;
  trafficDurationSeconds: number | null;
  baseDurationText: string | null;
  baseDurationSeconds: number | null;
  distanceText: string | null;
  distanceMeters: number | null;
  originResolved: string;
  destinationResolved: string;
  /** true cuando no hay ruta (ZERO_RESULTS / NOT_FOUND). */
  noRoute?: boolean;
  /** mensaje amigable cuando noRoute es true. */
  message?: string;
}

/** Intenta leer el cuerpo JSON del error de una edge function (FunctionsHttpError). */
async function readErrorBody(error: unknown): Promise<{ error?: string; message?: string } | null> {
  const ctx = (error as { context?: unknown })?.context;
  if (ctx instanceof Response) {
    try {
      return await ctx.clone().json();
    } catch {
      return null;
    }
  }
  // A veces el contexto ya viene como objeto.
  if (ctx && typeof ctx === "object") return ctx as { error?: string; message?: string };
  return null;
}

/** Calcula el tiempo de trayecto (con tráfico) entre dos lugares vía Google Distance Matrix. */
export function useTravelTime() {
  return useMutation({
    mutationFn: async (params: { origin: string; destination: string; departureTime?: string }): Promise<TravelResult> => {
      const { data, error } = await supabase.functions.invoke("maps-travel", { body: params });
      if (error) {
        // Intenta extraer el mensaje real del cuerpo de la respuesta (500/502/400).
        const body = await readErrorBody(error);
        if (body?.error === "maps_not_configured") {
          throw new Error(body.message || "Falta configurar Google Maps en el servidor.");
        }
        if (body?.message) throw new Error(body.message);
        if (body?.error) throw new Error(body.error);

        const msg = String(error.message || error);
        if (/failed to send|failed to fetch|not found/i.test(msg)) {
          throw new Error("La función de trayectos aún no está desplegada.");
        }
        throw new Error("No se pudo calcular el trayecto.");
      }
      // El servidor responde 200 con noRoute cuando no hay ruta (ZERO_RESULTS/NOT_FOUND).
      if (data?.error && !data?.noRoute) {
        throw new Error(data.message || data.error);
      }
      return data as TravelResult;
    },
  });
}
