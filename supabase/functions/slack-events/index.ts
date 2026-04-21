/**
 * Slash commands + Event API (reacciones y mensajes para notificaciones Kawiil).
 *
 * Política de mensajes (handleMessageNotificationEvent):
 * - Canales/grupos públicos o privados: notificar a todos los miembros Slack con cuenta Kawiil en el workspace,
 *   excepto el remitente y quienes tengan `slack_communication_prefs.notifications_muted` para ese canal.
 * - @menciones: siempre notifican (incluso si el canal está silenciado o el usuario apagó toggles no críticos).
 * - VIP y seguimiento de canal respetan silencio por conversación.
 *
 * Slack (misma app que los secretos del proyecto):
 * - Event Subscriptions → Request URL → esta función; verificar challenge.
 * - Subscribe to bot events: message.channels, message.groups, message.im, message.mpim, reaction_added.
 * - SLACK_SIGNING_SECRET de esa app en Supabase Secrets.
 * - SLACK_BOT_TOKEN + invitar el bot a canales donde quieras `conversations.members` (sin miembros no hay broadcast).
 * - Scopes útiles: conversations:read, channels:read, groups:read, im:read, mpim:read, chat:write (slash/reacciones).
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encode as hexEncode } from "https://deno.land/std@0.168.0/encoding/hex.ts";
import { sendWebPushToUsers } from "../_shared/webPush.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": '*',
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Verify Slack request signature
async function verifySlackSignature(
  body: string,
  timestamp: string,
  signature: string,
  signingSecret: string
): Promise<boolean> {
  const baseString = `v0:${timestamp}:${body}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(baseString)
  );
  const computed = `v0=${new TextDecoder().decode(hexEncode(new Uint8Array(sig)))}`;
  return computed === signature;
}

function getSupabaseAdmin() {
  return createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );
}

/** Miembros del canal (DM/mpim/canal); requiere SLACK_BOT_TOKEN con scopes im:read, mpim:read, channels:read o conversations:read. */
async function slackConversationMembers(channelId: string, botToken: string): Promise<string[]> {
  const out: string[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 10; i++) {
    const u = new URL("https://slack.com/api/conversations.members");
    u.searchParams.set("channel", channelId);
    if (cursor) u.searchParams.set("cursor", cursor);
    const res = await fetch(u.toString(), { headers: { Authorization: `Bearer ${botToken}` } });
    const j = (await res.json()) as {
      ok?: boolean;
      error?: string;
      members?: string[];
      response_metadata?: { next_cursor?: string };
    };
    if (!j.ok) {
      console.warn("conversations.members:", j.error || "unknown");
      break;
    }
    out.push(...(j.members || []));
    cursor = j.response_metadata?.next_cursor || undefined;
    if (!cursor) break;
  }
  return out;
}

/** Igual que `slackConversationMembers` pero con token de usuario (p. ej. remitente sin cuenta Kawiil). */
async function slackConversationMembersUserToken(channelId: string, userAccessToken: string): Promise<string[]> {
  const out: string[] = [];
  let cursor: string | undefined;
  for (let i = 0; i < 10; i++) {
    const u = new URL("https://slack.com/api/conversations.members");
    u.searchParams.set("channel", channelId);
    if (cursor) u.searchParams.set("cursor", cursor);
    const res = await fetch(u.toString(), { headers: { Authorization: `Bearer ${userAccessToken}` } });
    const j = (await res.json()) as {
      ok?: boolean;
      error?: string;
      members?: string[];
      response_metadata?: { next_cursor?: string };
    };
    if (!j.ok) {
      console.warn("conversations.members (user token):", j.error || "unknown");
      break;
    }
    out.push(...(j.members || []));
    cursor = j.response_metadata?.next_cursor || undefined;
    if (!cursor) break;
  }
  return out;
}

/** DM 1:1: el otro usuario Slack (`user` en conversations.info con token del remitente). */
async function slackImOtherSlackUserId(
  channelId: string,
  userAccessToken: string,
): Promise<string | null> {
  const u = new URL("https://slack.com/api/conversations.info");
  u.searchParams.set("channel", channelId);
  const res = await fetch(u.toString(), { headers: { Authorization: `Bearer ${userAccessToken}` } });
  const j = (await res.json()) as {
    ok?: boolean;
    error?: string;
    channel?: { user?: string; is_mpim?: boolean; members?: string[] };
  };
  if (!j.ok || !j.channel) {
    console.warn("conversations.info (DM):", j.error || "unknown");
    return null;
  }
  const ch = j.channel;
  if (typeof ch.user === "string" && ch.user.trim()) return ch.user.trim();
  if (ch.is_mpim && Array.isArray(ch.members)) {
    const o = ch.members.find((id) => typeof id === "string" && id.trim());
    return o ? String(o).trim() : null;
  }
  return null;
}

/** Miembros del canal con token de usuario (DM/mpim si el bot no está en la conversación). */
async function slackChannelMembersViaUserToken(
  channelId: string,
  userAccessToken: string,
): Promise<string[]> {
  const u = new URL("https://slack.com/api/conversations.info");
  u.searchParams.set("channel", channelId);
  const res = await fetch(u.toString(), { headers: { Authorization: `Bearer ${userAccessToken}` } });
  const j = (await res.json()) as {
    ok?: boolean;
    error?: string;
    channel?: { members?: string[]; user?: string; is_mpim?: boolean; is_im?: boolean };
  };
  if (!j.ok || !j.channel) {
    console.warn("conversations.info (members):", j.error || "unknown");
    return [];
  }
  const ch = j.channel;
  if (Array.isArray(ch.members) && ch.members.length > 0) {
    return ch.members.filter((x): x is string => typeof x === "string" && !!x.trim());
  }
  if (ch.is_im && typeof ch.user === "string" && ch.user.trim()) return [ch.user.trim()];
  return [];
}

