import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

function hostPreview(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return "";
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "GET" && req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const authHeader = req.headers.get("Authorization");
  if (!authHeader?.startsWith("Bearer ")) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const caller = createClient(supabaseUrl, anon, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await caller.auth.getUser();
  if (userErr || !user) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: isMgr } = await admin.rpc("is_admin_or_manager", { _user_id: user.id });
  if (!isMgr) {
    return new Response(
      JSON.stringify({ error: "Forbidden", message: "Solo administradores o referentes." }),
      { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const apiKey = Deno.env.get("MOFFIN_API_KEY");
  const baseUrl = (Deno.env.get("MOFFIN_BASE_URL") ?? "").replace(/\/$/, "");
  const svix = Deno.env.get("MOFFIN_SVIX_SIGNING_SECRET");

  const missing: string[] = [];
  if (!apiKey?.trim()) missing.push("MOFFIN_API_KEY");
  if (!baseUrl) missing.push("MOFFIN_BASE_URL");
  if (!svix?.trim()) missing.push("MOFFIN_SVIX_SIGNING_SECRET");

  const ok = missing.length === 0;

  // 200 siempre para que supabase.functions.invoke entregue el JSON (incluso si faltan secretos).
  return new Response(
    JSON.stringify({
      ok,
      missing,
      baseUrlHost: baseUrl ? hostPreview(baseUrl.startsWith("http") ? baseUrl : `https://${baseUrl}`) : null,
      looksLikeSandbox: /sandbox\.moffin/i.test(baseUrl),
      hint: ok
        ? "Credenciales presentes en el servidor (no se muestran valores)."
        : "Configura los secretos en Supabase → Edge Functions → Secrets.",
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
