import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const DIGEST_TYPE = "reminders_hourly_digest";
const DEDUPE_MS = 55 * 60 * 1000;
const MAX_TITLES_IN_BODY = 5;
const TITLE_PREVIEW_CHARS = 80;

async function sendWebPushToUser(
  supabase: ReturnType<typeof createClient>,
  userId: string,
  title: string,
  body: string,
  url: string,
) {
  const publicKey = Deno.env.get("VAPID_PUBLIC_KEY");
  const privateKey = Deno.env.get("VAPID_PRIVATE_KEY");
  if (!publicKey || !privateKey) return;

  const { data: prof } = await supabase
    .from("profiles")
    .select("desktop_push_notifications")
    .eq("user_id", userId)
    .maybeSingle();
  if (prof?.desktop_push_notifications !== true) return;

  const webpush = (await import("npm:web-push@3.6.6")).default;
  const contact = Deno.env.get("VAPID_CONTACT_EMAIL") || "mailto:hello@kawiil.com";
  webpush.setVapidDetails(contact, publicKey, privateKey);

  const { data: subs } = await supabase
    .from("push_subscriptions")
    .select("id, endpoint, p256dh, auth")
    .eq("user_id", userId);

  for (const s of subs || []) {
    try {
      await webpush.sendNotification(
        { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
        JSON.stringify({ title, body, url }),
      );
    } catch (e: unknown) {
      const code = (e as { statusCode?: number })?.statusCode;
      if (code === 404 || code === 410) {
        await supabase.from("push_subscriptions").delete().eq("id", s.id);
      }
      console.error("reminder-hourly-digest webpush:", code);
    }
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const cronSecret = Deno.env.get("CRON_SECRET");
    const headerSecret = req.headers.get("x-cron-secret");
    if (!cronSecret || headerSecret !== cronSecret) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const svc = createClient(supabaseUrl, serviceKey);

    const { data: profiles, error: pe } = await svc
      .from("profiles")
      .select("user_id, organization_id, desktop_push_notifications")
      .eq("reminders_hourly_digest", true);
    if (pe) throw pe;

    const rows = profiles ?? [];
    if (rows.length === 0) {
      return new Response(JSON.stringify({ ok: true, inserted: 0, users: 0 }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const userIds = rows.map((p) => p.user_id as string);
    const orgByUser = new Map(rows.map((p) => [p.user_id as string, p.organization_id as string]));
    const pushByUser = new Map(
      rows.map((p) => [p.user_id as string, p.desktop_push_notifications === true]),
    );

    const { data: pendingReminders, error: re } = await svc
      .from("reminders")
      .select("user_id, title, repeat_kind")
      .eq("is_completed", false)
      .in("user_id", userIds);
    if (re) throw re;

    const byUser = new Map<string, string[]>();
    for (const r of pendingReminders ?? []) {
      const rk = (r as { repeat_kind?: string }).repeat_kind ?? "hourly_digest";
      if (rk === "none" || rk === "daily_digest") continue;
      const uid = r.user_id as string;
      const t = (r.title as string)?.trim() || "(sin título)";
      if (!byUser.has(uid)) byUser.set(uid, []);
      byUser.get(uid)!.push(t);
    }

    const sinceIso = new Date(Date.now() - DEDUPE_MS).toISOString();
    const { data: recentDigests } = await svc
      .from("notifications")
      .select("user_id")
      .eq("type", DIGEST_TYPE)
      .gte("created_at", sinceIso)
      .in("user_id", userIds);
    const recentlyNotified = new Set((recentDigests ?? []).map((n) => n.user_id as string));

    let inserted = 0;
    const appOrigin =
      (Deno.env.get("SITE_URL") || Deno.env.get("PUBLIC_APP_URL") || "").replace(/\/$/, "") ||
      "https://app.kawiil.com";

    for (const uid of userIds) {
      const titles = byUser.get(uid);
      if (!titles?.length) continue;
      if (recentlyNotified.has(uid)) continue;

      const orgId = orgByUser.get(uid);
      if (!orgId) continue;

      const n = titles.length;
      const preview = titles
        .slice(0, MAX_TITLES_IN_BODY)
        .map((t) => (t.length > TITLE_PREVIEW_CHARS ? `${t.slice(0, TITLE_PREVIEW_CHARS)}…` : t));
      const more = n > MAX_TITLES_IN_BODY ? ` y ${n - MAX_TITLES_IN_BODY} más.` : ".";
      const body =
        n === 1
          ? preview[0]
          : `${n} pendientes: ${preview.join("; ")}${more}`;

      const { error: insErr } = await svc.from("notifications").insert({
        user_id: uid,
        organization_id: orgId,
        type: DIGEST_TYPE,
        title: n === 1 ? "Recordatorio pendiente" : "Recordatorios pendientes",
        body,
        is_read: false,
      });
      if (insErr) {
        console.error("reminder-hourly-digest insert:", insErr);
        continue;
      }
      inserted++;
      recentlyNotified.add(uid);

      if (pushByUser.get(uid)) {
        await sendWebPushToUser(
          svc,
          uid,
          n === 1 ? "Recordatorio pendiente" : "Recordatorios pendientes",
          body,
          `${appOrigin}/dashboard`,
        );
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        inserted,
        digestUsers: userIds.length,
        withPending: byUser.size,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("reminder-hourly-digest:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
