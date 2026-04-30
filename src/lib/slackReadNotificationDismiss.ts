/** Coincide con el prefijo de `tag` en push (`supabase/functions/slack-events/index.ts`). */
export const SW_CLOSE_SLACK_PUSH_MESSAGE = "CLOSE_SLACK_CHANNEL_PUSH" as const;

const slackDesktopByChannel = new Map<string, Set<Notification>>();

function tagForSlackChannelTs(channelId: string, messageTs: string): string {
  return `slack-${channelId}-${messageTs}`.replace(/\s/g, "");
}

/**
 * `entity_ref`: `channel|ts` o `channel|threadTs|ts` (Slack).
 */
export function slackChannelAndMessageTsFromEntityRef(
  entityRef: string | null | undefined,
): { channelId: string; ts: string } | null {
  if (!entityRef || typeof entityRef !== "string") return null;
  const parts = entityRef.split("|").filter(Boolean);
  if (parts.length < 2) return null;
  const channelId = parts[0];
  const ts = parts[parts.length - 1];
  if (!channelId || !ts) return null;
  return { channelId, ts };
}

export function slackDesktopNotificationTagFromEntityRef(entityRef: string | null | undefined): string | null {
  const p = slackChannelAndMessageTsFromEntityRef(entityRef);
  if (!p) return null;
  return tagForSlackChannelTs(p.channelId, p.ts);
}

export function trackSlackDesktopNotification(channelId: string, n: Notification): void {
  let set = slackDesktopByChannel.get(channelId);
  if (!set) {
    set = new Set();
    slackDesktopByChannel.set(channelId, set);
  }
  set.add(n);
  n.addEventListener("close", () => {
    set!.delete(n);
    if (set!.size === 0) slackDesktopByChannel.delete(channelId);
  });
}

export function closeSlackDesktopNotificationsForChannel(channelId: string): void {
  const set = slackDesktopByChannel.get(channelId);
  if (!set?.size) return;
  for (const n of set) {
    try {
      n.close();
    } catch {
      /* noop */
    }
  }
  slackDesktopByChannel.delete(channelId);
}

export function dismissSlackChannelSystemNotifications(channelId: string): void {
  closeSlackDesktopNotificationsForChannel(channelId);
  const payload = { type: SW_CLOSE_SLACK_PUSH_MESSAGE, channelId };
  try {
    const ctrl = navigator.serviceWorker?.controller;
    if (ctrl) {
      ctrl.postMessage(payload);
      return;
    }
    void navigator.serviceWorker?.ready.then((reg) => reg.active?.postMessage(payload));
  } catch {
    /* noop */
  }
}
