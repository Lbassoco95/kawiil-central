import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { toast } from "sonner";

export type AccountProvider = "microsoft" | "google" | "imap";

export interface LinkedAccount {
  id: string;
  provider: AccountProvider;
  email: string | null;
  display_name: string | null;
  status: "connected" | "error" | "disconnected";
  calendar_enabled: boolean;
  mail_enabled: boolean;
  last_error: string | null;
  created_at: string;
}

/** Cuentas vinculadas del usuario (metadatos; los tokens nunca llegan al cliente). */
export function useLinkedAccounts() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["linked-accounts"],
    queryFn: async (): Promise<LinkedAccount[]> => {
      // linked_accounts aún no está en los tipos generados de Supabase.
      const { data, error } = await (supabase as any)
        .from("linked_accounts")
        .select("id, provider, email, display_name, status, calendar_enabled, mail_enabled, last_error, created_at")
        .order("created_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as LinkedAccount[];
    },
    enabled: !!user,
    staleTime: 60 * 1000,
  });
}

/** Conecta / desconecta una cuenta de Google (calendario). */
export function useGoogleConnection() {
  const queryClient = useQueryClient();

  const connect = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("google-auth");
      if (error) {
        const msg = String(error.message || error);
        // La función aún no está desplegada o falta configuración.
        if (/edge function|failed to send|not found|non-2xx/i.test(msg)) {
          throw new Error(
            "La conexión con Google todavía no está activada. Falta desplegar las funciones (google-auth/callback/api) y configurar GOOGLE_CLIENT_ID/SECRET en Supabase.",
          );
        }
        throw error;
      }
      if (data?.error) {
        if (data.error === "Google credentials not configured") {
          throw new Error("Faltan las credenciales de Google (GOOGLE_CLIENT_ID/SECRET) en Supabase.");
        }
        throw new Error(data.error);
      }
      if (!data?.url) throw new Error("No se recibió URL de autorización");
      window.open(data.url, "google-auth", "width=600,height=700");
      return new Promise<void>((resolve, reject) => {
        const handler = (event: MessageEvent) => {
          if (event.data?.type === "google-auth-success") {
            window.removeEventListener("message", handler);
            resolve();
          } else if (event.data?.type === "google-auth-error") {
            window.removeEventListener("message", handler);
            reject(new Error(event.data.error));
          }
        };
        window.addEventListener("message", handler);
        setTimeout(() => {
          window.removeEventListener("message", handler);
          reject(new Error("Timeout - cierra la ventana e intenta de nuevo"));
        }, 300000);
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["linked-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["google-calendar-events"] });
      queryClient.invalidateQueries({ queryKey: ["calendar-events"] });
      toast.success("Cuenta de Google conectada");
    },
    onError: (err: Error) => toast.error("Error al conectar Google: " + err.message),
  });

  const disconnect = useMutation({
    mutationFn: async (accountId: string) => {
      const { error } = await (supabase as any).from("linked_accounts").delete().eq("id", accountId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["linked-accounts"] });
      queryClient.invalidateQueries({ queryKey: ["google-calendar-events"] });
      toast.success("Cuenta desconectada");
    },
    onError: (err: Error) => toast.error("Error al desconectar: " + err.message),
  });

  return { connect: connect.mutate, isConnecting: connect.isPending, disconnect: disconnect.mutate };
}

/** Eventos de calendario de las cuentas Google conectadas (formato normalizado tipo Graph). */
export function useGoogleCalendarEvents(start?: string, end?: string, enabled = true) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["google-calendar-events", start, end],
    queryFn: async () => {
      const { data, error } = await supabase.functions.invoke("google-api", {
        body: { action: "calendar-events", params: { start, end } },
      });
      if (error) throw error;
      return (data?.value as any[]) || [];
    },
    enabled: !!user && !!start && !!end && enabled,
    staleTime: 60 * 1000,
  });
}
