import type { SlackConversation } from "@/lib/slackApi";

export type SlackConversationGroups = {
  publicChannels: SlackConversation[];
  privateChannels: SlackConversation[];
  directMessages: SlackConversation[];
  groupDms: SlackConversation[];
};

export function groupSlackConversations(list: SlackConversation[]): SlackConversationGroups {
  const publicChannels: SlackConversation[] = [];
  const privateChannels: SlackConversation[] = [];
  const directMessages: SlackConversation[] = [];
  const groupDms: SlackConversation[] = [];

  for (const c of list) {
    if (c.is_mpim) groupDms.push(c);
    else if (c.is_im) directMessages.push(c);
    else if (c.is_private) privateChannels.push(c);
    else publicChannels.push(c);
  }

  const byLabel = (a: SlackConversation, b: SlackConversation) =>
    convLabelSort(a).localeCompare(convLabelSort(b), "es", { sensitivity: "base" });

  publicChannels.sort(byLabel);
  privateChannels.sort(byLabel);
  directMessages.sort(byLabel);
  groupDms.sort(byLabel);

  return { publicChannels, privateChannels, directMessages, groupDms };
}

function convLabelSort(c: SlackConversation): string {
  return c.name || c.user || c.id;
}

export function slackUserDisplayName(
  slackUserId: string | undefined,
  map: Record<string, { display_name: string | null; real_name: string | null } | undefined>,
): string {
  if (!slackUserId) return "Sistema";
  const p = map[slackUserId];
  const n = p?.display_name || p?.real_name;
  if (n?.trim()) return n.trim();
  return slackUserId.slice(0, 10) + (slackUserId.length > 10 ? "…" : "");
}

export function conversationTitle(
  c: SlackConversation,
  userMap: Record<string, { display_name: string | null; real_name: string | null } | undefined>,
): string {
  if (c.name?.trim()) return c.name.trim();
  if (c.is_im && c.user) return slackUserDisplayName(c.user, userMap);
  if (c.is_mpim) return c.name?.trim() || "Grupo";
  return c.id;
}
