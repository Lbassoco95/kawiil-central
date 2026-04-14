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
    if (payload.error === "ciec_not_configured") {
      return (
        "Falta MOFFIN_SAT_CIEC_SECRET o MOFFIN_FIEL_SECRET (≥32 caracteres) en Edge Functions para cifrar la CIEC " +
        "del cliente (Moffin Solutions)."
      );
    }
    if (payload.error === "ciec_required") {
      return typeof payload.message === "string" && payload.message.trim()
        ? payload.message
        : "Guarda la CIEC del cliente antes de ejecutar consultas CSF u opinión (Moffin Solutions).";
    }
    if (payload.error === "moffin_profile_failed") {
      const detail =
        typeof payload.message === "string" && payload.message.trim()
          ? ` Detalle de Moffin: ${payload.message.trim()}`
          : "";
      return (
        "No se pudo crear el perfil SAT en Moffin (RFC + CIEC). Revisa que la CIEC sea la del portal del SAT; " +
        "luego actualízala en Contabilidad y vuelve a intentar." + detail
      );
    }
    if (payload.error === "moffin_profile_invalid") {
      return (
        "Moffin no devolvió profileId al crear el perfil SAT. Contacta a soporte Moffin o verifica RFC y CIEC; " +
        "puedes actualizar la CIEC en Contabilidad y reintentar."
      );
    }
    if (payload.error === "ciec_decrypt_failed") {
      return (
        "No se pudo leer la CIEC guardada (cifrado). Vuelve a guardar la CIEC en Contabilidad o revisa en Supabase " +
        "que MOFFIN_SAT_CIEC_SECRET o MOFFIN_FIEL_SECRET coincidan con el valor usado al guardarla."
      );
    }
    if (payload.error === "moffin_solutions_auth") {
      return typeof payload.message === "string" && payload.message.trim()
        ? `Autenticación Moffin Solutions: ${payload.message.trim()}`
        : "No se pudo obtener token OAuth de Moffin Solutions. Revisa CLIENT_ID, CLIENT_SECRET y URL base en Supabase.";
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
