/**
 * Orígenes seguros para window.opener.postMessage tras OAuth.
 *
 * - Si APP_ORIGIN / KAWIIL_APP_URL está definido: se usa ese + dominios de prod conocidos
 *   (www y apex) para no romper si el usuario entra por cualquiera.
 * - Si no hay secreto de origen: se mantiene `*` (comportamiento previo) para no tumbar
 *   popups en producción hasta que ops configure APP_ORIGIN.
 */

const PROD_ORIGINS = [
  "https://www.kawiil-central.mx",
  "https://kawiil-central.mx",
];

export function resolvePostMessageOrigins(preferred?: string | null): string[] {
  const fromPreferred = typeof preferred === "string" ? preferred.trim().replace(/\/$/, "") : "";
  const fromEnv =
    Deno.env.get("APP_ORIGIN")?.trim().replace(/\/$/, "") ||
    Deno.env.get("KAWIIL_APP_URL")?.trim().replace(/\/$/, "") ||
    "";

  const primary = fromPreferred || fromEnv;
  if (!primary) {
    return ["*"];
  }

  const set = new Set<string>([primary, ...PROD_ORIGINS]);
  return [...set];
}

/** Script que hace postMessage a cada origen candidato (el opener solo acepta el suyo). */
export function openerPostMessageScript(dataLiteral: string, preferred?: string | null): string {
  const origins = resolvePostMessageOrigins(preferred);
  const posts = origins
    .map((o) => `try{window.opener&&window.opener.postMessage(${dataLiteral},${JSON.stringify(o)});}catch(_){}`)
    .join("");
  return posts;
}
