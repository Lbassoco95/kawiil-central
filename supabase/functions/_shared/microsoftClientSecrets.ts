/**
 * Client secrets de la App Registration Microsoft (calendario / Graph).
 * MICROSOFT_CLIENT_SECRET es el canónico; AZURE_CLIENT_SECRET es alias legacy
 * (pipeline/mail). Se prueban en orden, sin duplicar Values idénticos.
 */

export function microsoftClientSecretCandidates(): string[] {
  const primary = (Deno.env.get("MICROSOFT_CLIENT_SECRET") || "").trim();
  const alias = (Deno.env.get("AZURE_CLIENT_SECRET") || "").trim();
  const out: string[] = [];
  if (primary) out.push(primary);
  if (alias && alias !== primary) out.push(alias);
  return out;
}

export function requireMicrosoftClientSecretCandidates(): string[] {
  const secrets = microsoftClientSecretCandidates();
  if (secrets.length === 0) {
    throw new Error(
      "Falta MICROSOFT_CLIENT_SECRET (o AZURE_CLIENT_SECRET) en Edge Function Secrets",
    );
  }
  return secrets;
}
