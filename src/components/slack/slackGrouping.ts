import type { SlackConversation, SlackMessage } from "@/lib/slackApi";
import type { SlackUserProfile } from "@/hooks/useSlackUserProfiles";

export type SlackConversationGroups = {
  publicChannels: SlackConversation[];
  privateChannels: SlackConversation[];
  /** DMs 1:1 + MPDM agrupados (un solo bloque en sidebar). */
  allDirectMessages: SlackConversation[];
};

export function groupSlackConversations(list: SlackConversation[]): SlackConversationGroups {
  const publicChannels: SlackConversation[] = [];
  const privateChannels: SlackConversation[] = [];
  const allDirectMessages: SlackConversation[] = [];

  for (const c of list) {
    if (c.is_mpim || c.is_im) allDirectMessages.push(c);
    else if (c.is_private) privateChannels.push(c);
    else publicChannels.push(c);
  }

  const byLabel = (a: SlackConversation, b: SlackConversation) =>
    convLabelSort(a).localeCompare(convLabelSort(b), "es", { sensitivity: "base" });

  publicChannels.sort(byLabel);
  privateChannels.sort(byLabel);
  allDirectMessages.sort(byLabel);

  return { publicChannels, privateChannels, allDirectMessages };
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

/** Autor visible en la lista de mensajes (humanos, apps y bots con nombre en el payload). */
export function slackMessageAuthorDisplayName(
  m: SlackMessage,
  userMap: Record<string, SlackUserProfile | undefined>,
): string {
  const fromProfile = m.bot_profile?.name?.trim();
  if (fromProfile) return fromProfile;
  const fromUsername = m.username?.trim();
  if (fromUsername && fromUsername.toLowerCase() !== "slackbot") return fromUsername;
  if (m.user) return slackUserDisplayName(m.user, userMap);
  if (m.bot_id) return "App";
  return "Sistema";
}

export type ConversationTitleOpts = {
  /** channel_id → slack user ids miembros (mpim). */
  mpimMembersByChannel?: Record<string, string[]>;
  /** Usuario conectado (Slack); se omite en etiqueta "Leo, Ana". */
  slackSelfUserId?: string | null;
};

export function conversationTitle(
  c: SlackConversation,
  userMap: Record<string, { display_name: string | null; real_name: string | null } | undefined>,
  opts?: ConversationTitleOpts,
): string {
  if (c.is_im && c.user) return slackUserDisplayName(c.user, userMap);
  if (c.is_mpim) {
    const members = opts?.mpimMembersByChannel?.[c.id];
    if (members?.length) {
      const self = opts?.slackSelfUserId;
      const names = members
        .filter((id) => id !== self)
        .map((id) => slackUserDisplayName(id, userMap));
      const uniq = [...new Set(names)];
      if (uniq.length) return uniq.join(", ");
    }
    if (c.name?.trim() && !c.name.startsWith("mpdm-")) return c.name.trim();
    return "Grupo";
  }
  if (c.name?.trim()) return c.name.trim();
  return c.id;
}
