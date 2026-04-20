// Cron diario: revisa client_sat_certificates y crea notifications + push cuando un certificado
// (FIEL o CSD) entra a una nueva ventana de aviso (T-60, T-30, semanal hasta T-16, diario T-15..T-1, expired).
// Destinatarios: clients.responsible_user_id + miembros de celulas slug in ('finanzas','administracion').

import { createClient } from "npm:@supabase/supabase-js@2";
import { sendWebPushToUsers } from "../_shared/webPush.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

type CertRow = {
  id: string;
  organization_id: string;
  client_id: string;
  cert_type: "fiel" | "csd_sello";
  label: string | null;
  cert_serial: string | null;
  cert_subject_rfc: string | null;
  cert_not_after: string | null;
  last_reminder_bucket: string | null;
  last_reminder_at: string | null;
};

function daysLeft(notAfter: string): number {
  return Math.ceil(
    (Date.parse(notAfter) - Date.now()) / (1000 * 60 * 60 * 24),
  );
}

/** Devuelve el bucket actual o null si no aplica notificar todavia. */
function bucketFor(days: number): string | null {
  if (days <= 0) return "expired";
  if (days <= 15) return `d${days}`;
  if (days <= 22) return "t22";
  if (days <= 29) return "t29";
  if (days <= 30) return "t30";
  if (days <= 45) return "t45";
  if (days <= 60) return "t60";
  return null;
}

function shouldRenotifyExpired(lastAtIso: string | null): boolean {
  if (!lastAtIso) return true;
  const last = Date.parse(lastAtIso);
  if (Number.isNaN(last)) return true;
  return Date.now() - last >= 7 * 24 * 60 * 60 * 1000;
}

function appOrigin(): string {
  return (
    (Deno.env.get("SITE_URL") || Deno.env.get("PUBLIC_APP_URL") || "")
      .replace(/\/$/, "") || "https://app.kawiil.com"
  );
}

function certTypeLabel(t: CertRow["cert_type"]): string {
  return t === "fiel" ? "e.firma (FIEL)" : "Sello digital (CSD)";
}

function buildTitle(row: CertRow, days: number): string {
  const head = certTypeLabel(row.cert_type);
  if (days <= 0) {
    return `${head} VENCIDA`;
  }
  if (days === 1) return `${head} vence MAÑANA`;
  if (days <= 15) return `${head} vence en ${days} dias`;
  return `${head} vence en ${days} dias`;
}

