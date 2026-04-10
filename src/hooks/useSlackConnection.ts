import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export function useSlackConnection() {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const connectionQuery = useQuery({
    queryKey: ["slack-user-connection", user?.id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("user_slack_connections")
        .select("id, slack_team_id, slack_user_id, updated_at")
        .eq("user_id", user!.id)
        .order("updated_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!user,
    staleTime: 60 * 1000,
  });

  const connectMutation = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("slack-user-auth");
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      if (data?.url) {
        window.open(data.url, "slack-user-auth", "width=520,height=720");
        return new Promise<void>((resolve, reject) => {
          const handler = (event: MessageEvent) => {
            if (event.data?.type === "slack-auth-success") {
              window.removeEventListener("message", handler);
              resolve();
            } else if (event.data?.type === "slack-auth-error") {
              window.removeEventListener("message", handler);
              reject(new Error(String(event.data.error || "Error de Slack")));
            }
          };
          window.addEventListener("message", handler);
          setTimeout(() => {
            window.removeEventListener("message", handler);
            reject(new Error("Tiempo de espera agotado"));
          }, 120_000);
        });
      }
      throw new Error("No se obtuvo URL de autorización");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["slack-user-connection"] });
      toast.success("Slack conectado");
    },
    onError: (e: Error) => {
      if (!e.message.includes("Tiempo de espera")) {
        toast.error(e.message || "No se pudo conectar Slack");
      }
    },
  });

  return {
    connection: connectionQuery.data,
    isConnected: !!connectionQuery.data,
    isLoading: connectionQuery.isLoading,
    connect: () => connectMutation.mutate(),
    isConnecting: connectMutation.isPending,
    refetch: connectionQuery.refetch,
  };
}
