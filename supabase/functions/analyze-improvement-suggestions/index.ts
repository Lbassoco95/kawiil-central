import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

function modelId(): string {
  return (Deno.env.get("ANALYZE_SUGGESTIONS_ANTHROPIC_MODEL") || "").trim() ||
    "claude-3-5-haiku-20241022";
}

type AnalyzeBody = { message_id?: string };

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ ok: false, skip: "no_anthropic" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: authError } = await userClient.auth.getUser();
    if (authError || !user) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const body = (await req.json().catch(() => ({}))) as AnalyzeBody;
    const messageId = body.message_id?.trim();
    if (!messageId) {
      return new Response(JSON.stringify({ error: "message_id requerido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: row, error: msgErr } = await userClient
      .from("chat_messages")
      .select("id, role, content, conversation_id")
      .eq("id", messageId)
      .maybeSingle();

    if (msgErr || !row || row.role !== "user") {
      return new Response(JSON.stringify({ error: "Mensaje no encontrado" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const content = String(row.content || "").trim();
    if (content.length < 20) {
      return new Response(JSON.stringify({ ok: true, skip: "too_short" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const svc = createClient(supabaseUrl, serviceKey);

    const { data: existing } = await svc
      .from("improvement_suggestions")
      .select("id")
      .eq("chat_message_id", messageId)
      .maybeSingle();
    if (existing) {
      return new Response(JSON.stringify({ ok: true, skip: "already_recorded" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: conv, error: convErr } = await userClient
      .from("chat_conversations")
      .select("id, user_id, organization_id")
      .eq("id", row.conversation_id)
      .maybeSingle();

    if (convErr || !conv || conv.user_id !== user.id) {
      return new Response(JSON.stringify({ error: "Conversación no permitida" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const orgId = conv.organization_id as string;

    const prompt =
      `Eres un analista de producto. El siguiente texto es un mensaje de un usuario interno en un chat con su asistente de trabajo.\n` +
      `Determina si el usuario está sugiriendo una mejora al producto/plataforma (ej. "deberían", "falta que", "sería mejor si", "no puedo hacer X", "hace falta").\n` +
      `Ignora quejas puramente sobre un cliente o tema fiscal salvo que claramente pidan cambiar la herramienta.\n\n` +
      `Mensaje:\n"""${content.slice(0, 8000)}"""\n\n` +
      `Responde SOLO un JSON válido en una línea, sin markdown, con esta forma exacta:\n` +
      `{"has_suggestion":boolean,"category":string,"suggestion_text":string,"summary":string}\n` +
      `- category: una etiqueta corta en español (ej. "navegación", "IA/chat", "reportes", "otro").\n` +
      `- suggestion_text: frase clara de la mejora propuesta (español).\n` +
      `- summary: una oración para el equipo de producto.\n` +
      `Si no hay sugerencia de producto, has_suggestion false y los strings vacíos.`;

    const resp = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: modelId(),
        max_tokens: 400,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!resp.ok) {
      const t = await resp.text();
      console.warn("analyze-improvement-suggestions anthropic:", resp.status, t.slice(0, 300));
      return new Response(JSON.stringify({ ok: false, error: "model_error" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const text = (data.content?.find((b: { type?: string }) => b.type === "text") as { text?: string } | undefined)
      ?.text?.trim() || "";
    let parsed: {
      has_suggestion?: boolean;
      category?: string;
      suggestion_text?: string;
      summary?: string;
    } = {};
    try {
      const jsonStart = text.indexOf("{");
      const jsonEnd = text.lastIndexOf("}");
      if (jsonStart >= 0 && jsonEnd > jsonStart) {
        parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
      }
    } catch {
      console.warn("analyze-improvement-suggestions parse fail:", text.slice(0, 200));
    }

    if (!parsed.has_suggestion || !parsed.suggestion_text?.trim()) {
      return new Response(JSON.stringify({ ok: true, skip: "no_suggestion" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const category = (parsed.category || "otro").slice(0, 120);
    const suggestionText = parsed.suggestion_text.trim().slice(0, 4000);
    const summaryObj = {
      text: (parsed.summary || suggestionText).slice(0, 500),
    };

    const { data: inserted, error: insErr } = await svc
      .from("improvement_suggestions")
      .insert({
        organization_id: orgId,
        user_id: user.id,
        conversation_id: row.conversation_id,
        chat_message_id: messageId,
        suggestion_text: suggestionText,
        category,
        summary: summaryObj,
        status: "pending",
      })
      .select("id")
      .single();

    if (insErr) {
      console.error("improvement_suggestions insert:", insErr);
      return new Response(JSON.stringify({ ok: false, error: insErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const suggestionId = inserted?.id as string;

    const { data: admins } = await svc
      .from("user_module_permissions")
      .select("user_id")
      .eq("organization_id", orgId)
      .eq("module_key", "admin")
      .eq("enabled", true);

    const targets = new Set<string>();
    for (const a of admins || []) {
      if (a.user_id) targets.add(a.user_id as string);
    }

    for (const uid of targets) {
      await svc.from("notifications").insert({
        user_id: uid,
        organization_id: orgId,
        type: "improvement_suggestion",
        title: "Nueva sugerencia de mejora",
        body: summaryObj.text,
        entity_type: "improvement_suggestion",
        entity_id: suggestionId,
        source_user_id: user.id,
        is_read: false,
      });
    }

    return new Response(JSON.stringify({ ok: true, id: suggestionId }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
