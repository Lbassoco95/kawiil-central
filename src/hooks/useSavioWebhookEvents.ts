import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useFinanceAccess } from "@/hooks/useFinanceAccess";
import { useSavioIncomeAccess } from "@/hooks/useSavioIncomeAccess";
import type { Database } from "@/integrations/supabase/types";

type SavioRow = Database["public"]["Tables"]["savio_webhook_events"]["Row"];

export type SavioFinanceEvent = Pick<
  SavioRow,
  "id" | "created_at" | "event_type" | "savio_id" | "status" | "payload"
>;

const PAGE_SIZE = 500;

export function useSavioWebhookEvents() {
  const { user } = useAuth();
  const { hasFinanceAccess, isLoading: financeLoading } = useFinanceAccess();
  const { data: canViewSavioIncome = false, isLoading: savioLoading } = useSavioIncomeAccess();

  const enabled =
    !!user && hasFinanceAccess && canViewSavioIncome && !financeLoading && !savioLoading;

  return useQuery({
    queryKey: ["savio-webhook-events", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("savio_webhook_events")
        .select("id, created_at, event_type, savio_id, status, payload")
        .order("created_at", { ascending: false })
        .limit(PAGE_SIZE);
      if (error) throw error;
      return (data ?? []) as SavioFinanceEvent[];
    },
    enabled,
  });
}
