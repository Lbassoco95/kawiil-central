import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": '*',
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

interface NotificationPayload {
  event_type:
    | "client_created"
    | "task_created"
    | "task_updated"
    | "comment_mention"
    | "project_status_changed"
    | "deadline_created"
    | "mtg_minutes_approved";
  data: Record<string, any>;
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const SLACK_BOT_TOKEN = Deno.env.get("SLACK_BOT_TOKEN");
  if (!SLACK_BOT_TOKEN) {
    return new Response(
      JSON.stringify({ error: "SLACK_BOT_TOKEN not configured" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const SLACK_CHANNEL = Deno.env.get("SLACK_CHANNEL_ID") || "#general";

  try {
    const payload: NotificationPayload = await req.json();
    const { event_type, data } = payload;

    let message = "";
    let blocks: any[] = [];

    switch (event_type) {
      case "client_created":
        message = `🆕 Nuevo cliente: ${data.name}`;
        blocks = [
          {
            type: "header",
            text: { type: "plain_text", text: "🆕 Nuevo Cliente Registrado" },
          },
          {
            type: "section",
            fields: [
              { type: "mrkdwn", text: `*Nombre:*\n${data.name}` },
              { type: "mrkdwn", text: `*Tipo:*\n${data.client_type === "persona_moral" ? "Persona Moral" : "Persona Física"}` },
              { type: "mrkdwn", text: `*Servicios:*\n${(data.services || []).join(", ")}` },
              { type: "mrkdwn", text: `*Responsable:*\n${data.responsible_name || "Sin asignar"}` },
            ],
          },
        ];
        break;

      case "task_created":
        message = `📋 Nueva tarea: ${data.title}`;
        blocks = [
          {
            type: "header",
            text: { type: "plain_text", text: "📋 Nueva Tarea Creada" },
          },
          {
            type: "section",
            fields: [
              { type: "mrkdwn", text: `*Título:*\n${data.title}` },
              { type: "mrkdwn", text: `*Prioridad:*\n${data.priority || "media"}` },
              { type: "mrkdwn", text: `*Área:*\n${data.area || "General"}` },
              { type: "mrkdwn", text: `*Asignado a:*\n${data.assigned_name || "Sin asignar"}` },
            ],
          },
          ...(data.client_name
            ? [
                {
                  type: "context",
                  elements: [
                    { type: "mrkdwn", text: `👤 Cliente: ${data.client_name}` },
                  ],
                },
              ]
            : []),
        ];
        break;

      case "task_updated":
        message = `🔄 Tarea actualizada: ${data.title}`;
        blocks = [
          {
            type: "header",
            text: { type: "plain_text", text: "🔄 Tarea Actualizada" },
          },
          {
            type: "section",
            fields: [
              { type: "mrkdwn", text: `*Título:*\n${data.title}` },
              { type: "mrkdwn", text: `*Nuevo estatus:*\n${data.status}` },
              { type: "mrkdwn", text: `*Actualizado por:*\n${data.updated_by || "Sistema"}` },
            ],
          },
        ];
        break;

      case "comment_mention":
        message = `💬 ${data.author_name} te mencionó en una tarea`;
        blocks = [
          {
            type: "header",
            text: { type: "plain_text", text: "💬 Mención en Comentario" },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `*${data.author_name}* te mencionó en la tarea *${data.task_title}*:\n>${data.comment_preview}`,
            },
          },
        ];
        break;

      case "project_status_changed":
        message = `📊 Proyecto actualizado: ${data.name}`;
        blocks = [
          {
            type: "header",
            text: { type: "plain_text", text: "📊 Estatus de Proyecto Actualizado" },
          },
          {
            type: "section",
            fields: [
              { type: "mrkdwn", text: `*Proyecto:*\n${data.name}` },
              { type: "mrkdwn", text: `*Nuevo estatus:*\n${data.status}` },
              { type: "mrkdwn", text: `*Cliente:*\n${data.client_name || "N/A"}` },
            ],
          },
        ];
        break;

      case "deadline_created":
        message = `⚖️ Nuevo término/fecha clave: ${data.title}`;
        blocks = [
          {
            type: "header",
            text: { type: "plain_text", text: "⚖️ Término / Fecha Clave Registrada" },
          },
          {
            type: "section",
            fields: [
              { type: "mrkdwn", text: `*Título:*\n${data.title}` },
              { type: "mrkdwn", text: `*Tipo:*\n${data.type || "Término"}` },
              { type: "mrkdwn", text: `*Fecha:*\n${data.date}` },
              { type: "mrkdwn", text: `*Hora:*\n${data.time || "Sin hora"}` },
            ],
          },
          ...(data.attendees
            ? [
                {
                  type: "context",
                  elements: [
                    { type: "mrkdwn", text: `👥 Asistirán: ${data.attendees}` },
                  ],
                },
              ]
            : []),
          ...(data.assigned_to && data.assigned_to !== "Sin asignar"
            ? [
                {
                  type: "context",
                  elements: [
                    { type: "mrkdwn", text: `📌 Responsable: ${data.assigned_to}` },
                  ],
                },
              ]
            : []),
        ];
        break;

      case "mtg_minutes_approved": {
        // Nunca incluir minuta completa ni transcripción.
        const counts = data.movement_counts || {};
        const countLine = Object.entries(counts)
          .map(([k, v]) => `${k}: ${v}`)
          .join(", ") || "—";
        const agreements: Array<{ text?: string; owner?: string; due_date?: string }> =
          data.confirmed_agreements || [];
        const agrLines =
          agreements.length === 0
            ? "_Sin acuerdos confirmados_"
            : agreements
                .slice(0, 12)
                .map(
                  (a) =>
                    `• ${a.text || "—"} — ${a.owner || "—"} — ${a.due_date || "sin fecha"}`,
                )
                .join("\n");
        message = `✅ Minuta aprobada: ${data.title || "Junta"}`;
        blocks = [
          {
            type: "header",
            text: { type: "plain_text", text: "✅ Minuta aprobada (Múuch')" },
          },
          {
            type: "section",
            fields: [
              { type: "mrkdwn", text: `*Serie:*\n${data.title || "—"}` },
              { type: "mrkdwn", text: `*Ancla:*\n${data.anchor_label || "—"}` },
              {
                type: "mrkdwn",
                text: `*Fecha:*\n${(data.scheduled_at || "").slice(0, 10) || "—"}`,
              },
              { type: "mrkdwn", text: `*Movimientos:*\n${countLine}` },
            ],
          },
          {
            type: "section",
            text: { type: "mrkdwn", text: `*Acuerdos confirmados:*\n${agrLines}` },
          },
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: data.link ? `<${data.link}|Abrir minuta>` : "—",
            },
          },
        ];
        break;
      }

      default:
        return new Response(
          JSON.stringify({ error: "Unknown event type" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
    }

    // Canal del payload (p. ej. mtg_series.slack_channel_id) o default del secret.
    const targetChannel =
      (typeof data.channel === "string" && data.channel.trim()) || SLACK_CHANNEL;

    // Send to Slack
    const slackRes = await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${SLACK_BOT_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        channel: targetChannel,
        text: message,
        blocks,
      }),
    });

    const slackData = await slackRes.json();

    if (!slackData.ok) {
      console.error("Slack API error:", slackData);
      return new Response(
        JSON.stringify({ error: "Slack API error", details: slackData.error }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    return new Response(
      JSON.stringify({ success: true, ts: slackData.ts }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error) {
    console.error("Error sending notification:", error);
    return new Response(
      JSON.stringify({ error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
