/**
 * Reacciones de un clic al pasar el cursor, como en Slack
 * (Preferencias → Mensajes y archivos → Emoji).
 *
 * Slack guarda, por usuario:
 * - show_quick_reactions
 * - user_customized_quick_reactions_use_frequently_used_emoji
 * - user_customized_quick_reactions_emoji_1..3
 * - emoji_use (conteo de uso)
 * - preferred_skin_tone
 * y, si la persona no personalizó, las tres del workspace
 * (admin_customized_quick_reactions; por defecto ✅ 👀 🙌).
 */

export const SLACK_WORKSPACE_DEFAULT_QUICK_REACTIONS = [
  "white_check_mark",
  "eyes",
  "raised_hands",
] as const;

/** Emojis a los que Slack les aplica el tono de piel preferido. */
const SKIN_TONE_BASES = new Set([
  "+1",
  "-1",
  "thumbsup",
  "thumbsdown",
  "clap",
  "pray",
  "wave",
  "muscle",
  "point_up",
  "point_up_2",
  "point_down",
  "point_left",
  "point_right",
  "ok_hand",
  "v",
  "raised_hands",
  "raised_hand",
  "hand",
  "open_hands",
  "palms_up_together",
  "heart_hands",
  "fist",
  "punch",
  "facepunch",
  "writing_hand",
  "call_me_hand",
  "love_you_gesture",
  "metal",
  "crossed_fingers",
  "pinched_fingers",
  "pinching_hand",
  "handshake",
  "vulcan_salute",
]);

const EMOJI_NAME = /^[a-z0-9_+-]{1,100}(?:::skin-tone-[2-6])?$/i;

export type SlackQuickReactionsPayload = {
  ok?: boolean;
  error?: string;
  show_quick_reactions?: boolean;
  use_frequently_used?: boolean;
  has_customized?: boolean;
  emoji_1?: unknown;
  emoji_2?: unknown;
  emoji_3?: unknown;
  preferred_skin_tone?: unknown;
  emoji_use?: unknown;
  workspace_defaults?: unknown;
};

export type ResolvedSlackQuickReactions = {
  /** Casilla «Mostrar reacciones de un clic» de Slack. */
  enabled: boolean;
  /** Hasta tres emojis del hover, en el orden de Slack. */
  quick: string[];
  /** Los más usados, para abrir el selector con los mismos que Slack. */
  frequent: string[];
};

export function slackReactionNamesMatch(a: string, b: string): boolean {
  const left = reactionIdentity(a);
  const right = reactionIdentity(b);
  if (!left.base || !right.base || left.base !== right.base) return false;
  if (left.skin && right.skin && left.skin !== right.skin) return false;
  return true;
}

export function resolveSlackQuickReactions(
  payload: SlackQuickReactionsPayload | null | undefined,
): ResolvedSlackQuickReactions {
  const defaults = padThree(readNameList(payload?.workspace_defaults), [
    ...SLACK_WORKSPACE_DEFAULT_QUICK_REACTIONS,
  ]);
  const tone = readSkinTone(payload?.preferred_skin_tone);
  const paint = (name: string) => applyPreferredSkinTone(name, tone);

  if (!payload || payload.ok === false) {
    const quick = defaults.map(paint);
    return { enabled: true, quick, frequent: quick };
  }

  const slots = [payload.emoji_1, payload.emoji_2, payload.emoji_3]
    .map(readEmojiName)
    .filter((name): name is string => !!name);
  const frequentRaw = topEmojiNames(payload.emoji_use, 16);
  const enabled = payload.show_quick_reactions !== false;

  let quickSource: string[];
  if (payload.use_frequently_used) {
    quickSource = padThree(frequentRaw, slots.length ? slots : defaults);
  } else if (payload.has_customized || slots.length > 0) {
    quickSource = padThree(slots, defaults);
  } else {
    quickSource = defaults;
  }

  const quick = enabled ? quickSource.map(paint) : [];
  const frequent = (frequentRaw.length ? frequentRaw : quickSource).slice(0, 16).map(paint);
  return { enabled, quick, frequent };
}

function reactionIdentity(name: string): { base: string; skin: string | null } {
  const clean = name.replace(/^:|:$/g, "").trim().toLowerCase();
  const [rawBase, skin] = clean.split("::");
  const base = rawBase === "thumbsup" ? "+1" : rawBase === "thumbsdown" ? "-1" : rawBase;
  return { base, skin: skin?.startsWith("skin-tone-") ? skin : null };
}

function readEmojiName(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const name = value.trim().replace(/^:|:$/g, "");
  if (!EMOJI_NAME.test(name)) return null;
  return name;
}

function readNameList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const item of value) {
    const name = readEmojiName(item);
    if (name) out.push(name);
  }
  return out;
}

function readSkinTone(value: unknown): string | null {
  const raw = typeof value === "number" ? String(value) : typeof value === "string" ? value.trim() : "";
  const match = /^(?:skin-tone-)?([2-6])$/.exec(raw);
  return match ? match[1] : null;
}

function applyPreferredSkinTone(name: string, tone: string | null): string {
  if (!tone || name.includes("::")) return name;
  const base = name.split("::")[0]?.toLowerCase() ?? "";
  if (!SKIN_TONE_BASES.has(base)) return name;
  return `${name}::skin-tone-${tone}`;
}

function padThree(primary: string[], filler: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  const push = (name: string) => {
    const key = reactionIdentity(name).base + (reactionIdentity(name).skin ?? "");
    if (seen.has(key)) return;
    seen.add(key);
    out.push(name);
  };
  for (const name of primary) push(name);
  for (const name of filler) {
    if (out.length >= 3) break;
    push(name);
  }
  return out.slice(0, 3);
}

function topEmojiNames(raw: unknown, limit: number): string[] {
  let value = raw;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return [];
    }
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const rows: Array<{ name: string; count: number }> = [];
  for (const [key, count] of Object.entries(value as Record<string, unknown>)) {
    const name = readEmojiName(key);
    const n = typeof count === "number" ? count : Number(count);
    if (!name || !Number.isFinite(n) || n <= 0) continue;
    rows.push({ name, count: n });
  }
  rows.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
  return rows.slice(0, limit).map((row) => row.name);
}
