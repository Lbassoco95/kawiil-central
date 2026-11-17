import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

/**
 * Intercambia un code OAuth de Dropbox.
 * Requiere sesión de usuario. Los tokens NUNCA se devuelven al navegador:
 * el refresh_token se guarda en `integrations` (service role).
 */
serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization") || "";
    const bearer = authHeader.replace(/^Bearer\s+/i, "").trim();
    if (!bearer) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const caller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const {
      data: { user },
      error: authErr,
    } = await caller.auth.getUser();
    if (authErr || !user) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const APP_KEY = Deno.env.get("DROPBOX_APP_KEY");
    const APP_SECRET = Deno.env.get("DROPBOX_APP_SECRET");
    if (!APP_KEY || !APP_SECRET) {
      return new Response(JSON.stringify({ error: "Dropbox OAuth no configurado" }), {
        status: 503,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { code } = await req.json();
    if (!code || typeof code !== "string") {
      return new Response(JSON.stringify({ error: "Authorization code is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const response = await fetch("https://api.dropboxapi.com/oauth2/token", {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${APP_KEY}:${APP_SECRET}`)}`,
      },
      body: new URLSearchParams({
        code,
        grant_type: "authorization_code",
      }),
    });

    const data = await response.json();
    if (!response.ok) {
      console.error("Dropbox token exchange failed:", data);
      return new Response(JSON.stringify({ error: "Dropbox token exchange failed" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (!data.refresh_token) {
      return new Response(JSON.stringify({ error: "Dropbox no devolvió refresh_token" }), {
        status: 502,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const admin = createClient(supabaseUrl, serviceKey);
    const { data: prof } = await admin
      .from("profiles")
      .select("organization_id")
      .eq("user_id", user.id)
      .maybeSingle();
    const orgId = (prof?.organization_id as string | undefined) ?? null;
    if (!orgId) {
      return new Response(JSON.stringify({ error: "Usuario sin organización" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: existing } = await admin
      .from("integrations")
      .select("id, config")
      .eq("provider", "dropbox")
      .eq("organization_id", orgId)
      .eq("is_active", true)
      .maybeSingle();

    const nextConfig = {
      ...((existing?.config && typeof existing.config === "object") ? existing.config : {}),
      refresh_token: data.refresh_token,
      updated_by: user.id,
      updated_at: new Date().toISOString(),
    };

    if (existing?.id) {
      const { error: updErr } = await admin
        .from("integrations")
        .update({ config: nextConfig, is_active: true })
        .eq("id", existing.id);
      if (updErr) throw updErr;
    } else {
      const { error: insErr } = await admin.from("integrations").insert({
        provider: "dropbox",
        organization_id: orgId,
        is_active: true,
        config: nextConfig,
      });
      if (insErr) throw insErr;
    }

    // No exponer access_token ni refresh_token al cliente.
    return new Response(JSON.stringify({ success: true }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("dropbox-token-exchange:", error);
    return new Response(JSON.stringify({ error: "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