/** Nombre para título de notificación (#canal, MD, grupo); requiere SLACK_BOT_TOKEN. */
async function slackConversationDisplayName(
  channelId: string,
  botToken: string,
): Promise<string | undefined> {
  const u = new URL("https://slack.com/api/conversations.info");
  u.searchParams.set("channel", channelId);
  const res = await fetch(u.toString(), { headers: { Authorization: `Bearer ${botToken}` } });
  const j = (await res.json()) as {
    ok?: boolean;
    error?: string;
    channel?: { name?: string; is_im?: boolean; is_mpim?: boolean };
  };
  if (!j.ok || !j.channel) {
    console.warn("conversations.info:", j.error || "unknown");
    return undefined;
  }
  const ch = j.channel;
  if (ch.is_im || ch.is_mpim) return undefined;
  const n = typeof ch.name === "string" ? ch.name.trim() : "";
  if (n) return `#${n}`;
  return undefined;
}

/** Nombre visible del remitente Slack para poner en el título de la notificación. */
async function slackUserDisplayName(
  slackUserId: string,
  botToken: string,
): Promise<string | undefined> {
  const u = new URL("https://slack.com/api/users.info");
  u.searchParams.set("user", slackUserId);
  const res = await fetch(u.toString(), { headers: { Authorization: `Bearer ${botToken}` } });
  const j = (await res.json()) as {
    ok?: boolean;
    error?: string;
    user?: {
      real_name?: string;
      profile?: { display_name?: string; real_name?: string; real_name_normalized?: string };
      name?: string;
    };
  };
  if (!j.ok || !j.user) {
    console.warn("users.info:", j.error || "unknown");
    return undefined;
  }
  const p = j.user.profile || {};
  const cand = [p.display_name, p.real_name, p.real_name_normalized, j.user.real_name, j.user.name]
    .map((x) => (typeof x === "string" ? x.trim() : ""))
    .find((x) => x.length > 0);
  return cand || undefined;
}

const SLACK_DM_PROBE_MAX = 100;

/**
 * MD 1:1 cuando el bot no está en la conversación y el remitente no tiene token Kawiil (o falló):
 * con `conversations.info` + token de cada conexión del workspace, el canal `is_im` expone `user` = el otro
 * participante; si coincide con `senderSlackId`, ese usuario es el destinatario.
 */
async function slackDmRecipientViaConnectionProbe(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  teamId: string,
  channelId: string,
  senderSlackId: string,
): Promise<{ user_id: string; organization_id: string } | null> {
  if (!channelId.startsWith("D")) return null;
  const { data: conns } = await supabase
    .from("user_slack_connections")
    .select("user_id, organization_id, slack_user_id, access_token")
    .eq("slack_team_id", teamId)
    .neq("slack_user_id", senderSlackId);

  let n = 0;
  for (const c of conns || []) {
    if (++n > SLACK_DM_PROBE_MAX) {
      console.warn("slack-events: DM probe cap", SLACK_DM_PROBE_MAX);
      break;
    }
    const tok = typeof c.access_token === "string" ? c.access_token.trim() : "";
    if (!tok) continue;
    const u = new URL("https://slack.com/api/conversations.info");
    u.searchParams.set("channel", channelId);
    const res = await fetch(u.toString(), { headers: { Authorization: `Bearer ${tok}` } });
    const j = (await res.json()) as {
      ok?: boolean;
      error?: string;
      channel?: { is_im?: boolean; user?: string };
    };
    if (!j.ok || !j.channel?.is_im) continue;
    const other = typeof j.channel.user === "string" ? j.channel.user.trim() : "";
    if (other === senderSlackId) {
      return { user_id: c.user_id as string, organization_id: c.organization_id as string };
    }
  }
  return null;
}

type SlackTargetFlags = {
  organization_id: string;
  mention: boolean;
  watch: boolean;
  vip: boolean;
  dm: boolean;
  /** Miembro del canal/grupo público o privado: avisos como Slack (salvo silencio por conversación). */
  channel: boolean;
};

function mergeSlackTarget(
  targets: Map<string, SlackTargetFlags>,
  userId: string,
  organizationId: string,
  flag: "mention" | "watch" | "vip" | "dm" | "channel",
) {
  const cur = targets.get(userId);
  if (!cur) {
    targets.set(userId, {
      organization_id: organizationId,
      mention: flag === "mention",
      watch: flag === "watch",
      vip: flag === "vip",
      dm: flag === "dm",
      channel: flag === "channel",
    });
    return;
  }
  if (flag === "mention") cur.mention = true;
  if (flag === "watch") cur.watch = true;
  if (flag === "vip") cur.vip = true;
  if (flag === "dm") cur.dm = true;
  if (flag === "channel") cur.channel = true;
  targets.set(userId, cur);
}

/**
 * Título descriptivo estilo Slack nativo:
 * - DM 1:1: nombre del remitente (o "Mensaje directo" si no lo resolvimos).
 * - Grupo privado (mpim): "Grupo · {sender}".
 * - Canal: "#canal — {sender}" (o solo "#canal" si no hay sender).
 * - Mención: "Te mencionaron en #canal" (el body prefija el nombre del remitente).
 * - VIP / watch: conservan matiz pero incluyen sender y canal cuando están disponibles.
 */
