/**
 * OpenAPI Savio: servers[].url es https://api.savio.mx/api/v1 (prod) o …/api/v1 (sandbox).
 * Si SAVIO_API_BASE_URL solo trae el host, debemos añadir /api/v1 o las rutas /invoice responden 404.
 */
export function normalizeSavioApiBase(raw: string): string {
  const trimmed = raw.trim().replace(/\/+$/, "");
  if (!trimmed) return trimmed;
  if (/\/api\/v1$/i.test(trimmed)) return trimmed;
  return `${trimmed}/api/v1`;
}
