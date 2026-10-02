/**
 * gather-sync — Kawiil → Gather Smart Objects (webhooks firmados).
 *
 * Auth:
 *   - JWT usuario: list | save | delete | ping | sync_me
 *   - x-cron-secret (= CRON_SECRET): sync_all
 *
 * Secrets Edge: GATHER_BINDING_SECRET (≥32) o fallback MOFFIN_FIEL_SECRET.
 * verify_jwt = false en config (validación en código, igual que microsoft-api / satgo).
 */
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import {
  decryptFielSecret,
  encryptFielSecret,
} from "../_shared/moffinFielCrypto.ts";
import { gatherPing, gatherSend } from "../_shared/gatherWebhook.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const PURPOSES = ["inbox_tasks_slack_mail", "lightbulb_reminders"] as const;
type Purpose = (typeof PURPOSES)[number];

/** Ventana “por vencer” (G2). Override: GATHER_DUE_WINDOW_DAYS. */
function dueWindowDays(): number {
  const raw = Number(Deno.env.get("GATHER_DUE_WINDOW_DAYS") ?? "3");
  if (!Number.isFinite(raw) || raw < 0 || raw > 30) return 3;
  return Math.floor(raw);
}

function appOrigin(): string {
  return (
    (Deno.env.get("SITE_URL") || Deno.env.get("PUBLIC_APP_URL") || "").replace(/\/$/, "") ||
    "https://app.kawiil.com"
  );
}

function bindingSecret(): string {
  const primary = (Deno.env.get("GATHER_BINDING_SECRET") ?? "").trim();
  if (primary.length >= 32) return primary;
  const fallback = (Deno.env.get("MOFFIN_FIEL_SECRET") ?? "").trim();
  if (fallback.length >= 32) return fallback;
  return "";
}

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

function truncate(text: string, max: number): string {
  const t = text.trim().replace(/\s+/g, " ");
  if (t.length <= max) return t;
  return `${t.slice(0, Math.max(0, max - 1))}…`;
}

