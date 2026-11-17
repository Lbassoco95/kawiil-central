import { Fragment, type ReactNode, createElement } from "react";
import { format, isToday, isYesterday, isThisWeek } from "date-fns";
import { es } from "date-fns/locale";
import { nameToEmoji } from "gemoji";
import unicodeByEmoji from "unicode-emoji-json/data-by-emoji.json";
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
 * Alias de Slack que no coinciden con el slug Unicode ni con gemoji
 * (p. ej. `hugging_face`, `knife_fork_plate`). El catálogo vigente los completa.
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

  // Alias de Slack que gemoji nombra distinto
  knife_fork_plate: "🍽️",
  plate_with_cutlery: "🍽️",
  scales: "⚖️",
  balance_scale: "⚖️",
};


/** URLs de emojis personalizados del workspace (`emoji.list`), con alias ya resueltos. */
export type SlackCustomEmojiMap = Record<string, string>;

export type ResolvedSlackEmoji =
  | { kind: "unicode"; char: string }
  | { kind: "image"; url: string; name: string }
  | { kind: "unknown"; name: string };

const SKIN_TONE: Record<string, string> = {
  "skin-tone-2": "\u{1F3FB}",
  "skin-tone-3": "\u{1F3FC}",
  "skin-tone-4": "\u{1F3FD}",
  "skin-tone-5": "\u{1F3FE}",
  "skin-tone-6": "\u{1F3FF}",
};

type UnicodeEmojiMeta = { slug?: string };

type EmojiIndex = {
  byName: Map<string, string>;
  search: { name: string; emoji: string }[];
};

/**
 * Catálogo: alias manuales de Slack, Unicode reciente (slug) y nombres cortos de
 * gemoji (los que usa Slack). Gemoji pisa el resto para quedarnos con el glifo vigente.
 * También se indexa el nombre sin guiones bajos (`:shushingface:` → 🤫).
 */
function buildEmojiIndex(extra: Record<string, string>): EmojiIndex {
  const byName = new Map<string, string>();
  const search: { name: string; emoji: string }[] = [];
  const seenSearch = new Set<string>();

  const claim = (name: string, emoji: string, overwrite = false) => {
    const key = name.trim().toLowerCase();
    if (!key || !emoji) return;
    if (!overwrite && byName.has(key)) return;
    byName.set(key, emoji);
  };
  const addSearch = (name: string, emoji: string) => {
    const key = name.trim().toLowerCase();
    if (!key || !emoji || seenSearch.has(key)) return;
    seenSearch.add(key);
    search.push({ name: key, emoji });
  };

  for (const [name, emoji] of Object.entries(extra)) claim(name, emoji, false);

  const unicode = unicodeByEmoji as Record<string, UnicodeEmojiMeta>;
  for (const [emoji, meta] of Object.entries(unicode)) {
    if (meta?.slug) claim(meta.slug, emoji, false);
  }

  for (const [name, emoji] of Object.entries(nameToEmoji)) {
    claim(name, emoji, true);
    addSearch(name, emoji);
  }

  for (const [emoji, meta] of Object.entries(unicode)) {
    if (meta?.slug) addSearch(meta.slug, emoji);
  }

  for (const [name, emoji] of [...byName.entries()]) {
    const flat = name.replace(/_/g, "");
    if (flat !== name) claim(flat, emoji, false);
  }

  for (const [name, emoji] of Object.entries(SKIN_TONE)) claim(name, emoji, true);

  return { byName, search };
}

const EMOJI_INDEX = buildEmojiIndex(SLACK_EMOJI);

export type SlackEmojiSuggestion = {
  name: string;
  emoji?: string;
  url?: string;
};

