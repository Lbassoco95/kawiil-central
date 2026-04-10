import { supabase } from "@/integrations/supabase/client";

type InvokePayload = { error?: string; message?: string };

/**
 * Mensaje para el usuario cuando la Edge Function responde error pero el cuerpo JSON trae detalle.
 */
export function functionInvokeUserMessage(data: unknown, invokeError: unknown): string {
  const payload = data as InvokePayload | null;
  if (payload && typeof payload === "object") {
    if (payload.error === "fiel_not_configured") {
      return (
        "Falta el secreto MOFFIN_FIEL_SECRET en Supabase (Project Settings → Edge Functions → Secrets). " +
        "Debe tener al menos 32 caracteres. Un administrador del proyecto debe crearlo; luego vuelve a guardar la FIEL."
      );
    }
    if (payload.error === "moffin_not_configured") {
      return (
        "Falta MOFFIN_API_KEY en Supabase (Edge Functions → Secrets): es el token de API de tu cuenta Moffin " +
        "(producción o sandbox, según MOFFIN_BASE_URL). Sin esta clave no se pueden ejecutar consultas SAT " +
        "(69-B, constancia, opinión)."
      );
    }
    if (typeof payload.message === "string" && payload.message.trim()) {
      return payload.message;
    }
    if (typeof payload.error === "string" && payload.error.trim()) {
      return payload.error;
    }
  }
  return invokeError instanceof Error ? invokeError.message : "La función devolvió un error.";
}

/**
 * Invoca una Edge Function con el access_token actual (evita 401 si invoke no adjunta el header).
 */
export async function invokeFunctionWithSession<T = unknown>(
  functionName: string,
  body?: Record<string, unknown>,
) {
  const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
  const token = sessionData.session?.access_token;
  if (sessionError || !token) {
    return {
      data: null as T | null,
      error: new Error(
        sessionError?.message ?? "No hay sesión activa. Inicia sesión de nuevo.",
      ),
    };
  }

  return supabase.functions.invoke<T>(functionName, {
    body: body ?? {},
    headers: {
      Authorization: `Bearer ${token}`,
    },
  });
}