function slackNotificationTitle(
  flags: SlackTargetFlags,
  channelType: string,
  channelDisplay?: string,
  senderName?: string,
): string {
  const chSuffix = channelDisplay ? ` ${channelDisplay}` : "";
  const senderPart = senderName ? ` — ${senderName}` : "";

  if (flags.mention) {
    return channelDisplay ? `Te mencionaron en ${channelDisplay}` : "Te mencionaron en Slack";
  }
  if (flags.dm) {
    if (channelType === "im") return senderName || "Mensaje directo (Slack)";
    return senderName ? `Grupo · ${senderName}` : "Grupo privado (Slack)";
  }
  if (flags.vip) {
    const base = channelDisplay ? `Destacado · ${channelDisplay}` : "Destacado (Slack)";
    return senderName ? `${base} — ${senderName}` : base;
  }
  if (flags.watch) {
    const base = channelDisplay ? `Seguimiento · ${channelDisplay}` : "Seguimiento (Slack)";
    return senderName ? `${base} — ${senderName}` : base;
  }
  if (flags.channel) {
    if (channelDisplay) return `${channelDisplay}${senderPart}`;
    return senderName ? `Slack — ${senderName}` : "Slack · Nuevo mensaje";
  }
  if (channelType === "im") return senderName || "Mensaje directo (Slack)";
  if (channelType === "mpim") return senderName ? `Grupo · ${senderName}` : "Grupo privado (Slack)";
  return channelDisplay ? `Canal${chSuffix}${senderPart}` : "Slack · Canal";
}

function slackNotificationType(flags: SlackTargetFlags): string {
  return flags.mention ? "slack_mention" : "slack_message";
}

type SlackFile = {
  mimetype?: string;
  filetype?: string;
  name?: string;
  title?: string;
  pretty_type?: string;
};

/**
 * Descripción legible del primer adjunto para el body de la notificación:
 * - Solo imágenes: "Imagen" o "N imágenes".
 * - Archivo: "{nombre} ({TIPO})" (p. ej. "contrato.pdf (PDF)").
 * - Si hay más de uno, agrega "(+N más)".
 */
function describeSlackAttachments(files: SlackFile[] | undefined | null): string | null {
  if (!Array.isArray(files) || files.length === 0) return null;
  const isImage = (f: SlackFile) =>
    (f.mimetype || "").startsWith("image/") ||
    ["png", "jpg", "jpeg", "gif", "webp", "heic"].includes((f.filetype || "").toLowerCase());
  const images = files.filter(isImage);
  const others = files.filter((f) => !isImage(f));
  if (images.length > 0 && others.length === 0) {
    return files.length === 1 ? "Imagen" : `${files.length} imágenes`;
  }
  const f = others[0] ?? files[0];
  const name = (f.name || f.title || "").trim() || "archivo";
  const kindRaw = (f.pretty_type || f.filetype || "").toString().trim();
  const kind = kindRaw ? kindRaw.toUpperCase() : "";
  const suffix = kind ? ` (${kind})` : "";
  const extras = files.length > 1 ? ` (+${files.length - 1} más)` : "";
  return `${name}${suffix}${extras}`;
}

/**
 * Preview del mensaje respetando hasta 3 líneas de texto y fusionando con la descripción
 * del adjunto cuando hay archivos/imágenes. Preserva saltos de línea para que el toast pueda
 * aplicar `line-clamp-3`.
 */
function buildSlackPreview(text: string, files?: SlackFile[] | null): string {
  const cleanText = (text || "")
    .replace(/<@[A-Z0-9]+>/g, "@…")
    .replace(/[ \t]+/g, " ")
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .slice(0, 3)
    .join("\n")
    .slice(0, 280);
  const attach = describeSlackAttachments(files || []);
  if (attach && cleanText) return `${attach} · ${cleanText}`;
  if (attach) return attach;
  return cleanText;
}

