import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "GET") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const callerClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_ANON_KEY")!, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: userError,
    } = await callerClient.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const adminClient = createClient(supabaseUrl, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { data: savioOk } = await adminClient.rpc("can_view_savio_finance", { _user_id: user.id });
    if (!savioOk) {
      return new Response(
        JSON.stringify({
          error: "Forbidden",
          message: "No tienes permiso para ver ingresos Savio (finance_income_viewers).",
        }),
        { status: 403, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const base = (Deno.env.get("SAVIO_API_BASE_URL") || "").replace(/\/$/, "");
    const apiKey = Deno.env.get("SAVIO_API_KEY");
    const missing: string[] = [];
    if (!base) missing.push("SAVIO_API_BASE_URL");
    if (!apiKey) missing.push("SAVIO_API_KEY");
    if (missing.length > 0) {
      return new Response(
        JSON.stringify({
          ok: false,
          error: "missing_secrets",
          missing,
          hint: "Supabase Dashboard → Project Settings → Edge Functions → Secrets",
        }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const savioRes = await fetch(`${base}/api/v1/me`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });

    let savioErrorMessage: string | undefined;
    try {
      const j = await savioRes.json();
      if (!savioRes.ok && j && typeof j === "object" && "error" in j) {
        savioErrorMessage = String((j as { error: unknown }).error);
      }
    } catch {
      /* cuerpo no JSON */
    }

    const ok = savioRes.ok;
    const body: Record<string, unknown> = {
      ok,
      savio_http_status: savioRes.status,
      savio_api_base: base,
    };
    if (ok) {
      body.message = "Credenciales Savio API válidas.";
    } else if (savioErrorMessage) {
      body.savio_error = savioErrorMessage;
    }

    return new Response(JSON.stringify(body), {
      status: ok ? 200 : 502,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error("savio-api-health:", e);
    return new Response(JSON.stringify({ ok: false, error: "internal_error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
