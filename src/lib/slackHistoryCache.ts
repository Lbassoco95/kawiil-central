import type { SlackMessage } from "@/lib/slackApi";

const PREFIX = "kawiil-slack-hist:";
const TTL_MS = 10 * 60_000; // 10 minutes
const MAX_MESSAGES = 60;

type CachedHistory = { updatedAt: number; messages: SlackMessage[] };

export function saveSlackHistoryCache(channelId: string, messages: SlackMessage[]): void {
  if (typeof sessionStorage === "undefined" || !channelId || !messages.length) return;
  try {
    const payload: CachedHistory = {
      updatedAt: Date.now(),
      messages: messages.slice(-MAX_MESSAGES),
    };
    sessionStorage.setItem(PREFIX + channelId, JSON.stringify(payload));
  } catch {
    /* quota */
  }
}

export function loadSlackHistoryCache(channelId: string): SlackMessage[] | undefined {
  if (typeof sessionStorage === "undefined" || !channelId) return undefined;
  try {
    const raw = sessionStorage.getItem(PREFIX + channelId);
    if (!raw) return undefined;
    const p = JSON.parse(raw) as CachedHistory;
    if (!p?.updatedAt || !Array.isArray(p.messages)) return undefined;
    if (Date.now() - p.updatedAt > TTL_MS) return undefined;
    return p.messages;
  } catch {
    return undefined;
  }
}
