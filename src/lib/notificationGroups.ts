export type MomentKey = "hoy" | "ayer" | "semana" | "antes";

export const MOMENT_LABELS: Record<MomentKey, string> = {
  hoy: "Hoy",
  ayer: "Ayer",
  semana: "Esta semana",
  antes: "Antes",
};

const MOMENT_ORDER: MomentKey[] = ["hoy", "ayer", "semana", "antes"];

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

export function momentOf(createdAt: string | Date, now: Date = new Date()): MomentKey {
  const days = Math.round((startOfDay(now) - startOfDay(new Date(createdAt))) / 86_400_000);
  if (days <= 0) return "hoy";
  if (days === 1) return "ayer";
  if (days < 7) return "semana";
  return "antes";
}

/** Agrupa por momento conservando el orden recibido; omite grupos vacíos. */
export function groupByMoment<T extends { created_at: string }>(
  items: T[],
  now: Date = new Date(),
): Array<{ key: MomentKey; label: string; items: T[] }> {
  const buckets = new Map<MomentKey, T[]>();
  for (const it of items) {
    const k = momentOf(it.created_at, now);
    buckets.set(k, [...(buckets.get(k) ?? []), it]);
  }
  return MOMENT_ORDER.filter((k) => buckets.has(k)).map((k) => ({
    key: k,
    label: MOMENT_LABELS[k],
    items: buckets.get(k)!,
  }));
}