function buildBody(row: CertRow, days: number, clientName: string): string {
  const seg: string[] = [];
  seg.push(`Cliente: ${clientName}`);
  if (row.label) seg.push(`Sucursal/alias: ${row.label}`);
  if (row.cert_subject_rfc) seg.push(`RFC cert: ${row.cert_subject_rfc}`);
  if (row.cert_serial) seg.push(`Serie: ${row.cert_serial.slice(-12)}`);
  if (days <= 0) {
    seg.push("Renueva en el portal del SAT lo antes posible.");
  } else if (days <= 15) {
    seg.push(`Quedan ${days} dia(s). Agenda la renovacion ya.`);
  } else {
    seg.push(`Vence en ${days} dias. Planea la renovacion.`);
  }
  return seg.join(" • ");
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

    // Ventana ampliada (60 dias hacia adelante; vencidos hasta 90 dias atras para seguir avisando).
    const horizon = new Date(
      Date.now() + 65 * 24 * 60 * 60 * 1000,
    ).toISOString();

    const { data: certs, error: certsErr } = await svc
      .from("client_sat_certificates")
      .select(
        "id, organization_id, client_id, cert_type, label, cert_serial, cert_subject_rfc, cert_not_after, last_reminder_bucket, last_reminder_at",
      )
      .not("cert_not_after", "is", null)
      .lte("cert_not_after", horizon);

    if (certsErr) {
      console.error("cert-expiry-notifier select certs:", certsErr.message);
      throw certsErr;
    }

    const rows = (certs ?? []) as CertRow[];
    if (rows.length === 0) {
      return new Response(
        JSON.stringify({ ok: true, evaluated: 0, notified: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    // Cargar info de clientes (nombre + responsable).
    const clientIds = Array.from(new Set(rows.map((r) => r.client_id)));
    const { data: clients } = await svc
      .from("clients")
      .select("id, name, responsible_user_id, organization_id")
      .in("id", clientIds);
    const clientMap = new Map(
      (clients ?? []).map((c) => [c.id as string, c]),
    );

    // Resolver miembros de celulas finanzas/administracion por organizacion.
    const orgIds = Array.from(new Set(rows.map((r) => r.organization_id)));
    const { data: celulaMembers } = await svc
      .from("user_celulas")
      .select("user_id, organization_id, celulas!inner(slug)")
      .in("organization_id", orgIds)
      .filter("celulas.slug", "in", '("finanzas","administracion")');

    const celulaByOrg = new Map<string, Set<string>>();
    for (const m of celulaMembers ?? []) {
      const orgId = m.organization_id as string;
      const userId = m.user_id as string;
      if (!celulaByOrg.has(orgId)) celulaByOrg.set(orgId, new Set());
      celulaByOrg.get(orgId)!.add(userId);
    }

    const origin = appOrigin();
    let notifiedCount = 0;

    for (const row of rows) {
      if (!row.cert_not_after) continue;
      const days = daysLeft(row.cert_not_after);
      const bucket = bucketFor(days);
      if (!bucket) continue;

      // Para "expired" reescribimos cada 7 dias; para los demas, solo cuando cambia bucket.
      const sameBucket = row.last_reminder_bucket === bucket;
      if (sameBucket) {
        if (bucket !== "expired") continue;
        if (!shouldRenotifyExpired(row.last_reminder_at)) continue;
      }

      const client = clientMap.get(row.client_id);
      if (!client) continue;

      const recipients = new Set<string>();
      if (client.responsible_user_id) {
        recipients.add(client.responsible_user_id as string);
      }
      const cellMembers = celulaByOrg.get(row.organization_id);
      if (cellMembers) {
        for (const uid of cellMembers) recipients.add(uid);
      }
      if (recipients.size === 0) {
        // Sin destinatarios; aun asi marcamos bucket para no quedar revaluando infinito.
        await svc
          .from("client_sat_certificates")
          .update({
            last_reminder_bucket: bucket,
            last_reminder_at: new Date().toISOString(),
          })
          .eq("id", row.id);
        continue;
      }

      const clientName = (client.name as string) ?? "Cliente";
      const title = buildTitle(row, days);
      const body = buildBody(row, days, clientName);
      const url = `${origin}/clientes/${row.client_id}?tab=general#sat-certificates`;

      // Insert in-app notifications (una por usuario).
      const notifRows = Array.from(recipients).map((uid) => ({
        user_id: uid,
        type: "cert_expiry_warning",
        title,
        body,
        entity_type: "client_sat_certificate",
        entity_id: row.id,
        organization_id: row.organization_id,
      }));
      const { error: insErr } = await svc
        .from("notifications")
        .insert(notifRows);
      if (insErr) {
        console.error(
          "cert-expiry-notifier insert notifications:",
          insErr.message,
        );
        continue;
      }

      // Push (best-effort).
      try {
        await sendWebPushToUsers({
          userIds: Array.from(recipients),
          title,
          body,
          url,
          tag: `cert-expiry:${row.id}`,
          requireInteraction: days <= 7,
        });
      } catch (pushErr) {
        console.warn("cert-expiry-notifier push:", pushErr);
      }

      await svc
        .from("client_sat_certificates")
        .update({
          last_reminder_bucket: bucket,
          last_reminder_at: new Date().toISOString(),
        })
        .eq("id", row.id);

      notifiedCount += notifRows.length;
    }

    return new Response(
      JSON.stringify({
        ok: true,
        evaluated: rows.length,
        notified: notifiedCount,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error("cert-expiry-notifier failed:", msg);
    return new Response(JSON.stringify({ error: msg }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
