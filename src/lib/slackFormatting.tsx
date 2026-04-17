import { Fragment, type ReactNode, createElement } from "react";
import { format, isToday, isYesterday, isThisWeek } from "date-fns";
import { es } from "date-fns/locale";
import { get as emojiGet } from "node-emoji";
import type { SlackUserProfile } from "@/hooks/useSlackUserProfiles";
import { cn } from "@/lib/utils";

/** Slack ts "sec.micro" → milliseconds */
export function slackTsToMs(ts: string): number {
  const [sec, micro = "0"] = ts.split(".");
  const s = parseInt(sec, 10);
  const frac = parseInt((micro + "000000").slice(0, 6), 10);
  if (Number.isNaN(s)) return Date.now();
  return s * 1000 + Math.floor(frac / 1000);
}

export function slackTsToDate(ts: string): Date {
  return new Date(slackTsToMs(ts));
}

export function formatSlackMessageTime(ts: string): string {
  const d = slackTsToDate(ts);
  const t = format(d, "HH:mm", { locale: es });
  if (isToday(d)) return t;
  if (isYesterday(d)) return `Ayer ${t}`;
  if (isThisWeek(d, { weekStartsOn: 1 })) {
    return format(d, "EEEE HH:mm", { locale: es });
  }
  return format(d, "d MMM yyyy, HH:mm", { locale: es });
}

export function formatSlackTooltipFull(ts: string): string {
  return format(slackTsToDate(ts), "EEEE, d 'de' MMMM yyyy 'a las' HH:mm:ss", { locale: es });
}

export function formatDaySeparatorLabel(ts: string): string {
  const d = slackTsToDate(ts);
  return format(d, "d 'de' MMMM yyyy", { locale: es });
}

export function sameSlackDay(a: string, b: string): boolean {
  const da = slackTsToDate(a);
  const db = slackTsToDate(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

export const SLACK_EMOJI: Record<string, string> = {
  thinking_face: "🤔",
  hugging_face: "🤗",
  rocket: "🚀",
  clipboard: "📋",
  pray: "🙏",
  fire: "🔥",
  white_check_mark: "✅",
  warning: "⚠️",
  eyes: "👀",
  thumbsup: "👍",
  "+1": "👍",
  tada: "🎉",
  smile: "😄",
  joy: "😂",
  heart: "❤️",
  clap: "👏",
  raised_hands: "🙌",
  muscle: "💪",
  point_right: "👉",
  point_left: "👈",
  speech_balloon: "💬",
  memo: "📝",
  calendar: "📅",
  phone: "📞",
  email: "📧",
  link: "🔗",
  hourglass: "⌛",
  coffee: "☕",
  question: "❓",
  exclamation: "❗",
  x: "❌",
  o: "⭕",
  bangbang: "‼️",
  interrobang: "⁉️",
  arrow_right: "➡️",
  arrow_left: "⬅️",
  arrow_up: "⬆️",
  arrow_down: "⬇️",
  ok_hand: "👌",
  wave: "👋",
  raised_hand: "✋",
  skull: "💀",
  ghost: "👻",
  robot_face: "🤖",
  gear: "⚙️",
  bulb: "💡",
  zap: "⚡",
  star: "⭐",
  sparkles: "✨",
};

/** Token `<:alias:id>` (emoji de workspace) → `:alias:` para el parser `:alias:`. */
export function normalizeSlackEmojiTokens(text: string): string {
  return text.replace(/<:([a-z0-9_+-]+):[0-9A-Za-z]+>/gi, ":$1:");
}

/** Alias sin dos puntos (p. ej. reacciones Slack) → carácter Unicode o `:alias:`. */
export function slackEmojiAliasToChar(alias: string): string {
  const k = alias.replace(/^:|:$/g, "").toLowerCase();
  if (SLACK_EMOJI[k]) return SLACK_EMOJI[k];
  const u = emojiGet(k);
  return u ?? `:${alias.replace(/^:|:$/g, "")}:`;
}

function displayNameForSlackUser(
  id: string,
  userMap: Record<string, SlackUserProfile | undefined>,
): string {
  const p = userMap[id];
  const n = p?.display_name || p?.real_name;
  return n?.trim() || id;
}

export function extractSlackUserIdsFromText(text: string): string[] {
  const re = /<@([UW][A-Z0-9]+)(?:\|[^>]+)?>/g;
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    out.push(m[1]);
  }
  return out;
}

export type FormatContext = {
  userMap: Record<string, SlackUserProfile | undefined>;
  onUserMentionClick?: (slackUserId: string) => void;
};

function replaceEmojiCodes(text: string): (string | ReactNode)[] {
  const src = normalizeSlackEmojiTokens(text);
  const re = /:([a-z0-9_+-]+):/gi;
  const parts: (string | ReactNode)[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(src)) !== null) {
    if (m.index > last) parts.push(src.slice(last, m.index));
    const alias = m[1].toLowerCase();
    const uni = SLACK_EMOJI[alias] ?? emojiGet(alias);
    if (uni) {
      parts.push(uni);
    } else {
      parts.push(
        <span
          key={`ce-${m.index}`}
          className="rounded bg-muted px-1 py-0.5 text-xs font-mono text-muted-foreground"
          title={`Emoji :${m[1]}:`}
        >
          :{m[1]}:
        </span>,
      );
    }
    last = m.index + m[0].length;
  }
  if (last < src.length) parts.push(src.slice(last));
  return parts.length ? parts : [src];
}

