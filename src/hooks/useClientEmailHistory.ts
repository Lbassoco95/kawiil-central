import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/** `action` con el que se guarda en activity_log cada correo enviado desde la ficha del cliente. */
export const CLIENT_EMAIL_SENT_ACTION = "email_sent";
/** `action` de los correos programados desde la ficha (aún no han salido al registrarse). */
export const CLIENT_EMAIL_SCHEDULED_ACTION = "email_scheduled";

export const clientEmailHistoryKey = (clientId: string | undefined) =>
  ["client-email-history", clientId] as const;

export interface ClientEmailHistoryItem {
  id: string;
  user_id: string | null;
  created_at: string;
  subject: string;
  to: string[];
  cc: string[];
  attachments: string[];
  from: string | null;
  /** Presente solo en correos programados: cuándo debe salir. */
  scheduledAt: string | null;
}

const asStrings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

export function useClientEmailHistory(clientId: string | undefined) {
  const { user } = useAuth();
  return useQuery({
    queryKey: clientEmailHistoryKey(clientId),
    enabled: !!user && !!clientId,
    queryFn: async (): Promise<ClientEmailHistoryItem[]> => {
      const { data, error } = await supabase
        .from("activity_log")
        .select("id, user_id, action, details, created_at")
        .eq("entity_type", "client")
        .eq("entity_id", clientId!)
        .in("action", [CLIENT_EMAIL_SENT_ACTION, CLIENT_EMAIL_SCHEDULED_ACTION])
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return (data ?? []).map((row) => {
        const d = (row.details ?? {}) as Record<string, unknown>;
        return {
          id: row.id,
          user_id: row.user_id,
          created_at: row.created_at,
          subject: typeof d.subject === "string" ? d.subject : "(Sin asunto)",
          to: asStrings(d.to),
          cc: asStrings(d.cc),
          attachments: asStrings(d.attachments),
          from: typeof d.from === "string" ? d.from : null,
          scheduledAt:
            row.action === CLIENT_EMAIL_SCHEDULED_ACTION && typeof d.scheduled_at === "string"
              ? d.scheduled_at
              : null,
        };
      });
    },
  });
}
