import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface EventTravelRecord {
  event_id: string;
  origin: string;
  destination: string | null;
  duration_seconds: number;
  distance_text: string | null;
  with_traffic: boolean;
  departure_iso: string | null;
  computed_at: string;
}

/** Mapa event_id -> trayecto guardado, para dibujar el bloque de traslado en el calendario. */
export function useEventTravelMap() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["event-travel", user?.id],
    enabled: !!user,
    staleTime: 60_000,
    queryFn: async (): Promise<Record<string, EventTravelRecord>> => {
      const { data, error } = await supabase
        .from("event_travel")
        .select("event_id, origin, destination, duration_seconds, distance_text, with_traffic, departure_iso, computed_at");
      if (error) return {};
      const map: Record<string, EventTravelRecord> = {};
      for (const r of (data ?? []) as EventTravelRecord[]) map[r.event_id] = r;
      return map;
    },
  });
}

/** Guarda (upsert) el trayecto calculado de un evento. */
export function useSaveEventTravel() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (rec: Omit<EventTravelRecord, "computed_at">) => {
      if (!user) throw new Error("No autenticado");
      const { error } = await supabase.from("event_travel").upsert(
        { user_id: user.id, ...rec, computed_at: new Date().toISOString() },
        { onConflict: "user_id,event_id" },
      );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event-travel"] });
    },
  });
}

/** Borra el trayecto guardado de un evento. */
export function useDeleteEventTravel() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (eventId: string) => {
      if (!user) return;
      await supabase.from("event_travel").delete().eq("user_id", user.id).eq("event_id", eventId);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["event-travel"] });
    },
  });
}
