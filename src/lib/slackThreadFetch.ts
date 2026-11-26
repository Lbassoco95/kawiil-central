import type { QueryClient } from "@tanstack/react-query";
import { invokeSlackApi, type SlackMessage } from "@/lib/slackApi";
import { mergeThreadMessages, saveSlackThreadCache } from "@/lib/slackThreadCache";

export function slackThreadQueryKey(channelId: string, threadTs: string): string[] {
  return ["slack-thread-v2", channelId, threadTs];
}

type ThreadPageResponse = {
  ok?: boolean;
  error?: string;
  messages?: SlackMessage[];
  has_more?: boolean;
  response_metadata?: { next_cursor?: string };
};

const pendingCursors = new Map<string, string>();
const filling = new Set<string>();

function threadId(channelId: string, threadTs: string) {
  return `${channelId}\n${threadTs}`;
}

/**
 * Primera página del hilo. Con `replyCount` pide justo esas respuestas,
 * para no recorrer el hilo entero antes de pintar.
 */
export async function fetchSlackThreadFirstPage(
  channelId: string,
  threadTs: string,
  replyCount?: number,
): Promise<SlackMessage[]> {
  const known = replyCount && replyCount > 0 ? replyCount : 0;
  const limit = known > 0 ? Math.min(100, known + 1) : 40;
  const data = await invokeSlackApi<ThreadPageResponse>(
    {
      action: "conversations.replies",
      channel: channelId,
      ts: threadTs,
      limit,
      single_page: true,
    },
    { timeoutMs: 18_000 },
  );
  if (!data.ok) throw new Error(data.error || "No se pudo cargar el hilo");
  const messages = data.messages ?? [];
  const cursor = data.has_more ? data.response_metadata?.next_cursor?.trim() || undefined : undefined;
  const id = threadId(channelId, threadTs);
  if (!cursor) {
    pendingCursors.delete(id);
    if (messages.length > 0) saveSlackThreadCache(channelId, threadTs, messages);
  } else {
    pendingCursors.set(id, cursor);
  }
  return messages;
}

/**
 * Si la primera página no alcanzó, sigue en segundo plano y va sumando
 * respuestas al hilo que ya está en pantalla.
 */
export function continueSlackThreadInBackground(
  qc: QueryClient,
  channelId: string,
  threadTs: string,
): void {
  const id = threadId(channelId, threadTs);
  const cursor = pendingCursors.get(id);
  if (!cursor || filling.has(id)) return;
  filling.add(id);
  const key = slackThreadQueryKey(channelId, threadTs);
  void (async () => {
    let next: string | undefined = cursor;
    let guard = 0;
    try {
      while (next && guard < 12) {
        guard += 1;
        const page = await invokeSlackApi<ThreadPageResponse>(
          {
            action: "conversations.replies",
            channel: channelId,
            ts: threadTs,
            cursor: next,
            limit: 100,
            single_page: true,
          },
          { timeoutMs: 18_000 },
        );
        if (!page.ok) break;
        const incoming = page.messages ?? [];
        qc.setQueryData<SlackMessage[]>(key, (current) => mergeThreadMessages(current ?? [], incoming));
        next = page.has_more ? page.response_metadata?.next_cursor?.trim() || undefined : undefined;
      }
      const done = qc.getQueryData<SlackMessage[]>(key);
      if (done && done.length > 0) saveSlackThreadCache(channelId, threadTs, done);
    } catch {
      /* la primera página ya está visible */
    } finally {
      pendingCursors.delete(id);
      filling.delete(id);
    }
  })();
}
