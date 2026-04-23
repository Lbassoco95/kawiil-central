/** Clave para el orden de carpetas de primer nivel en localStorage. */
export const EMAIL_FOLDER_ORDER_ROOT_KEY = "__root__";

const STORAGE_VERSION = 1;

export type EmailFolderOrderPayload = {
  v: number;
  byParent: Record<string, string[]>;
};

function storageKey(userId: string): string {
  return `kawiil-email-folder-order:v${STORAGE_VERSION}:${userId}`;
}

/**
 * Fusiona orden guardado con el orden por defecto de Graph: mantiene el orden del usuario
 * y añade al final los ids nuevos que aún no estaban guardados.
 */
export function mergeSiblingOrder(stored: string[] | undefined, defaultOrderedIds: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  const validDefault = new Set(defaultOrderedIds);
  if (stored) {
    for (const id of stored) {
      if (validDefault.has(id) && !seen.has(id)) {
        seen.add(id);
        out.push(id);
      }
    }
  }
  for (const id of defaultOrderedIds) {
    if (!seen.has(id)) out.push(id);
  }
  return out;
}

export function readEmailFolderOrder(userId: string): Record<string, string[]> {
  if (typeof window === "undefined" || !userId) return {};
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return {};
    const parsed = JSON.parse(raw) as EmailFolderOrderPayload;
    if (!parsed || typeof parsed !== "object" || parsed.v !== STORAGE_VERSION) return {};
    const bp = parsed.byParent;
    if (!bp || typeof bp !== "object") return {};
    const out: Record<string, string[]> = {};
    for (const [k, v] of Object.entries(bp)) {
      if (!k || !Array.isArray(v)) continue;
      out[k] = v.filter((x) => typeof x === "string" && x.length > 0);
    }
    return out;
  } catch {
    return {};
  }
}

export function writeEmailFolderOrder(userId: string, byParent: Record<string, string[]>): void {
  if (typeof window === "undefined" || !userId) return;
  try {
    const payload: EmailFolderOrderPayload = { v: STORAGE_VERSION, byParent };
    window.localStorage.setItem(storageKey(userId), JSON.stringify(payload));
  } catch {
    /* ignore quota / private mode */
  }
}

/** Construye mapa parentKey -> ids en el orden por defecto (post buildFolderTreeData). */
export function defaultFolderOrdersFromTree(roots: { id: string }[], childrenMap: Map<string, { id: string }[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {
    [EMAIL_FOLDER_ORDER_ROOT_KEY]: roots.map((r) => r.id),
  };
  for (const [pid, arr] of childrenMap) {
    out[pid] = arr.map((f) => f.id);
  }
  return out;
}
