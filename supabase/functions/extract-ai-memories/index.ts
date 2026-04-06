import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages";

function modelId(): string {
  return (Deno.env.get("EXTRACT_MEMORIES_ANTHROPIC_MODEL") || "").trim() ||
    "claude-3-5-haiku-20241022";
}

async function sha256Hex(text: string): Promise<string> {
  const data = new TextEncoder().encode(text);
  const buf = await crypto.subtle.digest("SHA-256", data);
  return Array.from(new Uint8Array(buf)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

type Body = { conversation_id?: string };

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

    const { conversation_id: convId } = (await req.json().catch(() => ({}))) as Body;
    if (!convId?.trim()) {
      return new Response(JSON.stringify({ error: "conversation_id requerido" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: conv, error: cErr } = await userClient
      .from("chat_conversations")
      .select("id, user_id, organization_id")
      .eq("id", convId)
      .maybeSingle();

    if (cErr || !conv || conv.user_id !== user.id) {
      return new Response(JSON.stringify({ error: "Conversación no permitida" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const orgId = conv.organization_id as string;

    const { data: msgs, error: mErr } = await userClient
      .from("chat_messages")
      .select("role, content")
      .eq("conversation_id", convId)
      .order("created_at", { ascending: false })
      .limit(6);

    if (mErr || !msgs?.length) {
      return new Response(JSON.stringify({ ok: true, inserted: 0 }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const chronological = [...msgs].reverse();
    const transcript = chronological
      .map((m) => `${m.role}: ${String(m.content || "").slice(0, 2000)}`)
      .join("\n---\n")
      .slice(0, 12000);

    const prompt =
      `Del siguiente intercambio de chat interno, extrae de 0 a 3 "memorias" persistentes útiles para futuras conversaciones del MISMO usuario.\n` +
      `Tipos permitidos: preference (preferencias de estilo o formato), pattern (patrones de trabajo), knowledge (hecho estable sobre su rol/cliente), context (contexto operativo breve).\n` +
      `No inventes. Si no hay nada digno de recordar, devuelve array vacío.\n\n` +
      `${transcript}\n\n` +
      `Responde SOLO JSON válido: {"memories":[{"memory_type":"preference"|"pattern"|"knowledge"|"context","content":string}]}\n` +
      `content: español, máximo 240 caracteres cada una.`;

    const resp = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: modelId(),
        max_tokens: 500,
        messages: [{ role: "user", content: prompt }],
      }),
    });

    if (!resp.ok) {
      console.warn("extract-ai-memories:", await resp.text());
      return new Response(JSON.stringify({ ok: false }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const data = await resp.json();
    const text = (data.content?.find((b: { type?: string }) => b.type === "text") as { text?: string } | undefined)
      ?.text?.trim() || "";

    let memories: { memory_type?: string; content?: string }[] = [];
    try {
      const a = text.indexOf("{");
      const b = text.lastIndexOf("}");
      if (a >= 0 && b > a) {
        const j = JSON.parse(text.slice(a, b + 1));
        if (Array.isArray(j.memories)) memories = j.memories;
      }
    } catch {
      /* ignore */
    }

    const svc = createClient(supabaseUrl, serviceKey);
    const allowed = new Set(["preference", "pattern", "knowledge", "context"]);
    let inserted = 0;

    for (const m of memories) {
      const mt = String(m.memory_type || "");
      const content = String(m.content || "").trim();
      if (!allowed.has(mt) || content.length < 8) continue;
      const hash = await sha256Hex(`${mt}:${content.toLowerCase()}`);
      const { error: insErr } = await svc.from("ai_user_memories").insert({
        organization_id: orgId,
        user_id: user.id,
        memory_type: mt,
        content: content.slice(0, 500),
        content_hash: hash,
        source_conversation_id: convId,
        enabled: true,
      });
      if (!insErr) inserted += 1;
    }

    return new Response(JSON.stringify({ ok: true, inserted }), {
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
