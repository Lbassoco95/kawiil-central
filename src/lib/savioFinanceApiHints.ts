/** Metadatos típicos devueltos por savio-finance-api / savio-api-health. */
export type SavioInvokeMeta = {
  ok?: boolean;
  error?: string;
  missing?: string[];
  data?: unknown;
  savio_http_status?: number;
};

function supabaseEdgeSecretsUrl(): string | null {
  const id =
    typeof import.meta.env.VITE_SUPABASE_PROJECT_ID === "string"
      ? import.meta.env.VITE_SUPABASE_PROJECT_ID.trim()
      : "";
  return id ? `https://supabase.com/dashboard/project/${id}/settings/functions` : null;
}

/** Mensaje cuando la Edge Function indica secretos faltantes (mismo texto en UI y en “Probar conexión”). */
export function savioMissingSecretsUserMessage(missing: string[]): string {
  const names = missing.join(", ");
  const panel = supabaseEdgeSecretsUrl();
  return [
    `Hay que crear estos secretos en Supabase → Edge Functions → Secrets (no en Lovable ni en variables del front): ${names}.`,
    panel ? `Abre el panel del proyecto: ${panel}` : "",
    `Nombre exacto: SAVIO_API_KEY. Valor: la API key de tu entorno Savio sandbox (panel o docs de Savio).`,
    `Los pushes a GitHub y el deploy de funciones no rellenan la clave; hay que guardarla una vez en ese menú.`,
  ]
    .filter(Boolean)
    .join(" ");
}

export function savioFinanceApiFailureHint(meta: SavioInvokeMeta | undefined): string | null {
  if (!meta || meta.ok === true) return null;
  // Antes de devolver error genérico ("missing_secrets"), usar la lista `missing`.
  if (meta.missing?.length) {
    return savioMissingSecretsUserMessage(meta.missing);
  }
  if (typeof meta.error === "string" && meta.error) return meta.error;
  if (meta.ok === undefined && !meta.missing && meta.savio_http_status === undefined) return null;
  const d = meta.data;
  if (d && typeof d === "object" && "error" in d) {
    return `Savio: ${String((d as { error: unknown }).error)}`;
  }
  if (typeof meta.savio_http_status === "number") {
    return `Savio respondió HTTP ${meta.savio_http_status}. Revisa la ruta en la documentación (app.savio.mx/docs) y los secretos SAVIO_API_PATH_* si aplica.`;
  }
  return "No se pudo leer desde Savio. Comprueba API key y URL base.";
}
