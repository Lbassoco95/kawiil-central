/**
 * Inicia OAuth de Slack (token de usuario). En la app Slack: Redirect URL =
 * {SUPABASE_URL}/functions/v1/slack-user-callback
 * Scopes de usuario (user_scope): channels:history,channels:read,groups:history,groups:read,
 * im:history,im:read,mpim:history,mpim:read,users:read,users:read.email,chat:write,files:write
 * Event Subscriptions (misma app, slack-events): message.channels, message.groups, message.im, message.mpim
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const DEFAULT_USER_SCOPES = [
  "channels:history",
  "channels:read",
  "groups:history",
  "groups:read",
  "im:history",
  "im:read",
  "mpim:history",
  "mpim:read",
  "users:read",
  "users:read.email",
  "chat:write",
  "files:write",
].join(",");

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );

    const { data: { user }, error: userError } = await supabase.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const clientId = Deno.env.get("SLACK_CLIENT_ID")?.trim();
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!.replace(/\/$/, "");
    const redirectUri = `${supabaseUrl}/functions/v1/slack-user-callback`;

    if (!clientId) {
      return new Response(JSON.stringify({ error: "Slack OAuth not configured" }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userScope = Deno.env.get("SLACK_USER_SCOPES")?.trim() || DEFAULT_USER_SCOPES;

    const authUrl = "https://slack.com/oauth/v2/authorize?" +
      new URLSearchParams({
        client_id: clientId,
        user_scope: userScope,
        redirect_uri: redirectUri,
        state: user.id,
      }).toString();

    return new Response(JSON.stringify({ url: authUrl }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("slack-user-auth:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
