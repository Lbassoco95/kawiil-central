import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type FinanceIncomeViewerRow = {
  enabled: boolean;
  canWriteSavio: boolean;
};

export function useFinanceIncomeViewerForUser(userId: string | undefined) {
  return useQuery({
    queryKey: ["finance-income-viewer", userId],
    queryFn: async (): Promise<FinanceIncomeViewerRow | null> => {
      if (!userId) return null;
      const { data, error } = await supabase
        .from("finance_income_viewers")
        .select("user_id, can_write_savio")
        .eq("user_id", userId)
        .maybeSingle();
      if (error) return null;
      if (!data) return { enabled: false, canWriteSavio: false };
      return { enabled: true, canWriteSavio: !!data.can_write_savio };
    },
    enabled: !!userId,
    staleTime: 30_000,
  });
}

export function useSetFinanceIncomeViewer() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({
      userId,
      organizationId,
      enabled,
      canWriteSavio = false,
    }: {
      userId: string;
      organizationId: string;
      enabled: boolean;
      canWriteSavio?: boolean;
    }) => {
      if (enabled) {
        const { error } = await supabase.from("finance_income_viewers").upsert(
          {
            user_id: userId,
            organization_id: organizationId,
            can_write_savio: canWriteSavio,
          },
          { onConflict: "organization_id,user_id" },
        );
        if (error) throw error;
      } else {
        const { error } = await supabase
          .from("finance_income_viewers")
          .delete()
          .eq("user_id", userId)
          .eq("organization_id", organizationId);
        if (error) throw error;
      }
    },
    onSuccess: (_, vars) => {
      queryClient.invalidateQueries({ queryKey: ["finance-income-viewer", vars.userId] });
      queryClient.invalidateQueries({ queryKey: ["savio-income-access", vars.userId] });
      queryClient.invalidateQueries({ queryKey: ["savio-write-access", vars.userId] });
      queryClient.invalidateQueries({ queryKey: ["finance-access", "celula", vars.userId] });
      queryClient.invalidateQueries({ queryKey: ["finance-access", "module", vars.userId] });
    },
  });
}
