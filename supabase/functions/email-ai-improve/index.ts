import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
/**
 * email-ai-improve
 * ----------------
 * Reescribe / mejora el cuerpo de un correo según un modo:
 *   - "improve"  → mejora redacción manteniendo intención y largo
 *   - "shorter"  → versión más corta y directa
 *   - "formal"   → más profesional / formal
 *   - "friendly" → más cordial y cercana
 *
 * Body:
 *   {
 *     bodyHtml: string,             // cuerpo actual (puede traer firma)
 *     mode?: "improve" | "shorter" | "formal" | "friendly",
 *     subject?: string,
 *     to?: string,
 *     userName?: string,
 *     locale?: "es" | "en"
 *   }
 *
 * Respuesta:
 *   { improvedHtml: string, mode: string, model: string }
 *
 * Requiere `verify_jwt = true`. Usa ANTHROPIC_API_KEY.
 */

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

function normalizeClaudeModel(raw: string | undefined, fallback: string): string {
  const m = raw?.trim() || "";
  if (!m) return fallback;
  if (m.toLowerCase().includes("opus")) return "claude-opus-4-8";
  if (m.toLowerCase().includes("sonnet")) return "claude-sonnet-4-6";
  if (m.toLowerCase().includes("haiku")) return "claude-haiku-4-5";
  return m;
}
const DEFAULT_MODEL = normalizeClaudeModel(
  Deno.env.get("KAWIIL_AI_MODEL") || Deno.env.get("KAWIIL_AI_FAST_MODEL"),
  "claude-haiku-4-5",
);

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
        return "Make the email noticeably shorter while keeping the intent and tone. Keep paragraphs.";
      case "formal":
        return "Rewrite in a more professional, formal business tone (still concise).";
      case "friendly":
        return "Rewrite in a warmer, friendlier tone (still professional).";
      default:
        return "Improve clarity, grammar and natural flow without changing the meaning. Keep approximately the same length.";
    }
  }
  switch (mode) {
    case "shorter":
      return "Acórtalo notablemente conservando la intención y el tono. Mantén la estructura por párrafos.";
    case "formal":
      return "Reescríbelo en un tono más profesional y formal (sigue siendo conciso).";
    case "friendly":
      return "Reescríbelo en un tono más cálido y cercano (sin perder profesionalismo).";
    default:
      return "Mejora claridad, gramática y fluidez natural sin cambiar el significado. Mantén aproximadamente el mismo largo.";
  }
}

/**
 * Detecta el bloque de firma para preservarlo. Heurística: el usuario suele tener
 * un separador "—", "Saludos,", "Atte." u OutlookHeader. Si no encontramos firma,
 * no separamos nada.
 */
function splitBodyAndSignature(html: string): { body: string; signature: string } {
  if (!html) return { body: "", signature: "" };
  // si hay un comentario "<!--Signature-->" típico de Outlook
  const sigMarker = html.indexOf("<!--Signature-->");
  if (sigMarker >= 0) {
    return { body: html.slice(0, sigMarker), signature: html.slice(sigMarker) };
  }
  return { body: html, signature: "" };
}

serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return jsonResponse({ error: "Unauthorized" }, 401);

    // El gateway ya validó el JWT (verify_jwt=true). Evitar `auth.getUser()`
    // porque cuelga bajo carga con connection reset contra /auth/v1/user.

    const payload = (await req.json().catch(() => ({}))) as {
      bodyHtml?: string;
      mode?: string;
      subject?: string;
      to?: string;
      userName?: string;
      locale?: "es" | "en";
    };

    const bodyHtmlRaw = (payload.bodyHtml || "").trim();
    if (!bodyHtmlRaw) {
      return jsonResponse({ error: "empty_body", message: "Falta el cuerpo a mejorar." }, 400);
    }
    if (bodyHtmlRaw.length > 16000) {
      return jsonResponse({ error: "body_too_long", message: "Cuerpo muy largo (>16000 chars)." }, 400);
    }

    const mode: Mode = (MODES as readonly string[]).includes(payload.mode || "")
      ? (payload.mode as Mode)
      : "improve";
    const subject = (payload.subject || "").trim();
    const to = (payload.to || "").trim();
    const userName = (payload.userName || "").trim();
    const locale = payload.locale === "en" ? "en" : "es";

    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      return jsonResponse({
        error: "ai_not_configured",
        message: "Falta el secreto ANTHROPIC_API_KEY en Edge Functions.",
      }, 503);
    }

    const { body: editableBody, signature } = splitBodyAndSignature(bodyHtmlRaw);

    const systemPrompt = locale === "en"
      ? "You rewrite professional emails. Output ONLY the rewritten HTML body (use <p> for paragraphs, no <html>/<body>/<style>, no markdown fences, no explanations). Do not invent facts."
      : "Reescribes correos profesionales. Devuelve SOLO el HTML reescrito del cuerpo (usa <p> para párrafos, sin <html>/<body>/<style>, sin fences markdown, sin explicaciones). No inventes datos.";

    const ctxLines: string[] = [];
    if (subject) ctxLines.push(locale === "en" ? `Subject: ${subject}` : `Asunto: ${subject}`);
    if (to) ctxLines.push(locale === "en" ? `To: ${to}` : `Para: ${to}`);
    if (userName) ctxLines.push(locale === "en" ? `Sender: ${userName}` : `Remitente: ${userName}`);

    const userPrompt = locale === "en"
      ? `${modeInstruction(mode, locale)}
${ctxLines.length > 0 ? `\nContext:\n${ctxLines.join("\n")}\n` : ""}
Original HTML body (without signature):
"""
${editableBody}
"""

Return ONLY the rewritten HTML body. Do NOT include the signature; it will be re-appended by the client.`
      : `${modeInstruction(mode, locale)}
${ctxLines.length > 0 ? `\nContexto:\n${ctxLines.join("\n")}\n` : ""}
Cuerpo HTML original (sin firma):
"""
${editableBody}
"""

Devuelve SOLO el HTML del cuerpo reescrito. NO incluyas la firma; el cliente la vuelve a anexar.`;

    const aiResp = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        max_tokens: 1500,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }),
    });

    if (!aiResp.ok) {
      const txt = await aiResp.text();
      console.error("email-ai-improve anthropic error", aiResp.status, txt.slice(0, 400));
      return jsonResponse({ error: "ai_provider_error", status: aiResp.status, detail: txt.slice(0, 400) }, 502);
    }

    const aiData = await aiResp.json() as { content?: Array<{ type?: string; text?: string }> };
    let raw = aiData.content?.find((b) => b.type === "text")?.text?.trim() || "";

    // Limpia posibles fences ```html ... ```
    raw = raw.replace(/^```html\s*/i, "").replace(/```$/, "").trim();
    raw = raw.replace(/^"""([\s\S]*?)"""$/m, "$1").trim();

    if (!raw) {
      return jsonResponse({ error: "empty_improvement" }, 502);
    }

    const improvedHtml = signature ? `${raw}${signature}` : raw;

    return jsonResponse({ improvedHtml, mode, model: DEFAULT_MODEL });
  } catch (e) {
    console.error("email-ai-improve error", e);
    return jsonResponse({ error: e instanceof Error ? e.message : "unknown" }, 500);
  }
});
