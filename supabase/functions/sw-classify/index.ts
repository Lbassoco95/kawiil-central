// sw-classify — clasifica el motivo del llamante en una célula del Conmutador
// (LIT | CORP | COMP | CONT | PROC) usando Claude Haiku. Objetivo <300ms.
// Si el motivo es ambiguo, devuelve needs_disambiguation=true + pregunta_sugerida.
import { corsHeaders, jsonResponse, checkWebhookAuth } from "../_shared/switchboard-http.ts";
import { callAnthropicText, MODEL_HAIKU } from "../_shared/anthropic.ts";
import { buildClassifyPrompt, parseClassifyResponse } from "../_shared/conmutador.ts";

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  const unauth = checkWebhookAuth(req);
  if (unauth) return unauth;

  try {
    const { motivo } = await req.json().catch(() => ({ motivo: "" }));
    if (!motivo || typeof motivo !== "string") {
      return jsonResponse({ error: "motivo requerido" }, 400);
    }

    const apiKey = Deno.env.get("ANTHROPIC_API_KEY");
    if (!apiKey) return jsonResponse({ error: "ANTHROPIC_API_KEY no configurada" }, 500);

    const { system, user } = buildClassifyPrompt(motivo);
    const raw = await callAnthropicText({
      apiKey,
      model: MODEL_HAIKU,
      system,
      messages: [{ role: "user", content: user }],
      max_tokens: 120,
    });

    const result = parseClassifyResponse(raw);
    return jsonResponse(result);
  } catch (e) {
    console.error("sw-classify error:", e);
    return jsonResponse({ error: String(e) }, 500);
  }
});
