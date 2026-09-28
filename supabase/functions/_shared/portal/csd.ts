/**
 * Portal del cliente — vista pública del CSD. Lo único que cualquier respuesta
 * de la API puede decir de un certificado de sello digital. Nunca cifrados,
 * nunca .cer/.key, nunca la contraseña.
 */
export const CSD_PUBLIC_FIELDS = [
  "registry_id", "cert_serial", "cert_not_before", "cert_not_after", "registered_via",
  "registered_at", "revoked_at", "last_used_at", "use_count", "days_to_expiry",
] as const;

export type CsdPublic = Partial<Record<(typeof CSD_PUBLIC_FIELDS)[number], unknown>>;

export function publicCsdView(row: Record<string, unknown>): CsdPublic {
  const out: CsdPublic = {};
  for (const k of CSD_PUBLIC_FIELDS) if (k in row) out[k] = row[k];
  return out;
}

/** Aviso de vencimiento: días que faltan y nivel. */
export function csdExpiryLevel(notAfter: string | null, now = new Date()): { days: number | null; level: "ok" | "aviso" | "urgente" | "vencido" } {
  if (!notAfter) return { days: null, level: "vencido" };
  const days = Math.floor((new Date(notAfter).getTime() - now.getTime()) / 86_400_000);
  if (days < 0) return { days, level: "vencido" };
  if (days <= 15) return { days, level: "urgente" };
  if (days <= 60) return { days, level: "aviso" };
  return { days, level: "ok" };
}
