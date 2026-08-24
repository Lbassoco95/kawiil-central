/**
 * Coincidencia de texto para los buscadores de la app.
 *
 * El acervo está en español: los nombres llevan acentos ("Jesús", "Constitución",
 * "Peña") y la gente los escribe sin ellos. Además se busca por trozos sueltos
 * ("maria lopez" para "María Fernanda López"). Por eso la comparación se hace
 * sobre texto normalizado —sin diacríticos ni puntuación— y token por token:
 * todos los tokens de la consulta deben aparecer en algún campo del registro,
 * sin importar el orden.
 */

/** Minúsculas, sin acentos, sin puntuación y con espacios colapsados. */
export function normalizeSearchText(value: unknown): string {
  if (value === null || value === undefined) return "";
  return String(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/** Tokens significativos de la consulta (vacío = "sin filtro"). */
export function searchTokens(query: string): string[] {
  const normalized = normalizeSearchText(query);
  return normalized ? normalized.split(" ") : [];
}

/** Une los campos buscables de un registro en un solo texto normalizado. */
export function buildHaystack(fields: unknown[]): string {
  return fields.map(normalizeSearchText).filter(Boolean).join(" ");
}

/** true si todos los tokens de la consulta aparecen en alguno de los campos. */
export function matchesSearch(query: string, fields: unknown[]): boolean {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return true;
  const haystack = buildHaystack(fields);
  if (!haystack) return false;
  return tokens.every((token) => haystack.includes(token));
}

/**
 * Peso para ordenar resultados: primero lo que empieza con la consulta, luego
 * lo que la contiene como palabra completa, al final el resto. Menor es mejor.
 */
export function searchRank(query: string, primaryField: unknown): number {
  const tokens = searchTokens(query);
  if (tokens.length === 0) return 3;
  const primary = normalizeSearchText(primaryField);
  if (!primary) return 3;
  const joined = tokens.join(" ");
  if (primary.startsWith(joined)) return 0;
  if (primary.split(" ").some((word) => word.startsWith(tokens[0]))) return 1;
  if (primary.includes(joined)) return 2;
  return 3;
}
