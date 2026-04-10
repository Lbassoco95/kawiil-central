/**
 * Slash commands + Event API (reacciones y mensajes para notificaciones Kawiil).
 * En Slack: suscribir eventos message.channels, message.groups, message.im, message.mpim
 * (además de reaction_added). Misma Request URL que esta función.
 */
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { encode as hexEncode } from "https://deno.land/std@0.168.0/encoding/hex.ts";

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

async function sendWebPushForUsers(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  userIds: string[],
  title: string,
  body: string,
  url: string,
) {
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!publicKey || !privateKey || userIds.length === 0) return;

  const webpush = (await import("npm:web-push@3.6.6")).default;
  const contact = Deno.env.get("VAPID_CONTACT_EMAIL") || "mailto:hello@kawiil.com";
  webpush.setVapidDetails(contact, publicKey, privateKey);

  for (const uid of userIds) {
    const { data: prof } = await supabase
      .from("profiles")
      .select("desktop_push_notifications")
      .eq("user_id", uid)
      .maybeSingle();
    if (prof?.desktop_push_notifications !== true) continue;

    const { data: subs } = await supabase
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", uid);

    for (const s of subs || []) {
      try {
        await webpush.sendNotification(
          { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
          JSON.stringify({ title, body, url }),
        );
      } catch (e: unknown) {
        const code = (e as { statusCode?: number })?.statusCode;
        if (code === 404 || code === 410) {
          await supabase.from("push_subscriptions").delete().eq("id", s.id);
        }
        console.error("webpush error:", code);
      }
    }
  }
}

/** Notificaciones in-app (+ push) por @mención a usuarios conectados o canales en slack_channel_watches */
async function handleMessageNotificationEvent(
  supabase: ReturnType<typeof getSupabaseAdmin>,
  event: Record<string, unknown>,
  teamId: string,
) {
  const subtype = event.subtype as string | undefined;
  if (
    subtype &&
    ["message_changed", "message_deleted", "channel_join", "channel_leave", "channel_topic"].includes(
      subtype,
    )
  ) {
    return;
  }
  if (event.hidden) return;

  const channel = event.channel as string | undefined;
  const ts = event.ts as string | undefined;
  const senderSlackId = event.user as string | undefined;
  const text = (event.text as string) || "";

  if (!channel || !ts || !senderSlackId) return;
  if (event.bot_id && subtype === "bot_message") return;

  const { data: senderConn } = await supabase
    .from("user_slack_connections")
    .select("user_id")
    .eq("slack_team_id", teamId)
    .eq("slack_user_id", senderSlackId)
    .maybeSingle();
  const senderKawiilId = senderConn?.user_id as string | undefined;

  const targets = new Map<string, { organization_id: string }>();

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
      const { data: prof } = await supabase
        .from("profiles")
        .select("notify_slack_mentions")
        .eq("user_id", row.user_id)
        .maybeSingle();
      if (prof?.notify_slack_mentions === false) continue;
      targets.set(row.user_id, { organization_id: row.organization_id });
    }
  }

  const { data: watches } = await supabase
    .from("slack_channel_watches")
    .select("user_id, organization_id")
    .eq("channel_id", channel);

  for (const w of watches || []) {
    if (w.user_id === senderKawiilId) continue;
    const { data: prof } = await supabase
      .from("profiles")
      .select("notify_slack_channel_watch")
      .eq("user_id", w.user_id)
      .maybeSingle();
    if (prof?.notify_slack_channel_watch === false) continue;
    targets.set(w.user_id, { organization_id: w.organization_id });
  }

  /** VIP: cada mensaje en la conversación; ignora notify_slack_channel_watch pero respeta notify_slack_vip. */
  const { data: vipRows } = await supabase
    .from("slack_communication_prefs")
    .select("user_id, organization_id")
    .eq("channel_id", channel)
    .eq("is_vip", true);

  for (const v of vipRows || []) {
    if (v.user_id === senderKawiilId) continue;
    const { data: prof } = await supabase
      .from("profiles")
      .select("notify_slack_vip")
      .eq("user_id", v.user_id)
      .maybeSingle();
    if (prof?.notify_slack_vip === false) continue;
    targets.set(v.user_id, { organization_id: v.organization_id });
  }

  if (targets.size === 0) return;

  const preview = text.replace(/<@[A-Z0-9]+>/g, "@…").replace(/\s+/g, " ").trim().slice(0, 200);
  const channelType = (event.channel_type as string) || "channel";
  const titleLabel =
    channelType === "im"
      ? "Slack · Mensaje directo"
      : channelType === "mpim"
      ? "Slack · Grupo"
      : "Slack · Canal";

  const rows = [...targets.entries()].map(([user_id, { organization_id }]) => ({
    user_id,
    organization_id,
    type: "slack_message",
    title: titleLabel,
    body: preview || "(sin texto)",
    entity_type: "slack",
    entity_id: `${channel}|${ts}`,
    source_user_id: null as string | null,
  }));

  const { error } = await supabase.from("notifications").insert(rows);
  if (error) {
    console.error("slack message notifications insert:", error);
    return;
  }

  const deepUrl = `/comunicacion?channel=${encodeURIComponent(channel)}&ts=${encodeURIComponent(ts)}`;
  await sendWebPushForUsers(
    supabase,
    [...targets.keys()],
    titleLabel,
    preview || "Nuevo mensaje",
    deepUrl,
  );
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

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SLACK_SIGNING_SECRET = Deno.env.get("SLACK_SIGNING_SECRET");

  try {
    const body = await req.text();
    const contentType = req.headers.get("content-type") || "";

    // Verify signature if signing secret is configured
    if (SLACK_SIGNING_SECRET) {
      const timestamp = req.headers.get("x-slack-request-timestamp") || "";
      const slackSig = req.headers.get("x-slack-signature") || "";
      
      // Check timestamp freshness (5 minutes)
      const now = Math.floor(Date.now() / 1000);
      if (Math.abs(now - parseInt(timestamp)) > 300) {
        return new Response("Request too old", { status: 403 });
      }

      const valid = await verifySlackSignature(body, timestamp, slackSig, SLACK_SIGNING_SECRET);
      if (!valid) {
        return new Response("Invalid signature", { status: 403 });
      }
    }

    // Handle URL-encoded slash commands
    if (contentType.includes("application/x-www-form-urlencoded")) {
      const params = new URLSearchParams(body);
      const command = params.get("command");
      const payload: Record<string, string> = {};
      params.forEach((v, k) => (payload[k] = v));

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
      return new Response(JSON.stringify({ challenge: data.challenge }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    // Event callbacks
    if (data.type === "event_callback") {
      const event = data.event;
      const teamId = data.team_id as string | undefined;

      if (event.type === "message" && teamId) {
        await handleMessageNotificationEvent(getSupabaseAdmin(), event, teamId);
      }

      if (event.type === "reaction_added") {
        await handleReactionEvent(event);
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
