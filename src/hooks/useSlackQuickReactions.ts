import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { invokeSlackApi } from "@/lib/slackApi";
import {
  resolveSlackQuickReactions,
  type ResolvedSlackQuickReactions,
  type SlackQuickReactionsPayload,
} from "@/lib/slackQuickReactions";

const SESSION_KEY = "kawiil.slack.quickReactions.v1";

function readSession(): ResolvedSlackQuickReactions | undefined {
  if (typeof sessionStorage === "undefined") return undefined;
  try {
    const raw = sessionStorage.getItem(SESSION_KEY);
    if (!raw) return undefined;
    const parsed = JSON.parse(raw) as ResolvedSlackQuickReactions;
    if (!parsed || !Array.isArray(parsed.quick) || !Array.isArray(parsed.frequent)) return undefined;
    return parsed;
  } catch {
    return undefined;
  }
}

function writeSession(value: ResolvedSlackQuickReactions) {
  if (typeof sessionStorage === "undefined") return;
  try {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(value));
  } catch {
    /* la sesión sigue en memoria */
  }
}

/** Las tres reacciones del hover y los emojis frecuentes, como los tiene esta persona en Slack. */
export function useSlackQuickReactions(): ResolvedSlackQuickReactions {
  const cached = useMemo(() => readSession(), []);
  const query = useQuery({
    queryKey: ["slack-quick-reactions"],
    staleTime: 10 * 60_000,
    gcTime: 60 * 60_000,
    placeholderData: cached,
    queryFn: async () => {
      try {
        const data = await invokeSlackApi<SlackQuickReactionsPayload>(
          { action: "users.prefs.quickReactions" },
          { timeoutMs: 12_000 },
        );
        const resolved = resolveSlackQuickReactions(data);
        writeSession(resolved);
        return resolved;
      } catch {
        return cached ?? resolveSlackQuickReactions(null);
      }
    },
  });
  return query.data ?? cached ?? resolveSlackQuickReactions(null);
}
