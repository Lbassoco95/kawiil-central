import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export interface UserCelula {
  id: string;
  user_id: string;
  celula_id: string;
  organization_id: string;
}

export function useUserCelulas(userId?: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["user-celulas", userId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_celulas")
        .select("*")
        .eq("user_id", userId!);
      if (error) throw error;
      return data as UserCelula[];
    },
    enabled: !!user && !!userId,
  });
}

export function useSyncUserCelulas() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({
      userId,
      celulaIds,
      organizationId,
    }: {
      userId: string;
      celulaIds: string[];
      organizationId: string;
    }) => {
      // Delete existing
      const { error: delError } = await supabase
        .from("user_celulas")
        .delete()
        .eq("user_id", userId);
      if (delError) throw delError;

      // Insert new
      if (celulaIds.length > 0) {
        const rows = celulaIds.map((celula_id) => ({
          user_id: userId,
          celula_id,
          organization_id: organizationId,
        }));
        const { error: insError } = await supabase
          .from("user_celulas")
          .insert(rows as any);
        if (insError) throw insError;
      }
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["user-celulas"] });
      queryClient.invalidateQueries({ queryKey: ["finance-access"] });
    },
    onError: (e: any) => toast.error(e.message || "Error al actualizar células"),
  });
}
