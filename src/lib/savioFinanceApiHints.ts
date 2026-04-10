/** Metadatos típicos devueltos por savio-finance-api / savio-api-health. */
export type SavioInvokeMeta = {
  ok?: boolean;
  error?: string;
  missing?: string[];
  data?: unknown;
  savio_http_status?: number;
};

export function savioFinanceApiFailureHint(meta: SavioInvokeMeta | undefined): string | null {
  if (!meta || meta.ok === true) return null;
  if (typeof meta.error === "string" && meta.error) return meta.error;
  if (meta.ok === undefined && !meta.missing && meta.savio_http_status === undefined) return null;
  if (meta.missing?.length) {
    return `Faltan secretos en Supabase (Edge Functions → Secrets): ${meta.missing.join(", ")}. Añade SAVIO_API_KEY de tu cuenta Savio sandbox.`;
  }
  const d = meta.data;
  if (d && typeof d === "object" && "error" in d) {
    return `Savio: ${String((d as { error: unknown }).error)}`;
  }
  if (typeof meta.savio_http_status === "number") {
    return `Savio respondió HTTP ${meta.savio_http_status}. Revisa la ruta en la documentación (app.savio.mx/docs) y los secretos SAVIO_API_PATH_* si aplica.`;
  }
  return "No se pudo leer desde Savio. Comprueba API key y URL base.";
}
