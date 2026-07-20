import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface MsAccountRow {
  id: string;
  email: string | null;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  calendar_enabled: boolean;
  status: string;
}

/** Refresca el access_token de Microsoft si expiró; devuelve un token válido o null. */
async function ensureAccessToken(
  supabaseAdmin: ReturnType<typeof createClient>,
  account: MsAccountRow,
): Promise<string | null> {
  const now = Date.now();
  const exp = account.token_expires_at ? new Date(account.token_expires_at).getTime() : 0;
  if (account.access_token && exp - 60_000 > now) return account.access_token;
  if (!account.refresh_token) return account.access_token ?? null;

  const clientId = Deno.env.get("MICROSOFT_CLIENT_ID")!.trim();
  const clientSecret = Deno.env.get("MICROSOFT_CLIENT_SECRET")!.trim();
  const tenantId = Deno.env.get("MICROSOFT_TENANT_ID")!.trim();
  const res = await fetch(`https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/token`, {
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
    refresh_token: data.refresh_token ?? account.refresh_token,
    token_expires_at: newExpiry,
    status: "connected",
    last_error: null,
  }).eq("id", account.id);
  return data.access_token;
}

const PREFER_TZ = { Prefer: 'outlook.timezone="America/Mexico_City"' };

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
      .eq("provider", "microsoft");
    const accounts = (accountsRaw ?? []) as MsAccountRow[];
    if (accounts.length === 0) {
      return new Response(JSON.stringify({ value: [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "calendars") {
      const all: any[] = [];
      for (const acc of accounts) {
        const token = await ensureAccessToken(supabaseAdmin, acc);
        if (!token) continue;
        const res = await fetch("https://graph.microsoft.com/v1.0/me/calendars?$select=id,name,hexColor,color,isDefaultCalendar,canEdit&$top=100", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) continue;
        const json = await res.json();
        for (const item of json.value ?? []) {
          all.push({
            id: `outlook:${acc.id}:${item.id}`,
            name: acc.email ? `${item.name} · ${acc.email}` : item.name,
            hexColor: item.hexColor && item.hexColor !== "auto" ? item.hexColor : undefined,
            isDefaultCalendar: item.isDefaultCalendar === true,
            canEdit: item.canEdit === true,
            _source: "outlook",
            _accountId: acc.id,
          });
        }
      }
      return new Response(JSON.stringify({ value: all }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "calendar-events") {
      const start = params?.start || new Date().toISOString();
      const end = params?.end || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
      const qs = `startDateTime=${start}&endDateTime=${end}&$orderby=start/dateTime&$top=200`;
      const merged: any[] = [];

      for (const acc of accounts) {
        if (!acc.calendar_enabled) continue;
        const token = await ensureAccessToken(supabaseAdmin, acc);
        if (!token) continue;

        // Calendarios de esta cuenta
        const calRes = await fetch("https://graph.microsoft.com/v1.0/me/calendars?$select=id,name&$top=100", {
          headers: { Authorization: `Bearer ${token}` },
        });
        const calJson = calRes.ok ? await calRes.json() : { value: [] };
        const cals = (calJson.value ?? []) as Array<{ id: string; name: string }>;
        if (cals.length === 0) continue;

        for (const cal of cals) {
          const evRes = await fetch(
            `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(cal.id)}/calendarview?${qs}`,
            { headers: { Authorization: `Bearer ${token}`, ...PREFER_TZ } },
          );
          if (!evRes.ok) continue;
          const evJson = await evRes.json();
          const nsCalId = `outlook:${acc.id}:${cal.id}`;
          for (const ev of evJson.value ?? []) {
            merged.push({ ...ev, id: `outlook:${ev.id}`, calendarId: nsCalId, calendarName: cal.name, _source: "outlook" });
          }
        }
      }
      merged.sort((a, b) => String(a.start?.dateTime ?? "").localeCompare(String(b.start?.dateTime ?? "")));
      return new Response(JSON.stringify({ value: merged }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "create-event") {
      const acc = accounts.find((a) => a.calendar_enabled) || accounts[0];
      const token = await ensureAccessToken(supabaseAdmin, acc);
      if (!token) return new Response(JSON.stringify({ error: "no_valid_token" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      const tz = "America/Mexico_City";
      const body: Record<string, unknown> = { subject: params?.summary || "(sin título)" };
      if (params?.startDateTime) {
        body.start = { dateTime: params.startDateTime, timeZone: tz };
        body.end = { dateTime: params.endDateTime || params.startDateTime, timeZone: tz };
      } else {
        const d = String(params?.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
        body.isAllDay = true;
        body.start = { dateTime: `${d}T00:00:00`, timeZone: tz };
        const next = new Date(`${d}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
        body.end = { dateTime: `${next.toISOString().slice(0, 10)}T00:00:00`, timeZone: tz };
      }
      if (params?.description) body.body = { contentType: "text", content: params.description };
      if (params?.location) body.location = { displayName: params.location };

      const res = await fetch("https://graph.microsoft.com/v1.0/me/events", {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok) return new Response(JSON.stringify({ error: json?.error?.message || "create_failed" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      return new Response(JSON.stringify({ id: json.id, htmlLink: json.webLink }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "unknown_action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Error in outlook-account-api:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), { status: 500, headers: corsHeaders });
  }
});
