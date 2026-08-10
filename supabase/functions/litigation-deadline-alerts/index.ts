// Cron: alertas de términos y audiencias de litigio.
// Recorre los juicios (projects.area='juicios'), evalúa cada término/audiencia
// pendiente de lawsuit_details.deadlines[] y avisa (notificación in-app + push) en
// ventanas T-7 / T-3 / T-1 / hoy / vencido. Deduplica por (deadline_id, bucket) en
// la tabla litigation_deadline_alerts para no repetir el mismo aviso.
//
// Protegido por header `x-cron-secret` == secreto CRON_SECRET. Misma mecánica que
// cert-expiry-notifier.
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendWebPushToUsers } from "../_shared/webPush.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const DEADLINE_TYPE_LABELS: Record<string, string> = {
  termino: "Término",
  audiencia: "Audiencia",
  entrega: "Entrega",
  vencimiento: "Vencimiento",
};

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface Deadline {
  id: string;
  title: string;
  date: string;
  time?: string;
  type: string;
  completed?: boolean;
  assigned_to?: string | null;
  attendees?: string[];
}

function daysLeft(dateStr: string): number {
  return Math.round((Date.parse(`${dateStr}T00:00:00Z`) - Date.now()) / (24 * 60 * 60 * 1000));
}

/** Ventana de aviso o null si aún no toca. */
function bucketFor(days: number): string | null {
  if (days < 0) return "overdue";
  if (days === 0) return "d0";
  if (days === 1) return "d1";
  if (days <= 3) return "d3";
  if (days <= 7) return "d7";
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });

  try {
    const cronSecret = Deno.env.get("CRON_SECRET");
    if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret) {
      return new Response(JSON.stringify({ error: "No autorizado" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const svc = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    const origin = Deno.env.get("APP_ORIGIN") || "";

    const { data: projects, error } = await svc
      .from("projects")
      .select("id, organization_id, name, responsible_user_id, lawsuit_details")
      .eq("area", "juicios")
      .not("lawsuit_details", "is", null);
    if (error) throw error;

    let evaluated = 0;
    let notified = 0;

    for (const p of projects ?? []) {
      const deadlines: Deadline[] = Array.isArray((p.lawsuit_details as any)?.deadlines)
        ? (p.lawsuit_details as any).deadlines
        : [];

      for (const dl of deadlines) {
        if (dl.completed || !dl.date) continue;
        evaluated++;
        const bucket = bucketFor(daysLeft(dl.date));
        if (!bucket) continue;

        // Dedup: intentamos registrar (deadline_id, bucket); si ya existe, no re-avisamos.
        const { error: dupErr } = await svc.from("litigation_deadline_alerts").insert({
          organization_id: p.organization_id,
          project_id: p.id,
          deadline_id: dl.id,
          bucket,
        });
        if (dupErr) {
          if (dupErr.code !== "23505") console.error("alert dedup:", dupErr.message);
          continue;
        }

        // Destinatarios: asignado + asistentes que sean usuarios; si no, el responsable.
        const recipients = new Set<string>();
        if (dl.assigned_to && UUID_RE.test(dl.assigned_to)) recipients.add(dl.assigned_to);
        for (const a of dl.attendees ?? []) if (UUID_RE.test(a)) recipients.add(a);
        if (recipients.size === 0 && p.responsible_user_id) recipients.add(p.responsible_user_id);
        if (recipients.size === 0) continue;

        const tipo = DEADLINE_TYPE_LABELS[dl.type] || "Término";
        const days = daysLeft(dl.date);
        const when =
          bucket === "overdue" ? "VENCIDO" :
          bucket === "d0" ? "HOY" :
          bucket === "d1" ? "MAÑANA" :
          `en ${days} días`;
        const title = `${tipo} ${when} · ${dl.title}`;
        const body = `${p.name}${dl.time ? ` · ${dl.time}` : ""} — ${dl.date}`;
        const url = origin ? `${origin}/proyectos/${p.id}?tab=juicio` : undefined;

        const notifRows = Array.from(recipients).map((uid) => ({
          user_id: uid,
          type: "litigation_deadline",
          title,
          body,
          entity_type: "project",
          entity_id: p.id,
          organization_id: p.organization_id,
        }));
        const { error: insErr } = await svc.from("notifications").insert(notifRows);
        if (insErr) {
          console.error("alert notif insert:", insErr.message);
          continue;
        }
        notified += notifRows.length;

        try {
          await sendWebPushToUsers({
            userIds: Array.from(recipients),
            title,
            body,
            url,
            tag: `litig-deadline:${dl.id}:${bucket}`,
            requireInteraction: days <= 1,
          });
        } catch (pushErr) {
          console.warn("alert push:", pushErr);
        }
      }
    }

    return new Response(JSON.stringify({ ok: true, evaluated, notified }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("litigation-deadline-alerts failed:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
