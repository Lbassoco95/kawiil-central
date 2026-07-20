import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

type Block = { start: string; end: string; title: string; private: boolean; source: string };

const MS_PRIMARY_TENANT = () => Deno.env.get("MICROSOFT_TENANT_ID")?.trim() || "common";
const MS_LINKED_TENANT = () => Deno.env.get("MICROSOFT_LINKED_TENANT_ID")?.trim() || "common";

async function refreshMsToken(refreshToken: string, tenant: string): Promise<{ access_token: string; expires_in: number } | null> {
  const clientId = Deno.env.get("MICROSOFT_CLIENT_ID")!.trim();
  const clientSecret = Deno.env.get("MICROSOFT_CLIENT_SECRET")!.trim();
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) return null;
  return { access_token: data.access_token, expires_in: data.expires_in ?? 3600 };
}

async function refreshGoogleToken(refreshToken: string): Promise<{ access_token: string; expires_in: number } | null> {
  const clientId = Deno.env.get("GOOGLE_CLIENT_ID")!.trim();
  const clientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET")!.trim();
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, refresh_token: refreshToken, grant_type: "refresh_token" }),
  });
  const data = await res.json();
  if (!res.ok || !data.access_token) return null;
  return { access_token: data.access_token, expires_in: data.expires_in ?? 3600 };
}

const expired = (iso: string | null) => !iso || new Date(iso).getTime() - 60_000 <= Date.now();

/** Bloques ocupados desde un calendario de Microsoft Graph (/me/calendarview). */
async function msBlocks(token: string, start: string, end: string, source: string): Promise<Block[]> {
  const qs = `startDateTime=${start}&endDateTime=${end}&$select=subject,start,end,sensitivity,showAs,isAllDay&$orderby=start/dateTime&$top=200`;
  const res = await fetch(`https://graph.microsoft.com/v1.0/me/calendarview?${qs}`, {
    headers: { Authorization: `Bearer ${token}`, Prefer: 'outlook.timezone="America/Mexico_City"' },
  });
  if (!res.ok) return [];
  const json = await res.json();
  const blocks: Block[] = [];
  for (const ev of json.value ?? []) {
    if (ev.showAs === "free") continue; // solo ocupado/tentativo/fuera de oficina
    const isPrivate = ev.sensitivity && ev.sensitivity !== "normal";
    const s = ev.start?.dateTime, e = ev.end?.dateTime;
    if (!s || !e) continue;
    blocks.push({ start: s, end: e, title: isPrivate ? "Bloqueado" : (ev.subject || "Ocupado"), private: !!isPrivate, source });
  }
  return blocks;
}

/** Bloques ocupados desde Google Calendar (calendario primary). */
async function googleBlocks(token: string, start: string, end: string): Promise<Block[]> {
  const qs = new URLSearchParams({ timeMin: start, timeMax: end, singleEvents: "true", orderBy: "startTime", maxResults: "200" });
  const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?${qs.toString()}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) return [];
  const json = await res.json();
  const blocks: Block[] = [];
  for (const ev of json.items ?? []) {
    if (ev.status === "cancelled") continue;
    if (ev.transparency === "transparent") continue; // marcado como libre
    const isPrivate = ev.visibility === "private" || ev.visibility === "confidential";
    const s = ev.start?.dateTime || (ev.start?.date ? `${ev.start.date}T00:00:00` : null);
    const e = ev.end?.dateTime || (ev.end?.date ? `${ev.end.date}T00:00:00` : null);
    if (!s || !e) continue;
    blocks.push({ start: s, end: e, title: isPrivate ? "Bloqueado" : (ev.summary || "Ocupado"), private: !!isPrivate, source: "google" });
  }
  return blocks;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader?.startsWith("Bearer ")) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });
    const supabaseAuth = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_ANON_KEY")!, { global: { headers: { Authorization: authHeader } } });
    const { data: { user }, error: userError } = await supabaseAuth.auth.getUser();
    if (userError || !user) return new Response(JSON.stringify({ error: "Unauthorized" }), { status: 401, headers: corsHeaders });

    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const { start, end } = await req.json();
    const rangeStart = start || new Date().toISOString();
    const rangeEnd = end || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    // Organización del solicitante y sus miembros.
    const { data: me } = await admin.from("profiles").select("organization_id").eq("user_id", user.id).single();
    const orgId = me?.organization_id;
    if (!orgId) return new Response(JSON.stringify({ users: [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    const { data: members } = await admin.from("profiles").select("user_id, full_name, avatar_url").eq("organization_id", orgId);
    const userIds = (members ?? []).map((m: any) => m.user_id);

    // Tokens de todos los miembros (una sola lectura por tabla).
    const { data: msTokens } = await admin.from("microsoft_tokens").select("user_id, access_token, refresh_token, expires_at").in("user_id", userIds);
    const { data: linked } = await admin.from("linked_accounts").select("id, user_id, provider, access_token, refresh_token, token_expires_at, calendar_enabled, status").in("user_id", userIds);

    const msByUser = new Map<string, any>();
    (msTokens ?? []).forEach((t: any) => msByUser.set(t.user_id, t));
    const linkedByUser = new Map<string, any[]>();
    (linked ?? []).forEach((a: any) => { const arr = linkedByUser.get(a.user_id) ?? []; arr.push(a); linkedByUser.set(a.user_id, arr); });

    const results = await Promise.all((members ?? []).map(async (m: any) => {
      const blocks: Block[] = [];
      // 1) Microsoft principal
      const mt = msByUser.get(m.user_id);
      if (mt) {
        try {
          let token = mt.access_token;
          if (expired(mt.expires_at) && mt.refresh_token) {
            const r = await refreshMsToken(mt.refresh_token, MS_PRIMARY_TENANT());
            if (r) { token = r.access_token; await admin.from("microsoft_tokens").update({ access_token: r.access_token, expires_at: new Date(Date.now() + r.expires_in * 1000).toISOString() }).eq("user_id", m.user_id); }
          }
          if (token) blocks.push(...await msBlocks(token, rangeStart, rangeEnd, "microsoft"));
        } catch (_) { /* ignora un origen fallido */ }
      }
      // 2) Cuentas vinculadas (google / microsoft) con calendario habilitado
      for (const acc of (linkedByUser.get(m.user_id) || [])) {
        if (acc.calendar_enabled === false || acc.status === "disconnected") continue;
        try {
          let token = acc.access_token;
          if (expired(acc.token_expires_at) && acc.refresh_token) {
            const r = acc.provider === "google" ? await refreshGoogleToken(acc.refresh_token) : await refreshMsToken(acc.refresh_token, MS_LINKED_TENANT());
            if (r) { token = r.access_token; await admin.from("linked_accounts").update({ access_token: r.access_token, token_expires_at: new Date(Date.now() + r.expires_in * 1000).toISOString() }).eq("id", acc.id); }
          }
          if (!token) continue;
          if (acc.provider === "google") blocks.push(...await googleBlocks(token, rangeStart, rangeEnd));
          else blocks.push(...await msBlocks(token, rangeStart, rangeEnd, "outlook"));
        } catch (_) { /* ignora */ }
      }
      blocks.sort((a, b) => a.start.localeCompare(b.start));
      return { userId: m.user_id, name: m.full_name || "Usuario", avatarUrl: m.avatar_url || null, blocks };
    }));

    return new Response(JSON.stringify({ users: results }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Error in team-availability:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), { status: 500, headers: corsHeaders });
  }
});
