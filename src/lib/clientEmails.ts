/**
 * Correos registrados de un cliente: el de la ficha (puede traer varios separados
 * por coma o punto y coma) más los de recepción de sus perfiles fiscales.
 * Devuelve la lista sin duplicados (sin distinguir mayúsculas), en orden de aparición.
 */
export function collectClientEmails(
  clientEmail: string | null | undefined,
  taxProfileEmails: Array<string | null | undefined> = [],
): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of [clientEmail, ...taxProfileEmails]) {
    if (!raw) continue;
    for (const part of raw.split(/[,;\s]+/)) {
      const email = part.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) continue;
      const key = email.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(email);
    }
  }
  return out;
}