function hostFromUrl(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

type BindingRow = {
  id: string;
  user_id: string;
  organization_id: string;
  purpose: Purpose;
  label: string | null;
  webhook_url_ciphertext: string;
  webhook_secret_ciphertext: string;
  webhook_host: string | null;
  enabled: boolean;
  last_ping_at: string | null;
  last_sync_at: string | null;
  last_error: string | null;
  last_snapshot: Record<string, unknown> | null;
};

type Snapshot = {
  tasksDue: number;
  tasksOverdue: number;
  slackUnread: number;
  /** TODO: mail unread Graph — stub 0 en MVP (evitar scope creep). */
  mailUnread: number;
  remindersDue: number;
  urgent: boolean;
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function buildSnapshot(
  svc: SupabaseClient,
  userId: string,
  organizationId: string,
): Promise<Snapshot> {
  const today = ymdMexico(new Date());
  const windowEnd = addDaysYmd(today, dueWindowDays());
  const openStatuses = ["pendiente", "en_progreso", "en_revision"];

  const { data: tasks } = await svc
    .from("tasks")
    .select("id, title, due_date, status")
    .eq("assigned_to", userId)
    .eq("organization_id", organizationId)
    .in("status", openStatuses)
    .not("due_date", "is", null);

  let tasksDue = 0;
  let tasksOverdue = 0;
  for (const t of tasks ?? []) {
    const d = String(t.due_date).slice(0, 10);
    if (d < today) {
      tasksOverdue++;
      tasksDue++;
    } else if (d <= windowEnd) {
      tasksDue++;
    }
  }

  const { count: slackUnread } = await svc
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_read", false)
    .in("type", ["slack_message", "slack_mention"]);

  const { count: remindersDue } = await svc
    .from("reminders")
    .select("id", { count: "exact", head: true })
    .eq("user_id", userId)
    .eq("is_completed", false)
    .not("due_date", "is", null)
    .lte("due_date", today);

  const mailUnread = 0; // TODO(gather-mvp): unread Graph/Outlook sin scope creep

  const urgent = tasksOverdue > 0 || (remindersDue ?? 0) > 0;

  return {
    tasksDue,
    tasksOverdue,
    slackUnread: slackUnread ?? 0,
    mailUnread,
    remindersDue: remindersDue ?? 0,
    urgent,
  };
}

async function listDueTasks(
  svc: SupabaseClient,
  userId: string,
  organizationId: string,
  limit = 12,
): Promise<Array<{ id: string; title: string; due_date: string; overdue: boolean }>> {
  const today = ymdMexico(new Date());
  const windowEnd = addDaysYmd(today, dueWindowDays());
  const { data: tasks } = await svc
    .from("tasks")
    .select("id, title, due_date")
    .eq("assigned_to", userId)
    .eq("organization_id", organizationId)
    .in("status", ["pendiente", "en_progreso", "en_revision"])
    .not("due_date", "is", null)
    .lte("due_date", windowEnd)
    .order("due_date", { ascending: true })
    .limit(limit);

  return (tasks ?? []).map((t) => {
    const due = String(t.due_date).slice(0, 10);
    return {
      id: t.id as string,
      title: (t.title as string) || "Tarea",
      due_date: due,
      overdue: due < today,
    };
  });
}

async function syncInbox(
  url: string,
  secret: string,
  snapshot: Snapshot,
  tasks: Array<{ id: string; title: string; due_date: string; overdue: boolean }>,
): Promise<void> {
  const origin = appOrigin();
  await gatherSend(url, secret, "activity.clear");

  for (const t of tasks) {
    const prefix = t.overdue ? "Vencida" : `Vence ${t.due_date}`;
    await gatherSend(url, secret, "activity.add", {
      id: `task:${t.id}`,
      text: truncate(`${prefix}: ${t.title}`, 500),
      url: `${origin}/tareas?taskId=${encodeURIComponent(t.id)}`,
    });
  }

  if (snapshot.slackUnread > 0) {
    await gatherSend(url, secret, "activity.add", {
      id: "slack:unread",
      text: truncate(`Slack: ${snapshot.slackUnread} sin leer`, 500),
      url: `${origin}/comunicacion`,
    });
  }

  if (snapshot.mailUnread > 0) {
    await gatherSend(url, secret, "activity.add", {
      id: "mail:unread",
      text: truncate(`Correo: ${snapshot.mailUnread} sin leer`, 500),
      url: `${origin}/microsoft365/correo`,
    });
  } else {
    // Stub visible solo como activity informativa si hay otras señales? No — evita ruido.
  }

  const counter =
    snapshot.tasksDue + snapshot.slackUnread + snapshot.mailUnread;
  await gatherSend(url, secret, "counter.set", { count: Math.max(0, counter) });
}

async function syncLightbulb(
  url: string,
  secret: string,
  snapshot: Snapshot,
  colors: string[] | undefined,
): Promise<void> {
  const on = snapshot.urgent;
  await gatherSend(url, secret, "switch.set_state", { on });
  if (on && colors?.length) {
    const red =
      colors.find((c) => /red|rojo|crimson|scarlet/i.test(c)) ??
      colors.find((c) => /orange|amber|warn/i.test(c)) ??
      colors[0];
    if (red) {
      try {
        await gatherSend(url, secret, "variant.set", { color: red });
      } catch {
        // color fuera de lista → ignorar
      }
    }
  }
  const origin = appOrigin();
  const parts: string[] = [];
  if (snapshot.tasksOverdue > 0) parts.push(`${snapshot.tasksOverdue} vencida(s)`);
  if (snapshot.remindersDue > 0) parts.push(`${snapshot.remindersDue} recordatorio(s)`);
  await gatherSend(url, secret, "info.set", {
    name: on ? "Kawiil — urgente" : "Kawiil — al día",
    description: on
      ? truncate(parts.join(" · ") || "Hay señales urgentes en Kawiil", 2000)
      : `Sin urgencias. Desk sync Kawiil. Abrir: ${origin}/notificaciones`,
  });
}

async function decryptCreds(
  row: BindingRow,
  secretKey: string,
): Promise<{ url: string; secret: string }> {
  const url = await decryptFielSecret(row.webhook_url_ciphertext, secretKey);
  const secret = await decryptFielSecret(row.webhook_secret_ciphertext, secretKey);
  return { url, secret };
}

async function syncOneBinding(
  svc: SupabaseClient,
  row: BindingRow,
  secretKey: string,
): Promise<{ ok: boolean; error?: string; snapshot?: Snapshot }> {
  try {
    const { url, secret } = await decryptCreds(row, secretKey);
    const snapshot = await buildSnapshot(svc, row.user_id, row.organization_id);

    if (row.purpose === "inbox_tasks_slack_mail") {
      const tasks = await listDueTasks(svc, row.user_id, row.organization_id);
      await syncInbox(url, secret, snapshot, tasks);
    } else {
      let colors: string[] | undefined;
      try {
        const pong = await gatherPing(url, secret);
        colors = pong.colors;
      } catch {
        colors = undefined;
      }
      await syncLightbulb(url, secret, snapshot, colors);
    }

    await svc
      .from("gather_smart_object_bindings")
      .update({
        last_sync_at: new Date().toISOString(),
        last_error: null,
        last_snapshot: snapshot,
      })
      .eq("id", row.id);

    return { ok: true, snapshot };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    // Nunca loguear URL/secret
    console.error("gather-sync binding failed:", row.id, row.purpose, msg);
    await svc
      .from("gather_smart_object_bindings")
      .update({
        last_error: truncate(msg, 400),
        last_sync_at: new Date().toISOString(),
      })
      .eq("id", row.id);
    return { ok: false, error: msg };
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }
  if (req.method !== "POST") {
    return json({ error: "Method not allowed" }, 405);
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const cronSecret = Deno.env.get("CRON_SECRET")?.trim() ?? "";
  const headerSecret = req.headers.get("x-cron-secret")?.trim() ?? "";
  const isCron = !!cronSecret && headerSecret === cronSecret;

  let body: Record<string, unknown> = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const action = String(body.action ?? (isCron ? "sync_all" : "")).trim();
  const svc = createClient(supabaseUrl, serviceKey);

  if (isCron || action === "sync_all") {
    if (!isCron) {
      return json({ error: "No autorizado" }, 401);
    }
    const secretKey = bindingSecret();
    if (!secretKey) {
      return json(
        {
          error: "gather_not_configured",
          message:
            "Configura GATHER_BINDING_SECRET (≥32) en Edge Secrets (o MOFFIN_FIEL_SECRET).",
        },
        503,
      );
    }

    const { data: rows, error } = await svc
      .from("gather_smart_object_bindings")
      .select("*")
      .eq("enabled", true);
    if (error) return json({ error: error.message }, 500);

    let ok = 0;
    let fail = 0;
    for (const row of (rows ?? []) as BindingRow[]) {
      const r = await syncOneBinding(svc, row, secretKey);
      if (r.ok) ok++;
      else fail++;
    }
    return json({ ok: true, synced: ok, failed: fail, dueWindowDays: dueWindowDays() });
  }

  // --- user JWT path ---
  const rawAuth =
    req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";
  const bearerMatch = rawAuth.match(/^Bearer\s+(\S+)/i);
  const accessToken = bearerMatch?.[1];
  if (!accessToken) return json({ error: "No autorizado" }, 401);

  const userClient = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const { data: userData, error: authError } = await userClient.auth.getUser(accessToken);
  const user = userData?.user;
  if (authError || !user) return json({ error: "No autorizado" }, 401);

  const { data: profile } = await userClient
    .from("profiles")
    .select("organization_id")
    .eq("user_id", user.id)
    .single();
  if (!profile?.organization_id) return json({ error: "Perfil no encontrado" }, 403);

  const orgId = profile.organization_id as string;
  const secretKey = bindingSecret();

  if (action === "list") {
    const { data, error } = await svc
      .from("gather_smart_object_bindings")
      .select(
        "id, purpose, label, webhook_host, enabled, last_ping_at, last_sync_at, last_error, last_snapshot, created_at, updated_at",
      )
      .eq("user_id", user.id)
      .order("created_at", { ascending: true });
    if (error) return json({ error: error.message }, 500);
    return json({
      bindings: data ?? [],
      dueWindowDays: dueWindowDays(),
      configured: !!secretKey,
      mailUnreadStub: true,
    });
  }

  if (!secretKey) {
    return json(
      {
        error: "gather_not_configured",
        message:
          "Gather no está configurado en el servidor (GATHER_BINDING_SECRET ≥32).",
      },
      503,
    );
  }

  if (action === "save") {
    const purpose = String(body.purpose ?? "") as Purpose;
    const webhookUrl = String(body.webhookUrl ?? "").trim();
    const webhookSecret = String(body.webhookSecret ?? "").trim();
    const label = body.label != null ? String(body.label).trim().slice(0, 120) : null;
    const id = body.id != null ? String(body.id) : null;

    if (!PURPOSES.includes(purpose)) {
      return json({ error: "purpose inválido" }, 400);
    }
    if (!webhookUrl || !webhookSecret) {
      return json({ error: "webhookUrl y webhookSecret requeridos" }, 400);
    }
    if (!webhookSecret.startsWith("whsec_")) {
      return json({ error: "El secret debe empezar con whsec_" }, 400);
    }
    try {
      const u = new URL(webhookUrl);
      if (u.protocol !== "https:") return json({ error: "La URL debe ser https" }, 400);
    } catch {
      return json({ error: "URL inválida" }, 400);
    }

    // Ping antes de guardar
    let ping: Awaited<ReturnType<typeof gatherPing>>;
    try {
      ping = await gatherPing(webhookUrl, webhookSecret);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return json({ error: "ping_failed", message: msg }, 400);
    }

    const urlCt = await encryptFielSecret(webhookUrl, secretKey);
    const secCt = await encryptFielSecret(webhookSecret, secretKey);
    const host = hostFromUrl(webhookUrl);

    if (id) {
      const { data: existing } = await svc
        .from("gather_smart_object_bindings")
        .select("id")
        .eq("id", id)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!existing) return json({ error: "No encontrado" }, 404);
      const { error } = await svc
        .from("gather_smart_object_bindings")
        .update({
          purpose,
          label,
          webhook_url_ciphertext: urlCt,
          webhook_secret_ciphertext: secCt,
          webhook_host: host,
          enabled: true,
          last_ping_at: new Date().toISOString(),
          last_error: null,
        })
        .eq("id", id);
      if (error) return json({ error: error.message }, 500);
    } else {
      const { error } = await svc.from("gather_smart_object_bindings").insert({
        user_id: user.id,
        organization_id: orgId,
        purpose,
        label,
        webhook_url_ciphertext: urlCt,
        webhook_secret_ciphertext: secCt,
        webhook_host: host,
        enabled: true,
        last_ping_at: new Date().toISOString(),
      });
      if (error) return json({ error: error.message }, 500);
    }

    return json({
      ok: true,
      ping: {
        preset: ping.preset,
        colors: ping.colors ?? [],
        objectId: ping.objectId,
      },
    });
  }

  if (action === "delete") {
    const id = String(body.id ?? "").trim();
    if (!id) return json({ error: "id requerido" }, 400);
    const { error } = await svc
      .from("gather_smart_object_bindings")
      .delete()
      .eq("id", id)
      .eq("user_id", user.id);
    if (error) return json({ error: error.message }, 500);
    return json({ ok: true });
  }

  if (action === "ping") {
    const id = String(body.id ?? "").trim();
    const webhookUrl = String(body.webhookUrl ?? "").trim();
    const webhookSecret = String(body.webhookSecret ?? "").trim();

    let url = webhookUrl;
    let secret = webhookSecret;
    if (id) {
      const { data: row } = await svc
        .from("gather_smart_object_bindings")
        .select("*")
        .eq("id", id)
        .eq("user_id", user.id)
        .maybeSingle();
      if (!row) return json({ error: "No encontrado" }, 404);
      const creds = await decryptCreds(row as BindingRow, secretKey);
      url = creds.url;
      secret = creds.secret;
    }
    if (!url || !secret) return json({ error: "URL y secret requeridos" }, 400);

    try {
      const ping = await gatherPing(url, secret);
      if (id) {
        await svc
          .from("gather_smart_object_bindings")
          .update({ last_ping_at: new Date().toISOString(), last_error: null })
          .eq("id", id);
      }
      return json({
        ok: true,
        ping: {
          preset: ping.preset,
          colors: ping.colors ?? [],
          objectId: ping.objectId,
          spaceId: ping.spaceId,
        },
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return json({ error: "ping_failed", message: msg }, 400);
    }
  }

  if (action === "sync_me") {
    const { data: rows, error } = await svc
      .from("gather_smart_object_bindings")
      .select("*")
      .eq("user_id", user.id)
      .eq("enabled", true);
    if (error) return json({ error: error.message }, 500);

    const results = [];
    for (const row of (rows ?? []) as BindingRow[]) {
      results.push({
        id: row.id,
        purpose: row.purpose,
        ...(await syncOneBinding(svc, row, secretKey)),
      });
    }
    return json({ ok: true, results, dueWindowDays: dueWindowDays() });
  }

  return json({ error: "action inválida" }, 400);
});
