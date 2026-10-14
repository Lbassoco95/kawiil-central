import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/** `action` con el que se guarda en activity_log cada correo enviado desde la ficha del cliente. */
export const CLIENT_EMAIL_SENT_ACTION = "email_sent";
/** `action` de los correos programados desde la ficha (su estado real se consulta en scheduled_mail_jobs). */
export const CLIENT_EMAIL_SCHEDULED_ACTION = "email_scheduled";

export const clientEmailHistoryKey = (clientId: string | undefined) =>
  ["client-email-history", clientId] as const;

/** Estado de un envío programado (scheduled_mail_jobs.status; `unknown` si no se pudo consultar). */
export type ScheduledEmailStatus =
  | "pending"
  | "processing"
  | "sent"
  | "failed"
  | "cancelled"
  | "unknown";

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
  /** Solo en correos programados. */
  scheduledStatus: ScheduledEmailStatus | null;
  /** Cuándo salió realmente (solo si status = sent). */
  sentAt: string | null;
  /** Motivo corto del fallo (solo si status = failed). */
  errorMessage: string | null;
}

type JobStatusRow = {
  id: string;
  status: string;
  scheduled_at: string;
  sent_at: string | null;
  error_message: string | null;
};

const asStrings = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];

export function useClientEmailHistory(clientId: string | undefined) {
  const { user } = useAuth();
  return useQuery({
    queryKey: clientEmailHistoryKey(clientId),
    enabled: !!user && !!clientId,
    // Mientras haya envíos por salir, se vuelve a consultar para reflejar «Enviado» / «Falló».
    refetchInterval: (query) =>
      query.state.data?.some((it) => it.scheduledStatus === "pending" || it.scheduledStatus === "processing")
        ? 60_000
        : false,
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
      const rows = data ?? [];

      // Estado real de los envíos programados. La tabla solo la lee su dueño, así que se
      // consulta por RPC (limitada a la misma organización). Si falla, se muestran como «unknown».
      const jobIds = rows
        .filter((r) => r.action === CLIENT_EMAIL_SCHEDULED_ACTION)
        .map((r) => ((r.details ?? {}) as Record<string, unknown>).job_id)
        .filter((id): id is string => typeof id === "string");
      const jobById = new Map<string, JobStatusRow>();
      if (jobIds.length > 0) {
        const { data: jobs, error: jobsError } = await supabase.rpc("scheduled_mail_job_status", {
          p_job_ids: jobIds,
        });
        if (jobsError) console.warn("[client-email-history] estado de envíos", jobsError.message);
        for (const j of (jobs ?? []) as JobStatusRow[]) jobById.set(j.id, j);
      }

      return rows.map((row) => {
        const d = (row.details ?? {}) as Record<string, unknown>;
        const isScheduled = row.action === CLIENT_EMAIL_SCHEDULED_ACTION;
        const job = isScheduled && typeof d.job_id === "string" ? jobById.get(d.job_id) : undefined;
        return {
          id: row.id,
          user_id: row.user_id,
          created_at: row.created_at,
          subject: typeof d.subject === "string" ? d.subject : "(Sin asunto)",
          to: asStrings(d.to),
          cc: asStrings(d.cc),
          attachments: asStrings(d.attachments),
          from: typeof d.from === "string" ? d.from : null,
          scheduledAt: isScheduled && typeof d.scheduled_at === "string" ? d.scheduled_at : null,
          scheduledStatus: isScheduled ? ((job?.status as ScheduledEmailStatus | undefined) ?? "unknown") : null,
          sentAt: job?.sent_at ?? null,
          errorMessage: job?.error_message ?? null,
        };
      });
    },
  });
}
