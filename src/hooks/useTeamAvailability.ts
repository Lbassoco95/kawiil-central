import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

export interface AvailabilityBlock {
  start: string;
  end: string;
  title: string;
  private: boolean;
  source: string;
}
export interface TeamMemberAvailability {
  userId: string;
  name: string;
  avatarUrl: string | null;
  blocks: AvailabilityBlock[];
}

/** Disponibilidad (bloques ocupados) de todos los usuarios de la organización en un rango. */
export function useTeamAvailability(start?: string, end?: string, enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["team-availability", start, end],
    queryFn: async (): Promise<TeamMemberAvailability[]> => {
      const { data, error } = await supabase.functions.invoke("team-availability", {
        body: { start, end },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return (data?.users as TeamMemberAvailability[]) || [];
    },
    enabled: !!user && !!start && !!end && enabled,
    staleTime: 2 * 60 * 1000,
  });
}
