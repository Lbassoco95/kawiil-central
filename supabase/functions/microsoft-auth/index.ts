import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import {
  encodeMicrosoftOAuthState,
  sanitizeReturnPath,
} from "../_shared/microsoftOAuthState.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

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

    let returnTo = "/microsoft365/calendario";
    let mode: "redirect" | "popup" = "redirect";
    try {
      const body = await req.json();
      if (body && typeof body === "object") {
        if (typeof (body as { returnTo?: unknown }).returnTo === "string") {
          returnTo = sanitizeReturnPath((body as { returnTo: string }).returnTo);
        }
        if ((body as { mode?: unknown }).mode === "popup") mode = "popup";
      }
    } catch {
      /* body vacío u opcional */
    }

    const clientId = Deno.env.get("MICROSOFT_CLIENT_ID")?.trim();
    const tenantId = Deno.env.get("MICROSOFT_TENANT_ID")?.trim();
    const redirectUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/microsoft-callback`;

    if (!clientId || !tenantId) {
      return new Response(JSON.stringify({ error: "Microsoft credentials not configured" }), {
        status: 500,
        headers: corsHeaders,
      });
    }

    const scopes = [
      "openid",
      "profile",
      "email",
      "offline_access",
      "Calendars.ReadWrite",
      "Mail.Read",
      "Mail.ReadWrite",
      "Mail.Send",
      "MailboxSettings.ReadWrite",
      "User.Read",
    ].join(" ");

    // prompt=consent (no select_account): scopes nuevos + evita AADSTS165000 del account picker.
    // El cliente debe usar redirect de página completa (no popup) para conservar cookies de sesión.
    const authUrl =
      `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?` +
      new URLSearchParams({
        client_id: clientId,
        response_type: "code",
        redirect_uri: redirectUri,
        scope: scopes,
        response_mode: "query",
        state: encodeMicrosoftOAuthState({ u: user.id, r: returnTo, m: mode }),
        prompt: "consent",
      }).toString();

    return new Response(JSON.stringify({ url: authUrl, mode }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in microsoft-auth:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
