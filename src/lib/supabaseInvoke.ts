import { supabase } from "@/integrations/supabase/client";

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