/** Notificaciones in-app (+ push): cada mensaje en canal/grupo a miembros Kawiil, @mención, seguimiento, VIP, DM/mpim. */
async function handleMessageNotificationEvent(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  event: Record<string, unknown>,
  teamId: string,
  eventId?: string,
) {
  const subtype = event.subtype as string | undefined;
  if (
    subtype &&
    ["message_changed", "message_deleted", "channel_join", "channel_leave", "channel_topic"].includes(
      subtype,
    )
  ) {
    console.log("slack-events: message ignorado (subtype)", { subtype, channel: event.channel, ts: event.ts, eventId });
    return;
  }
  if (event.hidden) {
    console.log("slack-events: message ignorado (hidden)", { eventId, teamId });
    return;
  }

  const channel = event.channel as string | undefined;
  const ts = event.ts as string | undefined;
  const senderSlackId =
    typeof event.user === "string" && event.user.trim()
      ? event.user.trim()
      : typeof event.user_id === "string" && event.user_id.trim()
        ? event.user_id.trim()
        : undefined;
  const text = (event.text as string) || "";

  if (!channel || !ts) {
    console.warn("slack-events: message sin channel o ts", { eventId, teamId, channel, ts });
    return;
  }

  const rawThreadTs = event.thread_ts as string | undefined;
  const threadTsNorm =
    typeof rawThreadTs === "string" && rawThreadTs.trim() ? rawThreadTs.trim() : undefined;
  /** Respuesta en hilo: ref enriquecida para deep link (padre|respuesta). */
  const entityRef =
    threadTsNorm && threadTsNorm !== ts ? `${channel}|${threadTsNorm}|${ts}` : `${channel}|${ts}`;

  if (event.bot_id && subtype === "bot_message") {
    console.log("slack-events: message ignorado (bot_message)", { eventId, channel });
    return;
  }

  console.log("slack-events: message → notificaciones Kawiil", {
    eventId,
    teamId,
    channel,
    ts,
    senderSlackId: senderSlackId ?? null,
    subtype: subtype ?? null,
  });

  let senderKawiilId: string | undefined;
  if (senderSlackId) {
    const { data: senderConn } = await supabase
      .from("user_slack_connections")
      .select("user_id")
      .eq("slack_team_id", teamId)
      .eq("slack_user_id", senderSlackId)
      .maybeSingle();
    senderKawiilId = senderConn?.user_id as string | undefined;
  }

  const targets = new Map<string, SlackTargetFlags>();
  /** Solo rama channel/group: miembros Slack del canal resueltos (antes de filtrar a Kawiil). */
  let debugPubChannelSlackMemberCount = 0;

  const { data: mutedPrefRows } = await supabase
    .from("slack_communication_prefs")
    .select("user_id")
    .eq("channel_id", channel)
    .eq("notifications_muted", true);
  const mutedUserIds = new Set((mutedPrefRows || []).map((r: { user_id: string }) => r.user_id));

  const mentionMatches = [...text.matchAll(/<@([A-Z0-9]+)>/g)];
  const mentionIds = [...new Set(mentionMatches.map((m) => m[1]))];

  if (mentionIds.length > 0) {
    const { data: mentionRows } = await supabase
      .from("user_slack_connections")
      .select("user_id, organization_id, slack_user_id")
      .eq("slack_team_id", teamId)
      .in("slack_user_id", mentionIds);

    for (const row of mentionRows || []) {
      if (row.user_id === senderKawiilId) continue;
      mergeSlackTarget(targets, row.user_id, row.organization_id, "mention");
    }
  }

  const { data: watches } = await supabase
    .from("slack_channel_watches")
    .select("user_id, organization_id")
    .eq("channel_id", channel);

  for (const w of watches || []) {
    if (w.user_id === senderKawiilId) continue;
    if (mutedUserIds.has(w.user_id as string)) continue;
    const { data: prof } = await supabase
      .from("profiles")
      .select("notify_slack_channel_watch")
      .eq("user_id", w.user_id)
      .maybeSingle();
    if (prof?.notify_slack_channel_watch === false) continue;
    mergeSlackTarget(targets, w.user_id, w.organization_id, "watch");
  }

  /** VIP: cada mensaje en la conversación; ignora notify_slack_channel_watch pero respeta notify_slack_vip. */
  const { data: vipRows } = await supabase
    .from("slack_communication_prefs")
    .select("user_id, organization_id")
    .eq("channel_id", channel)
    .eq("is_vip", true);

  for (const v of vipRows || []) {
    if (v.user_id === senderKawiilId) continue;
    if (mutedUserIds.has(v.user_id as string)) continue;
    const { data: prof } = await supabase
      .from("profiles")
      .select("notify_slack_vip")
      .eq("user_id", v.user_id)
      .maybeSingle();
    if (prof?.notify_slack_vip === false) continue;
    mergeSlackTarget(targets, v.user_id, v.organization_id, "vip");
  }

  let channelType = (event.channel_type as string) || "";
  if (!channelType && channel) {
    if (channel.startsWith("D")) channelType = "im";
    else if (channel.startsWith("G")) channelType = "mpim";
    else channelType = "channel";
  }

  /** MD y grupos privados: notificar al resto de participantes con cuenta Kawiil (notify_slack_dm). */
  if ((channelType === "im" || channelType === "mpim") && channel) {
    const bot = Deno.env.get("SLACK_BOT_TOKEN");
    let memberSlackIds: string[] = [];
    if (bot) {
      memberSlackIds = await slackConversationMembers(channel, bot);
    }
    if (memberSlackIds.length === 0 && senderKawiilId) {
      const { data: senderTok } = await supabase
        .from("user_slack_connections")
        .select("access_token")
        .eq("user_id", senderKawiilId)
        .eq("slack_team_id", teamId)
        .maybeSingle();
      const tok = senderTok?.access_token as string | undefined;
      if (tok) {
        if (channel.startsWith("D")) {
          const other = await slackImOtherSlackUserId(channel, tok);
          if (other && (!senderSlackId || other !== senderSlackId)) {
            memberSlackIds = senderSlackId ? [senderSlackId, other] : [other];
          }
        } else {
          memberSlackIds = await slackChannelMembersViaUserToken(channel, tok);
        }
      }
    }
    if (memberSlackIds.length === 0) {
      const { data: dmTeamToks } = await supabase
        .from("user_slack_connections")
        .select("access_token")
        .eq("slack_team_id", teamId)
        .not("access_token", "is", null)
        .limit(12);
      for (const row of dmTeamToks || []) {
        const t = row.access_token as string | undefined;
        if (!t) continue;
        if (channel.startsWith("D")) {
          const other = await slackImOtherSlackUserId(channel, t);
          if (other && (!senderSlackId || other !== senderSlackId)) {
            memberSlackIds = senderSlackId ? [senderSlackId, other] : [other];
            if (memberSlackIds.length > 0) break;
          }
        } else {
          memberSlackIds = await slackChannelMembersViaUserToken(channel, t);
          if (memberSlackIds.length > 0) break;
        }
      }
    }
    let mergedDmRecipient = false;
    for (const sid of memberSlackIds) {
      if (senderSlackId && sid === senderSlackId) continue;
      const { data: conn } = await supabase
        .from("user_slack_connections")
        .select("user_id, organization_id")
        .eq("slack_team_id", teamId)
        .eq("slack_user_id", sid)
        .maybeSingle();
      if (!conn?.user_id) continue;
      if (conn.user_id === senderKawiilId) continue;
      if (mutedUserIds.has(conn.user_id as string)) continue;
      const { data: prof } = await supabase
        .from("profiles")
        .select("notify_slack_dm")
        .eq("user_id", conn.user_id)
        .maybeSingle();
      if (prof?.notify_slack_dm === false) continue;
      mergeSlackTarget(targets, conn.user_id, conn.organization_id, "dm");
      mergedDmRecipient = true;
    }
    if (!mergedDmRecipient && channelType === "im" && channel.startsWith("D") && senderSlackId) {
      const probed = await slackDmRecipientViaConnectionProbe(supabase, teamId, channel, senderSlackId);
      if (probed && probed.user_id !== senderKawiilId) {
        const { data: prof } = await supabase
          .from("profiles")
          .select("notify_slack_dm")
          .eq("user_id", probed.user_id)
          .maybeSingle();
        if (!mutedUserIds.has(probed.user_id) && prof?.notify_slack_dm !== false) {
          mergeSlackTarget(targets, probed.user_id, probed.organization_id, "dm");
          console.log("slack-events: DM recipient resolved via connection probe", {
            channel,
            recipient: probed.user_id,
          });
        }
      }
    }
  }

  /** Canales públicos y privados (no MD/mpim): notificar a todos los miembros con cuenta Kawiil, estilo Slack. */
  if ((channelType === "channel" || channelType === "group") && channel) {
    const bot = Deno.env.get("SLACK_BOT_TOKEN");
    let memberSlackIds: string[] = [];
    if (bot) {
      memberSlackIds = await slackConversationMembers(channel, bot);
    }
    if (memberSlackIds.length === 0 && senderKawiilId) {
      const { data: senderTok } = await supabase
        .from("user_slack_connections")
        .select("access_token")
        .eq("user_id", senderKawiilId)
        .eq("slack_team_id", teamId)
        .maybeSingle();
      const tok = senderTok?.access_token as string | undefined;
      if (tok) {
        memberSlackIds = await slackChannelMembersViaUserToken(channel, tok);
      }
    }
    if (memberSlackIds.length === 0) {
      const { data: teamToks } = await supabase
        .from("user_slack_connections")
        .select("access_token")
        .eq("slack_team_id", teamId)
        .not("access_token", "is", null)
        .limit(12);
      for (const row of teamToks || []) {
        const t = row.access_token as string | undefined;
        if (!t) continue;
        const ids = await slackConversationMembersUserToken(channel, t);
        if (ids.length > 0) {
          memberSlackIds = ids;
          console.log("slack-events: channel members via team user token", { channel, count: ids.length });
          break;
        }
      }
    }
    debugPubChannelSlackMemberCount = memberSlackIds.length;
    if (memberSlackIds.length > 0) {
      const { data: memberConns } = await supabase
        .from("user_slack_connections")
        .select("user_id, organization_id, slack_user_id")
        .eq("slack_team_id", teamId)
        .in("slack_user_id", memberSlackIds);
      const candidateIds: string[] = [];
      const orgByUser = new Map<string, string>();
      for (const row of memberConns || []) {
        const uid = row.user_id as string;
        const sid = row.slack_user_id as string;
        if (senderSlackId && sid === senderSlackId) continue;
        if (uid === senderKawiilId) continue;
        if (mutedUserIds.has(uid)) continue;
        if (!orgByUser.has(uid)) {
          orgByUser.set(uid, row.organization_id as string);
          candidateIds.push(uid);
        }
      }
      if (candidateIds.length > 0) {
        for (const uid of candidateIds) {
          const oid = orgByUser.get(uid);
          if (oid) mergeSlackTarget(targets, uid, oid, "channel");
        }
      }
    }
  }

  if (targets.size === 0) {
    console.warn("slack-events: message sin destinatarios Kawiil", {
      channel,
      channelType,
      ts,
      eventId,
      hadSenderSlackId: !!senderSlackId,
      senderLinkedKawiil: !!senderKawiilId,
      mentionCount: mentionIds.length,
      watchesCount: (watches || []).length,
      vipCount: (vipRows || []).length,
      hasSlackBotToken: Boolean(Deno.env.get("SLACK_BOT_TOKEN")),
      pubChannelSlackMemberCount:
        channelType === "channel" || channelType === "group" ? debugPubChannelSlackMemberCount : undefined,
    });
    return;
  }

  let channelDisplay: string | undefined;
  let senderName: string | undefined;
  const botForInfo = Deno.env.get("SLACK_BOT_TOKEN");
  if (botForInfo) {
    channelDisplay = await slackConversationDisplayName(channel, botForInfo);
    if (senderSlackId) {
      senderName = await slackUserDisplayName(senderSlackId, botForInfo);
    }
  }

  const preview =
    buildSlackPreview(text, event.files as SlackFile[] | undefined) || "(sin contenido)";

  const rows = [...targets.entries()].map(([user_id, flags]) => {
    const baseType = slackNotificationType(flags);
    const title = slackNotificationTitle(flags, channelType, channelDisplay, senderName);
    // En menciones, prefijar el body con el remitente para que se lea "Juan: {mensaje}".
    const bodyForRow =
      flags.mention && senderName && preview
        ? `${senderName}: ${preview}`
        : preview || "(sin texto)";
    return {
      user_id,
      organization_id: flags.organization_id,
      type: baseType,
      title,
      body: bodyForRow,
      entity_type: "slack",
      entity_id: null as string | null,
      entity_ref: entityRef,
      source_user_id: null as string | null,
    };
  });

  const userIds = rows.map((r) => r.user_id);
  const { data: existingRows } = await supabase
    .from("notifications")
    .select("user_id, type")
    .eq("entity_type", "slack")
    .eq("entity_ref", entityRef)
    .in("user_id", userIds)
    .in("type", ["slack_message", "slack_mention"]);

  const existingKey = new Set((existingRows || []).map((r) => `${r.user_id}|${r.type}`));
  const dedupedRows = rows.filter((r) => !existingKey.has(`${r.user_id}|${r.type}`));
  if (dedupedRows.length === 0) {
    console.log("Slack event deduped: no new notification rows", { channel, ts, eventId });
    return;
  }

  const { error } = await supabase.from("notifications").insert(dedupedRows);
  if (error) {
    console.error("slack message notifications insert:", error);
    return;
  }

  console.log("slack-events: insert OK en notifications", {
    count: dedupedRows.length,
    channel,
    ts,
    eventId,
    types: [...new Set(dedupedRows.map((r) => r.type))],
  });
  if (dedupedRows.length > 50) {
    console.warn("slack-events: muchas notificaciones en un solo mensaje", {
      count: dedupedRows.length,
      channel,
      ts,
      eventId,
    });
  }

  const deepUrl = `/comunicacion?channel=${encodeURIComponent(channel)}&ts=${encodeURIComponent(ts)}`;
  const pushTag = `slack-${channel}-${ts}`.replace(/\s/g, "");
  const isDmConversation = channelType === "im" || channelType === "mpim";
  for (const row of dedupedRows) {
    const isMention = row.type === "slack_mention";
    await sendWebPushToUsers(supabase, {
      userIds: [row.user_id],
      title: row.title,
      body: row.body || preview || "Nuevo mensaje",
      url: deepUrl,
      tag: pushTag,
      // DM/mpim y menciones entregan aunque el usuario no tenga "push con app cerrada" encendido:
      // son mensajes que esperamos interrumpir al usuario.
      force: isMention || isDmConversation,
      // Banner persistente en DMs y menciones: no se auto-cierra hasta que el usuario lo atienda.
      requireInteraction: isMention || isDmConversation,
    });
  }
}