/** Texto sin `code` inline: *bold* _italic_ ~strike~ + emoji + menciones. */
function formatPlainRichChunk(chunk: string, ctx: FormatContext, keyBase: string): ReactNode[] {
  if (!chunk) return [];
  const out: ReactNode[] = [];
  let rest = chunk;
  let k = 0;
  while (rest.length > 0) {
    const tryStar = /^\*([^*]+)\*/.exec(rest);
    const tryUnder = /^_([^_]+)_/.exec(rest);
    const tryStrike = /^~([^~]+)~/.exec(rest);
    let len = 0;
    let node: ReactNode | null = null;
    if (tryStar && tryStar.index === 0) {
      len = tryStar[0].length;
      node = <strong key={`${keyBase}-${k++}`}>{tryStar[1]}</strong>;
    } else if (tryUnder && tryUnder.index === 0) {
      len = tryUnder[0].length;
      node = <em key={`${keyBase}-${k++}`}>{tryUnder[1]}</em>;
    } else if (tryStrike && tryStrike.index === 0) {
      len = tryStrike[0].length;
      node = (
        <span key={`${keyBase}-${k++}`} className="line-through">
          {tryStrike[1]}
        </span>
      );
    }
    if (node) {
      out.push(node);
      rest = rest.slice(len);
      continue;
    }
    const next = rest.search(/[*_~]/);
    // Si el siguiente formateo está justo en índice 0 pero no es un par válido (p. ej. "*"
    // suelto sin cierre), debemos avanzar al menos 1 carácter para evitar un bucle infinito
    // que sature la memoria del navegador.
    const advance = next === -1 ? rest.length : next === 0 ? 1 : next;
    const plain = rest.slice(0, advance);
    const em = replaceEmojiCodes(plain);
    for (const p of em) {
      if (typeof p === "string") {
        out.push(...parseMentionsAndLinks(p, ctx, `${keyBase}-em-${k++}`));
      } else {
        out.push(p);
      }
    }
    rest = rest.slice(advance);
  }
  return out;
}

