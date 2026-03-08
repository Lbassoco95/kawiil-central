import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const GRAPH_BASE = "https://graph.microsoft.com/v1.0";

async function refreshTokenIfNeeded(supabaseAdmin: any, userId: string, tokenRow: any) {
  const expiresAt = new Date(tokenRow.expires_at);
  // Refresh 5 min before expiry
  if (expiresAt.getTime() - Date.now() > 5 * 60 * 1000) {
    return tokenRow.access_token;
  }

  const clientId = Deno.env.get("MICROSOFT_CLIENT_ID")!;
  const clientSecret = Deno.env.get("MICROSOFT_CLIENT_SECRET")!;
  const tenantId = Deno.env.get("MICROSOFT_TENANT_ID")!;

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
    }
  );

  const data = await res.json();
  if (!res.ok) throw new Error(`Token refresh failed: ${JSON.stringify(data)}`);

  const newExpiresAt = new Date(Date.now() + data.expires_in * 1000).toISOString();

  await supabaseAdmin
    .from("microsoft_tokens")
    .update({
      access_token: data.access_token,
      refresh_token: data.refresh_token || tokenRow.refresh_token,
      expires_at: newExpiresAt,
    })
    .eq("user_id", userId);

  return data.access_token;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    // Auth check
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } }
    );

    const token = authHeader.replace("Bearer ", "");
    const { data: claims, error: claimsError } = await supabase.auth.getClaims(token);
    if (claimsError || !claims?.claims) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }
    const userId = claims.claims.sub;

    // Get tokens using service role
    const supabaseAdmin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: tokenRow, error: tokenError } = await supabaseAdmin
      .from("microsoft_tokens")
      .select("*")
      .eq("user_id", userId)
      .single();

    if (tokenError || !tokenRow) {
      return new Response(JSON.stringify({ error: "Microsoft not connected", code: "NOT_CONNECTED" }), {
        status: 404,
        headers: corsHeaders,
      });
    }

    const accessToken = await refreshTokenIfNeeded(supabaseAdmin, userId, tokenRow);

    const body = await req.json();
    const { action, params } = body;

    let result;

    switch (action) {
      case "calendar-events": {
        const start = params?.start || new Date().toISOString();
        const end = params?.end || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        const res = await fetch(
          `${GRAPH_BASE}/me/calendarview?startDateTime=${start}&endDateTime=${end}&$orderby=start/dateTime&$top=100`,
          {
            headers: {
              Authorization: `Bearer ${accessToken}`,
              Prefer: 'outlook.timezone="America/Mexico_City"',
            },
          }
        );
        result = await res.json();
        break;
      }

      case "create-event": {
        const res = await fetch(`${GRAPH_BASE}/me/events`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(params.event),
        });
        result = await res.json();
        break;
      }

      case "delete-event": {
        const res = await fetch(`${GRAPH_BASE}/me/events/${params.eventId}`, {
          method: "DELETE",
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        result = { success: res.ok };
        break;
      }

      case "event-detail": {
        const res = await fetch(`${GRAPH_BASE}/me/events/${params.eventId}`, {
          headers: {
            Authorization: `Bearer ${accessToken}`,
            Prefer: 'outlook.timezone="America/Mexico_City"',
          },
        });
        result = await res.json();
        break;
      }

      case "update-event": {
        const encodedEventId = encodeURIComponent(params.eventId);

        // Snapshot previo para fallback en ocurrencias recurrentes
        const beforeRes = await fetch(`${GRAPH_BASE}/me/events/${encodedEventId}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const beforeEvent = beforeRes.ok ? await beforeRes.json() : null;

        const res = await fetch(`${GRAPH_BASE}/me/events/${encodedEventId}`, {
          method: "PATCH",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
            Prefer: 'outlook.timezone="America/Mexico_City", return=representation',
          },
          body: JSON.stringify(params.payload),
        });

        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(`Update event failed [${res.status}]: ${errBody}`);
        }

        const patchText = await res.text();
        const patchEvent: any = patchText ? JSON.parse(patchText) : null;

        // Verifica estado persistido (no confiar solo en respuesta del PATCH)
        const verifyRes = await fetch(`${GRAPH_BASE}/me/events/${encodedEventId}`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const persistedEvent = verifyRes.ok ? await verifyRes.json() : null;

        const desiredStart = params?.payload?.start?.dateTime as string | undefined;
        const desiredEnd = params?.payload?.end?.dateTime as string | undefined;
        const appliedStart = persistedEvent?.start?.dateTime as string | undefined;
        const appliedEnd = persistedEvent?.end?.dateTime as string | undefined;

        // Si el evento ya no existe por ese ID, asumimos que Graph lo convirtió/reidentificó y sí aplicó
        const updateApplied = !verifyRes.ok
          ? true
          : (!desiredStart || (appliedStart && appliedStart.startsWith(desiredStart))) &&
            (!desiredEnd || (appliedEnd && appliedEnd.startsWith(desiredEnd)));

        // Fallback para ocurrencias que no aceptan PATCH directo: clonar en nuevo horario y eliminar ocurrencia original
        if (!updateApplied && beforeEvent?.type === "occurrence") {
          const clonePayload: Record<string, any> = {
            subject: beforeEvent.subject,
            start: params?.payload?.start || beforeEvent.start,
            end: params?.payload?.end || beforeEvent.end,
            body: beforeEvent.body,
            attendees: beforeEvent.attendees,
            categories: beforeEvent.categories,
            isOnlineMeeting: !!beforeEvent.isOnlineMeeting,
            onlineMeetingProvider: beforeEvent.isOnlineMeeting ? "teamsForBusiness" : undefined,
            location: beforeEvent?.location?.displayName
              ? { displayName: beforeEvent.location.displayName }
              : undefined,
          };

          const createRes = await fetch(`${GRAPH_BASE}/me/events`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${accessToken}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify(clonePayload),
          });

          if (!createRes.ok) {
            const errBody = await createRes.text();
            throw new Error(`Fallback create event failed [${createRes.status}]: ${errBody}`);
          }

          const createdEvent = await createRes.json();

          await fetch(`${GRAPH_BASE}/me/events/${encodedEventId}`, {
            method: "DELETE",
            headers: { Authorization: `Bearer ${accessToken}` },
          });

          result = {
            ...createdEvent,
            migratedFromOccurrence: true,
            previousEventId: params.eventId,
          };
        } else {
          result = persistedEvent || patchEvent || { success: true };
        }

        break;
      }

      case "outlook-categories": {
        const res = await fetch(`${GRAPH_BASE}/me/outlook/masterCategories`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        const json = await res.json();
        result = json.value || [];
        break;
      }

      case "emails": {
        const top = params?.top || 20;
        const folder = params?.folder || "inbox";
        const search = params?.search ? `&$search="${params.search}"` : "";
        const res = await fetch(
          `${GRAPH_BASE}/me/mailFolders/${folder}/messages?$top=${top}&$orderby=receivedDateTime desc${search}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        result = await res.json();
        break;
      }

      case "email-detail": {
        const res = await fetch(
          `${GRAPH_BASE}/me/messages/${params.messageId}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        result = await res.json();
        break;
      }

      case "send-email": {
        const res = await fetch(`${GRAPH_BASE}/me/sendMail`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ message: params.message }),
        });
        result = { success: res.ok };
        break;
      }

      case "check-connection": {
        const res = await fetch(`${GRAPH_BASE}/me`, {
          headers: { Authorization: `Bearer ${accessToken}` },
        });
        result = await res.json();
        break;
      }

      case "reply": {
        const res = await fetch(`${GRAPH_BASE}/me/messages/${params.messageId}/reply`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ comment: params.comment }),
        });
        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(`Reply failed [${res.status}]: ${errBody}`);
        }
        result = { success: true };
        break;
      }

      case "reply-all": {
        const res = await fetch(`${GRAPH_BASE}/me/messages/${params.messageId}/replyAll`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({ comment: params.comment }),
        });
        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(`ReplyAll failed [${res.status}]: ${errBody}`);
        }
        result = { success: true };
        break;
      }

      case "forward": {
        const res = await fetch(`${GRAPH_BASE}/me/messages/${params.messageId}/forward`, {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            comment: params.comment,
            toRecipients: params.toRecipients,
          }),
        });
        if (!res.ok) {
          const errBody = await res.text();
          throw new Error(`Forward failed [${res.status}]: ${errBody}`);
        }
        result = { success: true };
        break;
      }
    }

    return new Response(JSON.stringify(result), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Microsoft API error:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), {
      status: 500,
      headers: corsHeaders,
    });
  }
});
