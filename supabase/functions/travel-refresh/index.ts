import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Cron (cada 15 min): recalcula el trayecto guardado de cada evento con el tráfico
// actual y avisa al usuario ~2 h y ~1 h antes de la hora de salida, por Kawiil
// Central (tabla notifications) y por DM de Slack. Idempotente por notified_2h/1h.

const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { "Content-Type": "application/json" } });

async function distanceMatrix(apiKey: string, origin: string, destination: string) {
  const params = new URLSearchParams({
    origins: origin,
    destinations: destination,
    mode: "driving",
    departure_time: "now",
    traffic_model: "best_guess",
    language: "es",
    region: "mx",
    units: "metric",
    key: apiKey,
  });
  const res = await fetch(`https://maps.googleapis.com/maps/api/distancematrix/json?${params}`);
  const data = await res.json();
  if (data.status !== "OK") return null;
  const el = data.rows?.[0]?.elements?.[0];
  if (!el || el.status !== "OK") return null;
  const traffic = el.duration_in_traffic ?? el.duration ?? null;
  return traffic ? { seconds: traffic.value as number, withTraffic: !!el.duration_in_traffic } : null;
}

async function dmToSlackUser(token: string, slackUserId: string, text: string) {
  try {
    await fetch("https://slack.com/api/chat.postMessage", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ channel: slackUserId, text }),
    });
  } catch (_) { /* no romper el resto por un DM */ }
}

const fmtHM = (d: Date) =>
  new Intl.DateTimeFormat("es-MX", { hour: "2-digit", minute: "2-digit", hour12: false, timeZone: "America/Mexico_City" }).format(d);

Deno.serve(async (req) => {
  // Solo el cron (o disparo manual con el secreto) puede ejecutar.
  const cronSecret = Deno.env.get("CRON_SECRET");
  if (cronSecret && req.headers.get("x-cron-secret") !== cronSecret) {
    return json({ error: "forbidden" }, 403);
  }

  const apiKey = Deno.env.get("GOOGLE_MAPS_API_KEY")?.trim();
  const slackToken = Deno.env.get("SLACK_BOT_TOKEN");
  const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

  const { data: rows, error } = await svc
    .from("event_travel")
    .select("user_id, event_id, origin, destination, duration_seconds, departure_iso, notified_2h, notified_1h");
  if (error) return json({ error: error.message }, 500);

  const now = Date.now();
  let notified = 0;

  for (const r of rows ?? []) {
    if (!r.departure_iso || !r.origin) continue;
    const eventStart = new Date(r.departure_iso).getTime();
    if (!Number.isFinite(eventStart)) continue;

    // Ventana según la hora de SALIDA (inicio - duración) con la duración vigente.
    let durationSeconds = r.duration_seconds as number;
    let leaveTime = eventStart - durationSeconds * 1000;
    const minsToLeave = (leaveTime - now) / 60000;

    const want2h = !r.notified_2h && minsToLeave <= 120 && minsToLeave > 60;
    const want1h = !r.notified_1h && minsToLeave <= 60 && minsToLeave > 0;
    if (!want2h && !want1h) continue;

    // Recalcular con tráfico actual (si hay key) y actualizar el bloque.
    let withTraffic = false;
    if (apiKey) {
      const fresh = await distanceMatrix(apiKey, r.origin, r.destination || r.origin);
      if (fresh) {
        durationSeconds = fresh.seconds;
        withTraffic = fresh.withTraffic;
        leaveTime = eventStart - durationSeconds * 1000;
      }
    }

    const patch: Record<string, unknown> = {
      duration_seconds: durationSeconds,
      with_traffic: withTraffic,
      computed_at: new Date().toISOString(),
    };
    if (want2h) patch.notified_2h = true;
    if (want1h) patch.notified_1h = true;
    await svc.from("event_travel").update(patch).eq("user_id", r.user_id).eq("event_id", r.event_id);

    const mins = Math.max(1, Math.round(durationSeconds / 60));
    const leaveStr = fmtHM(new Date(leaveTime));
    const eventStr = fmtHM(new Date(eventStart));
    const when = want2h ? "en ~2 h" : "en ~1 h";
    const title = `🚗 Traslado ${when}: sal a las ${leaveStr}`;
    const body = `Tu evento de las ${eventStr}${r.destination ? ` en ${r.destination}` : ""}: ~${mins} min${withTraffic ? " con tráfico ahora" : ""}. Sal a las ${leaveStr} para llegar a tiempo.`;

    // 1) Kawiil Central (in-app) — requiere organization_id del perfil.
    const { data: prof } = await svc
      .from("profiles").select("organization_id").eq("user_id", r.user_id).maybeSingle();
    if (prof?.organization_id) {
      await svc.from("notifications").insert({
        user_id: r.user_id,
        organization_id: prof.organization_id,
        type: "travel",
        title,
        body,
        is_read: false,
      });
    }

    // 2) Slack DM directo al usuario.
    if (slackToken) {
      const { data: conn } = await svc
        .from("user_slack_connections").select("slack_user_id").eq("user_id", r.user_id).maybeSingle();
      if (conn?.slack_user_id) await dmToSlackUser(slackToken, conn.slack_user_id, `${title}\n${body}`);
    }

    notified++;
  }

  return json({ ok: true, processed: (rows ?? []).length, notified });
});
