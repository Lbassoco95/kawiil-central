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

/**
 * Versión corta/ligera usada en mini-hilos: "hace 3 min", "hoy 14:30",
 * "ayer 18:47", "lun 09:15", "12 mar". Siempre devuelve ≤ 12 caracteres.
 */
export function formatSlackRelativeShort(ts: string): string {
  const d = slackTsToDate(ts);
  const now = Date.now();
  const diffMs = now - d.getTime();
  const sec = Math.max(0, Math.floor(diffMs / 1000));
  if (sec < 45) return "ahora";
  const min = Math.floor(sec / 60);
  if (min < 60) return `hace ${min} min`;
  if (isToday(d)) return `hoy ${format(d, "HH:mm", { locale: es })}`;
  if (isYesterday(d)) return `ayer ${format(d, "HH:mm", { locale: es })}`;
  if (isThisWeek(d, { weekStartsOn: 1 })) {
    return format(d, "EEE HH:mm", { locale: es });
  }
  return format(d, "d MMM", { locale: es });
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

/**
 * Mapa de aliases Slack → carácter Unicode.
 *
 * Cubre los emojis más usados en Slack incluidos los que la librería `node-emoji` (v2) NO resuelve
 * porque usa nombres CLDR ligeramente distintos (p. ej. `face_with_tears_of_joy` vs `joy`).
 * Primero se consulta este mapa; si falla, se cae a `node-emoji.get()` como fallback.
 */
export const SLACK_EMOJI: Record<string, string> = {
  // ---- Smileys & emociones ----
  grinning: "😀",
  smiley: "😃",
  smile: "😄",
  grin: "😁",
  laughing: "😆",
  satisfied: "😆",
  sweat_smile: "😅",
  rolling_on_the_floor_laughing: "🤣",
  rofl: "🤣",
  joy: "😂",
  face_with_tears_of_joy: "😂",
  slightly_smiling_face: "🙂",
  upside_down_face: "🙃",
  wink: "😉",
  blush: "😊",
  innocent: "😇",
  smiling_face_with_3_hearts: "🥰",
  heart_eyes: "😍",
  smiling_face_with_heart_eyes: "😍",
  star_struck: "🤩",
  kissing_heart: "😘",
  face_blowing_a_kiss: "😘",
  kissing: "😗",
  relaxed: "☺️",
  kissing_closed_eyes: "😚",
  kissing_smiling_eyes: "😙",
  yum: "😋",
  stuck_out_tongue: "😛",
  stuck_out_tongue_winking_eye: "😜",
  zany_face: "🤪",
  stuck_out_tongue_closed_eyes: "😝",
  money_mouth_face: "🤑",
  hugging_face: "🤗",
  hugs: "🤗",
  face_with_hand_over_mouth: "🤭",
  shushing_face: "🤫",
  thinking_face: "🤔",
  thinking: "🤔",
  zipper_mouth_face: "🤐",
  face_with_raised_eyebrow: "🤨",
  raised_eyebrow: "🤨",
  neutral_face: "😐",
  expressionless: "😑",
  no_mouth: "😶",
  smirk: "😏",
  unamused: "😒",
  rolling_eyes: "🙄",
  face_with_rolling_eyes: "🙄",
  grimacing: "😬",
  lying_face: "🤥",
  relieved: "😌",
  pensive: "😔",
  sleepy: "😪",
  drooling_face: "🤤",
  sleeping: "😴",
  mask: "😷",
  face_with_thermometer: "🤒",
  face_with_head_bandage: "🤕",
  nauseated_face: "🤢",
  face_vomiting: "🤮",
  sneezing_face: "🤧",
  hot_face: "🥵",
  cold_face: "🥶",
  woozy_face: "🥴",
  dizzy_face: "😵",
  exploding_head: "🤯",
  cowboy_hat_face: "🤠",
  partying_face: "🥳",
  sunglasses: "😎",
  nerd_face: "🤓",
  monocle_face: "🧐",
  confused: "😕",
  worried: "😟",
  slightly_frowning_face: "🙁",
  frowning_face: "☹️",
  open_mouth: "😮",
  hushed: "😯",
  astonished: "😲",
  flushed: "😳",
  pleading_face: "🥺",
  frowning: "😦",
  anguished: "😧",
  fearful: "😨",
  cold_sweat: "😰",
  disappointed_relieved: "😥",
  cry: "😢",
  sob: "😭",
  scream: "😱",
  confounded: "😖",
  persevere: "😣",
  disappointed: "😞",
  sweat: "😓",
  weary: "😩",
  tired_face: "😫",
  yawning_face: "🥱",
  triumph: "😤",
  pout: "😡",
  rage: "😡",
  angry: "😠",
  cursing_face: "🤬",
  smiling_imp: "😈",
  imp: "👿",
  skull: "💀",
  skull_and_crossbones: "☠️",
  hankey: "💩",
  poop: "💩",
  shit: "💩",
  clown_face: "🤡",
  japanese_ogre: "👹",
  japanese_goblin: "👺",
  ghost: "👻",
  alien: "👽",
  space_invader: "👾",
  robot_face: "🤖",
  robot: "🤖",

  // ---- Gestos / manos ----
  wave: "👋",
  raised_back_of_hand: "🤚",
  raised_hand: "✋",
  vulcan_salute: "🖖",
  ok_hand: "👌",
  pinched_fingers: "🤌",
  pinching_hand: "🤏",
  v: "✌️",
  crossed_fingers: "🤞",
  love_you_gesture: "🤟",
  metal: "🤘",
  call_me_hand: "🤙",
  point_left: "👈",
  point_right: "👉",
  point_up_2: "👆",
  middle_finger: "🖕",
  point_down: "👇",
  point_up: "☝️",
  thumbsup: "👍",
  "+1": "👍",
  thumbs_up: "👍",
  thumbsdown: "👎",
  "-1": "👎",
  thumbs_down: "👎",
  fist_raised: "✊",
  fist: "✊",
  facepunch: "👊",
  punch: "👊",
  fist_left: "🤛",
  fist_right: "🤜",
  clap: "👏",
  raised_hands: "🙌",
  open_hands: "👐",
  palms_up_together: "🤲",
  handshake: "🤝",
  pray: "🙏",
  writing_hand: "✍️",
  nail_care: "💅",
  selfie: "🤳",
  muscle: "💪",
  mechanical_arm: "🦾",
  leg: "🦵",
  mechanical_leg: "🦿",
  foot: "🦶",
  ear: "👂",
  ear_with_hearing_aid: "🦻",
  nose: "👃",
  brain: "🧠",
  tooth: "🦷",
  bone: "🦴",
  eyes: "👀",
  eye: "👁️",
  tongue: "👅",
  lips: "👄",

  // ---- Corazones ----
  red_heart: "❤️",
  heart: "❤️",
  orange_heart: "🧡",
  yellow_heart: "💛",
  green_heart: "💚",
  blue_heart: "💙",
  purple_heart: "💜",
  black_heart: "🖤",
  white_heart: "🤍",
  brown_heart: "🤎",
  broken_heart: "💔",
  heart_exclamation: "❣️",
  two_hearts: "💕",
  revolving_hearts: "💞",
  heartbeat: "💓",
  heartpulse: "💗",
  sparkling_heart: "💖",
  cupid: "💘",
  gift_heart: "💝",
  heart_decoration: "💟",

  // ---- Celebración / símbolos frecuentes ----
  tada: "🎉",
  party_popper: "🎉",
  confetti_ball: "🎊",
  balloon: "🎈",
  birthday: "🎂",
  gift: "🎁",
  fire: "🔥",
  "100": "💯",
  sparkles: "✨",
  star: "⭐",
  star2: "🌟",
  dizzy: "💫",
  boom: "💥",
  collision: "💥",
  zap: "⚡",
  sun_with_face: "🌞",
  sunny: "☀️",
  rainbow: "🌈",
  snowflake: "❄️",
  cloud: "☁️",
  droplet: "💧",
  sweat_drops: "💦",

  // ---- Señales / estado ----
  white_check_mark: "✅",
  heavy_check_mark: "✔️",
  ballot_box_with_check: "☑️",
  x: "❌",
  heavy_multiplication_x: "✖️",
  negative_squared_cross_mark: "❎",
  o: "⭕",
  warning: "⚠️",
  bangbang: "‼️",
  interrobang: "⁉️",
  question: "❓",
  grey_question: "❔",
  exclamation: "❗",
  heavy_exclamation_mark: "❗",
  grey_exclamation: "❕",
  no_entry: "⛔",
  no_entry_sign: "🚫",
  wheelchair: "♿",

  // ---- Flechas ----
  arrow_right: "➡️",
  arrow_left: "⬅️",
  arrow_up: "⬆️",
  arrow_down: "⬇️",
  arrow_upper_right: "↗️",
  arrow_lower_right: "↘️",
  arrow_upper_left: "↖️",
  arrow_lower_left: "↙️",
  arrow_right_hook: "↪️",
  leftwards_arrow_with_hook: "↩️",
  arrow_heading_up: "⤴️",
  arrow_heading_down: "⤵️",
  recycle: "♻️",

  // ---- Objetos comunes ----
  clipboard: "📋",
  memo: "📝",
  pencil2: "✏️",
  pushpin: "📌",
  paperclip: "📎",
  calendar: "📅",
  date: "📅",
  phone: "📞",
  telephone_receiver: "📞",
  email: "📧",
  envelope: "✉️",
  inbox_tray: "📥",
  outbox_tray: "📤",
  mailbox: "📫",
  package: "📦",
  link: "🔗",
  hourglass: "⌛",
  hourglass_flowing_sand: "⏳",
  clock: "🕐",
  alarm_clock: "⏰",
  stopwatch: "⏱️",
  timer_clock: "⏲️",
  coffee: "☕",
  tea: "🍵",
  beer: "🍺",
  beers: "🍻",
  wine_glass: "🍷",
  cocktail: "🍸",
  tropical_drink: "🍹",
  champagne: "🍾",
  clinking_glasses: "🥂",
  rocket: "🚀",
  airplane: "✈️",
  car: "🚗",
  truck: "🚚",
  speech_balloon: "💬",
  thought_balloon: "💭",
  bulb: "💡",
  gear: "⚙️",
  wrench: "🔧",
  hammer: "🔨",
  mag: "🔍",
  mag_right: "🔎",
  lock: "🔒",
  unlock: "🔓",
  key: "🔑",
  bell: "🔔",
  no_bell: "🔕",
  bookmark: "🔖",
  trophy: "🏆",
  medal_sports: "🏅",
  first_place_medal: "🥇",
  second_place_medal: "🥈",
  third_place_medal: "🥉",
  crown: "👑",
  dart: "🎯",
  chart_with_upwards_trend: "📈",
  chart_with_downwards_trend: "📉",
  bar_chart: "📊",
  moneybag: "💰",
  dollar: "💵",
  credit_card: "💳",
  receipt: "🧾",
  computer: "💻",
  desktop_computer: "🖥️",
  iphone: "📱",
  mobile_phone_off: "📴",
  keyboard: "⌨️",
  printer: "🖨️",
  floppy_disk: "💾",
  cd: "💿",
  dvd: "📀",
  camera: "📷",
  camera_flash: "📸",
  movie_camera: "🎥",
  film_strip: "🎞️",
  books: "📚",
  book: "📖",
  notebook: "📓",
  ledger: "📒",
  scroll: "📜",
  page_facing_up: "📄",
  page_with_curl: "📃",
  newspaper: "📰",
  pencil: "📝",

  // ---- Banderas / varios ----
  checkered_flag: "🏁",
  triangular_flag_on_post: "🚩",
  black_flag: "🏴",
  white_flag: "🏳️",
  rainbow_flag: "🏳️‍🌈",
  pirate_flag: "🏴‍☠️",
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
