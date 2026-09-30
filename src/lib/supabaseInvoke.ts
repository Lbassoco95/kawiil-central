import { supabase } from "@/integrations/supabase/client";
import { FunctionsHttpError } from "@supabase/functions-js";

type InvokePayload = { error?: string; message?: string };

/** Cuerpo JSON de una respuesta 4xx/5xx; `supabase.functions.invoke` a veces no rellena `data`. */
async function jsonBodyFromFunctionsHttpError(
  err: unknown,
): Promise<Record<string, unknown> | null> {
  if (!(err instanceof FunctionsHttpError)) return null;
  const res = err.context;
  if (!(res instanceof Response)) return null;
  try {
    const j: unknown = await res.clone().json();
    if (j && typeof j === "object" && !Array.isArray(j)) {
      return j as Record<string, unknown>;
    }
  } catch {
    try {
      const text = await res.clone().text();
      if (text?.trim()) {
        return { message: text.trim().slice(0, 500) };
      }
    } catch {
      /* ignore */
    }
  }
  return null;
}

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
        "del cliente (consultas SAT / SATgo)."
      );
    }
    if (payload.error === "ciec_required" || payload.error === "sat_credentials_required") {
      return typeof payload.message === "string" && payload.message.trim()
        ? payload.message
        : "Sube la e.firma (.cer/.key + contraseña) del cliente o guarda la CIEC antes de CSF/32D (SATgo).";
    }
    if (payload.error === "fiel_password_required") {
      return typeof payload.message === "string" && payload.message.trim()
        ? payload.message
        : "Indica la contraseña de la e.firma al guardar (se cifra a JWE para SATgo).";
    }
    if (payload.error === "satgo_jwe_encrypt_failed") {
      return typeof payload.message === "string" && payload.message.trim()
        ? payload.message
        : "No se pudo cifrar la e.firma a JWE con la llave pública de SATgo.";
    }
    if (payload.error === "satgo_not_configured" || payload.error === "satgo_token_exchange_failed") {
      return typeof payload.message === "string" && payload.message.trim()
        ? payload.message
        : "Configura SATGO_API_KEY en Supabase → Edge Functions → Secrets (Createkey en SATgo).";
    }
    if (payload.error === "satgo_api_error") {
      return typeof payload.message === "string" && payload.message.trim()
        ? `SATgo: ${payload.message.trim()}`
        : "Error al consultar CSF/32D en SATgo.";
    }
    if (payload.error === "moffin_profile_failed") {
      const rawMsg =
        typeof payload.message === "string" && payload.message.trim() ? payload.message.trim() : "";
      const looksLikeMoffinInvoicesOrBilling =
        /failed to fetch invoices|fetch invoices|factura/i.test(rawMsg);
      const hintRaw = (payload as { hint?: string }).hint;
      const hint =
        typeof hintRaw === "string" && hintRaw.trim() ? ` ${hintRaw.trim()}` : "";
      if (looksLikeMoffinInvoicesOrBilling) {
        return (
          "Kawiil solo envía RFC y CIEC para la constancia (CSF); no pide facturas del SAT. " +
          "El texto «Failed to fetch invoices» lo devuelve el servidor de Moffin cuando falla un paso interno " +
          "(suele ser facturación o datos de tu cuenta comercial en Moffin, no la descarga de la CSF). " +
          "Contacta a soporte Moffin con ese detalle. " +
          (rawMsg ? `Respuesta Moffin: ${rawMsg}` : "") +
          hint
        );
      }
      const detail = rawMsg ? ` Detalle de Moffin: ${rawMsg}` : "";
      return (
        "No se pudo crear el perfil SAT en Moffin (RFC + CIEC). Revisa que la CIEC sea la del portal del SAT; " +
        "luego actualízala en Contabilidad y vuelve a intentar." +
        detail +
        hint
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
 * Igual que {@link functionInvokeUserMessage} pero, si hay `FunctionsHttpError`, lee el JSON del
 * cuerpo (evita mostrar solo "Edge Function returned a non-2xx status code").
 */
export async function functionInvokeUserMessageAsync(
  data: unknown,
  invokeError: unknown,
): Promise<string> {
  const fromHttp = await jsonBodyFromFunctionsHttpError(invokeError);
  if (fromHttp) {
    const d =
      data && typeof data === "object" && data !== null && !Array.isArray(data)
        ? (data as Record<string, unknown>)
        : null;
    const merged = d ? { ...fromHttp, ...d } : { ...fromHttp };
    return functionInvokeUserMessage(merged, invokeError);
  }
  return functionInvokeUserMessage(data, invokeError);
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
