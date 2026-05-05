import { invokeSlackApi, type SlackConversation } from "@/lib/slackApi";

const CONV_PAGE_LIMIT = 1000;
/** Cota de páginas Slack (1000 conversaciones/página) antes de parar; alineada con el edge. */
export const MAX_SLACK_CONV_LIST_PAGES = 60;
const MAX_CONV_PAGES = MAX_SLACK_CONV_LIST_PAGES;

/** Margen sobre el abort del cliente hacia Slack (~ Edge 25 s) por página. */
export const SLACK_CONV_LIST_TIMEOUT_MS = 32_000;

/** Páginas iniciales antes de cargar el resto en segundo plano (Comunicación). */
export const SLACK_CONV_BOOTSTRAP_PAGES = 4;

const SLACK_CONV_CACHE_PREFIX = "kawiil-slack-conv:";
const SLACK_CONV_CACHE_TTL_MS = 5 * 60 * 1000;

type CachedConversationsPayload = { updatedAt: number; conversations: SlackConversation[] };

/** Cache de sesión para mostrar el sidebar al instante mientras React Query revalida. */
export function loadCachedSlackConversations(
  connectionId: string | null | undefined,
): SlackConversation[] | undefined {
  if (typeof sessionStorage === "undefined" || !connectionId) return undefined;
  try {
    const raw = sessionStorage.getItem(SLACK_CONV_CACHE_PREFIX + connectionId);
    if (!raw) return undefined;
    const p = JSON.parse(raw) as CachedConversationsPayload;
    if (!p?.updatedAt || !Array.isArray(p.conversations)) return undefined;
    if (Date.now() - p.updatedAt > SLACK_CONV_CACHE_TTL_MS) return undefined;
    return p.conversations;
  } catch {
    return undefined;
  }
}

function saveCachedSlackConversations(connectionId: string, conversations: SlackConversation[]): void {
  if (typeof sessionStorage === "undefined") return;
  try {
    const payload: CachedConversationsPayload = {
      updatedAt: Date.now(),
      conversations,
    };
    sessionStorage.setItem(SLACK_CONV_CACHE_PREFIX + connectionId, JSON.stringify(payload));
  } catch {
    /* quota / modo privado */
  }
}

export type FetchSlackConversationsPagedOpts = {
  /** Continuación: cursor tras la última página. Omitir en la primera tanda. */
  startCursor?: string;
  seedConversations?: SlackConversation[];
  maxPages: number;
  timeoutMs?: number;
  /** Si existe, persistir snapshot en sesión al terminar esta tanda (parcial o completo). */
  cacheConnectionId?: string;
};

export type FetchSlackConversationsPagedResult = {
  conversations: SlackConversation[];
  /** Solo si `complete` es false. */
  nextCursor?: string;
  complete: boolean;
};

/**
 * Obtiene hasta `maxPages` de `conversations.list`; corta ante fin de cursores en Slack.
 */
export async function fetchSlackConversationsPaged(
  opts: FetchSlackConversationsPagedOpts,
): Promise<FetchSlackConversationsPagedResult> {
  const timeoutMs = opts.timeoutMs ?? SLACK_CONV_LIST_TIMEOUT_MS;
  const maxPages = Math.max(1, Math.min(MAX_CONV_PAGES, opts.maxPages));
  const seed = opts.seedConversations ?? [];
  const out: SlackConversation[] = [...seed];
  const seen = new Set<string>();
  for (const c of out) {
    if (c?.id) seen.add(c.id);
  }
  let cursor: string | undefined = opts.startCursor?.trim() || undefined;

  for (let page = 0; page < maxPages; page++) {
    const data = await invokeSlackApi<{
      ok: boolean;
      channels?: SlackConversation[];
      error?: string;
      response_metadata?: { next_cursor?: string };
    }>(
      {
        action: "conversations.list",
        types: "public_channel,private_channel,mpim,im",
        limit: CONV_PAGE_LIMIT,
        cursor,
      },
      { timeoutMs },
    );

    if (!data.ok) throw new Error(data.error || "No se pudieron cargar conversaciones");

    for (const c of data.channels || []) {
      if (c?.id && !seen.has(c.id)) {
        seen.add(c.id);
        out.push(c);
      }
    }

    const nextCursor = data.response_metadata?.next_cursor?.trim() || undefined;
    if (!nextCursor) {
      if (opts.cacheConnectionId) {
        saveCachedSlackConversations(opts.cacheConnectionId, out);
      }
      return { conversations: out, complete: true, nextCursor: undefined };
    }

    cursor = nextCursor;
  }

  if (opts.cacheConnectionId) {
    saveCachedSlackConversations(opts.cacheConnectionId, out);
  }
  return {
    conversations: out,
    complete: false,
    nextCursor: cursor,
  };
}

export type FetchAllSlackConversationsOpts = {
  cacheConnectionId?: string;
  maxPages?: number;
  timeoutMs?: number;
  startCursor?: string;
  seedConversations?: SlackConversation[];
};

/**
 * Recorre `conversations.list` hasta agotar Slack o llegar al tope `maxPages` (default 60).
 */
export async function fetchAllSlackConversations(
  opts?: FetchAllSlackConversationsOpts,
): Promise<SlackConversation[]> {
  const r = await fetchSlackConversationsPaged({
    cacheConnectionId: opts?.cacheConnectionId,
    maxPages: opts?.maxPages ?? MAX_CONV_PAGES,
    timeoutMs: opts?.timeoutMs ?? SLACK_CONV_LIST_TIMEOUT_MS,
    startCursor: opts?.startCursor,
    seedConversations: opts?.seedConversations,
  });
  return r.conversations;
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
    }>(
      {
        action: "users.list",
        limit: USERS_PAGE_LIMIT,
        cursor,
      },
      { timeoutMs: SLACK_CONV_LIST_TIMEOUT_MS },
    );
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
