/**
 * push-from-notification: puente entre `notifications` (campana dentro de la app) y Web Push (celular/PWA).
 *
 * Lo llama el trigger `trg_push_bridge_notification` (pg_net) cada vez que se inserta una notificación
 * de un tipo permitido. Autenticación: cabecera x-cron-secret == CRON_SECRET (igual que los demás crons).
 * Despliegue: `supabase functions deploy push-from-notification --no-verify-jwt`.
 *
 * Slack (DM y menciones) NO pasa por aquí: slack-events ya manda su propio push.
 */
import { createClient } from "npm:@supabase/supabase-js@2";
import { sendWebPushToUsers } from "../_shared/webPush.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

type Ruta = { url: string; requireInteraction: boolean; ignoraSilencio: boolean };

/**
 * Tipo de notificación → a dónde abre el toque, si el banner se queda hasta que lo atiendan y si puede
 * sonar dentro del horario de silencio (por defecto 22:00–07:00). Solo las solicitudes por aprobar lo ignoran.
 */
export const RUTAS_PUSH: Record<string, Ruta> = {
  rh_request_pending: { url: "/rh?rh=solicitudes", requireInteraction: true, ignoraSilencio: true },
  rh_request_decided: { url: "/rh?rh=solicitudes", requireInteraction: false, ignoraSilencio: false },
  rh_candidate_new: { url: "/rh?rh=reclutamiento", requireInteraction: false, ignoraSilencio: false },
  aviso_equipo: { url: "/", requireInteraction: false, ignoraSilencio: false },
  email_new: { url: "/correo", requireInteraction: false, ignoraSilencio: false },
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const cronSecret = Deno.env.get("CRON_SECRET");
    if (!cronSecret || req.headers.get("x-cron-secret") !== cronSecret) {
      return json({ error: "No autorizado" }, 401);
    }

    const payload = await req.json().catch(() => ({})) as {
      notification_id?: string;
      user_id?: string;
      type?: string;
      title?: string;
      body?: string | null;
    };

    const ruta = payload.type ? RUTAS_PUSH[payload.type] : undefined;
    if (!ruta) return json({ ok: true, skipped: "tipo sin push" });
    if (!payload.user_id || !payload.title) return json({ error: "Faltan user_id o title" }, 400);

    const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);

    const report = await sendWebPushToUsers(svc, {
      userIds: [payload.user_id],
      title: payload.title,
      body: (payload.body ?? "").toString().slice(0, 200),
      url: ruta.url,
      // Los correos comparten tag: el aviso nuevo reemplaza al anterior en vez de apilarse.
      tag: payload.type === "email_new" ? "kawiil-email-new" : `${payload.type}-${payload.notification_id ?? Date.now()}`,
      requireInteraction: ruta.requireInteraction,
      bypassQuietHours: ruta.ignoraSilencio,
    });

    return json({
      ok: true,
      type: payload.type,
      delivered: report.filter((r) => r.status === "ok").length,
      report: report.map((r) => ({ status: r.status, statusCode: r.statusCode })),
    });
  } catch (e) {
    console.error("push-from-notification:", e);
    return json({ error: (e as Error).message }, 500);
  }
});
