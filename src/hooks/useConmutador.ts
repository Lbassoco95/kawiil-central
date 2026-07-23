import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import {
  parsePreguntas,
  type CelulaCode,
  type G4PorCelula,
  type SwitchboardCall,
  type SwitchboardConfig,
  type Urgencia,
} from "@/lib/conmutador";

// Tablas del Conmutador sin tipos generados aún: cast establecido en el repo.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export interface CallFilters {
  celula?: CelulaCode | "all";
  urgencia?: Urgencia | "all";
}

export function useSwitchboardCalls(filters: CallFilters = {}) {
  const { celula = "all", urgencia = "all" } = filters;
  return useQuery({
    queryKey: ["switchboard-calls", celula, urgencia],
    queryFn: async (): Promise<SwitchboardCall[]> => {
      let q = db
        .from("switchboard_call")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(200);
      if (celula !== "all") q = q.eq("celula", celula);
      if (urgencia !== "all") q = q.eq("urgencia", urgencia);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as SwitchboardCall[];
    },
  });
}

export function useSwitchboardConfig() {
  return useQuery({
    queryKey: ["switchboard-config"],
    queryFn: async (): Promise<SwitchboardConfig[]> => {
      const { data, error } = await db
        .from("switchboard_config")
        .select("*")
        .order("celula", { ascending: true });
      if (error) throw error;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      return (data ?? []).map((r: any) => ({
        ...r,
        preguntas: parsePreguntas(r.preguntas),
      })) as SwitchboardConfig[];
    },
  });
}

export function useG4PorCelula() {
  return useQuery({
    queryKey: ["switchboard-g4"],
    queryFn: async (): Promise<G4PorCelula[]> => {
      const { data, error } = await db.from("v_g4_por_celula").select("*");
      if (error) throw error;
      return (data ?? []) as G4PorCelula[];
    },
  });
}

// Perfiles de la org (para el desplegable de override de G4).
export function useOrgProfiles() {
  return useQuery({
    queryKey: ["org-profiles-min"],
    queryFn: async (): Promise<{ user_id: string; full_name: string }[]> => {
      const { data, error } = await supabase
        .from("profiles")
        .select("user_id, full_name")
        .eq("is_active", true)
        .order("full_name", { ascending: true });
      if (error) throw error;
      return (data ?? []) as { user_id: string; full_name: string }[];
    },
  });
}

export interface ConfigPatch {
  preguntas?: string[];
  prompt_override?: string | null;
  voz?: string | null;
  celula_slug?: string | null;
  g4_override_user_id?: string | null;
}

export function useUpdateSwitchboardConfig() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, patch }: { id: string; patch: ConfigPatch }) => {
      const { error } = await db.from("switchboard_config").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["switchboard-config"] });
      qc.invalidateQueries({ queryKey: ["switchboard-g4"] });
      toast.success("Configuración actualizada");
    },
    onError: (e: unknown) => {
      toast.error(`No se pudo guardar: ${e instanceof Error ? e.message : String(e)}`);
    },
  });
}
