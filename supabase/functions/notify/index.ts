/**
 * Edge Function `notify` (P0.1) — punto de entrada HTTP del servicio interno de
 * notificaciones. La lógica vive en ../_shared/notify.ts (reutilizable + testeable).
 *
 * Auth (dual, como el resto del repo):
 *   - JWT de usuario (Authorization: Bearer <jwt>), o
 *   - service-role key en Authorization, o
 *   - x-cron-secret === CRON_SECRET (para crons y otras Edge Functions).
 *
 * Body:
 *   { canal, destino, plantilla, datos?, organization_id?, source_user_id? }
 *   o { notifications: [ ...igual... ] } para envío en lote.
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { sendNotification, type NotificationRequest, type NotifyResult } from "../_shared/notify.ts";
import { loadNotifyConfigFromEnv } from "../_shared/notifyEnv.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
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

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const cronSecret = Deno.env.get("CRON_SECRET");

  const authHeader = req.headers.get("Authorization") || "";
  const bearer = authHeader.startsWith("Bearer ") ? authHeader.slice(7) : "";
  const cronHeader = req.headers.get("x-cron-secret") || "";

  const admin = createClient(supabaseUrl, serviceKey);

  // Autenticación: system (cron/service-role) o usuario con JWT.
  let userId: string | null = null;
  let userOrgId: string | null = null;
  const isSystem = (!!cronSecret && cronHeader === cronSecret) || (!!bearer && bearer === serviceKey);

  if (!isSystem) {
    if (!bearer) return json({ error: "Unauthorized" }, 401);
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    });
    const { data: { user }, error } = await userClient.auth.getUser();
    if (error || !user) return json({ error: "Unauthorized" }, 401);
    userId = user.id;
    const { data: orgId } = await admin.rpc("get_user_org_id", { _user_id: user.id });
    userOrgId = (orgId as string) ?? null;
  }

  let body: Record<string, unknown>;
  try {
    body = (await req.json()) as Record<string, unknown>;
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }

  const rawList = Array.isArray(body.notifications)
    ? (body.notifications as Record<string, unknown>[])
    : [body];

  if (rawList.length === 0) return json({ error: "Sin notificaciones" }, 400);

  const config = loadNotifyConfigFromEnv();

  const requests: NotificationRequest[] = rawList.map((n) => ({
    canal: n.canal as NotificationRequest["canal"],
    destino: (n.destino as string) ?? undefined,
    plantilla: (n.plantilla as string) ?? "",
    datos: (n.datos as Record<string, unknown>) ?? {},
    // La organización cae de vuelta a la del usuario autenticado si no se especifica.
    organization_id: (n.organization_id as string) ?? userOrgId ?? null,
    source_user_id: (n.source_user_id as string) ?? userId ?? null,
  }));

  const results: NotifyResult[] = [];
  for (const request of requests) {
    results.push(await sendNotification({ admin, config }, request));
  }

  const ok = results.every((r) => r.ok || r.estado === "omitido");
  return json({ ok, results }, ok ? 200 : 207);
});
