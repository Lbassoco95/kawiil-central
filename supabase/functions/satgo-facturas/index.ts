/**
 * Descarga automática de facturas SAT (CFDI) vía SATgo facfiel.
 *
 * Gate: solo clientes con e.firma JWE lista en client_sat_certificates
 * (satgo_key_jwe + satgo_password_jwe + cert_ciphertext). Sin FIEL → skip.
 *
 * Auth: x-cron-secret = CRON_SECRET (pg_cron) o JWT de staff (disparo manual).
 *
 * Horario CDMX: el cron invoca en ventanas UTC que cubren CST/CDT; esta Edge
 * valida America/Mexico_City ∈ {08,15,21} salvo body.force=true.
 *
 * Espejo OS: si KAWIIL_OS_SYSTEM_API_URL + CENTRAL_TO_OS_SIGNING_SECRET y el
 * cliente tiene portal_company_ref, publica invoice.publish (metadatos).
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { decryptFielSecret } from "../_shared/moffinFielCrypto.ts";
import { base64FileToBytes } from "../_shared/satgoFielJwe.ts";
import {
  extractSatgoFacComprobantes,
  fetchSatgoFacFielWithJwe,
  type SatgoFacComprobante,
  type SatgoFacTipo,
} from "../_shared/satgoFielClient.ts";
import { resolveSatgoBearer, satgoBaseUrl } from "../_shared/satgoAuth.ts";
import { publishInvoiceMetadataToOs } from "../_shared/portal/publishInvoiceToOs.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const MAX_CLIENTS = 40;
const LOOKBACK_DAYS_DEFAULT = 3;
const DOWNLOAD_HOURS_CDMX = new Set([8, 15, 21]);

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function mexicoCityHour(now = new Date()): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Mexico_City",
    hour: "numeric",
    hour12: false,
  }).formatToParts(now);
  const h = Number(parts.find((p) => p.type === "hour")?.value ?? "NaN");
  // en-US hour12:false puede devolver 24 en algunos motores → normalizar a 0
  if (h === 24) return 0;
  return h;
}

function isDownloadHourCdmx(now = new Date()): boolean {
  return DOWNLOAD_HOURS_CDMX.has(mexicoCityHour(now));
}

function formatSatgoDateTime(d: Date, endOfDay: boolean): string {
  // SATgo espera yyyy-MM-dd HH:mm:ss en hora local del SAT (CDMX).
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Mexico_City",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(d);
  const y = parts.find((p) => p.type === "year")?.value ?? "1970";
  const m = parts.find((p) => p.type === "month")?.value ?? "01";
  const day = parts.find((p) => p.type === "day")?.value ?? "01";
  return endOfDay ? `${y}-${m}-${day} 23:59:59` : `${y}-${m}-${day} 00:00:00`;
}

function lookbackRange(days: number): { fechaInicial: string; fechaFinal: string } {
  const end = new Date();
  const start = new Date(end.getTime() - Math.max(1, days) * 86_400_000);
  return {
    fechaInicial: formatSatgoDateTime(start, false),
    fechaFinal: formatSatgoDateTime(end, true),
  };
}

function pickUuid(c: SatgoFacComprobante): string {
  const raw = String(c.uuid ?? c.UUID ?? c.folioFiscal ?? "").trim().toUpperCase();
  return raw;
}

function mapDirection(tipo: SatgoFacTipo): "emitida" | "recibida" {
  return tipo === "emitidos" ? "emitida" : "recibida";
}

async function resolveBearerWithVault(
  admin: ReturnType<typeof createClient>,
): Promise<string | null> {
  const direct = await resolveSatgoBearer();
  if (direct.ok) return direct.bearer;
  try {
    const { data } = await admin.rpc("kawiil_vault_secret", {
      secret_name: "satgo_api_key",
    });
    if (typeof data === "string" && data.trim()) {
      const base = satgoBaseUrl();
      const res = await fetch(`${base}/api/Auth/token-json`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ key: data.trim() }),
      });
      const text = await res.text();
      let parsed: Record<string, unknown> = {};
      try {
        parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        /* ignore */
      }
      if (!res.ok) return null;
      if (typeof parsed.token === "string" && parsed.token.trim()) return parsed.token.trim();
      const nested = parsed.tokens;
      if (nested && typeof nested === "object") {
        const access = (nested as Record<string, unknown>).access;
        if (access && typeof access === "object") {
          const v = (access as Record<string, unknown>).value;
          if (typeof v === "string" && v.trim()) return v.trim();
        }
      }
    }
  } catch {
    /* ignore */
  }
  return null;
}

