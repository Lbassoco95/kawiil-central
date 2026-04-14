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