export function resolveSlackEmoji(alias: string, custom?: SlackCustomEmojiMap): ResolvedSlackEmoji {
  const raw = alias.replace(/^:|:$/g, "").trim().toLowerCase();
  if (!raw) return { kind: "unknown", name: alias };
  const skinSep = raw.indexOf("::");
  const name = skinSep >= 0 ? raw.slice(0, skinSep) : raw;
  const skinPart = skinSep >= 0 ? raw.slice(skinSep + 2) : "";
  const url = custom?.[name];
  if (url && /^https?:\/\//i.test(url)) return { kind: "image", url, name };
  const char = EMOJI_INDEX.byName.get(name);
  if (char) {
    const tone = /^skin-tone-([2-6])$/.exec(skinPart);
    const modifier = tone ? EMOJI_INDEX.byName.get(`skin-tone-${tone[1]}`) : undefined;
    if (modifier) return { kind: "unicode", char: char + modifier };
    return { kind: "unicode", char };
  }
  return { kind: "unknown", name };
}

/** Nombres estándar buscables (Slack/GitHub + Unicode que gemoji todavía no trae). */
export function listStandardSlackEmoji(): { name: string; emoji: string }[] {
  return EMOJI_INDEX.search;
}

function rankEmojiName(name: string, query: string): number {
  if (name === query) return 0;
  if (name.startsWith(query)) return 1;
  return 2;
}

export function searchSlackEmoji(
  query: string,
  custom?: SlackCustomEmojiMap,
  limit = 8,
): SlackEmojiSuggestion[] {
  const q = query.toLowerCase().replace(/:/g, "").trim();
  if (!q) return [];
  const out: SlackEmojiSuggestion[] = [];
  const seen = new Set<string>();
  const push = (item: SlackEmojiSuggestion) => {
    if (seen.has(item.name) || out.length >= limit) return;
    seen.add(item.name);
    out.push(item);
  };

  if (custom) {
    const customHits = Object.keys(custom).filter((name) => name.includes(q));
    customHits.sort((a, b) => rankEmojiName(a, q) - rankEmojiName(b, q) || a.localeCompare(b));
    for (const name of customHits) push({ name, url: custom[name] });
  }

  if (out.length < limit) {
    const hits = EMOJI_INDEX.search.filter((entry) => entry.name.includes(q));
    hits.sort(
      (a, b) => rankEmojiName(a.name, q) - rankEmojiName(b.name, q) || a.name.localeCompare(b.name),
    );
    for (const hit of hits) {
      push({ name: hit.name, emoji: hit.emoji });
      if (out.length >= limit) break;
    }
  }
  return out;
}

export function slackEmojiToReact(alias: string, custom?: SlackCustomEmojiMap, key?: string): ReactNode {
  const resolved = resolveSlackEmoji(alias, custom);
  if (resolved.kind === "image") {
    return (
      <img
        key={key}
        src={resolved.url}
        alt={`:${resolved.name}:`}
        title={`:${resolved.name}:`}
        className="sl-emoji-custom"
        loading="lazy"
        draggable={false}
      />
    );
  }
  if (resolved.kind === "unicode") {
    return (
      <span key={key} className="sl-emoji">
        {resolved.char}
      </span>
    );
  }
  return (
    <span key={key} className="sl-emoji-missing" title={`Emoji :${resolved.name}:`}>
      :{resolved.name}:
    </span>
  );
}

/** Token `<:alias:id>` → `:alias:` para el parser de shortcodes. */
export function normalizeSlackEmojiTokens(text: string): string {
  return text.replace(/<:([a-z0-9_+-]+):[0-9A-Za-z]+>/gi, ":$1:");
}

/** Slack guarda `<`, `>` y `&` escapados en el texto del mensaje. */
export function unescapeSlackText(text: string): string {
  return text.replace(/&(?:amp|lt|gt|quot|#39);/g, (entity) => {
    switch (entity) {
      case "&amp;":
        return "&";
      case "&lt;":
        return "<";
      case "&gt;":
        return ">";
      case "&quot;":
        return '"';
      case "&#39;":
        return "'";
      default:
        return entity;
    }
  });
}

/** Alias sin dos puntos (reacciones) → carácter Unicode, o `:alias:` si no hay glifo. */
export function slackEmojiAliasToChar(alias: string, custom?: SlackCustomEmojiMap): string {
  const resolved = resolveSlackEmoji(alias, custom);
  if (resolved.kind === "unicode") return resolved.char;
  return `:${resolved.name}:`;
}

function displayNameForSlackUser(
  id: string,
  userMap: Record<string, SlackUserProfile | undefined>,
): string {
  const profile = userMap[id];
  const name = profile?.display_name || profile?.real_name;
  return name?.trim() || id;
}

export function extractSlackUserIdsFromText(text: string): string[] {
  const re = /<@([UW][A-Z0-9]+)(?:\|[^>]+)?>/g;
  const out: string[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    out.push(match[1]);
  }
  return out;
}

export type FormatContext = {
  userMap: Record<string, SlackUserProfile | undefined>;
  onUserMentionClick?: (slackUserId: string) => void;
  /** Emojis subidos al workspace de Slack, nombre → URL https. */
  customEmoji?: SlackCustomEmojiMap;
};

const WORD_CHAR = /[\p{L}\p{N}]/u;

function isWordChar(ch: string | undefined): boolean {
  return !!ch && WORD_CHAR.test(ch);
}

function boundaryBefore(src: string, index: number): boolean {
  return index <= 0 || !isWordChar(src[index - 1]);
}

function boundaryAfter(src: string, index: number): boolean {
  return index >= src.length || !isWordChar(src[index]);
}

/** Negrita, cursiva o tachado. El interior se vuelve a parsear (enlaces y emojis). */
function matchWrap(src: string, index: number, marker: string): { inner: string; length: number } | null {
  if (!src.startsWith(marker, index)) return null;
  if (!boundaryBefore(src, index)) return null;
  const start = index + marker.length;
  const end = src.indexOf(marker, start);
  if (end === -1 || end - start > 8000) return null;
  const inner = src.slice(start, end);
  if (!inner || /^\s|\s$/.test(inner)) return null;
  const after = end + marker.length;
  if (!boundaryAfter(src, after)) return null;
  return { inner, length: after - index };
}

function safeSlackHref(raw: string): string | null {
  const href = raw.replace(/\s+/g, "");
  if (!href) return null;
  try {
    const url = new URL(href);
    if (url.protocol === "http:" || url.protocol === "https:" || url.protocol === "mailto:") {
      return url.href;
    }
  } catch {
    return null;
  }
  return null;
}

type InlineToken = { node: ReactNode; length: number };

function takeToken(src: string, index: number, ctx: FormatContext, key: string): InlineToken | null {
  const slice = src.slice(index);

  if (slice.startsWith("`")) {
    const end = slice.indexOf("`", 1);
    if (end > 1 && !slice.slice(1, end).includes("\n")) {
      return {
        length: end + 1,
        node: (
          <code key={key} className="rounded bg-muted px-1 py-0.5 text-[0.85em] font-mono">
            {slice.slice(1, end)}
          </code>
        ),
      };
    }
  }

  const user = /^<@([UW][A-Z0-9]+)(?:\|([^>]+))?>/.exec(slice);
  if (user) {
    const id = user[1];
    const label = user[2] || displayNameForSlackUser(id, ctx.userMap);
    return {
      length: user[0].length,
      node: (
        <button
          key={key}
          type="button"
          className={cn(
            "inline rounded bg-sky-500/15 px-1 py-0.5 text-sky-700 dark:text-sky-300 font-medium text-sm align-baseline",
            ctx.onUserMentionClick && "cursor-pointer hover:bg-sky-500/25",
          )}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            ctx.onUserMentionClick?.(id);
          }}
        >
          @{label}
        </button>
      ),
    };
  }

  const special = /^<!(channel|here|everyone|subteam\^[A-Z0-9]+)(?:\|([^>]+))?>/.exec(slice);
  if (special) {
    const kind = special[1].startsWith("subteam^") ? "grupo" : special[1];
    const label = special[2]?.replace(/^@/, "") || kind;
    return {
      length: special[0].length,
      node: (
        <span
          key={key}
          className="inline rounded bg-violet-500/15 px-1 py-0.5 text-violet-700 dark:text-violet-300 font-medium text-sm"
        >
          @{label}
        </span>
      ),
    };
  }

  const channel = /^<#([CG][A-Z0-9]+)(?:\|([^>]+))?>/.exec(slice);
  if (channel) {
    return {
      length: channel[0].length,
      node: (
        <span key={key} className="font-medium text-primary">
          #{channel[2] || channel[1]}
        </span>
      ),
    };
  }

  const link = /^<((?:https?|mailto):[^>|]{1,4000})(?:\|([^>]{1,800}))?>/i.exec(slice);
  if (link) {
    const href = safeSlackHref(link[1]);
    if (href) {
      const label = (link[2] ?? link[1]).replace(/\s+/g, " ").trim() || href;
      return {
        length: link[0].length,
        node: (
          <a
            key={key}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-primary underline underline-offset-2 break-words"
          >
            {label}
          </a>
        ),
      };
    }
  }

  const emoji = /^:([a-z0-9_+-]{1,100}):/i.exec(slice);
  if (emoji) {
    let length = emoji[0].length;
    const name = emoji[1];
    const skin = /^:skin-tone-([2-6]):/i.exec(slice.slice(length));
    const glyph = slackEmojiToReact(name, ctx.customEmoji, `${key}-e`);
    if (skin && !/^skin-tone-/i.test(name)) {
      length += skin[0].length;
      return {
        length,
        node: (
          <Fragment key={key}>
            {glyph}
            {slackEmojiToReact(`skin-tone-${skin[1]}`, ctx.customEmoji, `${key}-skin`)}
          </Fragment>
        ),
      };
    }
    return { length, node: glyph };
  }

  const bold2 = matchWrap(src, index, "**");
  if (bold2) {
    return {
      length: bold2.length,
      node: <strong key={key}>{parseInline(bold2.inner, ctx, `${key}-b`)}</strong>,
    };
  }
  const bold = matchWrap(src, index, "*");
  if (bold) {
    return {
      length: bold.length,
      node: <strong key={key}>{parseInline(bold.inner, ctx, `${key}-b`)}</strong>,
    };
  }
  const italic = matchWrap(src, index, "_");
  if (italic) {
    return {
      length: italic.length,
      node: <em key={key}>{parseInline(italic.inner, ctx, `${key}-i`)}</em>,
    };
  }
  const strike = matchWrap(src, index, "~");
  if (strike) {
    return {
      length: strike.length,
      node: (
        <span key={key} className="line-through">
          {parseInline(strike.inner, ctx, `${key}-s`)}
        </span>
      ),
    };
  }

  if (boundaryBefore(src, index)) {
    const bare = /^https?:\/\/[^\s<>]+/i.exec(slice);
    if (bare) {
      const trimmed = bare[0].replace(/[),.;!?]+$/g, "");
      const href = safeSlackHref(trimmed);
      if (href && trimmed.length > "https://".length) {
        return {
          length: trimmed.length,
          node: (
            <a
              key={key}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline underline-offset-2 break-all"
            >
              {trimmed}
            </a>
          ),
        };
      }
    }
  }

  return null;
}