type JobRow = {
  organization_id: string;
  client_id: string;
  rfc: string;
  cert_ciphertext: string;
  satgo_key_jwe: string;
  satgo_password_jwe: string;
  portal_company_ref: string | null;
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const cronSecret = Deno.env.get("CRON_SECRET")?.trim() ?? "";
  const incomingCron = req.headers.get("x-cron-secret")?.trim() ?? "";
  const cronOk = !!(cronSecret && incomingCron && cronSecret === incomingCron);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  let body: {
    force?: boolean;
    clientId?: string;
    lookbackDays?: number;
    startdate?: string;
    enddate?: string;
  } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const force = body.force === true;

  if (!cronOk) {
    const rawAuth = req.headers.get("Authorization") ?? "";
    const token = rawAuth.match(/^Bearer\s+(\S+)/i)?.[1];
    if (!token) return json({ error: "No autorizado" }, 401);
    const userClient = createClient(supabaseUrl, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: authError } = await userClient.auth.getUser(token);
    if (authError || !userData?.user) return json({ error: "No autorizado" }, 401);
    // Disparo manual de staff implica force (no esperar horario cron).
    body.force = true;
  }

  if (!force && !isDownloadHourCdmx()) {
    return json({
      skipped: true,
      reason: "outside_cdmx_window",
      timezone: "America/Mexico_City",
      localHour: mexicoCityHour(),
      allowedHours: [...DOWNLOAD_HOURS_CDMX],
      hint: "Usa {\"force\":true} para ensayo fuera de 08/15/21 CDMX.",
    });
  }

  const fielSecret = Deno.env.get("MOFFIN_FIEL_SECRET")?.trim() ?? "";
  if (fielSecret.length < 32) {
    return json(
      {
        error: "fiel_not_configured",
        message: "Configura MOFFIN_FIEL_SECRET (≥32) para descifrar .cer en central.",
      },
      503,
    );
  }

  const bearer = await resolveBearerWithVault(admin);
  if (!bearer) return json({ error: "satgo_not_configured" }, 503);

  const lookbackDays = Number.isFinite(body.lookbackDays)
    ? Math.min(Math.max(Number(body.lookbackDays), 1), 31)
    : Number(Deno.env.get("SATGO_CFDI_LOOKBACK_DAYS") ?? LOOKBACK_DAYS_DEFAULT) ||
      LOOKBACK_DAYS_DEFAULT;

  let fechaInicial: string;
  let fechaFinal: string;
  if (
    typeof body.startdate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(body.startdate) &&
    typeof body.enddate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(body.enddate)
  ) {
    fechaInicial = `${body.startdate} 00:00:00`;
    fechaFinal = `${body.enddate} 23:59:59`;
  } else {
    ({ fechaInicial, fechaFinal } = lookbackRange(lookbackDays));
  }

  const clientIdFilter =
    typeof body.clientId === "string" && body.clientId.trim()
      ? body.clientId.trim()
      : null;

  async function listFielJobs(): Promise<{
    jobs: JobRow[];
    hasPortalRefCol: boolean;
    error?: string;
  }> {
    const withRef = admin
      .from("client_sat_certificates")
      .select(
        "organization_id, client_id, cert_ciphertext, satgo_key_jwe, satgo_password_jwe, clients(rfc, portal_company_ref)",
      )
      .eq("cert_type", "fiel")
      .not("satgo_key_jwe", "is", null)
      .not("satgo_password_jwe", "is", null);
    const { data: fielRows, error: fielErr } = clientIdFilter
      ? await withRef.eq("client_id", clientIdFilter)
      : await withRef;

    let rows = fielRows;
    let hasPortalRefCol = true;
    if (fielErr) {
      const base = admin
        .from("client_sat_certificates")
        .select(
          "organization_id, client_id, cert_ciphertext, satgo_key_jwe, satgo_password_jwe, clients(rfc)",
        )
        .eq("cert_type", "fiel")
        .not("satgo_key_jwe", "is", null)
        .not("satgo_password_jwe", "is", null);
      const fallback = clientIdFilter
        ? await base.eq("client_id", clientIdFilter)
        : await base;
      if (fallback.error) {
        return { jobs: [], hasPortalRefCol: false, error: fallback.error.message };
      }
      rows = fallback.data;
      hasPortalRefCol = false;
    }

    const out: JobRow[] = [];
    const seen = new Set<string>();
    for (const row of (rows ?? []) as Array<{
      organization_id: string;
      client_id: string;
      cert_ciphertext: string;
      satgo_key_jwe: string;
      satgo_password_jwe: string;
      clients:
        | { rfc: string | null; portal_company_ref?: string | null }
        | null;
    }>) {
      const rfc = row.clients?.rfc?.trim().toUpperCase().replace(/\s/g, "") ?? "";
      if (!rfc || seen.has(row.client_id)) continue;
      if (!row.satgo_key_jwe?.trim() || !row.satgo_password_jwe?.trim()) continue;
      if (!row.cert_ciphertext) continue;
      seen.add(row.client_id);
      out.push({
        organization_id: row.organization_id,
        client_id: row.client_id,
        rfc,
        cert_ciphertext: row.cert_ciphertext,
        satgo_key_jwe: row.satgo_key_jwe,
        satgo_password_jwe: row.satgo_password_jwe,
        portal_company_ref: hasPortalRefCol
          ? row.clients?.portal_company_ref?.trim() || null
          : null,
      });
    }
    return { jobs: out, hasPortalRefCol };
  }

  const listed = await listFielJobs();
  if (listed.error) {
    return json({ error: "list_failed", message: listed.error }, 500);
  }
  const jobs = listed.jobs;
  const hasPortalRefCol = listed.hasPortalRefCol;

  const tipos: SatgoFacTipo[] = ["emitidos", "recibidos"];
  const results: Array<Record<string, unknown>> = [];
  let processed = 0;
  let published = 0;
  let upserted = 0;

  for (const job of jobs) {
    if (processed >= MAX_CLIENTS) break;

    let certBytes: Uint8Array;
    try {
      const certB64 = await decryptFielSecret(job.cert_ciphertext, fielSecret);
      certBytes = base64FileToBytes(certB64);
    } catch (e) {
      results.push({
        clientId: job.client_id,
        status: "error",
        message: "cert_decrypt_failed",
        detail: e instanceof Error ? e.message : String(e),
      });
      processed += 1;
      continue;
    }

    const { data: runRow, error: runErr } = await admin
      .from("satgo_cfdi_runs")
      .insert({
        organization_id: job.organization_id,
        client_id: job.client_id,
        rfc: job.rfc,
        period_start: fechaInicial.slice(0, 10),
        period_end: fechaFinal.slice(0, 10),
        status: "running",
        trigger: cronOk && !force ? "cron" : "manual",
        local_hour_cdmx: mexicoCityHour(),
      })
      .select("id")
      .single();

    if (runErr || !runRow?.id) {
      results.push({
        clientId: job.client_id,
        status: "error",
        message: "run_insert_failed",
        detail: runErr?.message,
      });
      processed += 1;
      continue;
    }

    const runId = runRow.id as string;
    let requestId: string | null = null;
    let clientEmitidas = 0;
    let clientRecibidas = 0;
    let clientErrors = 0;

    for (const tipo of tipos) {
      const res = await fetchSatgoFacFielWithJwe({
        bearer,
        rfc: job.rfc,
        tipo,
        certBytes,
        keyJwe: job.satgo_key_jwe,
        passwordJwe: job.satgo_password_jwe,
        fechaInicial,
        fechaFinal,
        estatusFactura: -1,
        solicitaMetadata: false,
        descargaComprobantes: false,
        descargaPdfs: false,
        requestId,
      });

      if (!res.ok) {
        clientErrors += 1;
        results.push({
          clientId: job.client_id,
          tipo,
          status: "error",
          message: res.message.slice(0, 300),
          httpStatus: res.httpStatus,
        });
        continue;
      }

      if (res.requestId) requestId = res.requestId;
      const comps = extractSatgoFacComprobantes(res.json);
      const direction = mapDirection(tipo);

      for (const c of comps) {
        const uuid = pickUuid(c);
        if (!uuid) continue;
        const issuedAt =
          typeof c.fechaEmision === "string"
            ? c.fechaEmision
            : typeof c.fecha === "string"
              ? c.fecha
              : null;
        const total = Number(c.total ?? c.Total ?? 0);
        const subtotal = Number(c.subtotal ?? c.SubTotal ?? 0);
        const satStatus = String(
          c.estadoDeComprobante ?? c.estatus ?? c.estado ?? "unknown",
        ).slice(0, 40);

        const { error: upErr } = await admin.from("satgo_cfdi_items").upsert(
          {
            organization_id: job.organization_id,
            client_id: job.client_id,
            rfc: job.rfc,
            uuid,
            direction,
            issued_at: issuedAt,
            issuer_rfc: String(c.rfcEmisor ?? "").toUpperCase() || null,
            issuer_name: typeof c.razonSocialEmisor === "string"
              ? c.razonSocialEmisor
              : null,
            receiver_rfc: String(c.rfcReceptor ?? "").toUpperCase() || null,
            receiver_name: typeof c.razonSocialReceptor === "string"
              ? c.razonSocialReceptor
              : null,
            total: Number.isFinite(total) ? total : 0,
            subtotal: Number.isFinite(subtotal) ? subtotal : 0,
            sat_status: satStatus,
            payment_method: typeof c.metodoPago === "string" ? c.metodoPago : null,
            payment_form: typeof c.formaPago === "string" ? c.formaPago : null,
            currency: typeof c.moneda === "string" ? c.moneda : "MXN",
            voucher_type: typeof c.tipoDeComprobante === "string"
              ? c.tipoDeComprobante
              : null,
            last_run_id: runId,
            raw_meta: {
              // sin XML/PDF ni secretos — solo campos planos seguros
              uuid,
              fechaEmision: issuedAt,
              total,
              estado: satStatus,
            },
            updated_at: new Date().toISOString(),
          },
          { onConflict: "client_id,uuid,direction" },
        );
        if (!upErr) {
          upserted += 1;
          if (direction === "emitida") clientEmitidas += 1;
          else clientRecibidas += 1;
        }

        if (job.portal_company_ref) {
          const pub = await publishInvoiceMetadataToOs({
            companyRef: job.portal_company_ref,
            uuid,
            direction,
            issuedAt,
            issuerRfc: String(c.rfcEmisor ?? "").toUpperCase() || null,
            issuerName: typeof c.razonSocialEmisor === "string"
              ? c.razonSocialEmisor
              : null,
            receiverRfc: String(c.rfcReceptor ?? "").toUpperCase() || null,
            receiverName: typeof c.razonSocialReceptor === "string"
              ? c.razonSocialReceptor
              : null,
            total,
            subtotal,
            satStatus,
            paymentMethod: typeof c.metodoPago === "string" ? c.metodoPago : null,
            paymentForm: typeof c.formaPago === "string" ? c.formaPago : null,
            currency: typeof c.moneda === "string" ? c.moneda : "MXN",
            voucherType: typeof c.tipoDeComprobante === "string"
              ? c.tipoDeComprobante
              : null,
          });
          if (pub.ok && !("skipped" in pub && pub.skipped)) published += 1;
        }
      }

      results.push({
        clientId: job.client_id,
        tipo,
        status: "success",
        count: comps.length,
        folioDescarga: res.json.folioDescarga ?? null,
      });
    }

    await admin
      .from("satgo_cfdi_runs")
      .update({
        status: clientErrors > 0 && clientEmitidas + clientRecibidas === 0
          ? "error"
          : "success",
        emitidas_count: clientEmitidas,
        recibidas_count: clientRecibidas,
        error_message: clientErrors > 0
          ? `${clientErrors} dirección(es) con error SATgo`
          : null,
        finished_at: new Date().toISOString(),
      })
      .eq("id", runId);

    // Historial visible en panel SAT (moffin_consults)
    const { data: proj } = await admin
      .from("projects")
      .select("id")
      .eq("client_id", job.client_id)
      .limit(1)
      .maybeSingle();
    if (proj?.id) {
      const { error: histErr } = await admin.from("moffin_consults").insert({
        organization_id: job.organization_id,
        project_id: proj.id,
        client_id: job.client_id,
        rfc: job.rfc,
        consult_type: "satgo_cfdi_download",
        moffin_service: "satgo-facfiel",
        status: clientErrors > 0 && clientEmitidas + clientRecibidas === 0
          ? "error"
          : "success",
        summary:
          `CFDI auto SATgo · emitidas ${clientEmitidas} · recibidas ${clientRecibidas} · ${fechaInicial.slice(0, 10)}→${fechaFinal.slice(0, 10)}`,
        raw_response: {
          provider: "satgo",
          endpoint: "facfiel",
          period: { fechaInicial, fechaFinal },
          emitidas: clientEmitidas,
          recibidas: clientRecibidas,
          runId,
          _auto: true,
        },
        requested_by: null,
      });
      if (histErr) {
        console.error("moffin_consults satgo_cfdi_download:", histErr.message);
      }
    }

    processed += 1;
  }

  return json({
    source: cronOk ? "cron" : "manual",
    provider: "satgo",
    timezone: "America/Mexico_City",
    localHour: mexicoCityHour(),
    period: { fechaInicial, fechaFinal },
    gate: "fiel_jwe_required",
    jobsEligible: jobs.length,
    clientsProcessed: processed,
    itemsUpserted: upserted,
    mirrorPublished: published,
    mirrorNote: hasPortalRefCol
      ? "invoice.publish si portal_company_ref + secretos OS"
      : "columna portal_company_ref ausente — solo persistencia en central",
    results,
  });
});
