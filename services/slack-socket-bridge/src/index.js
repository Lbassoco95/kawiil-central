/**
 * slack-socket-bridge
 *
 * Conecta con Slack vía Socket Mode y hace broadcast de user_typing
 * al canal de Supabase Realtime que ya escucha el frontend de Kawiil.
 *
 * Variables de entorno requeridas:
 *   SLACK_APP_TOKEN      — xapp-... (App-Level Token con connections:write)
 *   SLACK_BOT_TOKEN      — xoxb-... (Bot Token, para users.info)
 *   SUPABASE_URL         — https://xxxx.supabase.co
 *   SUPABASE_SERVICE_KEY — service_role key (no la anon)
 */

const { SocketModeClient } = require("@slack/socket-mode");
const { WebClient } = require("@slack/web-api");
const { createClient } = require("@supabase/supabase-js");

// ─── Config ──────────────────────────────────────────────────
const SLACK_APP_TOKEN = process.env.SLACK_APP_TOKEN;
const SLACK_BOT_TOKEN = process.env.SLACK_BOT_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_KEY = process.env.SUPABASE_SERVICE_KEY;

for (const [key, val] of Object.entries({ SLACK_APP_TOKEN, SLACK_BOT_TOKEN, SUPABASE_URL, SUPABASE_SERVICE_KEY })) {
  if (!val) { console.error(`❌ Falta variable de entorno: ${key}`); process.exit(1); }
}

// ─── Clientes ────────────────────────────────────────────────
const slack = new SocketModeClient({ appToken: SLACK_APP_TOKEN });
const slackWeb = new WebClient(SLACK_BOT_TOKEN);
const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);

// ─── Cache de perfiles (evita llamadas repetidas) ────────────
const profileCache = new Map(); // slackUserId → { name, avatar }
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 min

async function getUserProfile(slackUserId) {
  const cached = profileCache.get(slackUserId);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached;

  try {
    const res = await slackWeb.users.info({ user: slackUserId });
    const p = res.user?.profile ?? {};
    const name = p.display_name || p.real_name || res.user?.name || slackUserId;
    const avatar = p.image_48 || p.image_72 || null;
    const profile = { name, avatar, ts: Date.now() };
    profileCache.set(slackUserId, profile);
    return profile;
  } catch (err) {
    console.warn(`⚠️  users.info falló para ${slackUserId}:`, err.message);
    return { name: slackUserId, avatar: null, ts: Date.now() };
  }
}

// ─── Broadcast a Supabase Realtime ───────────────────────────
// El formato debe coincidir con BroadcastPayload en useSlackTyping.ts
async function broadcastTyping(channelId, slackUserId, isTyping) {
  try {
    const { name, avatar } = await getUserProfile(slackUserId);

    const ch = supabase.channel(`slack-typing:${channelId}`, {
      config: { broadcast: { self: true } },
    });

    await new Promise((resolve) => {
      ch.subscribe((status) => {
        if (status === "SUBSCRIBED") resolve();
      });
    });

    await ch.send({
      type: "broadcast",
      event: "typing",
      payload: {
        user_id: slackUserId,          // Slack user ID (se muestra con Slack avatar)
        user_name: name,
        avatar_url: avatar,
        channel_id: channelId,
        is_typing: isTyping,
        source: "slack",               // indica que viene de la app nativa
      },
    });

    await supabase.removeChannel(ch);
  } catch (err) {
    console.error("broadcastTyping error:", err.message);
  }
}

// Debounce por usuario: { "userId|channelId" → timeoutId }
const typingTimers = new Map();
const TYPING_STOP_DELAY_MS = 4000;

function scheduleTypingStop(channelId, slackUserId) {
  const key = `${slackUserId}|${channelId}`;
  const existing = typingTimers.get(key);
  if (existing) clearTimeout(existing);

  const tid = setTimeout(async () => {
    typingTimers.delete(key);
    await broadcastTyping(channelId, slackUserId, false);
    console.log(`⌨️  [stop]  ${slackUserId} en ${channelId}`);
  }, TYPING_STOP_DELAY_MS);

  typingTimers.set(key, tid);
}

// ─── Manejar evento user_typing ──────────────────────────────
slack.on("user_typing", async ({ event }) => {
  const { channel, user: slackUserId } = event;
  if (!channel || !slackUserId) return;

  console.log(`⌨️  [typing] ${slackUserId} en ${channel}`);
  await broadcastTyping(channel, slackUserId, true);
  scheduleTypingStop(channel, slackUserId);
});

// ─── Reconexión automática ───────────────────────────────────
slack.on("disconnecting", () => console.warn("⚡ Desconectando de Slack..."));
slack.on("reconnecting", () => console.log("🔄 Reconectando a Slack Socket Mode..."));
slack.on("connected", () => console.log("✅ Conectado a Slack Socket Mode"));

// ─── Arranque ────────────────────────────────────────────────
(async () => {
  console.log("🚀 slack-socket-bridge iniciando...");
  console.log(`   SUPABASE_URL: ${SUPABASE_URL}`);
  await slack.start();
  console.log("✅ slack-socket-bridge activo. Escuchando user_typing...");
})();

// Graceful shutdown
process.on("SIGTERM", async () => {
  console.log("🛑 SIGTERM recibido, cerrando...");
  await slack.disconnect();
  process.exit(0);
});
