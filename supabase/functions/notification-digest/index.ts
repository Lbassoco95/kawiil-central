import { createClient } from "npm:@supabase/supabase-js@2";
import { sendWebPushToUsers } from "../_shared/webPush.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

function ymdMexico(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function addDaysYmd(ymd: string, days: number): string {
  const [y, m, da] = ymd.split("-").map(Number);
  const dt = new Date(y, m - 1, da + days);
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, "0");
  const dd = String(dt.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
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

    const todayYmd = ymdMexico(new Date());
    const tomorrowYmd = addDaysYmd(todayYmd, 1);

    const { data: tasks, error: te } = await svc
      .from("tasks")
      .select("id, title, due_date, assigned_to, organization_id, status")
      .in("status", ["pendiente", "en_progreso", "en_revision"])
      .not("assigned_to", "is", null)
      .not("due_date", "is", null);
    if (te) throw te;

    const rows = tasks ?? [];
    const overdue = rows.filter((t) => {
      const d = String(t.due_date).slice(0, 10);
      return d < todayYmd;
    });
    const dueTomorrow = rows.filter((t) => {
      const d = String(t.due_date).slice(0, 10);
      return d === tomorrowYmd;
    });

    const sinceIso = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
    const appOrigin =
      (Deno.env.get("SITE_URL") || Deno.env.get("PUBLIC_APP_URL") || "").replace(/\/$/, "") ||
      "https://app.kawiil.com";

    const { data: existing } = await svc
      .from("notifications")
      .select("entity_id, type")
      .in("type", ["deadline_overdue_task", "deadline_due_tomorrow_task"])
      .gte("created_at", sinceIso);

    const existingKeys = new Set((existing ?? []).map((n) => `${n.type}:${n.entity_id}`));

    let inserted = 0;

    for (const t of overdue) {
      const key = `deadline_overdue_task:${t.id}`;
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      const title = "Tarea vencida";
      const body = `"${t.title}" venció el ${String(t.due_date).slice(0, 10)}`;
      const { error } = await svc.from("notifications").insert({
        user_id: t.assigned_to as string,
        organization_id: t.organization_id,
        type: "deadline_overdue_task",
        title,
        body,
        entity_type: "task",
        entity_id: t.id,
        is_read: false,
      });
      if (!error) {
        inserted++;
        await sendWebPushToUsers(svc, {
          userIds: [t.assigned_to as string],
          title,
          body,
          url: `${appOrigin}/tareas?taskId=${encodeURIComponent(t.id)}`,
          tag: `deadline-overdue-${t.id}`,
        });
      }
    }

    for (const t of dueTomorrow) {
      const key = `deadline_due_tomorrow_task:${t.id}`;
      if (existingKeys.has(key)) continue;
      existingKeys.add(key);
      const title = "Tarea vence mañana";
      const body = `"${t.title}" vence el ${tomorrowYmd}`;
      const { error } = await svc.from("notifications").insert({
        user_id: t.assigned_to as string,
        organization_id: t.organization_id,
        type: "deadline_due_tomorrow_task",
        title,
        body,
        entity_type: "task",
        entity_id: t.id,
        is_read: false,
      });
      if (!error) {
        inserted++;
        await sendWebPushToUsers(svc, {
          userIds: [t.assigned_to as string],
          title,
          body,
          url: `${appOrigin}/tareas?taskId=${encodeURIComponent(t.id)}`,
          tag: `deadline-tomorrow-${t.id}`,
        });
      }
    }

    // Recordatorios personales con cadencia diaria (máx. 1 notificación / usuario / ~22 h)
    const { data: dailyReminders, error: dre } = await svc
      .from("reminders")
      .select("user_id, organization_id, title, id")
      .eq("is_completed", false)
      .eq("repeat_kind", "daily_digest");
    if (!dre && dailyReminders?.length) {
      const sinceDailyIso = new Date(Date.now() - 22 * 60 * 60 * 1000).toISOString();
      const { data: recentDailyDigests } = await svc
        .from("notifications")
        .select("user_id")
        .eq("type", "reminders_daily_digest")
        .gte("created_at", sinceDailyIso);
      const usersWithRecentDaily = new Set(
        (recentDailyDigests ?? []).map((n) => n.user_id as string),
      );

      const dailyByUser = new Map<string, { organization_id: string; titles: string[] }>();
      for (const r of dailyReminders) {
        const uid = r.user_id as string;
        if (!dailyByUser.has(uid)) {
          dailyByUser.set(uid, {
            organization_id: r.organization_id as string,
            titles: [],
          });
        }
        const t = (r.title as string)?.trim() || "Recordatorio";
        dailyByUser.get(uid)!.titles.push(t);
      }

      for (const [uid, bucket] of dailyByUser) {
        if (usersWithRecentDaily.has(uid) || bucket.titles.length === 0) continue;
        const n = bucket.titles.length;
        const preview = bucket.titles.slice(0, 5).join(n > 1 ? "; " : "");
        const body =
          n === 1
            ? preview
            : `${n} pendientes: ${preview}${n > 5 ? `… (+${n - 5})` : ""}`;
        const title = n === 1 ? "Recordatorio (resumen diario)" : "Recordatorios (resumen diario)";
        const { error: dIns } = await svc.from("notifications").insert({
          user_id: uid,
          organization_id: bucket.organization_id,
          type: "reminders_daily_digest",
          title,
          body,
          is_read: false,
        });
        if (!dIns) {
          inserted++;
          usersWithRecentDaily.add(uid);
          await sendWebPushToUsers(svc, {
            userIds: [uid],
            title,
            body,
            url: `${appOrigin}/dashboard`,
            tag: `reminder-daily-${uid}`,
          });
        }
      }
    }

    return new Response(
      JSON.stringify({
        ok: true,
        inserted,
        overdueScanned: overdue.length,
        dueTomorrowScanned: dueTomorrow.length,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (e) {
    console.error("notification-digest:", e);
    return new Response(
      JSON.stringify({ error: e instanceof Error ? e.message : String(e) }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }
});
