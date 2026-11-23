/**
 * Radar de actividades (Fase 0 del seguimiento proactivo de Donna). Cron diario lun-vie ~08:37 CDMX.
 * Revisa cada actividad vigente (planeación / en curso) con reglas fijas, sin IA, y avisa solo lo que pide acción:
 * +1 extra por aprobar, sede u hora sin confirmar, invitados sin responder, anticipos y rubros sin elegir, tareas vencidas.
 *
 * Quién recibe: quienes administran la actividad (G4, el responsable y los ayudantes asignados).
 * Calma: un solo aviso agrupado por persona y por día; entre semana solo lo "ahora", los lunes también lo "pronto".
 * Crea la notificación in-app y manda web push (respeta el horario de silencio de cada persona).
 * Auth: x-cron-secret (CRON_SECRET), igual que kawiilito-cierre.
 * Pruebas: {"dry_run": true} solo reporta a quién avisaría y qué diría; {"only_user_id": "<uuid>"} limita a una persona;
 *          {"forzar_lunes": true} incluye lo "pronto" aunque no sea lunes.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendWebPushToUsers } from "../_shared/webPush.ts";
import {
  construirMensajeRadar, diasHasta, esLunes, evaluarActividad, fechaMexico, resumenesConAviso,
  type RadarActividadResumen,
} from "../_shared/actividadesRadar.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};
const NOTIFICATION_TYPE = "actividades_radar";

const json = (b: unknown, status = 200) =>
  new Response(JSON.stringify(b), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const cronSecret = Deno.env.get("CRON_SECRET");
    if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret) {
      return json({ error: "No autorizado" }, 401);
    }
    const body = await req.json().catch(() => ({}));
    const dryRun = body?.dry_run === true;
    const onlyUserId = typeof body?.only_user_id === "string" ? body.only_user_id : null;

    const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const appOrigin =
      (Deno.env.get("SITE_URL") || Deno.env.get("PUBLIC_APP_URL") || "").replace(/\/$/, "") || "https://kawiil-central.mx";

    const hoy = fechaMexico(new Date());
    const lunes = esLunes(hoy) || body?.forzar_lunes === true;
    // Una sola por día aunque el cron se dispare dos veces.
    const recentCutoff = new Date(Date.now() - 20 * 60 * 60 * 1000).toISOString();

    const { data: acts, error: ae } = await svc
      .from("activities")
      .select("id, organization_id, name, event_date, event_time, venue_confirmed, location, status, responsible_user_id")
      .in("status", ["planeacion", "en_curso"]);
    if (ae) throw ae;
    const activities = acts ?? [];
    if (activities.length === 0) return json({ ok: true, sent: 0, actividades: 0 });
    const actIds = activities.map((a) => a.id as string);

    const [attR, provR, taskR, mgrR, g4R, profR, doneR] = await Promise.all([
      svc.from("activity_attendees").select("activity_id, confirmed, rsvp_responded_at, extra_guests_status").in("activity_id", actIds),
      svc.from("activity_providers").select("activity_id, category, status, advance").in("activity_id", actIds),
      svc.from("tasks").select("activity_id, due_date, status").in("activity_id", actIds),
      svc.from("activity_managers").select("activity_id, user_id").in("activity_id", actIds),
      svc.from("user_roles").select("user_id").eq("role", "transformador"),
      svc.from("profiles").select("user_id, organization_id, full_name, proactive_ai_notifications")
        .eq("is_active", true).eq("invitation_accepted", true),
      svc.from("notifications").select("user_id").eq("type", NOTIFICATION_TYPE).gte("created_at", recentCutoff),
    ]);
    for (const r of [attR, provR, taskR, mgrR, g4R, profR]) if (r.error) throw r.error;

    const by = <T extends { activity_id: string }>(rows: T[] | null) => {
      const m = new Map<string, T[]>();
      for (const r of rows ?? []) { const l = m.get(r.activity_id) ?? []; l.push(r); m.set(r.activity_id, l); }
      return m;
    };
    const attBy = by(attR.data as any[]); const provBy = by(provR.data as any[]);
    const taskBy = by(taskR.data as any[]); const mgrBy = by(mgrR.data as any[]);
    const g4 = new Set((g4R.data ?? []).map((r) => r.user_id as string));
    const profiles = new Map((profR.data ?? []).map((p) => [p.user_id as string, p]));
    const yaAvisados = new Set((doneR.data ?? []).map((r) => r.user_id as string));

    // Resumen por actividad y a quién le toca.
    const porPersona = new Map<string, RadarActividadResumen[]>();
    for (const a of activities) {
      const hallazgos = evaluarActividad(
        { id: a.id, name: a.name, event_date: a.event_date, event_time: a.event_time,
          venue_confirmed: !!a.venue_confirmed, location: a.location },
        (attBy.get(a.id) ?? []) as any, (provBy.get(a.id) ?? []) as any, (taskBy.get(a.id) ?? []) as any, hoy,
      );
      if (hallazgos.length === 0) continue;
      const resumen: RadarActividadResumen = {
        id: a.id, name: a.name, hallazgos,
        dias: a.event_date ? diasHasta(a.event_date, hoy) : null,
      };
      const destinatarios = new Set<string>([
        ...g4, ...(a.responsible_user_id ? [a.responsible_user_id as string] : []),
        ...(mgrBy.get(a.id) ?? []).map((m: any) => m.user_id as string),
      ]);
      for (const uid of destinatarios) {
        const p = profiles.get(uid);
        // Misma organización, cuenta activa y que no haya apagado los avisos proactivos.
        if (!p || p.organization_id !== a.organization_id || p.proactive_ai_notifications === false) continue;
        if (onlyUserId && uid !== onlyUserId) continue;
        const l = porPersona.get(uid) ?? []; l.push(resumen); porPersona.set(uid, l);
      }
    }

    let sent = 0;
    const preview: { user_id: string; title: string; body: string; ya_avisado_hoy: boolean }[] = [];
    for (const [uid, resumenes] of porPersona) {
      const p = profiles.get(uid)!;
      if (!dryRun && yaAvisados.has(uid)) continue;
      const nombre = String(p.full_name ?? "").trim().split(/\s+/)[0] ?? "";
      const msg = construirMensajeRadar(nombre, resumenes, lunes);
      if (!msg) continue;
      if (dryRun) { preview.push({ user_id: uid, ...msg, ya_avisado_hoy: yaAvisados.has(uid) }); continue; }

      // Si el aviso habla de una sola actividad, el clic lleva directo a ella.
      const incluidas = resumenesConAviso(resumenes, lunes);
      const unica = incluidas.length === 1 ? incluidas[0].id : null;
      const { error: ie } = await svc.from("notifications").insert({
        user_id: uid, organization_id: p.organization_id, type: NOTIFICATION_TYPE,
        title: msg.title, body: msg.body,
        entity_type: unica ? "activity" : "dashboard", entity_id: unica,
        is_read: false,
      });
      if (ie) { console.warn("[actividades-radar] insert falló:", ie.message); continue; }
      await sendWebPushToUsers(svc, {
        userIds: [uid], title: msg.title, body: msg.body,
        url: unica ? `${appOrigin}/actividades/${unica}` : `${appOrigin}/actividades`,
        tag: `actividades-radar-${uid}`,
      });
      sent += 1;
    }

    if (dryRun) return json({ ok: true, dry_run: true, hoy, lunes, actividades: activities.length, would_send: preview.length, preview });
    return json({ ok: true, hoy, lunes, actividades: activities.length, sent });
  } catch (e) {
    console.error("actividades-radar", e);
    return json({ error: String(e) }, 500);
  }
});
