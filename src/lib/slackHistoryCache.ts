import type { SlackMessage } from "@/lib/slackApi";

const PREFIX = "kawiil-slack-hist:";
const TTL_MS = 30 * 60_000; // 30 min — survives page reloads
const MAX_MESSAGES = 60;

type CachedHistory = { updatedAt: number; messages: SlackMessage[] };

export function saveSlackHistoryCache(channelId: string, messages: SlackMessage[]): void {
  if (typeof localStorage === "undefined" || !channelId || !messages.length) return;
  try {
    const payload: CachedHistory = {
      updatedAt: Date.now(),
      messages: messages.slice(-MAX_MESSAGES),
    };
    localStorage.setItem(PREFIX + channelId, JSON.stringify(payload));
  } catch {
    /* quota — silently ignore */
  }
}

export function loadSlackHistoryCache(channelId: string): SlackMessage[] | undefined {
  if (typeof localStorage === "undefined" || !channelId) return undefined;
  try {
    const raw = localStorage.getItem(PREFIX + channelId);
    if (!raw) return undefined;
    const p = JSON.parse(raw) as CachedHistory;
    if (!p?.updatedAt || !Array.isArray(p.messages)) return undefined;
    if (Date.now() - p.updatedAt > TTL_MS) return undefined;
    return p.messages;
  } catch {
    return undefined;
  }
}
