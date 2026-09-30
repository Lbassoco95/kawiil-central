import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import {
  invokeFunctionWithSession,
  functionInvokeUserMessageAsync,
} from "@/lib/supabaseInvoke";
import { createNotifications } from "@/lib/notificationHelpers";
import { toast } from "sonner";

export type LinkedAccountHealth = {
  id: string;
  provider: "microsoft" | "google" | "imap";
  email: string | null;
  display_name: string | null;
  status: "connected" | "error" | "disconnected";
  calendar_enabled: boolean;
  mail_enabled: boolean;
  last_error: string | null;
  last_sync_at: string | null;
  updated_at: string;
};

export type SlackHealth = {
  connected: boolean;
  broken: boolean;
  updated_at: string | null;
};

export type MicrosoftPrincipalHealth = {
  connected: boolean;
  expires_at: string | null;
  updated_at: string | null;
};

export type UserIntegrationHealth = {
  user_id: string;
  full_name: string;
  email: string;
  avatar_url: string | null;
  role: string | null;
  slack: SlackHealth;
  microsoft_principal: MicrosoftPrincipalHealth;
  linked_accounts: LinkedAccountHealth[];
  issue_count: number;
};

export type IntegrationHealthCounts = {
  total: number;
  slack_broken: number;
  slack_missing: number;
  microsoft_missing: number;
  linked_account_errors: number;
  users_with_issues: number;
};

export type IntegrationHealthResponse = {
  users: UserIntegrationHealth[];
  counts: IntegrationHealthCounts;
  generated_at: string;
};

export function useIntegrationHealth(enabled = true) {
  const { session } = useAuth();

  return useQuery({
    queryKey: ["integration-health"],
    queryFn: async () => {
      const { data, error } = await invokeFunctionWithSession<IntegrationHealthResponse>(
        "integration-health",
        {},
      );
      if (error) {
        throw new Error(await functionInvokeUserMessageAsync(data, error));
      }
      if (!data) throw new Error("Respuesta vacía del servidor");
      return data;
    },
    enabled: !!session?.access_token && enabled,
    staleTime: 2 * 60 * 1000,
  });
}

export function useRequestIntegrationReconnect() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async ({
      userId,
      fullName,
      integration,
    }: {
      userId: string;
      fullName: string;
      integration: "slack" | "microsoft_principal" | "linked_account";
    }) => {
      const sourceUserId = user?.id ?? userId;
      const titles: Record<typeof integration, string> = {
        slack: "Reconecta tu cuenta de Slack",
        microsoft_principal: "Reconecta tu cuenta de Microsoft 365",
        linked_account: "Revisa tu cuenta vinculada",
      };
      const bodies: Record<typeof integration, string> = {
        slack:
          "Detectamos que tu conexión con Slack no está activa o fue revocada. Ve a Comunicación y actualiza los permisos para que tu estado y emoji se sincronicen.",
        microsoft_principal:
          "Detectamos que tu cuenta principal de Microsoft 365 no está conectada o tiene problemas. Conéctala desde Calendario o Correo para recuperar la sincronización.",
        linked_account:
          "Una de tus cuentas de correo/calendario vinculadas reportó un error. Revisa la configuración en Calendario o Correo y vuelve a conectar si es necesario.",
      };

      await createNotifications([
        {
          user_id: userId,
          type: "integration_reconnect",
          title: titles[integration],
          body: bodies[integration],
          entity_type: "integration_health",
          entity_id: userId,
          source_user_id: sourceUserId,
        },
      ]);

      return fullName;
    },
    onSuccess: (fullName) => {
      queryClient.invalidateQueries({ queryKey: ["notifications"] });
      toast.success(`Se solicitó a ${fullName} que reconecte la integración`);
    },
    onError: (error: Error) => {
      toast.error(error.message || "No se pudo enviar la solicitud");
    },
  });
}