// Find user by Slack email lookup
async function findUserByEmail(supabase: any, email: string) {
  const { data } = await supabase
    .from("profiles")
    .select("user_id, full_name, organization_id")
    .eq("email", email)
    .eq("is_active", true)
    .single();
  return data;
}

// Get Slack user email
async function getSlackUserEmail(slackUserId: string, botToken: string): Promise<string | null> {
  const res = await fetch(`https://slack.com/api/users.info?user=${slackUserId}`, {
    headers: { Authorization: `Bearer ${botToken}` },
  });
  const data = await res.json();
  return data.ok ? data.user?.profile?.email || null : null;
}

// Parse /tarea command: /tarea Título de la tarea @usuario #area !prioridad
function parseTaskCommand(text: string) {
  const mentions = text.match(/<@(\w+)>/g) || [];
  const mentionIds = mentions.map((m: string) => m.replace(/<@|>/g, ""));
  
  const areaMatch = text.match(/#(\w+)/);
  const area = areaMatch ? areaMatch[1] : null;
  
  const priorityMatch = text.match(/!(urgente|alta|media|baja)/i);
  const priority = priorityMatch ? priorityMatch[1].toLowerCase() : "media";
  
  const dueDateMatch = text.match(/fecha:(\d{4}-\d{2}-\d{2})/);
  const dueDate = dueDateMatch ? dueDateMatch[1] : null;

  // Clean title: remove mentions, area, priority, date
  let title = text
    .replace(/<@\w+>/g, "")
    .replace(/#\w+/g, "")
    .replace(/!(urgente|alta|media|baja)/gi, "")
    .replace(/fecha:\d{4}-\d{2}-\d{2}/g, "")
    .trim();

  return { title, mentionIds, area, priority, dueDate };
}

// Map area shorthand to service_area enum
function mapArea(area: string | null): string | null {
  if (!area) return null;
  const map: Record<string, string> = {
    contabilidad: "contabilidad",
    conta: "contabilidad",
    legal: "legal",
    softlanding: "softlanding",
    sl: "softlanding",
    pld: "pld_ft",
    juicios: "juicios",
    gestoria: "gestoria",
    constitucion: "constitucion_nacional",
    cumplimiento: "cumplimiento",
  };
  return map[area.toLowerCase()] || null;
}

// Handle /tarea slash command
async function handleTareaCommand(payload: Record<string, string>) {
  const SLACK_BOT_TOKEN = Deno.env.get("SLACK_BOT_TOKEN")!;
  const supabase = getSupabaseAdmin();
  const { text, user_id: slackUserId } = payload;

  if (!text || text.trim() === "") {
    return {
      response_type: "ephemeral",
      text: "📝 *Uso:* `/tarea Título de la tarea @usuario #area !prioridad fecha:YYYY-MM-DD`\n\n" +
        "• `@usuario` — asignar a alguien (opcional)\n" +
        "• `#conta` `#legal` `#cumplimiento` etc. — área (opcional)\n" +
        "• `!urgente` `!alta` `!media` `!baja` — prioridad (default: media)\n" +
        "• `fecha:2026-04-15` — fecha límite (opcional)",
    };
  }

  const parsed = parseTaskCommand(text);

  // Get creator info
  const creatorEmail = await getSlackUserEmail(slackUserId, SLACK_BOT_TOKEN);
  const creator = creatorEmail ? await findUserByEmail(supabase, creatorEmail) : null;

  if (!creator) {
    return {
      response_type: "ephemeral",
      text: "❌ No encontré tu cuenta en el sistema. Verifica que tu email de Slack coincida con el registrado.",
    };
  }

  // Resolve assignee
  let assignedTo: string | null = null;
  let assigneeName = "Sin asignar";
  if (parsed.mentionIds.length > 0) {
    const assigneeEmail = await getSlackUserEmail(parsed.mentionIds[0], SLACK_BOT_TOKEN);
    if (assigneeEmail) {
      const assignee = await findUserByEmail(supabase, assigneeEmail);
      if (assignee) {
        assignedTo = assignee.user_id;
        assigneeName = assignee.full_name;
      }
    }
  }

  const mappedArea = mapArea(parsed.area);

  // Create task
  const { data: task, error } = await supabase.from("tasks").insert({
    title: parsed.title,
    organization_id: creator.organization_id,
    created_by: creator.user_id,
    assigned_to: assignedTo,
    area: mappedArea,
    priority: parsed.priority,
    due_date: parsed.dueDate,
    status: "pendiente",
  }).select().single();

  if (error) {
    console.error("Error creating task:", error);
    return {
      response_type: "ephemeral",
      text: `❌ Error al crear la tarea: ${error.message}`,
    };
  }

  // Add additional assignees
  if (parsed.mentionIds.length > 1) {
    for (let i = 1; i < parsed.mentionIds.length; i++) {
      const email = await getSlackUserEmail(parsed.mentionIds[i], SLACK_BOT_TOKEN);
      if (email) {
        const profile = await findUserByEmail(supabase, email);
        if (profile) {
          await supabase.from("task_assignees").insert({
            task_id: task.id,
            user_id: profile.user_id,
          });
        }
      }
    }
  }

  return {
    response_type: "in_channel",
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: "✅ Tarea Creada desde Slack" },
      },
      {
        type: "section",
        fields: [
          { type: "mrkdwn", text: `*Título:*\n${parsed.title}` },
          { type: "mrkdwn", text: `*Asignado a:*\n${assigneeName}` },
          { type: "mrkdwn", text: `*Prioridad:*\n${parsed.priority}` },
          { type: "mrkdwn", text: `*Área:*\n${mappedArea || "Sin área"}` },
        ],
      },
      ...(parsed.dueDate
        ? [{
            type: "context",
            elements: [{ type: "mrkdwn", text: `📅 Fecha límite: ${parsed.dueDate}` }],
          }]
        : []),
    ],
  };
}

