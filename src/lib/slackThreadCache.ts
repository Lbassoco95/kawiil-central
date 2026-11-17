import type { SlackMessage } from "@/lib/slackApi";

const PREFIX = "kawiil-slack-thread:";
const TTL_MS = 30 * 60_000;
const MAX_MESSAGES = 120;

type CachedThread = { updatedAt: number; messages: SlackMessage[] };

export function saveSlackThreadCache(
  channelId: string,
  threadTs: string,
  messages: SlackMessage[],
): void {
  if (typeof localStorage === "undefined" || !channelId || !threadTs || messages.length === 0) return;
  try {
    const payload: CachedThread = {
      updatedAt: Date.now(),
      messages: messages.slice(-MAX_MESSAGES),
    };
    localStorage.setItem(PREFIX + channelId + ":" + threadTs, JSON.stringify(payload));
  } catch {
    /* cuota llena: el hilo sigue en memoria */
  }
}

export function loadSlackThreadCache(
  channelId: string,
  threadTs: string,
): { updatedAt: number; messages: SlackMessage[] } | undefined {
  if (typeof localStorage === "undefined" || !channelId || !threadTs) return undefined;
  try {
    const raw = localStorage.getItem(PREFIX + channelId + ":" + threadTs);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as CachedThread;
    if (!parsed?.updatedAt || !Array.isArray(parsed.messages) || parsed.messages.length === 0) {
      return undefined;
    }
    if (Date.now() - parsed.updatedAt > TTL_MS) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

/** Une páginas del hilo sin perder un envío que todavía no confirmó Slack. */
export function mergeThreadMessages(
  current: SlackMessage[],
  incoming: SlackMessage[],
): SlackMessage[] {
  const byTs = new Map<string, SlackMessage>();
  for (const message of current) {
    if (message.ts) byTs.set(message.ts, message);
  }
  for (const message of incoming) {
    if (!message.ts) continue;
    const prev = byTs.get(message.ts);
    byTs.set(
      message.ts,
      prev
        ? { ...prev, ...message, reactions: message.reactions ?? prev.reactions }
        : message,
    );
  }
  return [...byTs.values()].sort((a, b) => parseFloat(a.ts) - parseFloat(b.ts));
}
