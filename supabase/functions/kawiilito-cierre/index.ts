/**
 * Kawiilito · cierre del día (cron 17:00 CDMX, lun-vie).
 * Avisa a cada persona con tareas que vencen hoy o ya vencidas, o con compromisos de juntas
 * sin tarea, para que cierre su día aunque no tenga Kawiil abierto. Crea la notificación
 * in-app y manda web push. Sin llamadas a IA: el mensaje es determinista y calmado.
 * Auth: x-cron-secret (CRON_SECRET), igual que ai-proactive-notifications.
 * Pruebas: cuerpo {"dry_run": true} solo reporta a quién avisaría; {"only_user_id": "<uuid>"} limita a una persona.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendWebPushToUsers } from "../_shared/webPush.ts";
import { buildCierreMessage, parseCierreOptions } from "../_shared/kawiilitoCierre.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const NOTIFICATION_TYPE = "kawiilito_cierre";
const AGREEMENTS_WINDOW_DAYS = 14;

function ymdMexico(d: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d);
}

function nextYmd(ymd: string): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
}

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const cronSecret = Deno.env.get("CRON_SECRET");
    if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret) {
      return json({ error: "No autorizado" }, 401);
    }

    const opts = parseCierreOptions(await req.json().catch(() => ({})));
    const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const appOrigin =
      (Deno.env.get("SITE_URL") || Deno.env.get("PUBLIC_APP_URL") || "").replace(/\/$/, "") ||
      "https://app.kawiil.com";

    const now = new Date();
    const todayYmd = ymdMexico(now);
    const since = new Date(now.getTime() - AGREEMENTS_WINDOW_DAYS * 24 * 60 * 60 * 1000).toISOString();
    // Una sola por día aunque el cron se dispare dos veces.
    const recentCutoff = new Date(now.getTime() - 20 * 60 * 60 * 1000).toISOString();

    const { data: profiles, error: pe } = await svc
      .from("profiles")
      .select("user_id, organization_id, full_name, proactive_ai_notifications")
      .eq("is_active", true)
      .eq("invitation_accepted", true);
    if (pe) throw pe;

    const people = (profiles ?? []).filter(
      (p) =>
        p.user_id &&
        p.organization_id &&
        p.proactive_ai_notifications !== false &&
        (!opts.onlyUserId || p.user_id === opts.onlyUserId),
    );
    const ids = people.map((p) => p.user_id as string);
    if (ids.length === 0) return json({ ok: true, sent: 0, users: 0 });

    const [{ data: tasks, error: te }, { data: agreements, error: ae }, { data: already }] = await Promise.all([
      svc
        .from("tasks")
        .select("assigned_to, due_date")
        .in("assigned_to", ids)
        // «en_revision» espera a un tercero: no tiene sentido pedir cerrarla hoy.
        .in("status", ["pendiente", "en_progreso"])
        .not("due_date", "is", null)
        .lt("due_date", nextYmd(todayYmd)),
      svc
        .from("mtg_agreements")
        .select("owner_user_id, created_by")
        .in("status", ["proposed", "confirmed"])
        .is("task_id", null)
        .gte("created_at", since),
      svc.from("notifications").select("user_id").eq("type", NOTIFICATION_TYPE).gte("created_at", recentCutoff),
    ]);
    if (te) throw te;
    if (ae) console.warn("[kawiilito-cierre] acuerdos no disponibles:", ae.message);

    const dueByUser = new Map<string, { dueNow: number; overdue: number }>();
    for (const t of tasks ?? []) {
      const d = String(t.due_date).slice(0, 10);
      if (d > todayYmd) continue;
      const cur = dueByUser.get(t.assigned_to as string) ?? { dueNow: 0, overdue: 0 };
      cur.dueNow += 1;
      if (d < todayYmd) cur.overdue += 1;
      dueByUser.set(t.assigned_to as string, cur);
    }

    const agreementsByUser = new Map<string, number>();
    for (const a of agreements ?? []) {
      // Del responsable; si no tiene, de quien lo capturó.
      const uid = (a.owner_user_id ?? a.created_by) as string | null;
      if (uid) agreementsByUser.set(uid, (agreementsByUser.get(uid) ?? 0) + 1);
    }

    const notified = new Set((already ?? []).map((r) => r.user_id as string));
    let sent = 0;
    const preview: { user_id: string; title: string; body: string; already_notified: boolean }[] = [];

    for (const p of people) {
      const uid = p.user_id as string;
      // En dry_run no se omite a nadie: se reporta si ya se le avisó hoy.
      if (!opts.dryRun && notified.has(uid)) continue;
      const due = dueByUser.get(uid);
      const msg = buildCierreMessage({
        firstName: String(p.full_name ?? "").trim().split(/\s+/)[0] ?? "",
        dueNow: due?.dueNow ?? 0,
        overdue: due?.overdue ?? 0,
        agreements: agreementsByUser.get(uid) ?? 0,
      });
      if (!msg) continue;

      if (opts.dryRun) {
        preview.push({ user_id: uid, title: msg.title, body: msg.body, already_notified: notified.has(uid) });
        continue;
      }

      const { error: ie } = await svc.from("notifications").insert({
        user_id: uid,
        organization_id: p.organization_id,
        type: NOTIFICATION_TYPE,
        title: msg.title,
        body: msg.body,
        entity_type: "dashboard",
        entity_id: null,
        is_read: false,
      });
      if (ie) {
        console.warn("[kawiilito-cierre] insert falló:", ie.message);
        continue;
      }
      await sendWebPushToUsers(svc, {
        userIds: [uid],
        title: msg.title,
        body: msg.body,
        url: `${appOrigin}/`,
        tag: `kawiilito-cierre-${uid}`,
      });
      sent += 1;
    }

    if (opts.dryRun) return json({ ok: true, dry_run: true, would_send: preview.length, users: people.length, preview });
    return json({ ok: true, sent, users: people.length });
  } catch (e) {
    console.error("kawiilito-cierre", e);
    return json({ error: String(e) }, 500);
  }
});
