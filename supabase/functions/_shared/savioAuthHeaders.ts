/**
 * OpenAPI Savio (sandbox/prod): securitySchemes.ApiKey → type apiKey, name Authorization, in header.
 * Suele enviarse la clave tal cual, sin prefijo "Bearer"; si Savio exige Bearer, secreto SAVIO_API_AUTH_MODE=bearer.
 */
export function savioAuthorizationHeaderValue(apiKey: string): string {
  const mode = (Deno.env.get("SAVIO_API_AUTH_MODE") || "raw").toLowerCase().trim();
  const k = apiKey.trim();
  if (!k) return k;
  if (mode === "bearer") return `Bearer ${k}`;
  return k;
}
