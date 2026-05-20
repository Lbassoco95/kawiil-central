import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
/**
 * slack-ai-improve
 * ----------------
 * Reescribe / mejora un borrador de mensaje de Slack según un modo:
 *   - "improve"  → mejora redacción manteniendo intención y largo
 *   - "shorter"  → versión más corta y directa (1-2 líneas)
 *   - "formal"   → versión más profesional / formal
 *   - "friendly" → versión más cordial y cálida
 *
 * Body:
 *   {
 *     draft: string,                   // borrador actual del usuario
 *     mode?: "improve" | "shorter" | "formal" | "friendly",
 *     channelTitle?: string,
 *     channelType?: "channel" | "private" | "im" | "mpim",
 *     userName?: string,
 *     locale?: "es" | "en"
 *   }
 *
 * Respuesta:
 *   { improved: string, mode: string, model: string }
 *
 * Requiere `verify_jwt = true`. Usa ANTHROPIC_API_KEY.
 */

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";
const DEFAULT_MODEL = "claude-sonnet-4-6";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function jsonResponse(payload: unknown, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

const MODES = ["improve", "shorter", "formal", "friendly"] as const;
type Mode = typeof MODES[number];

function modeInstruction(mode: Mode, locale: "es" | "en"): string {
  if (locale === "en") {
    switch (mode) {
      case "shorter":
        return "Shorten to at most 2 short lines while keeping the original intent. Cut filler.";
      case "formal":
        return "Rewrite in a more professional and formal tone, but still concise (Slack-friendly).";
      case "friendly":
        return "Rewrite in a warmer, friendlier tone (still professional). Keep it concise.";
      default:
        return "Improve clarity, grammar and natural flow without changing the meaning. Keep approximately the same length.";
    }
  }
  switch (mode) {
    case "shorter":
      return "Acórtalo a máximo 2 líneas, manteniendo la intención. Quita relleno.";
    case "formal":
      return "Reescríbelo en un tono más profesional y formal, pero sigue conciso (Slack-friendly).";
    case "friendly":
      return "Reescríbelo en un tono más cálido y cercano (sin perder profesionalismo). Mantenlo conciso.";
    default:
      return "Mejora claridad, gramática y fluidez natural sin cambiar el significado. Mantén aproximadamente el mismo largo.";
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return jsonResponse({ error: "Unauthorized" }, 401);

    // El gateway ya validó el JWT (verify_jwt=true). Evitar `auth.getUser()`
    // porque cuelga bajo carga con connection reset contra /auth/v1/user.

    const payload = (await req.json().catch(() => ({}))) as {
      draft?: string;
      mode?: string;
      channelTitle?: string;
      channelType?: string;
      userName?: string;
      locale?: "es" | "en";
    };

    const draft = (payload.draft || "").trim();
    if (!draft) {
      return jsonResponse({ error: "empty_draft", message: "Falta el borrador a mejorar." }, 400);
    }
    if (draft.length > 4000) {
      return jsonResponse({ error: "draft_too_long", message: "Borrador muy largo (>4000 chars)." }, 400);
    }

    const mode: Mode = (MODES as readonly string[]).includes(payload.mode || "")
      ? (payload.mode as Mode)
      : "improve";
    const channelTitle = (payload.channelTitle || "").trim();
    const channelType = (payload.channelType || "channel").trim();
    const userName = (payload.userName || "").trim();
    const locale = payload.locale === "en" ? "en" : "es";

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      return jsonResponse({
        error: "ai_not_configured",
        message: "Falta el secreto ANTHROPIC_API_KEY en Edge Functions.",
      }, 503);
    }

    const systemPrompt = locale === "en"
      ? "You rewrite Slack messages. Output ONLY the rewritten message, no explanations, no quotes, no markdown fences."
      : "Reescribes mensajes de Slack. Devuelve SOLO el mensaje reescrito, sin explicaciones, sin comillas, sin fences markdown.";

    const contextLine = channelTitle
      ? locale === "en"
        ? `Context: ${channelType === "im" ? "DM" : channelType === "mpim" ? "group DM" : channelType === "private" ? "private channel" : "channel"} "${channelTitle}".`
        : `Contexto: ${channelType === "im" ? "DM" : channelType === "mpim" ? "DM grupal" : channelType === "private" ? "canal privado" : "canal"} "${channelTitle}".`
      : "";

    const signatureLine = userName
      ? (locale === "en" ? `Sent by: ${userName}.` : `Lo envía: ${userName}.`)
      : "";

    const userPrompt = locale === "en"
      ? `${modeInstruction(mode, locale)}
${contextLine}
${signatureLine}
Keep Slack mrkdwn (mentions like <@U123>, links, *bold*, _italic_, code) intact when present.

Original draft:
"""
${draft}
"""

Return ONLY the rewritten message.`
      : `${modeInstruction(mode, locale)}
${contextLine}
${signatureLine}
Conserva el mrkdwn de Slack (menciones <@U123>, links, *negritas*, _cursiva_, code) si existen.

Borrador original:
"""
${draft}
"""

Devuelve SOLO el mensaje reescrito.`;

    const aiResp = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        max_tokens: 600,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!aiResp.ok) {
      const txt = await aiResp.text();
      console.error("slack-ai-improve anthropic error", aiResp.status, txt.slice(0, 400));
      return jsonResponse({ error: "ai_provider_error", status: aiResp.status, detail: txt.slice(0, 400) }, 502);
    }

    const aiData = await aiResp.json() as { content?: Array<{ type?: string; text?: string }> };
    const rawText = aiData.content?.find((b) => b.type === "text")?.text?.trim() || "";

    const improved = rawText
      .replace(/^"""([\s\S]*?)"""$/m, "$1")
      .replace(/^"(.*)"$/s, "$1")
      .trim();

    if (!improved) {
      return jsonResponse({ error: "empty_improvement" }, 502);
    }

    return jsonResponse({ improved, mode, model: DEFAULT_MODEL });
  } catch (e) {
    console.error("slack-ai-improve error", e);
    return jsonResponse({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});
