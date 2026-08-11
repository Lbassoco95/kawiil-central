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
// Estado de respuesta de Google → estilo Graph, para reutilizar la UI de RSVP.
function googleResponseToGraph(resp?: string): string {
  switch (resp) {
    case "accepted": return "accepted";
    case "declined": return "declined";
    case "tentative": return "tentativelyAccepted";
    case "needsAction": return "notResponded";
    default: return "none";
  }
}

function normalizeEvent(ev: Record<string, any>, namespacedCalendarId: string, calName: string) {
  const isAllDay = Boolean(ev.start?.date && !ev.start?.dateTime);
  const attendees = Array.isArray(ev.attendees) ? ev.attendees : [];
  const selfAttendee = attendees.find((a: any) => a?.self === true);
  const isOrganizer = ev.organizer?.self === true;
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
    // Datos de invitación para RSVP (formato normalizado tipo Graph).
    attendees: attendees.map((a: any) => ({
      emailAddress: { address: a?.email, name: a?.displayName },
      status: { response: googleResponseToGraph(a?.responseStatus) },
    })),
    isOrganizer,
    responseStatus: { response: isOrganizer ? "organizer" : googleResponseToGraph(selfAttendee?.responseStatus) },
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
    const accountId = params?.accountId as string | undefined;

    const { data: accountsRaw } = await supabaseAdmin
      .from("linked_accounts")
      .select("id, email, access_token, refresh_token, token_expires_at, calendar_enabled, status")
      .eq("user_id", user.id)
      .eq("provider", "google");
    const accounts = (accountsRaw ?? []) as GoogleAccountRow[];

    if (accounts.length === 0) return new Response(JSON.stringify({ value: [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });

    if (action === "calendars") {
      const all: any[] = [];
      // Diagnóstico por cuenta: en vez de tragarnos los errores en silencio (que hacía
      // que las cuentas Google "desaparecieran" del calendario), reportamos qué pasó.
      const diagnostics: any[] = [];
      for (const acc of accounts) {
        const token = await ensureAccessToken(supabaseAdmin, acc);
        if (!token) {
          diagnostics.push({ accountId: acc.id, email: acc.email, ok: false, reason: "reconnect_needed", message: "No se pudo renovar el acceso. Vuelve a conectar la cuenta de Google." });
          continue;
        }
        const res = await fetch("https://www.googleapis.com/calendar/v3/users/me/calendarList", {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!res.ok) {
          let message = `HTTP ${res.status}`;
          let reason = "api_error";
          try {
            const errJson = await res.json();
            message = errJson?.error?.message || message;
            const status = errJson?.error?.status || "";
            const isDisabled = res.status === 403 && /has not been used|is disabled|SERVICE_DISABLED|accessNotConfigured/i.test(JSON.stringify(errJson));
            if (isDisabled) { reason = "calendar_api_disabled"; }
            else if (res.status === 401 || status === "UNAUTHENTICATED") { reason = "reconnect_needed"; }
            else if (res.status === 403) { reason = "forbidden"; }
          } catch { /* sin cuerpo JSON */ }
          diagnostics.push({ accountId: acc.id, email: acc.email, ok: false, reason, message });
          continue;
        }
        const json = await res.json();
        let count = 0;
        for (const item of json.items ?? []) {
          count++;
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
        diagnostics.push({ accountId: acc.id, email: acc.email, ok: true, count });
      }
      return new Response(JSON.stringify({ value: all, diagnostics }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
      // Crea un evento en una cuenta Google. params: { accountId?, calendarId?, event? (estilo Graph)
      //   | summary, description?, location?, date?, startDateTime?, endDateTime? }
      const acc = accountId ? (accounts.find((a) => a.id === accountId) || accounts[0]) : (accounts.find((a) => a.calendar_enabled) || accounts[0]);
      const token = await ensureAccessToken(supabaseAdmin, acc);
      if (!token) {
        return new Response(JSON.stringify({ error: "no_valid_token" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const targetCal = params?.calendarId ? String(params.calendarId).replace(/^google:[^:]+:/, "") : "primary";

      // Cuerpo estilo Graph (del diálogo): lo traducimos a los campos de Google.
      if (params?.event && typeof params.event === "object") {
        const p = params.event;
        const tz = p?.start?.timeZone || "America/Mexico_City";
        const gBody: Record<string, any> = { summary: p.subject || "(sin título)" };
        // Día completo: el diálogo manda isAllDay + dateTime a medianoche; Google usa `date`.
        if (p.isAllDay || (p.start?.date && !p.start?.dateTime)) {
          const d = String(p.start?.date || p.start?.dateTime || new Date().toISOString().slice(0, 10)).slice(0, 10);
          const endRaw = String(p.end?.date || p.end?.dateTime || "").slice(0, 10);
          const next = new Date(`${d}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
          gBody.start = { date: d };
          gBody.end = { date: endRaw && endRaw > d ? endRaw : next.toISOString().slice(0, 10) };
        } else if (p.start?.dateTime) {
          gBody.start = { dateTime: p.start.dateTime, timeZone: tz };
          gBody.end = { dateTime: p.end?.dateTime || p.start.dateTime, timeZone: p.end?.timeZone || tz };
        } else {
          const d = String(p.start?.date || new Date().toISOString().slice(0, 10)).slice(0, 10);
          const next = new Date(`${d}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
          gBody.start = { date: d };
          gBody.end = { date: p.end?.date || next.toISOString().slice(0, 10) };
        }
        if (p.body?.content) {
          gBody.description = String(p.body.content)
            .replace(/<br\s*\/?>/gi, "\n").replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
            .replace(/<[^>]+>/g, "").replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").trim();
        }
        if (p.location?.displayName) gBody.location = p.location.displayName;
        if (Array.isArray(p.attendees) && p.attendees.length > 0) {
          gBody.attendees = p.attendees.map((a: any) => ({ email: a?.emailAddress?.address })).filter((a: any) => a.email);
        }
        // Recurrencia estilo Graph → RRULE de Google.
        if (p.recurrence?.pattern) {
          const pat = p.recurrence.pattern;
          const rng = p.recurrence.range || {};
          const interval = Math.max(1, Number(pat.interval) || 1);
          const parts: string[] = [];
          if (pat.type === "daily") parts.push("FREQ=DAILY");
          else if (pat.type === "weekly") {
            parts.push("FREQ=WEEKLY");
            const map: Record<string, string> = { sunday: "SU", monday: "MO", tuesday: "TU", wednesday: "WE", thursday: "TH", friday: "FR", saturday: "SA" };
            const days = (pat.daysOfWeek || []).map((d: string) => map[String(d).toLowerCase()]).filter(Boolean);
            if (days.length) parts.push(`BYDAY=${days.join(",")}`);
          } else {
            parts.push("FREQ=MONTHLY");
            if (pat.dayOfMonth) parts.push(`BYMONTHDAY=${pat.dayOfMonth}`);
          }
          parts.push(`INTERVAL=${interval}`);
          if (rng.type === "numbered" && rng.numberOfOccurrences) parts.push(`COUNT=${rng.numberOfOccurrences}`);
          else if (rng.type === "endDate" && rng.endDate) parts.push(`UNTIL=${String(rng.endDate).replace(/-/g, "")}T235959Z`);
          gBody.recurrence = [`RRULE:${parts.join(";")}`];
        }
        const sendUpdates = gBody.attendees ? "all" : "none";
        const res = await fetch(
          `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetCal)}/events?sendUpdates=${sendUpdates}`,
          { method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" }, body: JSON.stringify(gBody) },
        );
        const json = await res.json();
        if (!res.ok) return new Response(JSON.stringify({ error: json?.error?.message || "create_failed" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
        return new Response(JSON.stringify({ id: json.id, htmlLink: json.htmlLink }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
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
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(targetCal)}/events`,
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

    if (action === "respond-event") {
      // RSVP en Google: no hay endpoint "accept"; se parchea el responseStatus del
      // asistente propio. params: { accountId, calendarId (crudo), eventId (crudo), response }
      const acc = accountId ? accounts.find((a) => a.id === accountId) : (accounts.find((a) => a.calendar_enabled) || accounts[0]);
      if (!acc) return new Response(JSON.stringify({ error: "no_account" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const token = await ensureAccessToken(supabaseAdmin, acc);
      if (!token) return new Response(JSON.stringify({ error: "no_valid_token" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      const respMap: Record<string, string> = {
        accept: "accepted",
        accepted: "accepted",
        decline: "declined",
        declined: "declined",
        tentative: "tentative",
        tentatively: "tentative",
      };
      const googleResp = respMap[String(params?.response || "").trim()];
      if (!googleResp) return new Response(JSON.stringify({ error: "invalid_response" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      const calId = String(params?.calendarId || "primary").replace(/^google:[^:]+:/, "");
      const rawEventId = String(params?.eventId || "").replace(/^google:/, "");
      if (!rawEventId) return new Response(JSON.stringify({ error: "missing_event" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(rawEventId)}`;
      // Leer el evento para ubicar al asistente propio y conservar el resto.
      const getRes = await fetch(base, { headers: { Authorization: `Bearer ${token}` } });
      if (!getRes.ok) {
        let msg = "event_not_found";
        try { const j = await getRes.json(); msg = j?.error?.message || msg; } catch { /* sin cuerpo */ }
        return new Response(JSON.stringify({ error: msg }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      const evt = await getRes.json();
      const attendees = Array.isArray(evt.attendees) ? evt.attendees : [];
      let found = false;
      const updated = attendees.map((a: any) => {
        if (a?.self === true || a?.email?.toLowerCase() === acc.email?.toLowerCase()) {
          found = true;
          return { ...a, responseStatus: googleResp };
        }
        return a;
      });
      if (!found) {
        // No aparece como asistente: no se puede responder (probablemente es el organizador).
        return new Response(JSON.stringify({ error: "not_an_attendee" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }

      const patchRes = await fetch(`${base}?sendUpdates=all`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ attendees: updated }),
      });
      if (!patchRes.ok) {
        let msg = "respond_failed";
        try { const j = await patchRes.json(); msg = j?.error?.message || msg; } catch { /* sin cuerpo */ }
        return new Response(JSON.stringify({ error: msg }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "update-event") {
      // Edita un evento de Google. params: { accountId, calendarId, eventId, payload }
      // El payload llega en estilo Graph (como el diálogo de edición); lo traducimos.
      const acc = accountId ? accounts.find((a) => a.id === accountId) : (accounts.find((a) => a.calendar_enabled) || accounts[0]);
      if (!acc) return new Response(JSON.stringify({ error: "no_account" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const token = await ensureAccessToken(supabaseAdmin, acc);
      if (!token) return new Response(JSON.stringify({ error: "no_valid_token" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      const calId = String(params?.calendarId || "primary").replace(/^google:[^:]+:/, "");
      const rawEventId = String(params?.eventId || "").replace(/^google:/, "");
      if (!rawEventId) return new Response(JSON.stringify({ error: "missing_event" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      const p = params?.payload && typeof params.payload === "object" ? params.payload : {};
      const tz = p?.start?.timeZone || "America/Mexico_City";

      // Leemos el evento actual para respetar su naturaleza (día completo vs con hora)
      // y no convertir por accidente un evento de día completo en uno con hora.
      const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(rawEventId)}`;
      let existing: any = null;
      try {
        const getRes = await fetch(base, { headers: { Authorization: `Bearer ${token}` } });
        if (getRes.ok) existing = await getRes.json();
      } catch { /* si falla, seguimos con lo que haya */ }
      const isAllDay = !!(existing?.start?.date && !existing?.start?.dateTime);

      const gPatch: Record<string, any> = {};
      if (typeof p.subject === "string") gPatch.summary = p.subject;
      if (p.start?.dateTime || p.end?.dateTime) {
        if (isAllDay) {
          // Mantener día completo: Google usa `date` (fin exclusivo, +1 día).
          const sd = String(p.start?.dateTime || "").slice(0, 10);
          const edRaw = String(p.end?.dateTime || p.start?.dateTime || "").slice(0, 10);
          if (sd) gPatch.start = { date: sd };
          if (edRaw) {
            // Si inicio == fin (mismo día), Google exige fin exclusivo (+1 día).
            let end = edRaw;
            if (edRaw <= sd) { const n = new Date(`${sd}T00:00:00Z`); n.setUTCDate(n.getUTCDate() + 1); end = n.toISOString().slice(0, 10); }
            gPatch.end = { date: end };
          }
        } else {
          if (p.start?.dateTime) gPatch.start = { dateTime: p.start.dateTime, timeZone: tz };
          if (p.end?.dateTime) gPatch.end = { dateTime: p.end.dateTime, timeZone: p.end.timeZone || tz };
        }
      }
      if (p.body?.content !== undefined) {
        // El diálogo manda HTML; Google muestra texto plano. Convertimos saltos y quitamos
        // etiquetas, preservando los saltos de línea del contenido.
        gPatch.description = String(p.body.content)
          .replace(/<br\s*\/?>/gi, "\n")
          .replace(/<\/(p|div|li|h[1-6])>/gi, "\n")
          .replace(/<[^>]+>/g, "")
          .replace(/[ \t]+/g, " ")
          .replace(/\n{3,}/g, "\n\n")
          .trim();
      }
      if (p.location !== undefined) gPatch.location = p.location?.displayName ?? "";
      // Solo tocamos asistentes si el cliente los envía explícitamente (evita resetear RSVPs).
      if (Array.isArray(p.attendees)) {
        gPatch.attendees = p.attendees.map((a: any) => ({ email: a?.emailAddress?.address })).filter((a: any) => a.email);
      }

      // sendUpdates=none por defecto para no enviar correos en cada guardado/arrastre;
      // solo notificamos si cambian los asistentes.
      const sendUpdates = Array.isArray(p.attendees) ? "all" : "none";
      const res = await fetch(`${base}?sendUpdates=${sendUpdates}`, {
        method: "PATCH",
        headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify(gPatch),
      });
      const json = await res.json();
      if (!res.ok) {
        return new Response(JSON.stringify({ error: json?.error?.message || "update_failed" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ success: true, id: `google:${json.id}` }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "delete-event") {
      // Elimina un evento de Google. params: { accountId, calendarId, eventId }
      const acc = accountId ? accounts.find((a) => a.id === accountId) : (accounts.find((a) => a.calendar_enabled) || accounts[0]);
      if (!acc) return new Response(JSON.stringify({ error: "no_account" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const token = await ensureAccessToken(supabaseAdmin, acc);
      if (!token) return new Response(JSON.stringify({ error: "no_valid_token" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      const calId = String(params?.calendarId || "primary").replace(/^google:[^:]+:/, "");
      const rawEventId = String(params?.eventId || "").replace(/^google:/, "");
      if (!rawEventId) return new Response(JSON.stringify({ error: "missing_event" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });

      const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events/${encodeURIComponent(rawEventId)}?sendUpdates=none`;
      const res = await fetch(url, { method: "DELETE", headers: { Authorization: `Bearer ${token}` } });
      // Google responde 204 al borrar; 404/410 = ya no existe (lo tratamos como éxito).
      if (!res.ok && res.status !== 204 && res.status !== 404 && res.status !== 410) {
        let msg = `HTTP ${res.status}`;
        try { msg = (await res.json())?.error?.message || msg; } catch { /* sin cuerpo */ }
        return new Response(JSON.stringify({ error: msg }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // ─── GMAIL EMAIL ACTIONS ───────────────────────────────────────────────

    function decodeBase64Url(data: string, charset = "utf-8"): string {
      try {
        // atob da un string binario (1 char = 1 byte); hay que decodificar los bytes con el
        // charset real o los acentos salen como mojibake ("atenciÃ³n" en vez de "atención").
        const bin = atob(data.replace(/-/g, "+").replace(/_/g, "/"));
        const bytes = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
        // UTF-8 PRIMERO con validación estricta: muchos correos (gobierno/banca) declaran
        // un charset legacy (iso-8859-1) pero su contenido real ES UTF-8. Respetar el charset
        // declarado los rompería. Si el contenido es UTF-8 válido, ganó UTF-8; si no, usamos
        // el charset declarado (o windows-1252 como respaldo latino).
        try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes); }
        catch { /* no es UTF-8 válido → legacy */ }
        const legacy = charset && charset !== "utf-8" ? charset : "windows-1252";
        try { return new TextDecoder(legacy).decode(bytes); }
        catch { return new TextDecoder("utf-8").decode(bytes); }
      } catch { return ""; }
    }

    /** Charset declarado en el Content-Type de la parte MIME (default utf-8). */
    function partCharset(payload: any): string {
      const ct = (payload?.headers || []).find((h: any) => String(h.name).toLowerCase() === "content-type")?.value || "";
      const m = String(ct).match(/charset="?([^";\s]+)"?/i);
      return m ? m[1].toLowerCase() : "utf-8";
    }

    function extractGmailBody(payload: any): { html?: string; text?: string } {
      if (!payload) return {};
      if (payload.mimeType === "text/html" && payload.body?.data) return { html: decodeBase64Url(payload.body.data, partCharset(payload)) };
      if (payload.mimeType === "text/plain" && payload.body?.data) return { text: decodeBase64Url(payload.body.data, partCharset(payload)) };
      if (payload.parts) {
        let html: string | undefined, text: string | undefined;
        for (const p of payload.parts) { const r = extractGmailBody(p); if (r.html) html = r.html; if (r.text && !text) text = r.text; }
        return { html, text };
      }
      return {};
    }

    function parseGmailAddr(raw: string): { name: string; address: string } {
      const m = raw.match(/^(.+?)\s*<([^>]+)>$/);
      if (m) return { name: m[1].trim().replace(/^"(.*)"$/, "$1"), address: m[2].trim() };
      return { name: "", address: raw.trim() };
    }

    /** Decodifica encoded-words RFC 2047 en headers: "=?UTF-8?B?...?=" / "=?UTF-8?Q?...?=". */
    function decodeRfc2047(value: string): string {
      if (!value.includes("=?")) return value;
      // Palabras codificadas adyacentes se unen sin el espacio intermedio (RFC 2047 §6.2).
      const joined = value.replace(/(\?=)\s+(=\?)/g, "$1$2");
      return joined.replace(/=\?([^?]+)\?([BbQq])\?([^?]*)\?=/g, (_m, charset, enc, text) => {
        try {
          let bin: string;
          if (String(enc).toUpperCase() === "B") {
            bin = atob(text);
          } else {
            bin = text
              .replace(/_/g, " ")
              .replace(/=([0-9A-Fa-f]{2})/g, (_s: string, h: string) => String.fromCharCode(parseInt(h, 16)));
          }
          const bytes = new Uint8Array(bin.length);
          for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i) & 0xff;
          return new TextDecoder(String(charset).toLowerCase()).decode(bytes);
        } catch { return text; }
      });
    }

    function normalizeGmailMsg(msg: any, accId: string, accEmail: string) {
      const hdrs: Array<{ name: string; value: string }> = msg.payload?.headers || [];
      const hdr = (n: string) =>
        decodeRfc2047(hdrs.find((h: any) => h.name.toLowerCase() === n.toLowerCase())?.value || "");
      const from = parseGmailAddr(hdr("from"));
      const dateStr = hdr("date");
      const receivedDateTime = dateStr ? (() => { try { return new Date(dateStr).toISOString(); } catch { return new Date().toISOString(); } })() : new Date().toISOString();
      return {
        id: `gmail:${accId}:${msg.id}`,
        subject: hdr("subject") || "(sin asunto)",
        bodyPreview: msg.snippet || "",
        from: { emailAddress: { name: from.name, address: from.address } },
        toRecipients: (hdr("to") || "").split(",").filter(Boolean).map((t: string) => {
          const p = parseGmailAddr(t.trim()); return { emailAddress: { name: p.name, address: p.address } };
        }),
        receivedDateTime,
        isRead: !(msg.labelIds?.includes("UNREAD") ?? false),
        hasAttachments: !!(msg.payload?.parts?.some((p: any) => p.filename && p.filename.length > 0)),
        importance: "normal",
        conversationId: `gmail:${accId}:${msg.threadId}`,
        _source: "gmail",
        _accountId: accId,
        _provider: "google",
        _accountEmail: accEmail,
      };
    }

    if (action === "gmail-emails") {
      const targetAccounts = accountId ? accounts.filter(a => a.id === accountId) : accounts;
      if (accountId && targetAccounts.length === 0) {
        return new Response(
          JSON.stringify({ error: "Esta cuenta no está disponible para correo. Reconéctala para autorizar el acceso.", code: "REAUTH_REQUIRED" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      const labelId = params?.labelId || "INBOX";
      const maxResults = Math.min(Number(params?.maxResults) || 25, 100);
      const filterUnread = params?.filterUnread === true;
      const searchText = typeof params?.search === "string" ? params.search.trim() : "";
      // q de Gmail combina filtros y texto libre (busca en asunto/cuerpo/remitente).
      const q = [filterUnread ? "is:unread" : "", searchText].filter(Boolean).join(" ").trim();
      const allEmails: unknown[] = [];
      let nextPageToken: string | undefined;
      for (const acc of targetAccounts) {
        const token = await ensureAccessToken(supabaseAdmin, acc);
        if (!token) {
          // Cuenta pedida explícitamente sin token válido → el usuario debe reconectar.
          if (accountId) {
            return new Response(
              JSON.stringify({ error: "Reconecta esta cuenta de Google para dar acceso al correo.", code: "REAUTH_REQUIRED" }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }
          continue;
        }
        // Con texto de búsqueda: buscar en TODO el correo (sin restringir a la etiqueta/INBOX).
        const listQs = new URLSearchParams({ maxResults: String(maxResults) });
        if (!searchText) listQs.set("labelIds", labelId);
        if (params?.pageToken) listQs.set("pageToken", params.pageToken);
        if (q) listQs.set("q", q);
        const listRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${listQs}`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        if (!listRes.ok) {
          if (accountId) {
            const body = await listRes.text();
            // 403 con accessNotConfigured = la Gmail API no está habilitada en el proyecto
            // de Google Cloud; reconectar la cuenta NO lo arregla.
            if (/accessNotConfigured|SERVICE_DISABLED|has not been used in project/i.test(body)) {
              return new Response(
                JSON.stringify({ error: "La API de Gmail no está habilitada en el proyecto de Google Cloud de Kawiil. Actívala en console.cloud.google.com → APIs y servicios → Biblioteca → Gmail API → Habilitar. Reconectar la cuenta no resuelve esto." }),
                { headers: { ...corsHeaders, "Content-Type": "application/json" } },
              );
            }
            // 401/403 restantes = el token no incluye los scopes de Gmail.
            if (listRes.status === 401 || listRes.status === 403) {
              return new Response(
                JSON.stringify({ error: "Esta cuenta se conectó solo para calendario. Reconéctala para autorizar el correo.", code: "REAUTH_REQUIRED" }),
                { headers: { ...corsHeaders, "Content-Type": "application/json" } },
              );
            }
            // Cualquier otro fallo: exponer el motivo real, nunca lista vacía.
            return new Response(
              JSON.stringify({ error: `Gmail API [${listRes.status}]: ${body.slice(0, 300)}` }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } },
            );
          }
          continue;
        }
        let listJson = await listRes.json();
        let msgIds: string[] = (listJson.messages ?? []).map((m: any) => m.id);
        // Fallback OR: si la búsqueda AND (por defecto en Gmail) no encontró nada y hay varias
        // palabras, reintentamos con OR para no dejar sin resultados cuando un término está escrito
        // distinto (p. ej. el nombre) pero otro sí coincide (el asunto).
        const searchTerms = searchText.split(/\s+/).filter(Boolean);
        if (searchText && searchTerms.length > 1 && msgIds.length === 0) {
          const orQs = new URLSearchParams({ maxResults: String(maxResults) });
          orQs.set("q", [filterUnread ? "is:unread" : "", searchTerms.join(" OR ")].filter(Boolean).join(" ").trim());
          if (params?.pageToken) orQs.set("pageToken", params.pageToken);
          const orRes = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages?${orQs}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (orRes.ok) {
            listJson = await orRes.json();
            msgIds = (listJson.messages ?? []).map((m: any) => m.id);
          }
        }
        if (listJson.nextPageToken && accountId) nextPageToken = listJson.nextPageToken;
        const metaFetches = msgIds.map((id: string) =>
          fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${id}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date&metadataHeaders=To`, {
            headers: { Authorization: `Bearer ${token}` },
          }).then(r => r.ok ? r.json() : null)
        );
        const metas = await Promise.all(metaFetches);
        for (const meta of metas) { if (meta) allEmails.push(normalizeGmailMsg(meta, acc.id, acc.email || "")); }
      }
      (allEmails as any[]).sort((a, b) => String(b.receivedDateTime ?? "").localeCompare(String(a.receivedDateTime ?? "")));
      return new Response(JSON.stringify({ value: allEmails, nextPageToken }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "gmail-detail") {
      const acc = accountId ? accounts.find(a => a.id === accountId) : accounts[0];
      if (!acc) return new Response(JSON.stringify({ error: "no_account" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const token = await ensureAccessToken(supabaseAdmin, acc);
      if (!token) return new Response(JSON.stringify({ error: "no_valid_token" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const rawId = String(params?.emailId || "").replace(/^gmail:[^:]+:/, "");
      const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${rawId}?format=full`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const msg = await res.json();
      const hdrs: Array<{ name: string; value: string }> = msg.payload?.headers || [];
      const hdr = (n: string) =>
        decodeRfc2047(hdrs.find((h: any) => h.name.toLowerCase() === n.toLowerCase())?.value || "");
      const { html, text } = extractGmailBody(msg.payload);
      const normalized = normalizeGmailMsg(msg, acc.id, acc.email || "");
      return new Response(JSON.stringify({
        ...normalized,
        body: { contentType: html ? "html" : "text", content: html || (text ? text.replace(/\n/g, "<br>") : "") },
        internetMessageId: hdr("message-id"),
        references: hdr("references"),
        inReplyTo: hdr("in-reply-to"),
        ccRecipients: (hdr("cc") || "").split(",").filter(Boolean).map((t: string) => {
          const p = parseGmailAddr(t.trim()); return { emailAddress: { name: p.name, address: p.address } };
        }),
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Lista de adjuntos de un correo de Gmail (recorre las partes MIME con filename).
    if (action === "gmail-attachments") {
      const acc = accountId ? accounts.find(a => a.id === accountId) : accounts[0];
      if (!acc) return new Response(JSON.stringify({ value: [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const token = await ensureAccessToken(supabaseAdmin, acc);
      if (!token) return new Response(JSON.stringify({ value: [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const rawId = String(params?.emailId || "").replace(/^gmail:[^:]+:/, "");
      const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${rawId}?format=full`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return new Response(JSON.stringify({ value: [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const msg = await res.json();
      const out: any[] = [];
      const walk = (p: any) => {
        if (!p) return;
        if (p.filename && p.filename.length > 0 && p.body?.attachmentId) {
          out.push({ id: p.body.attachmentId, name: p.filename, contentType: p.mimeType || "application/octet-stream", size: p.body.size ?? 0, isInline: false });
        }
        (p.parts || []).forEach(walk);
      };
      walk(msg.payload);
      return new Response(JSON.stringify({ value: out }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // Bytes de un adjunto de Gmail (base64) para descargar/visualizar.
    if (action === "gmail-attachment-content") {
      const acc = accountId ? accounts.find(a => a.id === accountId) : accounts[0];
      if (!acc) return new Response(JSON.stringify({ error: "no_account" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const token = await ensureAccessToken(supabaseAdmin, acc);
      if (!token) return new Response(JSON.stringify({ error: "no_valid_token" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const rawId = String(params?.emailId || "").replace(/^gmail:[^:]+:/, "");
      const attId = String(params?.attachmentId || "");
      if (!rawId || !attId) return new Response(JSON.stringify({ error: "emailId y attachmentId requeridos" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const res = await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${rawId}/attachments/${attId}`, { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return new Response(JSON.stringify({ error: "not_found" }), { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const json = await res.json();
      // Gmail devuelve base64url; convertir a base64 estándar para el frontend.
      const b64 = String(json.data || "").replace(/-/g, "+").replace(/_/g, "/");
      return new Response(JSON.stringify({
        contentType: String(params?.contentType || "application/octet-stream"),
        name: String(params?.name || "adjunto"),
        size: json.size,
        contentBytes: b64,
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "gmail-labels") {
      const acc = accountId ? accounts.find(a => a.id === accountId) : accounts[0];
      if (!acc) return new Response(JSON.stringify({ value: [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const token = await ensureAccessToken(supabaseAdmin, acc);
      if (!token) return new Response(JSON.stringify({ value: [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/labels", { headers: { Authorization: `Bearer ${token}` } });
      if (!res.ok) return new Response(JSON.stringify({ value: [] }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const json = await res.json();
      const SYSTEM_LABELS = new Set(["INBOX", "SENT", "DRAFT", "TRASH", "SPAM", "STARRED"]);
      const labels = (json.labels ?? [])
        .filter((l: any) => l.type !== "system" || SYSTEM_LABELS.has(l.id))
        .map((l: any) => ({ id: `gmail:${acc.id}:${l.id}`, name: l.name, type: l.type, _accountId: acc.id, _rawId: l.id }));
      return new Response(JSON.stringify({ value: labels, _accountId: acc.id }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "gmail-inbox-meta") {
      const targetAccounts = accountId ? accounts.filter(a => a.id === accountId) : accounts;
      const metaList: unknown[] = [];
      for (const acc of targetAccounts) {
        const token = await ensureAccessToken(supabaseAdmin, acc);
        if (!token) continue;
        const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/labels/INBOX", { headers: { Authorization: `Bearer ${token}` } });
        if (!res.ok) continue;
        const json = await res.json();
        metaList.push({ accountId: acc.id, email: acc.email, unreadItemCount: json.messagesUnread ?? 0 });
      }
      return new Response(JSON.stringify({ accounts: metaList }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "gmail-mark-read") {
      const acc = accountId ? accounts.find(a => a.id === accountId) : accounts[0];
      if (!acc) return new Response(JSON.stringify({ error: "no_account" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const token = await ensureAccessToken(supabaseAdmin, acc);
      if (!token) return new Response(JSON.stringify({ error: "no_valid_token" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const rawId = String(params?.emailId || "").replace(/^gmail:[^:]+:/, "");
      await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${rawId}/modify`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ removeLabelIds: ["UNREAD"] }),
      });
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "gmail-archive") {
      const acc = accountId ? accounts.find(a => a.id === accountId) : accounts[0];
      if (!acc) return new Response(JSON.stringify({ error: "no_account" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const token = await ensureAccessToken(supabaseAdmin, acc);
      if (!token) return new Response(JSON.stringify({ error: "no_valid_token" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const rawId = String(params?.emailId || "").replace(/^gmail:[^:]+:/, "");
      await fetch(`https://gmail.googleapis.com/gmail/v1/users/me/messages/${rawId}/modify`, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ removeLabelIds: ["INBOX"] }),
      });
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    if (action === "gmail-send") {
      const acc = accountId ? accounts.find(a => a.id === accountId) : accounts[0];
      if (!acc) return new Response(JSON.stringify({ error: "no_account" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const token = await ensureAccessToken(supabaseAdmin, acc);
      if (!token) return new Response(JSON.stringify({ error: "no_valid_token" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      const toList: string[] = params?.to || [];
      const ccList: string[] = params?.cc || [];
      const subjectB64 = btoa(unescape(encodeURIComponent(params?.subject || "(sin asunto)")));
      const bodyB64 = btoa(unescape(encodeURIComponent(params?.bodyHtml || "")));
      const attachments = Array.isArray(params?.attachments) ? params.attachments : [];
      const headerBase = [
        `From: ${acc.email}`,
        `To: ${toList.join(", ")}`,
        ...(ccList.length ? [`Cc: ${ccList.join(", ")}`] : []),
        `Subject: =?UTF-8?B?${subjectB64}?=`,
        "MIME-Version: 1.0",
      ];
      let mimeStr: string;
      if (attachments.length) {
        // multipart/mixed: cuerpo HTML + cada adjunto (base64). Permite enviar adjuntos desde Gmail.
        const boundary = `kawiil_${Date.now()}_bnd`;
        const parts: string[] = [];
        parts.push(`--${boundary}`, "Content-Type: text/html; charset=utf-8", "Content-Transfer-Encoding: base64", "", bodyB64);
        for (const a of attachments) {
          const name = String(a?.name || "adjunto").replace(/["\r\n]/g, "");
          parts.push(
            `--${boundary}`,
            `Content-Type: ${a?.contentType || "application/octet-stream"}; name="${name}"`,
            "Content-Transfer-Encoding: base64",
            `Content-Disposition: attachment; filename="${name}"`,
            "",
            String(a?.contentBytes || ""),
          );
        }
        parts.push(`--${boundary}--`);
        mimeStr = [...headerBase, `Content-Type: multipart/mixed; boundary="${boundary}"`, "", ...parts].join("\r\n");
      } else {
        mimeStr = [...headerBase, "Content-Type: text/html; charset=utf-8", "Content-Transfer-Encoding: base64", "", bodyB64].join("\r\n");
      }
      const raw = btoa(mimeStr).replace(/\+/g, "-").replace(/\//g, "_").replace(/=/g, "");
      const res = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
        method: "POST", headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
        body: JSON.stringify({ raw }),
      });
      if (!res.ok) {
        const errJson = await res.json().catch(() => ({}));
        return new Response(JSON.stringify({ error: (errJson as any)?.error?.message || "send_failed" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
      }
      return new Response(JSON.stringify({ success: true }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    return new Response(JSON.stringify({ error: "unknown_action" }), { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } });
  } catch (error) {
    console.error("Error in google-api:", error);
    return new Response(JSON.stringify({ error: (error as Error).message }), { status: 500, headers: corsHeaders });
  }
});
