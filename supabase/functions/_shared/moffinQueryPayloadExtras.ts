/**
 * Tras la respuesta de Moffin: JSON opcional que se fusiona al body de POST /query/...
 * (claves adicionales, metadata, flags, etc.). Valor = objeto JSON en una sola línea o multilínea válido.
 */

type SatConsult = "constancia_situacion_fiscal" | "opinion_cumplimiento";

function parseExtraObject(raw: string, logLabel: string): Record<string, unknown> | null {
  try {
    const v = JSON.parse(raw) as unknown;
    if (!v || typeof v !== "object" || Array.isArray(v)) {
      console.warn(`moffin_query_extra_${logLabel}: el JSON debe ser un objeto`);
      return null;
    }
    return v as Record<string, unknown>;
  } catch (e) {
    console.warn(
      `moffin_query_extra_${logLabel}: JSON inválido`,
      e instanceof Error ? e.message : String(e),
    );
    return null;
  }
}

function mergeMetadata(
  base: Record<string, unknown> | undefined,
  extra: unknown,
): Record<string, unknown> {
  const b = base && typeof base === "object" && !Array.isArray(base) ? { ...base } : {};
  if (extra && typeof extra === "object" && !Array.isArray(extra)) {
    return { ...b, ...(extra as Record<string, unknown>) };
  }
  return b;
}

/** Fusiona en `payload` las claves del extra (shallow). `metadata` se combina en un solo objeto. */
export function mergeMoffinQueryPayloadExtras(
  payload: Record<string, unknown>,
  consultType: SatConsult,
): void {
  const envKey =
    consultType === "constancia_situacion_fiscal"
      ? "MOFFIN_QUERY_EXTRA_BODY_CONSTANCIA_SITUACION_FISCAL"
      : "MOFFIN_QUERY_EXTRA_BODY_OPINION_CUMPLIMIENTO";
  const raw = Deno.env.get(envKey)?.trim();
  if (!raw) return;

  const extra = parseExtraObject(raw, envKey);
  if (!extra) return;

  for (const [k, v] of Object.entries(extra)) {
    if (k === "metadata") {
      payload.metadata = mergeMetadata(
        payload.metadata as Record<string, unknown> | undefined,
        v,
      );
      continue;
    }
    payload[k] = v;
  }
}
