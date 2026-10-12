import { supabase } from "@/integrations/supabase/client";
import { FunctionsHttpError } from "@supabase/functions-js";

/**
 * Las tablas esign_* / user_signatures aún no están en los tipos generados de Supabase;
 * al regenerar `types.ts` este alias puede reemplazarse por `supabase` a secas.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export const esignDb = supabase as any;

export interface EsignError extends Error {
  code?: string;
}

/** Invoca la Edge Function `esign` y propaga el mensaje real de error (y `code`). */
export async function invokeEsign<T = Record<string, unknown>>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke("esign", { body });
  if (error) {
    let message = error.message;
    let code: string | undefined;
    if (error instanceof FunctionsHttpError) {
      try {
        const j = await error.context.json();
        if (j?.error) message = j.error;
        code = j?.code;
      } catch {
        /* cuerpo no JSON */
      }
    }
    throw Object.assign(new Error(message), { code }) as EsignError;
  }
  if (data?.error) throw Object.assign(new Error(data.error), { code: data.code }) as EsignError;
  return data as T;
}

export type EsignRequestStatus = "pending" | "completed" | "cancelled" | "declined" | "expired";

export const ESIGN_STATUS_LABEL: Record<EsignRequestStatus, string> = {
  pending: "Pendiente",
  completed: "Firmado",
  cancelled: "Cancelado",
  declined: "Rechazado",
  expired: "Vencido",
};

export interface EsignSignerRow {
  id: string;
  request_id: string;
  sign_order: number;
  name: string;
  email: string;
  user_id: string | null;
  token: string;
  status: "pending" | "signed" | "declined";
  signed_at: string | null;
}

export interface EsignRequestRow {
  id: string;
  title: string;
  file_name: string;
  message: string | null;
  status: EsignRequestStatus;
  sequential: boolean;
  created_by: string;
  client_id: string | null;
  project_id: string | null;
  expires_at: string;
  completed_at: string | null;
  created_at: string;
}
