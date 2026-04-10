import { invokeSlackApi, type SlackConversation } from "@/lib/slackApi";

const CONV_PAGE_LIMIT = 1000;
const MAX_CONV_PAGES = 60;

/** Recorre `conversations.list` con cursor hasta agotar resultados (evita perder MPIM / canales fuera de la primera página). */
export async function fetchAllSlackConversations(): Promise<SlackConversation[]> {
  const out: SlackConversation[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;

  for (let page = 0; page < MAX_CONV_PAGES; page++) {
    const data = await invokeSlackApi<{
      ok: boolean;
      channels?: SlackConversation[];
      error?: string;
      response_metadata?: { next_cursor?: string };
    }>({
      action: "conversations.list",
      types: "public_channel,private_channel,mpim,im",
      limit: CONV_PAGE_LIMIT,
      cursor,
    });
    if (!data.ok) throw new Error(data.error || "No se pudieron cargar conversaciones");
    for (const c of data.channels || []) {
      if (c?.id && !seen.has(c.id)) {
        seen.add(c.id);
        out.push(c);
      }
    }
    const next = data.response_metadata?.next_cursor?.trim();
    if (!next) break;
    cursor = next;
  }
  return out;
}

export type SlackWorkspaceUserRow = {
  id: string;
  label: string;
  subtitle?: string;
};

const USERS_PAGE_LIMIT = 200;
const MAX_USER_PAGES = 50;

/** Lista miembros del workspace (paginado) para elegir destinatario de DM. */
export async function fetchAllSlackWorkspaceUsers(): Promise<SlackWorkspaceUserRow[]> {
  const rows: SlackWorkspaceUserRow[] = [];
  const seen = new Set<string>();
  let cursor: string | undefined;

  for (let page = 0; page < MAX_USER_PAGES; page++) {
    const data = await invokeSlackApi<{
      ok: boolean;
      members?: Array<{
        id: string;
        name?: string;
        deleted?: boolean;
        is_bot?: boolean;
        is_stranger?: boolean;
        profile?: { display_name?: string; real_name?: string; email?: string };
        real_name?: string;
      }>;
      error?: string;
      response_metadata?: { next_cursor?: string };
    }>({
      action: "users.list",
      limit: USERS_PAGE_LIMIT,
      cursor,
    });
    if (!data.ok) throw new Error(data.error || "No se pudieron cargar usuarios");
    for (const m of data.members || []) {
      if (!m?.id || seen.has(m.id)) continue;
      if (m.deleted || m.is_bot) continue;
      seen.add(m.id);
      const dn = m.profile?.display_name?.trim();
      const rn = (m.profile?.real_name || m.real_name)?.trim();
      const nm = m.name?.trim();
      const label = dn || rn || nm || m.id;
      const email = m.profile?.email?.trim();
      rows.push({
        id: m.id,
        label,
        subtitle: email || (nm && nm !== label ? `@${nm}` : undefined),
      });
    }
    const next = data.response_metadata?.next_cursor?.trim();
    if (!next) break;
    cursor = next;
  }
  rows.sort((a, b) => a.label.localeCompare(b.label, "es", { sensitivity: "base" }));
  return rows;
}
