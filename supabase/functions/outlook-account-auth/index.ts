import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

// Inicia OAuth para conectar una cuenta ADICIONAL de Outlook/Microsoft (se guarda
// en linked_accounts, aparte del buzón principal que vive en microsoft_tokens).
Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

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

    const clientId = Deno.env.get("MICROSOFT_CLIENT_ID")?.trim();
    // Cuentas ADICIONALES: usamos 'common' por defecto para permitir cualquier
    // organización Microsoft (requiere que la app de Azure sea multitenant).
    // Se puede fijar un tenant específico con MICROSOFT_LINKED_TENANT_ID.
    const tenantId = Deno.env.get("MICROSOFT_LINKED_TENANT_ID")?.trim() || "common";
    const redirectUri = `${Deno.env.get("SUPABASE_URL")}/functions/v1/outlook-account-callback`;
    if (!clientId) {
      return new Response(JSON.stringify({ error: "Microsoft credentials not configured" }), { status: 500, headers: corsHeaders });
    }

    const scopes = [
      "openid", "profile", "email", "offline_access",
      "Calendars.ReadWrite", "User.Read",
    ].join(" ");

    const authUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?` +
      new URLSearchParams({
        client_id: clientId,
        response_type: "code",
        redirect_uri: redirectUri,
        scope: scopes,
        response_mode: "query",
        state: user.id,
        prompt: "select_account",
      }).toString();

    return new Response(JSON.stringify({ url: authUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Error in outlook-account-auth:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), { status: 500, headers: corsHeaders });
  }
});
