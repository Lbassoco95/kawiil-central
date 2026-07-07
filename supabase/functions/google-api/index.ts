import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface GoogleAccountRow {
  id: string;
  email: string | null;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  calendar_enabled: boolean;
  status: string;
}

/** Refresca el access_token si expiró; devuelve un token válido o null. */
async function ensureAccessToken(
  supabaseAdmin: ReturnType<typeof createClient>,
  account: GoogleAccountRow,
): Promise<string | null> {
  const now = Date.now();
  const exp = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0;
  if (account.access_token && exp - 60_000 > now) return account.access_token;
  if (!account.refresh_token) return account.access_token ?? null;

  const clientId = Deno.env.get("GOOGLE_CLIENT_ID")!.trim();
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET")!.trim();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: account.refresh_token,
      grant_type: "refresh_token",
    }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) {
    await supabaseAdmin.from("linked_accounts").update({ status: "error", last_error: "refresh_failed" }).eq("id", account.id);
    return null;
  }
  const newExpiry = new Date(Date.now() + (data.expires_in ?? 3600) * 1000).toISOString();
  await supabaseAdmin.from("linked_accounts").update({
    access_token: data.access_token,
    token_expires_at: newExpiry,
    status: "connected",
    last_error: null,
  }).eq("id", account.id);
  return data.access_token;
}

/** Normaliza un evento de Google Calendar al formato tipo Microsoft Graph que usa el frontend. */
function normalizeEvent(ev: Record<string, any>, namespacedCalendarId: string, calName: string) {
  const isAllDay = Boolean(ev.start?.date && !ev.start?.dateTime);
  return {
    id: `google:${ev.id}`,
    subject: ev.summary ?? "(sin título)",
    start: { dateTime: ev.start?.dateTime ?? (ev.start?.date ? `${ev.start.date}T00:00:00` : undefined), date: ev.start?.date },
    end: { dateTime: ev.end?.dateTime ?? (ev.end?.date ? `${ev.end.date}T00:00:00` : undefined), date: ev.end?.date },
    location: ev.location ? { displayName: ev.location } : null,
    body: { content: ev.description ?? "", contentType: "text" },
    isAllDay,
    onlineMeetingUrl: ev.hangoutLink ?? null,
    categories: [],
    calendarId: namespacedCalendarId,
    calendarName: calName,
    _source: "google",
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const supabaseAuth = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_ANON_KEY")!,
      { global: { headers: { Authorization: authHeader } } },
    );
    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
    if (userError || !user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    }

    const supabaseAdmin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { action, params } = await req.json();

    const { data: accountsRaw } = await supabaseAdmin
      .from("linked_accounts")
      .select("id, email, access_token, refresh_token, token_expires_at, calendar_enabled, status")
      .eq("user_id", user.id)
      .eq("provider", "google");
    const accounts = (accountsRaw ?? []) as GoogleAccountRow[];

    if (accounts.length === 0) return new Response(JSON.stringify({ value: [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    if (action === "calendars") {
      const all: any[] = [];
      for (const acc of accounts) {
        const token = await ensureAccessToken(supabaseAdmin, acc);
        if (!token) continue;
        const res = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) continue;
        const json = await res.json();
        for (const item of json.items ?? []) {
          all.push({
            id: `google:${acc.id}:${item.id}`,
            name: acc.email ? `${item.summary} · ${acc.email}` : item.summary,
            hexColor: item.backgroundColor,
            isDefaultCalendar: item.primary === true,
            canEdit: item.accessRole === "owner" || item.accessRole === "writer",
            _source: "google",
            _accountId: acc.id,
          });
        }
      }
      return new Response(JSON.stringify({ value: all }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "calendar-events") {
      const start = params?.start || new Date().toISOString();
      const end = params?.end || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const merged: any[] = [];

      for (const acc of accounts) {
        if (!acc.calendar_enabled) continue;
        const token = await ensureAccessToken(supabaseAdmin, acc);
        if (!token) continue;

        // Calendarios de esta cuenta
        const calRes = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!calRes.ok) continue;
        const calJson = await calRes.json();
        const calendars = (calJson.items ?? []).filter((c: any) => c.selected !== false);

        for (const cal of calendars) {
          const qs = new URLSearchParams({
            timeMin: start,
            timeMax: end,
            singleEvents: "true",
            orderBy: "startTime",
            maxResults: "250",
          });
          const evRes = await fetch(
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(cal.id)}/events?${qs.toString()}`,
            { headers: { Authorization: `Bearer ${token}` } },
          );
          if (!evRes.ok) continue;
          const evJson = await evRes.json();
          const nsCalId = `google:${acc.id}:${cal.id}`;
          for (const ev of evJson.items ?? []) {
            if (ev.status === "cancelled") continue;
            merged.push(normalizeEvent(ev, nsCalId, cal.summary));
          }
        }
      }

      merged.sort((a, b) => String(a.start?.dateTime ?? "").localeCompare(String(b.start?.dateTime ?? "")));
      return new Response(JSON.stringify({ value: merged }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "create-event") {
      // Crea un evento en el calendario principal de la primera cuenta Google conectada.
      // params: { summary, description?, location?, date? (all-day YYYY-MM-DD),
      //           startDateTime?, endDateTime? (timed, ISO) }
      const acc = accounts.find((a) => a.calendar_enabled) || accounts[0];
      const token = await ensureAccessToken(supabaseAdmin, acc);
      if (!token) {
        return new Response(JSON.stringify({ error: "no_valid_token" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const tz = "America/Mexico_City";
      let start: Record<string, string>;
      let end: Record<string, string>;
      if (params?.startDateTime) {
        start = { dateTime: params.startDateTime, timeZone: tz };
        end = { dateTime: params.endDateTime || params.startDateTime, timeZone: tz };
      } else {
        // Evento de día completo. En Google, end.date es exclusivo (+1 día).
        const d = String(params?.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
        const next = new Date(`${d}T00:00:00Z`);
        next.setUTCDate(next.getUTCDate() + 1);
        start = { date: d };
        end = { date: next.toISOString().slice(0, 10) };
      }

      const body: Record<string, unknown> = {
        summary: params?.summary || "(sin título)",
        start,
        end,
      };
      if (params?.description) body.description = params.description;
      if (params?.location) body.location = params.location;

      const res = await fetch(
        "https://www.googleapis.com/calendar/v3/calendars/primary/events",
        {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const json = await res.json();
      if (!res.ok) {
        return new Response(JSON.stringify({ error: json?.error?.message || "create_failed" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ id: json.id, htmlLink: json.htmlLink }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "unknown_action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Error in google-api:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), { status: 500, headers: corsHeaders });
  }
});