function parseInlineSegment(segment: string, ctx: FormatContext, keyBase: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const codeRe = /`([^`]+)`/g;
  let last = 0;
  let m: RegExpExecArray | null;
  let ki = 0;
  while ((m = codeRe.exec(segment)) !== null) {
    if (m.index > last) {
      nodes.push(...formatPlainRichChunk(segment.slice(last, m.index), ctx, `${keyBase}-c-${ki++}`));
    }
    nodes.push(
      <code
        key={`${keyBase}-code-${m.index}`}
        className="rounded bg-muted px-1 py-0.5 text-[0.85em] font-mono"
      >
        {m[1]}
      </code>,
    );
    last = m.index + m[0].length;
  }
  if (last < segment.length) {
    nodes.push(...formatPlainRichChunk(segment.slice(last), ctx, `${keyBase}-end-${ki}`));
  }
  if (nodes.length === 0) {
    nodes.push(...formatPlainRichChunk(segment, ctx, `${keyBase}-all`));
  }
  return nodes;
}

function parseMentionsAndLinks(text: string, ctx: FormatContext, keyBase: string): ReactNode[] {
  const re =
    /(<@[UW][A-Z0-9]+(?:\|[^>]+)?>)|(<!(?:channel|here|everyone)(?:\|[^>]+)?>)|(<[^|>]+\|[^>]+>)|(<https?:\/\/[^>]+>)/g;
  const out: ReactNode[] = [];
  let last = 0;
  let m: RegExpExecArray | null;
  let k = 0;
  while ((m = re.exec(text)) !== null) {
    if (m.index > last) {
      out.push(
        <Fragment key={`${keyBase}-t-${k++}`}>{text.slice(last, m.index)}</Fragment>,
      );
    }
    const full = m[0];
    if (m[1]) {
      const um = /^<@([UW][A-Z0-9]+)(?:\|([^>]+))?>$/.exec(full);
      if (um) {
        const id = um[1];
        const label = um[2] || displayNameForSlackUser(id, ctx.userMap);
        out.push(
          <button
            key={`${keyBase}-u-${m.index}`}
            type="button"
            className={cn(
              "inline rounded bg-sky-500/15 px-1 py-0.5 text-sky-700 dark:text-sky-300 font-medium text-sm align-baseline",
              ctx.onUserMentionClick && "cursor-pointer hover:bg-sky-500/25",
            )}
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              ctx.onUserMentionClick?.(id);
            }}
          >
            @{label}
          </button>,
        );
      }
    } else if (m[2]) {
      const special = full.replace(/[<>|]/g, " ").split(/\s+/).filter(Boolean);
      const kind = special[1]?.replace("!", "") || "channel";
      out.push(
        <span
          key={`${keyBase}-s-${m.index}`}
          className="inline rounded bg-violet-500/15 px-1 py-0.5 text-violet-700 dark:text-violet-300 font-medium text-sm"
        >
          @{kind}
        </span>,
      );
    } else if (m[3]) {
      const linkm = /^<([^|>]+)\|([^>]+)>$/.exec(full);
      if (linkm) {
        out.push(
          <a
            key={`${keyBase}-l-${m.index}`}
            href={linkm[1]}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2"
          >
            {linkm[2]}
          </a>,
        );
      }
    } else if (m[4]) {
      const url = full.slice(1, -1);
      out.push(
        <a
          key={`${keyBase}-u2-${m.index}`}
          href={url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-primary underline underline-offset-2 break-all"
        >
          {url}
        </a>,
      );
    }
    last = m.index + full.length;
  }
  if (last < text.length) {
    out.push(<Fragment key={`${keyBase}-end-${k}`}>{text.slice(last)}</Fragment>);
  }
  return out.length ? out : [<Fragment key={keyBase}>{text}</Fragment>];
}

/** Slack mrkdwn → React (subset). */
export function slackMrkdwnToReact(text: string | undefined, ctx: FormatContext): ReactNode {
  if (!text?.trim()) return null;
  const lines = normalizeSlackEmojiTokens(text).split("\n");
  const blocks: ReactNode[] = [];
  let i = 0;
  let bi = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.startsWith("```")) {
      const lang = line.slice(3).trim();
      const body: string[] = [];
      i++;
      while (i < lines.length && !lines[i].startsWith("```")) {
        body.push(lines[i]);
        i++;
      }
      if (i < lines.length) i++;
      blocks.push(
        <pre
          key={`blk-${bi++}`}
          className="my-1 overflow-x-auto rounded-lg bg-muted p-2 text-xs font-mono"
        >
          {lang ? <span className="text-muted-foreground block mb-1">{lang}</span> : null}
          {body.join("\n")}
        </pre>,
      );
      continue;
    }
    if (line.startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].startsWith(">")) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      blocks.push(
        <blockquote
          key={`blk-${bi++}`}
          className="my-1 border-l-2 border-primary/40 pl-3 text-muted-foreground italic"
        >
          <span className="inline-flex flex-col gap-0.5">
            {parseInlineSegment(quoteLines.join("\n"), ctx, `quote-${bi}`)}
          </span>
        </blockquote>,
      );
      continue;
    }
    const para: string[] = [];
    while (
      i < lines.length &&
      !lines[i].startsWith("```") &&
      !lines[i].startsWith(">")
    ) {
      para.push(lines[i]);
      i++;
    }
    const joined = para.join("\n");
    if (joined.trim()) {
      blocks.push(
        <p key={`blk-${bi++}`} className="my-0.5 whitespace-pre-wrap break-words leading-relaxed">
          {parseInlineSegment(joined, ctx, `p-${bi}`)}
        </p>,
      );
    }
  }
  return createElement(Fragment, null, ...blocks);
}

const SYSTEM_SUBTYPES = new Set([
  "channel_join",
  "channel_leave",
  "channel_topic",
  "channel_purpose",
  "channel_name",
  "channel_archive",
  "channel_unarchive",
  "pinned_item",
  "unpinned_item",
  "message_changed",
  "message_deleted",
]);

export function isSlackSystemSubtype(subtype: string | undefined): boolean {
  if (!subtype) return false;
  return SYSTEM_SUBTYPES.has(subtype);
}

export function slackSystemMessageLabel(m: { subtype?: string; text?: string; user?: string }): string {
  const t = m.text?.trim();
  if (t) return t;
  switch (m.subtype) {
    case "channel_join":
      return "Alguien se unió al canal";
    case "channel_leave":
      return "Alguien salió del canal";
    case "channel_topic":
      return "Se actualizó el tema del canal";
    case "channel_purpose":
      return "Se actualizó la descripción del canal";
    case "channel_name":
      return "Se cambió el nombre del canal";
    default:
      return "Evento del canal";
  }
}
