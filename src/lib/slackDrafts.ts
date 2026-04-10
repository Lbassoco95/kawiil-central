const PREFIX = "slack-draft-v1";

export type SlackDraftPayload = {
  text: string;
  updatedAt: number;
};

export function slackDraftKey(userId: string, channelId: string): string {
  return `${PREFIX}:${userId}:${channelId}`;
}

export function loadSlackDraft(userId: string, channelId: string): SlackDraftPayload | null {
  try {
    const raw = localStorage.getItem(slackDraftKey(userId, channelId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { text?: string; updatedAt?: number };
    if (typeof parsed.text !== "string") return null;
    return {
      text: parsed.text,
      updatedAt: typeof parsed.updatedAt === "number" ? parsed.updatedAt : Date.now(),
    };
  } catch {
    return null;
  }
}

export function saveSlackDraft(userId: string, channelId: string, text: string): void {
  try {
    if (!text.trim()) {
      localStorage.removeItem(slackDraftKey(userId, channelId));
      return;
    }
    localStorage.setItem(
      slackDraftKey(userId, channelId),
      JSON.stringify({ text, updatedAt: Date.now() }),
    );
  } catch {
    /* ignore quota / private mode */
  }
}

export function clearSlackDraft(userId: string, channelId: string): void {
  try {
    localStorage.removeItem(slackDraftKey(userId, channelId));
  } catch {
    /* ignore */
  }
}