// Handle /consultar slash command
async function handleConsultarCommand(payload: Record<string, string>) {
  const SLACK_BOT_TOKEN = Deno.env.get("SLACK_BOT_TOKEN")!;
  const supabase = getSupabaseAdmin();
  const { text, user_id: slackUserId } = payload;

  const creatorEmail = await getSlackUserEmail(slackUserId, SLACK_BOT_TOKEN);
  const creator = creatorEmail ? await findUserByEmail(supabase, creatorEmail) : null;

  if (!creator) {
    return {
      response_type: "ephemeral",
      text: "❌ No encontré tu cuenta en el sistema.",
    };
  }

  let query = supabase
    .from("tasks")
    .select("id, title, status, priority, due_date, area, assigned_to")
    .eq("organization_id", creator.organization_id)
    .order("created_at", { ascending: false })
    .limit(10);

  // Parse filters
  const filter = (text || "").trim().toLowerCase();
  if (filter === "mias" || filter === "mis") {
    query = query.eq("assigned_to", creator.user_id);
  } else if (filter === "pendientes") {
    query = query.eq("status", "pendiente");
  } else if (filter === "urgentes") {
    query = query.eq("priority", "urgente");
  } else if (filter === "hoy") {
    const today = new Date().toISOString().split("T")[0];
    query = query.eq("due_date", today);
  } else if (filter) {
    query = query.ilike("title", `%${filter}%`);
  }

  const { data: tasks, error } = await query;

  if (error || !tasks || tasks.length === 0) {
    return {
      response_type: "ephemeral",
      text: error
        ? `❌ Error: ${error.message}`
        : "📭 No se encontraron tareas con ese filtro.",
    };
  }

  const priorityEmoji: Record<string, string> = {
    urgente: "🔴",
    alta: "🟠",
    media: "🟡",
    baja: "🟢",
  };

  const statusLabel: Record<string, string> = {
    pendiente: "⏳ Pendiente",
    en_progreso: "🔄 En progreso",
    en_revision: "👀 En revisión",
    completada: "✅ Completada",
    cancelada: "❌ Cancelada",
  };

  const taskLines = tasks.map(
    (t: any) =>
      `${priorityEmoji[t.priority] || "⚪"} *${t.title}* — ${statusLabel[t.status] || t.status}${t.due_date ? ` | 📅 ${t.due_date}` : ""}`
  );

  return {
    response_type: "ephemeral",
    blocks: [
      {
        type: "header",
        text: { type: "plain_text", text: `📋 Tareas${filter ? ` (${filter})` : ""}` },
      },
      {
        type: "section",
        text: { type: "mrkdwn", text: taskLines.join("\n") },
      },
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "Filtros: `mias` `pendientes` `urgentes` `hoy` o busca por texto",
          },
        ],
      },
    ],
  };
}

