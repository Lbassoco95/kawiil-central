/**
 * Descarga automática de facturas SAT (CFDI) vía SATgo facfiel + enriquecimiento XML.
 *
 * Gate: solo clientes con e.firma JWE lista en client_sat_certificates.
 * Auth: x-cron-secret = CRON_SECRET (pg_cron) o JWT de staff (disparo manual).
 * Horario CDMX: America/Mexico_City ∈ {08,15,21} salvo body.force=true.
 *
 * Enriquecimiento:
 * - Listado con descargaComprobantes=true → parse XML → montos/PUE|PPD/partidas/pagos/NC
 * - body.enrich=true → re-descarga por UUID los items aún metadata/$0
 * - Publica invoice.publish con detail_status=complete cuando hay monto+método/partidas
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { decryptFielSecret } from "../_shared/moffinFielCrypto.ts";
import { base64FileToBytes } from "../_shared/satgoFielJwe.ts";
import {
  extractSatgoFacComprobantes,
  fetchSatgoFacFielWithJwe,
  type SatgoFacTipo,
} from "../_shared/satgoFielClient.ts";
import { resolveSatgoBearer, satgoBaseUrl } from "../_shared/satgoAuth.ts";
import {
  enrichSatgoComprobante,
  toPublishedInvoice,
  type EnrichedCfdi,
} from "../_shared/satgoCfdiEnrich.ts";
import {
  loadMirrorCfg,
  publishInvoiceToOs,
  type MirrorCfg,
} from "../_shared/portal/publishInvoiceToOs.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

const MAX_CLIENTS = 40;
const LOOKBACK_DAYS_DEFAULT = 3;
const DOWNLOAD_HOURS_CDMX = new Set([8, 15, 21]);
const ENRICH_BATCH_DEFAULT = 40;

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
  if (h === 24) return 0;
  return h;
}

function isDownloadHourCdmx(now = new Date()): boolean {
  return DOWNLOAD_HOURS_CDMX.has(mexicoCityHour(now));
}

function formatSatgoDateTime(d: Date, endOfDay: boolean): string {
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

type Admin = ReturnType<typeof createClient>;

async function persistEnriched(
  admin: Admin,
  job: JobRow,
  runId: string | null,
  direction: "emitida" | "recibida",
  enriched: EnrichedCfdi,
): Promise<{ itemId: string | null; error?: string }> {
  const { data: upserted, error: upErr } = await admin
    .from("satgo_cfdi_items")
    .upsert(
      {
        organization_id: job.organization_id,
        client_id: job.client_id,
        rfc: job.rfc,
        uuid: enriched.uuid,
        direction,
        issued_at: enriched.issuedAt,
        issuer_rfc: enriched.issuerRfc,
        issuer_name: enriched.issuerName,
        receiver_rfc: enriched.receiverRfc,
        receiver_name: enriched.receiverName,
        total: enriched.total,
        subtotal: enriched.subtotal,
        discount: enriched.discount,
        vat_transferred: enriched.vatTransferred,
        vat_withheld: enriched.vatWithheld,
        income_tax_withheld: enriched.incomeTaxWithheld,
        sat_status: enriched.satStatus,
        payment_method: enriched.paymentMethod,
        payment_form: enriched.paymentForm,
        currency: enriched.currency,
        exchange_rate: enriched.exchangeRate,
        voucher_type: enriched.voucherType,
        cfdi_version: enriched.version,
        detail_status: enriched.detailStatus,
        related_uuid: enriched.relatedUuid,
        source_xml: enriched.sourceXml,
        last_run_id: runId,
        raw_meta: {
          uuid: enriched.uuid,
          fechaEmision: enriched.issuedAt,
          total: enriched.total,
          payment_method: enriched.paymentMethod,
          voucher_type: enriched.voucherType,
          detail_status: enriched.detailStatus,
          source_xml: enriched.sourceXml,
          concepts: enriched.concepts.length,
          payments: enriched.payments.length,
          estado: enriched.satStatus,
        },
        updated_at: new Date().toISOString(),
      },
      { onConflict: "client_id,uuid,direction" },
    )
    .select("id")
    .single();

  if (upErr || !upserted?.id) {
    return { itemId: null, error: upErr?.message ?? "upsert_failed" };
  }
  const itemId = upserted.id as string;

  await admin.from("satgo_cfdi_concepts").delete().eq("item_id", itemId);
  if (enriched.concepts.length) {
    const { error: cErr } = await admin.from("satgo_cfdi_concepts").insert(
      enriched.concepts.map((c, i) => ({
        item_id: itemId,
        organization_id: job.organization_id,
        client_id: job.client_id,
        line_no: i + 1,
        product_service_key: c.product_service_key ?? null,
        description: c.description,
        quantity: c.quantity,
        unit_value: c.unit_value,
        amount: c.amount,
        discount: c.discount ?? 0,
      })),
    );
    if (cErr) console.error("satgo_cfdi_concepts", cErr.message);
  }

  await admin.from("satgo_cfdi_payment_links").delete().eq("payment_item_id", itemId);
  if (enriched.payments.length) {
    const { error: pErr } = await admin.from("satgo_cfdi_payment_links").insert(
      enriched.payments.map((p) => ({
        organization_id: job.organization_id,
        client_id: job.client_id,
        payment_item_id: itemId,
        related_uuid: p.related_uuid,
        paid_at: p.paid_at,
        paid_amount: p.paid_amount,
      })),
    );
    if (pErr) console.error("satgo_cfdi_payment_links", pErr.message);
  }

  return { itemId };
}

async function publishEnriched(
  mirrorCfg: MirrorCfg | null,
  companyRef: string | null,
  direction: "emitida" | "recibida",
  enriched: EnrichedCfdi,
): Promise<boolean> {
  if (!mirrorCfg || !companyRef) return false;
  const pub = await publishInvoiceToOs(
    {
      companyRef,
      invoice: toPublishedInvoice(enriched, direction),
    },
    mirrorCfg,
  );
  if (!pub.ok) {
    console.error("mirror_publish_fail", pub.status, pub.message);
    return false;
  }
  return !("skipped" in pub && pub.skipped);
}

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
  const mirrorCfg = await loadMirrorCfg(admin);
  if (!mirrorCfg) {
    console.error("mirror_not_configured: vault/env missing CENTRAL_TO_OS or OS URL");
  }

  let body: {
    force?: boolean;
    enrich?: boolean;
    clientId?: string;
    lookbackDays?: number;
    enrichLimit?: number;
    startdate?: string;
    enddate?: string;
    descargaComprobantes?: boolean;
  } = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }
  const force = body.force === true;
  const enrichMode = body.enrich === true;
  // Por defecto descargar XML en listado; opt-out con descargaComprobantes:false
  const downloadXml = body.descargaComprobantes !== false;

  if (!cronOk) {
    const rawAuth = req.headers.get("Authorization") ?? "";
    const token = rawAuth.match(/^Bearer\s+(\S+)/i)?.[1];
    if (!token) return json({ error: "No autorizado" }, 401);
    const userClient = createClient(supabaseUrl, anon, {
      global: { headers: { Authorization: `Bearer ${token}` } },
    });
    const { data: userData, error: authError } = await userClient.auth.getUser(token);
    if (authError || !userData?.user) return json({ error: "No autorizado" }, 401);
    body.force = true;
  }

  if (!force && !isDownloadHourCdmx()) {
    return json({
      skipped: true,
      reason: "outside_cdmx_window",
      timezone: "America/Mexico_City",
      localHour: mexicoCityHour(),
      allowedHours: [...DOWNLOAD_HOURS_CDMX],
      hint: 'Usa {"force":true} para ensayo fuera de 08/15/21 CDMX.',
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

  const results: Array<Record<string, unknown>> = [];
  let processed = 0;
  let published = 0;
  let upserted = 0;
  let enrichedXml = 0;

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

    // ── Modo enrich: UUID por UUID de items incompletos ──
    if (enrichMode) {
      const limit = Number.isFinite(body.enrichLimit)
        ? Math.min(Math.max(Number(body.enrichLimit), 1), 200)
        : ENRICH_BATCH_DEFAULT;
      const { data: pending, error: pendErr } = await admin
        .from("satgo_cfdi_items")
        .select("uuid, direction, sat_status")
        .eq("client_id", job.client_id)
        // Solo metadata: tipo P complete tiene total=0 / sin MetodoPago y no debe re-encolarse.
        .eq("detail_status", "metadata")
        .order("issued_at", { ascending: false, nullsFirst: false })
        .limit(limit);
      if (pendErr) {
        results.push({
          clientId: job.client_id,
          status: "error",
          message: "enrich_list_failed",
          detail: pendErr.message,
        });
        clientErrors += 1;
      } else {
        let enrichOk = 0;
        let enrichFail = 0;
        for (const row of pending ?? []) {
          const uuid = String(row.uuid ?? "").toUpperCase();
          const direction = row.direction === "emitida" ? "emitida" : "recibida";
          const tipo: SatgoFacTipo =
            direction === "emitida" ? "emitidos" : "recibidos";
          const res = await fetchSatgoFacFielWithJwe({
            bearer,
            rfc: job.rfc,
            tipo,
            certBytes,
            keyJwe: job.satgo_key_jwe,
            passwordJwe: job.satgo_password_jwe,
            tipoBusqueda: 0,
            uuid,
            estatusFactura: -1,
            solicitaMetadata: false,
            descargaComprobantes: true,
            descargaPdfs: false,
            requestId,
          });
          if (!res.ok) {
            enrichFail += 1;
            continue;
          }
          if (res.requestId) requestId = res.requestId;
          const comps = extractSatgoFacComprobantes(res.json);
          const c = comps[0] ?? { uuid };
          const enriched = enrichSatgoComprobante(c, uuid);
          if (!enriched.sourceXml && enriched.total <= 0.009) {
            // SATgo no devolvió XML: dejar metadata pero actualizar lo que haya
          }
          const persisted = await persistEnriched(
            admin,
            job,
            runId,
            direction,
            enriched,
          );
          if (persisted.itemId) {
            upserted += 1;
            enrichOk += 1;
            if (enriched.sourceXml) enrichedXml += 1;
            if (direction === "emitida") clientEmitidas += 1;
            else clientRecibidas += 1;
            if (
              await publishEnriched(
                mirrorCfg,
                job.portal_company_ref,
                direction,
                enriched,
              )
            ) {
              published += 1;
            }
          } else {
            enrichFail += 1;
          }
        }
        // Segunda pasada: facturas referenciadas por complementos P que aún no están en central.
        const { data: missingRels } = await admin
          .from("satgo_cfdi_payment_links")
          .select("related_uuid")
          .eq("client_id", job.client_id)
          .limit(80);
        const relatedUuids = [
          ...new Set(
            (missingRels ?? [])
              .map((r) => String(r.related_uuid ?? "").toUpperCase())
              .filter(Boolean),
          ),
        ];
        let relatedFetched = 0;
        for (const relatedUuid of relatedUuids.slice(0, 25)) {
          const { data: exists } = await admin
            .from("satgo_cfdi_items")
            .select("id")
            .eq("client_id", job.client_id)
            .eq("uuid", relatedUuid)
            .maybeSingle();
          if (exists?.id) continue;
          // Probar emitidos y recibidos (dirección desconocida fuera del lote).
          let fetched = false;
          for (const tipo of ["emitidos", "recibidos"] as SatgoFacTipo[]) {
            const res = await fetchSatgoFacFielWithJwe({
              bearer,
              rfc: job.rfc,
              tipo,
              certBytes,
              keyJwe: job.satgo_key_jwe,
              passwordJwe: job.satgo_password_jwe,
              tipoBusqueda: 0,
              uuid: relatedUuid,
              estatusFactura: -1,
              solicitaMetadata: false,
              descargaComprobantes: true,
              descargaPdfs: false,
              requestId,
            });
            if (!res.ok) continue;
            if (res.requestId) requestId = res.requestId;
            const comps = extractSatgoFacComprobantes(res.json);
            if (!comps.length) continue;
            const direction = mapDirection(tipo);
            const enriched = enrichSatgoComprobante(comps[0], relatedUuid);
            const persisted = await persistEnriched(
              admin,
              job,
              runId,
              direction,
              enriched,
            );
            if (persisted.itemId) {
              upserted += 1;
              relatedFetched += 1;
              if (enriched.sourceXml) enrichedXml += 1;
              if (
                await publishEnriched(
                  mirrorCfg,
                  job.portal_company_ref,
                  direction,
                  enriched,
                )
              ) {
                published += 1;
              }
              fetched = true;
              break;
            }
          }
          if (!fetched) {
            /* complementary invoice outside SATgo reach for this RFC/tipo */
          }
        }

        // Re-publicar complementos P ahora que las relacionadas pueden existir en OS.
        const { data: pagoItems } = await admin
          .from("satgo_cfdi_items")
          .select("uuid, direction, sat_status")
          .eq("client_id", job.client_id)
          .eq("voucher_type", "P")
          .limit(40);
        let paymentsRepublished = 0;
        for (const row of pagoItems ?? []) {
          const uuid = String(row.uuid ?? "").toUpperCase();
          const direction = row.direction === "emitida" ? "emitida" : "recibida";
          const tipo: SatgoFacTipo =
            direction === "emitida" ? "emitidos" : "recibidos";
          const res = await fetchSatgoFacFielWithJwe({
            bearer,
            rfc: job.rfc,
            tipo,
            certBytes,
            keyJwe: job.satgo_key_jwe,
            passwordJwe: job.satgo_password_jwe,
            tipoBusqueda: 0,
            uuid,
            estatusFactura: -1,
            solicitaMetadata: false,
            descargaComprobantes: true,
            descargaPdfs: false,
            requestId,
          });
          if (!res.ok) continue;
          if (res.requestId) requestId = res.requestId;
          const comps = extractSatgoFacComprobantes(res.json);
          const enriched = enrichSatgoComprobante(comps[0] ?? { uuid }, uuid);
          await persistEnriched(admin, job, runId, direction, enriched);
          if (
            await publishEnriched(
              mirrorCfg,
              job.portal_company_ref,
              direction,
              enriched,
            )
          ) {
            paymentsRepublished += 1;
            published += 1;
          }
        }

        results.push({
          clientId: job.client_id,
          mode: "enrich",
          status: "success",
          pending: (pending ?? []).length,
          enrichOk,
          enrichFail,
          relatedFetched,
          paymentsRepublished,
        });
      }
    } else {
      // ── Modo listado por fechas (+ XML si downloadXml) ──
      const tipos: SatgoFacTipo[] = ["emitidos", "recibidos"];
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
          tipoBusqueda: 1,
          estatusFactura: -1,
          solicitaMetadata: false,
          descargaComprobantes: downloadXml,
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
        let xmlHits = 0;

        for (const c of comps) {
          const uuid = String(c.uuid ?? c.UUID ?? c.folioFiscal ?? "")
            .trim()
            .toUpperCase();
          if (!uuid) continue;
          const enriched = enrichSatgoComprobante(c, uuid);
          if (enriched.sourceXml) xmlHits += 1;
          const persisted = await persistEnriched(
            admin,
            job,
            runId,
            direction,
            enriched,
          );
          if (persisted.itemId) {
            upserted += 1;
            if (enriched.sourceXml) enrichedXml += 1;
            if (direction === "emitida") clientEmitidas += 1;
            else clientRecibidas += 1;
            if (
              await publishEnriched(
                mirrorCfg,
                job.portal_company_ref,
                direction,
                enriched,
              )
            ) {
              published += 1;
            }
          }
        }

        results.push({
          clientId: job.client_id,
          tipo,
          status: "success",
          count: comps.length,
          xmlParsed: xmlHits,
          descargaComprobantes: downloadXml,
          folioDescarga: res.json.folioDescarga ?? null,
        });
      }
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
          `CFDI auto SATgo · emitidas ${clientEmitidas} · recibidas ${clientRecibidas} · xml ${enrichedXml} · ${fechaInicial.slice(0, 10)}→${fechaFinal.slice(0, 10)}${enrichMode ? " · enrich" : ""}`,
        raw_response: {
          provider: "satgo",
          endpoint: "facfiel",
          period: { fechaInicial, fechaFinal },
          emitidas: clientEmitidas,
          recibidas: clientRecibidas,
          enrichedXml,
          enrichMode,
          downloadXml,
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
    mode: enrichMode ? "enrich" : "list",
    downloadXml,
    jobsEligible: jobs.length,
    clientsProcessed: processed,
    itemsUpserted: upserted,
    xmlEnriched: enrichedXml,
    mirrorPublished: published,
    mirrorNote: hasPortalRefCol
      ? "invoice.publish si portal_company_ref + vault/env OS secrets"
      : "columna portal_company_ref ausente — solo persistencia en central",
    results,
  });
});
