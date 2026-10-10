import { supabase } from "@/integrations/supabase/client";

/**
 * Cliente ligero para consumir el servicio interno de notificaciones (Edge
 * Function `notify`) desde el frontend. Los módulos del servidor la consumen
 * importando directamente ../_shared/notify.ts; el frontend usa esto.
 */
export type NotifyChannel = "slack" | "whatsapp" | "email" | "in_app";

export interface NotifyRequest {
  canal: NotifyChannel;
  destino?: string;
  plantilla: string;
  datos?: Record<string, unknown>;
  organization_id?: string | null;
  source_user_id?: string | null;
}

export interface NotifyResult {
  ok: boolean;
  canal: string;
  estado: "enviado" | "error" | "omitido";
  error?: string;
}

/** Envía una o varias notificaciones vía la Edge Function `notify`. */
export async function invokeNotify(
  input: NotifyRequest | NotifyRequest[],
): Promise<{ ok: boolean; results: NotifyResult[] }> {
  const body = Array.isArray(input) ? { notifications: input } : input;
  const { data, error } = await supabase.functions.invoke("notify", { body });
  if (error) throw new Error(error.message || "No se pudo enviar la notificación");
  return data as { ok: boolean; results: NotifyResult[] };
}
