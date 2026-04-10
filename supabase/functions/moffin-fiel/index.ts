import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  encryptFielSecret,
  sha256HexFromBase64File,
} from "../_shared/moffinFielCrypto.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type Action = "status" | "save" | "delete";

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
  const fielSecret = Deno.env.get("MOFFIN_FIEL_SECRET") ?? "";

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "No autorizado" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userClient = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "No autorizado" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: {
    action?: Action;
    clientId?: string;
    certificateBase64?: string;
    privateKeyBase64?: string;
  };
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
      .from("moffin_client_fiel")
      .select("cert_fingerprint_sha256, updated_at")
      .eq("client_id", clientId)
      .maybeSingle();
    return new Response(
      JSON.stringify({
        configured: !!row,
        certFingerprint: row?.cert_fingerprint_sha256 ?? null,
        updatedAt: row?.updated_at ?? null,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (action === "delete") {
    await admin.from("moffin_client_fiel").delete().eq("client_id", clientId);
    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // save
  if (fielSecret.length < 32) {
    return new Response(
      JSON.stringify({
        error: "fiel_not_configured",
        message:
          "Configura MOFFIN_FIEL_SECRET en Edge Functions (mínimo 32 caracteres) para guardar certificados.",
      }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const certB64 = body.certificateBase64?.trim() ?? "";
  const keyB64 = body.privateKeyBase64?.trim() ?? "";
  if (!certB64 || !keyB64) {
    return new Response(
      JSON.stringify({
        error: "certificate_required",
        message: "Envía certificateBase64 y privateKeyBase64 (archivos .cer y .key en base64).",
      }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  try {
    const certEnc = await encryptFielSecret(certB64, fielSecret);
    const keyEnc = await encryptFielSecret(keyB64, fielSecret);
    const fp = await sha256HexFromBase64File(certB64);

    const { error: upErr } = await admin.from("moffin_client_fiel").upsert(
      {
        organization_id: client.organization_id,
        client_id: clientId,
        cert_ciphertext: certEnc,
        key_ciphertext: keyEnc,
        cert_fingerprint_sha256: fp,
        updated_at: new Date().toISOString(),
        updated_by: user.id,
      },
      { onConflict: "client_id" },
    );
    if (upErr) {
      console.error("moffin_client_fiel upsert:", upErr.message);
      return new Response(JSON.stringify({ error: upErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, certFingerprint: fp }), {
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
