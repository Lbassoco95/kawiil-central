// Sincroniza el estado de Slack del equipo según su jornada y calendario.
// Invocada por pg_cron (cada ~10 min). Para cada persona en jornada activa
// con Slack conectado, fija un estado no verbal:
//   pausa (comida/descanso) > en trayecto (🚗) > en reunión (🗓️, calendario) > modalidad.
// Las respuestas del calendario usan el token de Microsoft de cada usuario.
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

type Status = { emoji: string; text: string };

const WORK_MODE: Record<string, Status> = {
  office: { emoji: ":office:", text: "En la oficina" },
  home_office: { emoji: ":house_with_garden:", text: "Home Office" },
  commission: { emoji: ":walking:", text: "De comisión" },
};
const LUNCH: Status = { emoji: ":knife_fork_plate:", text: "Comiendo" };
const BREAK: Status = { emoji: ":coffee:", text: "En un descanso" };
const TRANSIT: Status = { emoji: ":car:", text: "En trayecto" };
const MEETING: Status = { emoji: ":calendar:", text: "En reunión" };

/** Fin del día (23:59) en hora de CDMX (UTC-6, sin horario de verano). */
function mexEndOfDayEpoch(): number {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City", year: "numeric", month: "2-digit", day: "2-digit",
  }).format(new Date()).split("-").map(Number);
  return Math.floor(Date.UTC(parts[0], parts[1] - 1, parts[2], 23 + 6, 59) / 1000);
}

async function refreshMsToken(admin: any, userId: string, row: any): Promise<string> {
  if (new Date(row.expires_at).getTime() - Date.now() > 5 * 60 * 1000) return row.access_token;
  const res = await fetch(
    `https://login.microsoftonline.com/${Deno.env.get("MICROSOFT_TENANT_ID")!.trim()}/oauth2/v2.0/token`,
    {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: Deno.env.get("MICROSOFT_CLIENT_ID")!.trim(),
        client_secret: Deno.env.get("MICROSOFT_CLIENT_SECRET")!.trim(),
        refresh_token: row.refresh_token,
        grant_type: "refresh_token",
      }),
    },
  );
  const data = await res.json();
  if (!res.ok) throw new Error("ms refresh failed");
  await admin.from("microsoft_tokens").update({
    access_token: data.access_token,
    refresh_token: data.refresh_token || row.refresh_token,
    expires_at: new Date(Date.now() + data.expires_in * 1000).toISOString(),
  }).eq("user_id", userId);
  return data.access_token;
}

/** Devuelve el epoch de fin de la reunión en curso, o null si no hay. */
async function meetingEndEpoch(accessToken: string): Promise<number | null> {
  const now = Date.now();
  const start = new Date(now - 60_000).toISOString();
  const end = new Date(now + 60_000).toISOString();
  const res = await fetch(
    `https://graph.microsoft.com/v1.0/me/calendarview?startDateTime=${start}&endDateTime=${end}&$orderby=start/dateTime&$top=20`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) return null;
  const data = await res.json();
  for (const ev of data.value ?? []) {
    if (ev.isAllDay || ev.isCancelled) continue;
    const s = new Date(ev.start?.dateTime + "Z").getTime();
    const e = new Date(ev.end?.dateTime + "Z").getTime();
    if (s <= now && now < e) return Math.floor(e / 1000);
  }
  return null;
}

async function setSlackStatus(token: string, status: Status, expiration: number) {
  await fetch("https://slack.com/api/users.profile.set", {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8", Authorization: `Bearer ${token}` },
    body: JSON.stringify({
      profile: { status_text: status.text, status_emoji: status.emoji, status_expiration: expiration },
    }),
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const secret = Deno.env.get("CRON_SECRET");
    if (!secret || req.headers.get("x-cron-secret") !== secret) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const admin = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    // Jornadas activas (check-in hoy, sin check-out), no más viejas de 18h.
    const cutoff = new Date(Date.now() - 18 * 3600 * 1000).toISOString();
    const { data: sessions } = await admin
      .from("rh_attendance")
      .select("id, user_id, work_mode, in_transit, check_in_at")
      .is("check_out_at", null)
      .gte("check_in_at", cutoff);

    const endOfDay = mexEndOfDayEpoch();
    let updated = 0;

    for (const s of sessions ?? []) {
      // Slack conectado
      const { data: slack } = await admin
        .from("user_slack_connections").select("access_token").eq("user_id", s.user_id).maybeSingle();
      if (!slack?.access_token) continue;

      // Estado de pausa según el último evento de la jornada
      const { data: lastEv } = await admin
        .from("rh_attendance_events")
        .select("event_type")
        .eq("attendance_id", s.id)
        .order("event_at", { ascending: false })
        .limit(1)
        .maybeSingle();
      const onLunch = lastEv?.event_type === "lunch_start";
      const onBreak = lastEv?.event_type === "break_start";

      let status: Status = WORK_MODE[s.work_mode] ?? WORK_MODE.office;
      // Comida/descanso/trayecto no expiran solos (0): los termina el usuario.
      let expiration = endOfDay;

      if (onLunch) {
        status = LUNCH; expiration = 0;
      } else if (onBreak) {
        status = BREAK; expiration = 0;
      } else if (s.in_transit) {
        status = TRANSIT; expiration = 0;
      } else {
        // ¿En reunión? (calendario de Outlook del usuario)
        const { data: msTok } = await admin
          .from("microsoft_tokens").select("access_token, refresh_token, expires_at").eq("user_id", s.user_id).maybeSingle();
        if (msTok?.access_token) {
          try {
            const token = await refreshMsToken(admin, s.user_id, msTok);
            const meetEnd = await meetingEndEpoch(token);
            if (meetEnd) { status = MEETING; expiration = meetEnd; }
          } catch { /* sin calendario: deja la modalidad */ }
        }
      }

      try { await setSlackStatus(slack.access_token, status, expiration); updated++; } catch { /* best-effort */ }
    }

    return new Response(JSON.stringify({ ok: true, sessions: sessions?.length ?? 0, updated }), {
      status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, error: String(e) }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