// Handle reaction events (✅ = complete task)
async function handleReactionEvent(event: any) {
  // Only handle white_check_mark or heavy_check_mark reactions
  if (!["white_check_mark", "heavy_check_mark"].includes(event.reaction)) {
    return;
  }

  const SLACK_BOT_TOKEN = Deno.env.get("SLACK_BOT_TOKEN")!;
  const supabase = getSupabaseAdmin();

  // Get the original message to find task reference
  const msgRes = await fetch(
    `https://slack.com/api/conversations.history?channel=${event.item.channel}&latest=${event.item.ts}&limit=1&inclusive=true`,
    { headers: { Authorization: `Bearer ${SLACK_BOT_TOKEN}` } }
  );
  const msgData = await msgRes.json();
  
  if (!msgData.ok || !msgData.messages?.[0]) return;

  const messageText = msgData.messages[0].text || "";
  // Look for task ID pattern in bot messages
  const taskMatch = messageText.match(/task_id:([a-f0-9-]+)/i);
  if (!taskMatch) return;

  const taskId = taskMatch[1];
  await supabase
    .from("tasks")
    .update({ status: "completada" })
    .eq("id", taskId);

  // Post confirmation
  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      channel: event.item.channel,
      thread_ts: event.item.ts,
      text: "✅ Tarea marcada como completada",
    }),
  });
}

