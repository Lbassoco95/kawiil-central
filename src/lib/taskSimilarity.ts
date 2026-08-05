/**
 * Detección de tareas duplicadas / muy similares por título.
 *
 * Reglas de negocio:
 * - La comparación es por título normalizado (sin acentos, mayúsculas ni puntuación)
 *   y por solapamiento de palabras.
 * - NO aplica a tareas recurrentes ni al área de Contabilidad: en esas los títulos
 *   se repiten a propósito cada periodo (p. ej. "Declaración mensual").
 */

/** Célula/área cuyos títulos se repiten por diseño (mensuales) y no deben marcarse como duplicados. */
export const DUPLICATE_EXEMPT_AREAS = ["contabilidad"] as const;

const STOPWORDS = new Set([
  "de", "del", "la", "el", "los", "las", "un", "una", "unos", "unas",
  "y", "o", "a", "en", "con", "para", "por", "al", "the", "of", "to",
]);

/** Normaliza un título: minúsculas, sin acentos, sin puntuación, espacios colapsados. */
export function normalizeTaskTitle(title: string | null | undefined): string {
  return (title ?? "")
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // quita diacríticos
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, " ") // quita puntuación/símbolos
    .replace(/\s+/g, " ")
    .trim();
}

/** Conjunto de palabras significativas (sin stopwords ni tokens de 1 carácter). */
function significantTokens(normalized: string): Set<string> {
  return new Set(
    normalized
      .split(" ")
      .filter((t) => t.length > 1 && !STOPWORDS.has(t)),
  );
}

/**
 * Puntaje de similitud entre dos títulos en [0, 1].
 * 1 = títulos normalizados idénticos. Combina Jaccard y "contención"
 * (para que "Revisar DOF" y "Revisar DOF lunes" salgan altos).
 */
export function titleSimilarity(a: string, b: string): number {
  const na = normalizeTaskTitle(a);
  const nb = normalizeTaskTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;

  const ta = significantTokens(na);
  const tb = significantTokens(nb);
  if (ta.size === 0 || tb.size === 0) return 0;

  let inter = 0;
  for (const t of ta) if (tb.has(t)) inter++;
  const union = ta.size + tb.size - inter;
  const jaccard = union > 0 ? inter / union : 0;
  const containment = inter / Math.min(ta.size, tb.size);
  return Math.max(jaccard, containment);
}

export interface SimilarTaskCandidate {
  id: string;
  title: string;
  status?: string | null;
  area?: string | null;
  is_recurring?: boolean | null;
}

/** ¿La tarea está exenta de la detección de duplicados? (recurrente o área contable) */
export function isDuplicateExempt(task: {
  area?: string | null;
  is_recurring?: boolean | null;
}): boolean {
  if (task.is_recurring) return true;
  if (task.area && (DUPLICATE_EXEMPT_AREAS as readonly string[]).includes(task.area)) return true;
  return false;
}

/**
 * Encuentra tareas existentes similares a un título dado.
 * Excluye la propia tarea (excludeId) y las exentas (recurrentes/contables).
 */
export function findSimilarTasks(
  title: string,
  candidates: SimilarTaskCandidate[],
  opts: { threshold?: number; excludeId?: string; area?: string | null; isRecurring?: boolean } = {},
): Array<SimilarTaskCandidate & { score: number }> {
  const { threshold = 0.7, excludeId, area, isRecurring } = opts;
  // Si lo que se va a crear es exento, no molestamos.
  if (isDuplicateExempt({ area, is_recurring: isRecurring })) return [];
  const norm = normalizeTaskTitle(title);
  if (!norm) return [];

  return candidates
    .filter((c) => c.id !== excludeId && !isDuplicateExempt(c))
    .map((c) => ({ ...c, score: titleSimilarity(title, c.title) }))
    .filter((c) => c.score >= threshold)
    .sort((a, b) => b.score - a.score);
}

/**
 * Agrupa tareas por título normalizado idéntico para limpieza de duplicados existentes.
 * Devuelve solo los grupos con 2+ tareas (posibles repeticiones), excluyendo exentas.
 */
export function findDuplicateGroups<T extends SimilarTaskCandidate>(tasks: T[]): T[][] {
  const byKey = new Map<string, T[]>();
  for (const t of tasks) {
    if (isDuplicateExempt(t)) continue;
    const key = normalizeTaskTitle(t.title);
    if (!key) continue;
    const arr = byKey.get(key);
    if (arr) arr.push(t);
    else byKey.set(key, [t]);
  }
  return [...byKey.values()].filter((g) => g.length >= 2);
}
