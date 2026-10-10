/**
 * Traduce errores de supabase.functions.invoke a mensajes claros en español.
 * En particular detecta el caso "la función no está desplegada / no hay red"
 * (FunctionsFetchError → "Failed to send a request to the Edge Function"), que
 * suele ocurrir cuando una Edge Function nueva aún no se ha desplegado en Supabase.
 */
export function describeEdgeFnError(error: unknown, fnLabel: string): string {
  const msg = error instanceof Error ? error.message : String(error ?? "");
  const name = (error as { name?: string } | null)?.name ?? "";
  if (
    name === "FunctionsFetchError" ||
    /failed to send a request to the edge function/i.test(msg) ||
    /failed to fetch/i.test(msg)
  ) {
    return `No se pudo contactar la función «${fnLabel}». Probablemente aún no está desplegada en Supabase o no hay conexión. Aplica las migraciones y despliega las Edge Functions (al integrar a main corre el workflow «Deploy Supabase»).`;
  }
  return msg || `Error al llamar «${fnLabel}».`;
}
