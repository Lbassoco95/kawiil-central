import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export type WorkStatus = "oficina" | "remoto" | "transito" | "en_sitio";

export interface WorkLocation {
  id: string;
  user_id: string;
  date: string; // yyyy-MM-dd
  status: WorkStatus;
  place: string | null;
  note: string | null;
}

export const WORK_STATUS_META: Record<WorkStatus, { label: string; short: string; icon: string; color: string }> = {
  oficina: { label: "En oficina", short: "Oficina", icon: "🏢", color: "#0ea5e9" },
  remoto: { label: "Remoto", short: "Remoto", icon: "🏠", color: "#22c55e" },
  transito: { label: "En tránsito", short: "Tránsito", icon: "🚗", color: "#f59e0b" },
  en_sitio: { label: "En sitio", short: "En sitio", icon: "📍", color: "#a855f7" },
};

/** Ubicaciones de trabajo (de toda la organización) en un rango de fechas. */
export function useWorkLocations(startYmd?: string, endYmd?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["work-locations", startYmd, endYmd],
    queryFn: async (): Promise<WorkLocation[]> => {
      let q = (supabase as any).from("work_locations").select("id, user_id, date, status, place, note");
      if (startYmd) q = q.gte("date", startYmd);
      if (endYmd) q = q.lte("date", endYmd);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as WorkLocation[];
    },
    enabled: !!user && !!startYmd && !!endYmd,
    staleTime: 60 * 1000,
  });
}

async function currentOrgId(userId: string): Promise<string> {
  const { data, error } = await supabase.from("profiles").select("organization_id").eq("user_id", userId).single();
  if (error || !data?.organization_id) throw new Error("No se encontró la organización del usuario");
  return data.organization_id as string;
}

/** Fija (upsert) la ubicación/estatus de trabajo del usuario para una fecha. */
export function useSetWorkLocation() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async ({ date, status, place, note }: { date: string; status: WorkStatus; place?: string | null; note?: string | null }) => {
      const organization_id = await currentOrgId(user!.id);
      const { error } = await (supabase as any)
        .from("work_locations")
        .upsert(
          { user_id: user!.id, organization_id, date, status, place: place ?? null, note: note ?? null, updated_at: new Date().toISOString() },
          { onConflict: "user_id,date" },
        );
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["work-locations"] });
      toast.success("Ubicación de trabajo actualizada");
    },
    onError: (e: Error) => toast.error("No se pudo guardar: " + e.message),
  });
}

export function useClearWorkLocation() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: async (date: string) => {
      const { error } = await (supabase as any).from("work_locations").delete().eq("user_id", user!.id).eq("date", date);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["work-locations"] }),
    onError: (e: Error) => toast.error("No se pudo quitar: " + e.message),
  });
}
