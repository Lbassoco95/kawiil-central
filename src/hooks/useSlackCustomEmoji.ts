import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { invokeSlackApi } from "@/lib/slackApi";
import type { SlackCustomEmojiMap } from "@/lib/slackFormatting";

const CACHE_KEY = "kawiil.slack.customEmoji.v1";
const STALE_MS = 15 * 60 * 1000;
const EMPTY_EMOJI: SlackCustomEmojiMap = {};

type EmojiListResponse = {
  ok?: boolean;
  error?: string;
  emoji?: Record<string, string>;
};

type EmojiCache = {
  at: number;
  emoji: SlackCustomEmojiMap;
};

/** Sigue `alias:otro` hasta una URL https. Ignora ciclos. */
export function normalizeSlackCustomEmoji(raw: Record<string, string> | null | undefined): SlackCustomEmojiMap {
  if (!raw) return {};
  const lower: Record<string, string> = {};
  for (const [name, value] of Object.entries(raw)) {
    if (typeof value === "string" && value.trim()) lower[name.toLowerCase()] = value.trim();
  }
  const out: SlackCustomEmojiMap = {};
  for (const name of Object.keys(lower)) {
    const seen = new Set<string>();
    let current = name;
    let url: string | null = null;
    for (let hop = 0; hop < 6; hop++) {
      if (seen.has(current)) break;
      seen.add(current);
      const value = lower[current];
      if (!value) break;
      if (/^alias:/i.test(value)) {
        current = value.slice(6).trim().toLowerCase();
        continue;
      }
      if (/^https?:\/\//i.test(value)) url = value;
      break;
    }
    if (url) out[name] = url;
  }
  return out;
}

function readEmojiCache(): EmojiCache | null {
  try {
    const raw = localStorage.getItem(CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as EmojiCache;
    if (!parsed?.emoji || typeof parsed.emoji !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writeEmojiCache(emoji: SlackCustomEmojiMap) {
  try {
    const payload: EmojiCache = { at: Date.now(), emoji };
    localStorage.setItem(CACHE_KEY, JSON.stringify(payload));
  } catch {
    /* quota */
  }
}

export const SLACK_CUSTOM_EMOJI_QUERY_KEY = ["slack-custom-emoji"] as const;

/**
 * Emojis subidos al workspace de Slack (`emoji.list`).
 * Hace falta el scope de usuario `emoji:read` (se pide al actualizar permisos).
 */
export function useSlackCustomEmoji(enabled = true) {
  const cached = useMemo(() => readEmojiCache(), []);
  const query = useQuery({
    queryKey: SLACK_CUSTOM_EMOJI_QUERY_KEY,
    enabled,
    staleTime: STALE_MS,
    retry: (count, error) => {
      const message = error instanceof Error ? error.message : "";
      if (message.includes("missing_scope")) return false;
      return count < 1;
    },
    queryFn: async () => {
      const data = await invokeSlackApi<EmojiListResponse>({ action: "emoji.list" });
      if (!data.ok) {
        throw new Error(data.error || "No se pudieron leer los emojis de Slack");
      }
      const emoji = normalizeSlackCustomEmoji(data.emoji);
      writeEmojiCache(emoji);
      return emoji;
    },
  });

  const emoji = query.data ?? cached?.emoji ?? EMPTY_EMOJI;
  return { ...query, emoji };
}
