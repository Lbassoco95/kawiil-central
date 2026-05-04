const storageKey = (userId: string) => `kawiil-slack-read-ts-${userId}`;

/** Último mensaje visto por canal (ts Slack) para estimar no leídos con conversations.history. */
export function loadSlackReadMap(userId: string): Record<string, string> {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (!raw) return {};
    const j = JSON.parse(raw) as unknown;
    if (!j || typeof j !== "object") return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(j as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim()) out[k] = v.trim();
    }
    return out;
  } catch {
    return {};
  }
}

export function saveSlackReadCursor(userId: string, channelId: string, messageTs: string): void {
  const ts = messageTs.trim();
  if (!ts) return;
  try {
    const m = loadSlackReadMap(userId);
    m[channelId] = ts;
    localStorage.setItem(storageKey(userId), JSON.stringify(m));
  } catch {
    /* ignore */
  }
}

/** `last_read` en el objeto `channel` de `conversations.info`. */
export function parseSlackChannelLastRead(
  channel: Record<string, unknown> | null | undefined,
): string | null {
  if (!channel) return null;
  const lr = channel.last_read;
  if (typeof lr === "string" && lr.trim()) return lr.trim();
  if (typeof lr === "number" && Number.isFinite(lr)) return String(lr);
  return null;
}

/** Comparación de timestamps Slack (`sec.frac`). */
export function compareSlackTs(a: string, b: string): number {
  const ax = a.trim();
  const bx = b.trim();
  if (ax === bx) return 0;
  const parsePart = (s: string) => {
    const [sec, frac = "0"] = s.split(".");
    const secN = /^\d+$/.test(sec) ? BigInt(sec) : null;
    const fracP = frac.replace(/\D/g, "").padEnd(6, "0").slice(0, 6);
    const fracN = BigInt(fracP || "0");
    return { secN, fracN };
  };
  const A = parsePart(ax);
  const B = parsePart(bx);
  if (A.secN === null || B.secN === null) return ax.localeCompare(bx);
  if (A.secN < B.secN) return -1;
  if (A.secN > B.secN) return 1;
  if (A.fracN < B.fracN) return -1;
  if (A.fracN > B.fracN) return 1;
  return 0;
}

export function maxSlackTs(a: string, b: string): string {
  return compareSlackTs(a, b) >= 0 ? a : b;
}
