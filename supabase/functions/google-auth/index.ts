import { signOAuthState } from "../_shared/oauthState.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Inicia el flujo OAuth de Google. Devuelve la URL de consentimiento; el cliente
// la abre en un popup y espera el postMessage de google-callback.
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const clientId = Deno.env.get("GOOGLE_CLIENT_ID")?.trim();
    const redirectUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/google-callback`;

    if (!clientId) {
      return new Response(JSON.stringify({ error: "Google credentials not configured" }), { status: 500, headers: corsHeaders });
    }

    // Permiso OPCIONAL de Drive para los agentes: una autorización aparte (solo lectura) que se SUMA a lo ya concedido (include_granted_scopes).
    // El flujo normal de conexión no cambia: sin `extra` se piden los mismos permisos de siempre.
    let extra = "";
    let loginHint = "";
    if (req.method === "POST") {
      const b = await req.json().catch(() => ({}));
      extra = b?.extra === "drive" ? "drive" : "";
      loginHint = typeof b?.email === "string" && /^[^\s@<>]{1,64}@[^\s@<>]{1,255}$/.test(b.email) ? b.email : "";
    }
    const scopes = (extra === "drive"
      ? ["openid", "email", "profile", "https://www.googleapis.com/auth/drive.readonly"]
      : [
        "openid",
        "email",
        "profile",
        "https://www.googleapis.com/auth/calendar",
        "https://www.googleapis.com/auth/gmail.modify",
        "https://www.googleapis.com/auth/gmail.send",
      ]).join(" ");

    const authUrl = "https://accounts.google.com/o/oauth2/v2/auth?" +
      new URLSearchParams({
        client_id: clientId,
        response_type: "code",
        redirect_uri: redirectUri,
        scope: scopes,
        state: await signOAuthState("google", { u: user.id }),
        access_type: "offline",
        include_granted_scopes: "true",
        prompt: "consent",
        ...(loginHint ? { login_hint: loginHint } : {}),
      }).toString();

    return new Response(JSON.stringify({ url: authUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in google-auth:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
