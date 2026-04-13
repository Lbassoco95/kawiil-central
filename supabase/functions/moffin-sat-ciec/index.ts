import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { encryptFielSecret } from "../_shared/moffinFielCrypto.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type Action = "status" | "save" | "delete";

function ciecSecret(): string {
  const dedicated = Deno.env.get("MOFFIN_SAT_CIEC_SECRET")?.trim() ?? "";
  if (dedicated.length >= 32) return dedicated;
  return Deno.env.get("MOFFIN_FIEL_SECRET")?.trim() ?? "";
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const secret = ciecSecret();

  const rawAuth =
    req.headers.get("Authorization") ??
    req.headers.get("authorization") ??
    "";
  const bearerMatch = rawAuth.match(/^Bearer\s+(\S+)/i);
  const accessToken = bearerMatch?.[1];
  if (!accessToken) {
    return new Response(JSON.stringify({ error: "No autorizado" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userClient = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const { data: userData, error: authError } = await userClient.auth.getUser(accessToken);
  const user = userData?.user;
  if (authError || !user) {
    console.error("moffin-sat-ciec auth:", authError?.message ?? "sin usuario");
    return new Response(JSON.stringify({ error: "No autorizado" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: { action?: Action; clientId?: string; ciec?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "JSON inválido" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const action = body.action;
  const clientId = body.clientId?.trim();
  const allowed: Action[] = ["status", "save", "delete"];
  if (!clientId || !action || !allowed.includes(action)) {
    return new Response(
      JSON.stringify({ error: "clientId y action (status|save|delete) requeridos" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const { data: profile, error: profErr } = await userClient
    .from("profiles")
    .select("organization_id")
    .eq("user_id", user.id)
    .single();
  if (profErr || !profile?.organization_id) {
    return new Response(JSON.stringify({ error: "Perfil no encontrado" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const { data: client, error: clientErr } = await userClient
    .from("clients")
    .select("id, organization_id")
    .eq("id", clientId)
    .single();
  if (clientErr || !client || client.organization_id !== profile.organization_id) {
    return new Response(JSON.stringify({ error: "Cliente no encontrado o sin acceso" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(supabaseUrl, serviceKey);

  if (action === "status") {
    const { data: row } = await admin
      .from("moffin_client_sat_ciec")
      .select("moffin_profile_id, updated_at")
      .eq("client_id", clientId)
      .maybeSingle();
    return new Response(
      JSON.stringify({
        configured: !!row,
        profileId: row?.moffin_profile_id ?? null,
        updatedAt: row?.updated_at ?? null,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (action === "delete") {
    await admin.from("moffin_client_sat_ciec").delete().eq("client_id", clientId);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (secret.length < 32) {
    return new Response(
      JSON.stringify({
        error: "ciec_not_configured",
        message:
          "Configura MOFFIN_SAT_CIEC_SECRET o MOFFIN_FIEL_SECRET (≥32 caracteres) en Edge Functions para guardar CIEC.",
      }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const ciecRaw = typeof body.ciec === "string" ? body.ciec.trim() : "";
  if (!ciecRaw) {
    return new Response(
      JSON.stringify({
        error: "ciec_required",
        message: "Envía el campo ciec (clave CIEC del SAT).",
      }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const ciecEnc = await encryptFielSecret(ciecRaw, secret);
    const { error: upErr } = await admin.from("moffin_client_sat_ciec").upsert(
      {
        organization_id: client.organization_id,
        client_id: clientId,
        ciec_ciphertext: ciecEnc,
        moffin_profile_id: null,
        updated_at: new Date().toISOString(),
        updated_by: user.id,
      },
      { onConflict: "client_id" },
    );
    if (upErr) {
      console.error("moffin_client_sat_ciec upsert:", upErr.message);
      return new Response(JSON.stringify({ error: upErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return new Response(JSON.stringify({ error: "encrypt_failed", message: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
