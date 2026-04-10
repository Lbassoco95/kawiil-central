import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { FunctionsHttpError } from "@supabase/functions-js";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

/** Cuerpo JSON de error cuando la Edge Function devuelve 4xx/5xx (p. ej. Slack OAuth not configured). */
async function edgeFunctionJsonError(error: unknown): Promise<string | null> {
  if (!(error instanceof FunctionsHttpError)) return null;
  const res = error.context;
  if (!(res instanceof Response)) return null;
  try {
    const body = await res.clone().json();
    if (body && typeof body.error === "string") return body.error;
  } catch {
    /* ignore */
  }
  return null;
}

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
      const { data: sessionData } = await supabase.auth.getSession();
      const token = sessionData.session?.access_token;
      if (!token) {
        throw new Error("Inicia sesión de nuevo para conectar Slack.");
      }

      const { data, error } = await supabase.functions.invoke("slack-user-auth", {
        headers: { Authorization: `Bearer ${token}` },
        body: {},
      });
      if (error) {
        const apiMsg = await edgeFunctionJsonError(error);
        if (apiMsg) throw new Error(apiMsg);
        throw error;
      }
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
      if (e.message.includes("Tiempo de espera")) return;
      const msg = e.message || "";
      if (msg.includes("Slack OAuth not configured")) {
        toast.error(
          "Slack no está configurado en Supabase: en el dashboard del proyecto ve a Project Settings → Edge Functions → Secrets y define SLACK_CLIENT_ID y SLACK_CLIENT_SECRET (de tu app en api.slack.com). Guarda y vuelve a conectar.",
          { duration: 12_000 },
        );
        return;
      }
      if (msg.includes("Failed to send a request") || msg === "Edge Function returned a non-2xx status code") {
        toast.error(
          "No se alcanzó la función slack-user-auth en Supabase. Despliégala con la CLI (supabase functions deploy slack-user-auth) y confirma VITE_SUPABASE_URL / claves del mismo proyecto.",
          { duration: 8000 },
        );
        return;
      }
      toast.error(msg || "No se pudo conectar Slack");
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