function parseInline(src: string, ctx: FormatContext, keyBase: string): ReactNode[] {
  const out: ReactNode[] = [];
  let index = 0;
  let seq = 0;
  let buf = "";
  const flush = () => {
    if (!buf) return;
    out.push(buf);
    buf = "";
  };
  while (index < src.length) {
    const ch = src[index];
    const maybe =
      ch === "`" ||
      ch === "<" ||
      ch === ":" ||
      ch === "*" ||
      ch === "_" ||
      ch === "~" ||
      (ch === "h" && (src.startsWith("http://", index) || src.startsWith("https://", index)));
    if (maybe) {
      const token = takeToken(src, index, ctx, `${keyBase}-${seq}`);
      if (token && token.length > 0) {
        flush();
        out.push(token.node);
        index += token.length;
        seq += 1;
        continue;
      }
    }
    buf += ch;
    index += 1;
  }
  flush();
  return out;
}

/** Slack mrkdwn → React (enlaces, menciones, emojis y énfasis). */
export function slackMrkdwnToReact(text: string | undefined, ctx: FormatContext): ReactNode {
  if (!text?.trim()) return null;
  const normalized = normalizeSlackEmojiTokens(unescapeSlackText(text));
  const lines = normalized.split("\n");
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
        <pre key={`blk-${bi++}`} className="my-1 overflow-x-auto rounded-lg bg-muted p-2 text-xs font-mono">
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
          className="my-1 border-l-2 border-primary/40 pl-3 text-muted-foreground italic whitespace-pre-wrap"
        >
          {parseInline(quoteLines.join("\n"), ctx, `quote-${bi}`)}
        </blockquote>,
      );
      continue;
    }
    const para: string[] = [];
    while (i < lines.length && !lines[i].startsWith("```") && !lines[i].startsWith(">")) {
      para.push(lines[i]);
      i++;
    }
    const joined = para.join("\n");
    if (joined.trim()) {
      blocks.push(
        <p key={`blk-${bi++}`} className="my-0.5 whitespace-pre-wrap break-words leading-relaxed">
          {parseInline(joined, ctx, `p-${bi}`)}
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
