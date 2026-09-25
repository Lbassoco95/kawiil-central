import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { throwMicrosoftOAuthError } from "../_shared/microsoftOAuthErrors.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

async function refreshTokenIfNeeded(supabaseAdmin: any, userId: string, tokenRow: any) {
  const expiresAt = new Date(tokenRow.expires_at);
  if (expiresAt.getTime() - Date.now() > 5 * 60 * 1000) return tokenRow.access_token;
  const clientId = Deno.env.get("MICROSOFT_CLIENT_ID")!.trim();
  const clientSecret = Deno.env.get("MICROSOFT_CLIENT_SECRET")!.trim();
  const tenantId = Deno.env.get("MICROSOFT_TENANT_ID")!.trim();
  const res = await fetch(
    `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId,
        client_secret: clientSecret,
        refresh_token: tokenRow.refresh_token,
        grant_type: "refresh_token",
      }),
    },
  );
  const data = await res.json();
  if (!res.ok) throwMicrosoftOAuthError(data, "Token refresh failed");
  const newExpiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();
  await supabaseAdmin.from("microsoft_tokens").update({
    access_token: data.access_token,
    refresh_token: data.refresh_token || tokenRow.refresh_token,
    expires_at: newExpiresAt,
  }).eq("user_id", userId);
  return data.access_token;
}

async function graphRequest(accessToken: string, path: string, init?: RequestInit) {
  const pathPart = path.startsWith("/") ? path : `/${path}`;
  const res = await fetch(`${GRAPH_BASE}${pathPart}`, {
    ...init,
    headers: { Authorization: `Bearer ${accessToken}`, ...(init?.headers || {}) },
  });
  if (!res.ok) {
    const errorBody = await res.text();
    throw new Error(`Microsoft Graph error [${res.status}]: ${errorBody}`);
  }
  if (res.status === 204) return { success: true };
  const text = await res.text();
  if (!text) return { success: true };
  return JSON.parse(text);
}

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
    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claims?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const userId = claims.claims.sub as string;
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const body = await req.json();
    const { action, params } = body;

    const { data: tokenRow, error: tokenError } = await supabaseAdmin
      .from("microsoft_tokens")
      .select("*")
      .eq("user_id", userId)
      .single();
    if (tokenError || !tokenRow) {
      return new Response(JSON.stringify({ error: "Microsoft not connected", code: "NOT_CONNECTED" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const accessToken = await refreshTokenIfNeeded(supabaseAdmin, userId, tokenRow);

    let result: unknown;
    switch (action) {
      case "check-connection": {
        result = await graphRequest(accessToken, "/me");
        break;
      }
      case "calendars": {
        result = await graphRequest(
          accessToken,
          `/me/calendars?$select=id,name,color,hexColor,isDefaultCalendar,canEdit,owner&$top=100`,
        );
        break;
      }
      case "calendar-events": {
        const start = params?.start || new Date().toISOString();
        const end = params?.end || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        const qs = `startDateTime=${start}&endDateTime=${end}&$orderby=start/dateTime&$top=100`;
        result = await graphRequest(accessToken, `/me/calendarview?${qs}`, {
          headers: { Prefer: 'outlook.timezone="America/Mexico_City"' },
        });
        break;
      }
      case "create-event": {
        result = await graphRequest(accessToken, `/me/events`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(params?.event ?? {}),
        });
        break;
      }
      case "update-event": {
        const encodedEventId = encodeURIComponent(params.eventId);
        result = await graphRequest(accessToken, `/me/events/${encodedEventId}`, {
          method: "PATCH",
          headers: {
            "Content-Type": "application/json",
            Prefer: 'outlook.timezone="America/Mexico_City", return=representation',
          },
          body: JSON.stringify(params.payload),
        });
        break;
      }
      case "delete-event": {
        await graphRequest(accessToken, `/me/events/${params.eventId}`, { method: "DELETE" });
        result = { success: true };
        break;
      }
      case "emails": {
        const top = params?.top || 25;
        const folder = params?.folder || "inbox";
        const select =
          "$select=id,subject,bodyPreview,from,toRecipients,receivedDateTime,sentDateTime,isRead,hasAttachments,importance,conversationId";
        result = await graphRequest(
          accessToken,
          `/me/mailFolders/${folder}/messages?${select}&$top=${top}&$orderby=receivedDateTime desc`,
        );
        break;
      }
      case "email-detail": {
        result = await graphRequest(accessToken, `/me/messages/${params.messageId}`);
        break;
      }
      case "send-email": {
        await graphRequest(accessToken, `/me/sendMail`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ message: params.message }),
        });
        result = { success: true };
        break;
      }
      default: {
        return new Response(
          JSON.stringify({
            error: "Acción no reconocida o microsoft-api desactualizada.",
            code: "UNKNOWN_ACTION",
            action: action ?? null,
          }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Microsoft API error:", error);
    const message = (error as Error).message || "Unknown error";
    if (message.startsWith("MICROSOFT_AUTH_CONFIG_EXPIRED:")) {
      return new Response(JSON.stringify({
        error: message.replace("MICROSOFT_AUTH_CONFIG_EXPIRED:", ""),
        code: "AUTH_CONFIG_EXPIRED",
      }), { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    if (message.startsWith("MICROSOFT_RECONNECT_REQUIRED:")) {
      return new Response(JSON.stringify({
        error: message.replace("MICROSOFT_RECONNECT_REQUIRED:", ""),
        code: "RECONNECT_REQUIRED",
      }), { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