/** Workspace Slack `T…`; el payload a veces trae el team solo en `event.team` o `authorizations`. */
function extractSlackEventTeamId(data: Record<string, unknown>, event: Record<string, unknown>): string | undefined {
  const tryTeam = (x: unknown): string | undefined => {
    if (typeof x !== "string") return undefined;
    const t = x.trim();
    return /^T[A-Z0-9]+$/.test(t) ? t : undefined;
  };
  const fromAuths = (): string | undefined => {
    const a = data.authorizations;
    if (!Array.isArray(a) || a.length === 0) return undefined;
    const z = a[0] as Record<string, unknown>;
    return tryTeam(z?.team_id);
  };
  const fromTeamObj = (): string | undefined => {
    const t = (data as { team?: { id?: unknown } }).team;
    if (t && typeof t === "object" && typeof (t as { id?: unknown }).id === "string") {
      return tryTeam((t as { id: string }).id);
    }
    return undefined;
  };
  return (
    tryTeam(data.team_id) ??
    tryTeam(event.team) ??
    tryTeam(event.team_id) ??
    tryTeam((event as { source_team_id?: unknown }).source_team_id) ??
    tryTeam((data as { context_team_id?: unknown }).context_team_id) ??
    fromTeamObj() ??
    fromAuths()
  );
}

type EdgeGlobal = typeof globalThis & { EdgeRuntime?: { waitUntil: (p: Promise<unknown>) => void } };

function runSlackEventInBackground(label: string, work: () => Promise<void>) {
  const promise = work().catch((e) => console.error(`slack-events: ${label}`, e));
  const eg = globalThis as EdgeGlobal;
  if (typeof eg.EdgeRuntime?.waitUntil === "function") {
    eg.EdgeRuntime.waitUntil(promise);
  } else {
    void promise;
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SLACK_SIGNING_SECRET = Deno.env.get("SLACK_SIGNING_SECRET");
  const ALLOW_INSECURE_SLACK_EVENTS = Deno.env.get("ALLOW_INSECURE_SLACK_EVENTS") === "true";

  try {
    const body = await req.text();
    const contentType = req.headers.get("content-type") || "";
    const retryNum = req.headers.get("x-slack-retry-num") || "";
    const retryReason = req.headers.get("x-slack-retry-reason") || "";

    if (!SLACK_SIGNING_SECRET && !ALLOW_INSECURE_SLACK_EVENTS) {
      console.error("SLACK_SIGNING_SECRET missing. Rejecting request for safety.");
      return new Response("Slack signing secret not configured", { status: 500 });
    }

    // Verify signature if signing secret is configured
    if (SLACK_SIGNING_SECRET) {
      const timestamp = req.headers.get("x-slack-request-timestamp") || "";
      const slackSig = req.headers.get("x-slack-signature") || "";
      
      // Check timestamp freshness (5 minutes)
      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - parseInt(timestamp)) > 300) {
        console.warn("slack-events: 403 request too old (firma Slack)");
        return new Response("Request too old", { status: 403 });
      }

      const valid = await verifySlackSignature(body, timestamp, slackSig, SLACK_SIGNING_SECRET);
      if (!valid) {
        console.warn("slack-events: 403 invalid signature (revisa SLACK_SIGNING_SECRET vs app Slack)");
        return new Response("Invalid signature", { status: 403 });
      }
    }

    // Handle URL-encoded slash commands
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const params = new URLSearchParams(body);
      const command = params.get("command");
      const payload: Record<string, string> = {};
      params.forEach((v, k) => (payload[k] = v));

      console.log("slack-events: slash_command", {
        command: command ?? null,
        user_id: params.get("user_id")?.slice(0, 12) ?? null,
      });

      let result;
      if (command === "/tarea") {
        result = await handleTareaCommand(payload);
      } else if (command === "/consultar") {
        result = await handleConsultarCommand(payload);
      } else {
        result = { response_type: "ephemeral", text: `Comando desconocido: ${command}` };
      }

      return new Response(JSON.stringify(result), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Handle JSON events (Event API, URL verification)
    const data = JSON.parse(body);

    // URL verification challenge
    if (data.type === "url_verification") {
      console.log("slack-events: url_verification ok");
      return new Response(JSON.stringify({ challenge: data.challenge }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Event callbacks
    if (data.type === "event_callback") {
      const event = data.event as Record<string, unknown>;
      const teamId = extractSlackEventTeamId(data as Record<string, unknown>, event);
      const eventId = data.event_id as string | undefined;

      console.log("slack-events: event_callback", {
        eventType: event.type,
        teamId: teamId ?? null,
        eventId,
      });

      if (retryNum) {
        console.log("Slack retry request", { retryNum, retryReason, eventId, teamId });
      }

      if (event.type === "message") {
        if (teamId) {
          console.log("slack-events: event_callback message", {
            eventId,
            teamId,
            channel: event.channel,
            api_app_id: (data as { api_app_id?: string }).api_app_id,
          });
          /** Responder 200 antes del tope de Slack (~3s); el trabajo sigue con waitUntil. */
          runSlackEventInBackground("handleMessageNotificationEvent", () =>
            handleMessageNotificationEvent(getSupabaseAdmin(), event, teamId, eventId),
          );
        } else {
          console.warn("slack-events: message sin team_id resolvible; no se crean notificaciones Kawiil", {
            event_id: eventId,
            event_user: event.user,
            event_channel: event.channel,
          });
        }
      }

      if (event.type === "reaction_added") {
        runSlackEventInBackground("handleReactionEvent", () => handleReactionEvent(event));
      }

      return new Response(JSON.stringify({ ok: true }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Slack events error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
