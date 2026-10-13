/** Orden alfabético en español: sin distinguir mayúsculas/acentos, números en orden natural. */
const collator = new Intl.Collator("es", { sensitivity: "base", numeric: true });

export const compareAlpha = (a: string | null | undefined, b: string | null | undefined) =>
  collator.compare((a ?? "").trim(), (b ?? "").trim());

/** Copia ordenada alfabéticamente por la clave que devuelva `getLabel`. */
export function sortAlpha<T>(items: readonly T[], getLabel: (item: T) => string | null | undefined): T[] {
  return [...items].sort((a, b) => compareAlpha(getLabel(a), getLabel(b)));
}
