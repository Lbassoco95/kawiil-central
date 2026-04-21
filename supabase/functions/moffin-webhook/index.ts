/**
 * Webhook Svix (Moffin): verifica firma y actualiza moffin_consults cuando llega el resultado asíncrono.
 *
 * sat_rfc (constancia/opinión en Kawiil): la API pública documenta certificados RFC; el payload puede traer
 * `.cer` u otros campos. Revisa logs `moffin_webhook_sat_rfc_payload_shape` y compáralos con lo que indique Moffin.
 * Si documentan nombres de campo con URL de PDF, configura `MOFFIN_SAT_RFC_EXTRA_PDF_FIELD_NAMES` en Edge (misma
 * variable que usa moffin-query / pickSatRfcPdfUrlForConsult).
 *
 * Configuración:
 * - MOFFIN_SVIX_SIGNING_SECRET = whsec_... (Svix / Moffin)
 * - URL: https://<ref>.supabase.co/functions/v1/moffin-webhook (no usar moffin-query: exige JWT)
 *
 * Deploy: verify_jwt = false (supabase/config.toml)
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  getMoffinApiFlavor,
  moffinLegacyApiKey,
  moffinLegacyBaseUrl,
  moffinSolutionsBaseUrl,
} from "../_shared/moffinApiFlavor.ts";
import { resolveMoffinSolutionsBearer } from "../_shared/moffinSolutionsAuth.ts";
import {
  extractMoffinErrorMessage,
  mapMoffinReportStatus,
  mapMoffinStatus,
  moffinMessageImpliesSatStillProcessing,
} from "../_shared/moffinReportStatus.ts";
import {
  extractSolutionsQueryId,
  moffinSolutionsGetJson,
  type MoffinSolutionsAuthScheme,
} from "../_shared/moffinSolutionsClient.ts";
import { summarizeSatRfcCertificates } from "../_shared/moffinSatRfc.ts";
import { tryUploadSatRfcPdf } from "../_shared/moffinSatRfcUpload.ts";
import {
  attemptNubariumRetryPost,
  buildRetryRawResponse,
  bumpNubariumRetryState,
  decideNubariumRetry,
  type NubariumRetryConsultType,
  nubariumRetrySummary,
  nubariumSecretFromEnv,
} from "../_shared/moffinNubariumRetry.ts";
import { Webhook } from "npm:svix";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, svix-id, svix-timestamp, svix-signature",
};

type ConsultType = "lista_69b" | "constancia_situacion_fiscal" | "opinion_cumplimiento";

const KAWIIL_EXTERNAL_RE =
  /^kawiil-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(lista_69b|constancia_situacion_fiscal|opinion_cumplimiento)-(\d+)$/i;

function blacklistInner(resp: Record<string, unknown>): Record<string, unknown> | null {
  const tryObj = (x: unknown): Record<string, unknown> | null =>
    x && typeof x === "object" && !Array.isArray(x) ? (x as Record<string, unknown>) : null;
  return (
    tryObj(resp?.response) ??
    tryObj(resp?.state) ??
    tryObj((resp?.response as Record<string, unknown> | undefined)?.data) ??
    tryObj(resp?.data) ??
    tryObj((resp?.query as Record<string, unknown> | undefined)?.response)
  );
}

function summarizeBlacklist(resp: Record<string, unknown>): string {
  const inner = blacklistInner(resp);
  if (!inner) {
    return mapMoffinStatus(String(resp?.status)) === "pending"
      ? "Consulta en proceso (Moffin)"
      : "Sin detalle en respuesta";
  }
  const rfc = inner.RFC ?? inner.rfc;
  const est = inner.Estatus ?? inner.estatus ?? inner.resultado ?? inner.status;
  const rz = inner.RazonSocial ?? inner.razonSocial;
  const parts = [
    rfc ? `RFC: ${rfc}` : null,
    est ? `Estatus: ${est}` : null,
    rz ? `Razón social: ${rz}` : null,
  ].filter(Boolean);
  return parts.length ? parts.join(" · ") : "Lista 69-B consultada";
}

function summarizeSatRfc(
  consultType: "constancia_situacion_fiscal" | "opinion_cumplimiento",
  resp: Record<string, unknown>,
): string {
  return summarizeSatRfcCertificates(consultType, resp);
}

/** Forma superficial del informe para cotejar con Moffin (PDF, URLs, claves en certificates[]). */
function logMoffinWebhookSatPayloadShape(
  consultType: ConsultType,
  mr: Record<string, unknown> | null | undefined,
) {
  if (!mr || typeof mr !== "object") return;
  if (
    consultType !== "constancia_situacion_fiscal" &&
    consultType !== "opinion_cumplimiento"
  ) {
    return;
  }
  const resp = mr.response as Record<string, unknown> | undefined;
  const data = resp?.data as Record<string, unknown> | undefined;
  const certs = Array.isArray(data?.certificates) ? (data.certificates as unknown[]) : [];
  const first = certs[0];
  const firstKeys =
    first && typeof first === "object" && !Array.isArray(first)
      ? Object.keys(first as Record<string, unknown>)
      : [];
  console.log(
    JSON.stringify({
      moffin_webhook_sat_rfc_payload_shape: {
        consultType,
        reportKeys: Object.keys(mr).slice(0, 48),
        responseKeys:
          resp && typeof resp === "object" ? Object.keys(resp).slice(0, 48) : [],
        dataKeys: data && typeof data === "object" ? Object.keys(data).slice(0, 48) : [],
        firstCertificateKeys: firstKeys,
        hasReportPdfURL: typeof (mr as { pdfURL?: string }).pdfURL === "string",
      },
    }),
  );
}

function webhookRowUsesSolutions(row: { moffin_service?: string | null }): boolean {
  if (getMoffinApiFlavor() !== "solutions") return false;
  const s = String(row.moffin_service ?? "");
  return s === "csf" || s === "compliance-opinion";
}

async function fetchMoffinReportJson(
  row: { moffin_service?: string | null },
  base: string,
  key: string,
  queryId: string,
  solutionsBearer: string,
  solutionsAuthScheme: MoffinSolutionsAuthScheme,
): Promise<Record<string, unknown> | null> {
  if (webhookRowUsesSolutions(row)) {
    if (!solutionsBearer.trim()) return null;
    const r = await moffinSolutionsGetJson(
      moffinSolutionsBaseUrl(),
      solutionsBearer,
      queryId,
      solutionsAuthScheme,
    );
    return r.ok ? r.json : null;
  }
  const legacyBase = getMoffinApiFlavor() === "solutions" ? moffinLegacyBaseUrl() : base.replace(/\/$/, "");
  const legacyKey = getMoffinApiFlavor() === "solutions" ? moffinLegacyApiKey() : key.trim();
  const url =
    `${legacyBase}/report/${encodeURIComponent(queryId)}?withPDF=true&withFileURL=true`;
  const res = await fetch(url, { headers: { Authorization: `Token ${legacyKey}` } });
  const text = await res.text();
  if (!res.ok) return null;
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return null;
  }
}

function findKawiilExternalId(obj: unknown): string | null {
  if (obj == null) return null;
  if (typeof obj !== "object") return null;
  if (Array.isArray(obj)) {
    for (const x of obj) {
      const f = findKawiilExternalId(x);
      if (f) return f;
    }
    return null;
  }
  const o = obj as Record<string, unknown>;
  if (typeof o.externalId === "string" && o.externalId.startsWith("kawiil-")) {
    return o.externalId;
  }
  for (const v of Object.values(o)) {
    const f = findKawiilExternalId(v);
    if (f) return f;
  }
  return null;
}

/** Busca un objeto con forma de respuesta Moffin (status + response o query). */
function extractMoffinReport(obj: unknown): Record<string, unknown> | null {
  if (obj == null || typeof obj !== "object") return null;
  if (Array.isArray(obj)) {
    for (const x of obj) {
      const r = extractMoffinReport(x);
      if (r) return r;
    }
    return null;
  }
  const o = obj as Record<string, unknown>;
  if (typeof o.status === "string" && (o.response !== undefined || o.query !== undefined)) {
    return o;
  }
  for (const v of Object.values(o)) {
    const r = extractMoffinReport(v);
    if (r) return r;
  }
  return null;
}

function extractMoffinQueryIdFromPayload(obj: unknown): string | null {
  const report = extractMoffinReport(obj);
  if (!report) return null;
  const sid = extractSolutionsQueryId(report);
  if (sid) return sid;
  const id = report.id;
  if (typeof id === "number" || typeof id === "string") return String(id);
  return null;
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  if (req.method !== "POST") {
    return new Response(JSON.stringify({ error: "Method not allowed" }), {
      status: 405,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const secret = Deno.env.get("MOFFIN_SVIX_SIGNING_SECRET");
  if (!secret?.trim()) {
    console.error("moffin-webhook: MOFFIN_SVIX_SIGNING_SECRET no configurado");
    return new Response(
      JSON.stringify({
        error: "svix_secret_missing",
        message: "Configura MOFFIN_SVIX_SIGNING_SECRET en Edge Functions (valor whsec_... de Svix).",
      }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const rawBody = await req.text();
  const svixId = req.headers.get("svix-id");
  const svixTs = req.headers.get("svix-timestamp");
  const svixSig = req.headers.get("svix-signature");

  if (!svixId || !svixTs || !svixSig) {
    return new Response(
      JSON.stringify({
        error: "missing_svix_headers",
        message: "Se requieren cabeceras svix-id, svix-timestamp y svix-signature",
      }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  let verified: Record<string, unknown>;
  try {
    const wh = new Webhook(secret);
    verified = wh.verify(rawBody, {
      "svix-id": svixId,
      "svix-timestamp": svixTs,
      "svix-signature": svixSig,
    }) as Record<string, unknown>;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.warn("moffin-webhook: verificación Svix falló:", msg);
    return new Response(JSON.stringify({ error: "invalid_signature", message: msg }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const eventType = String(verified.type ?? "unknown");
  const data = verified.data;

  console.log(
    `moffin-webhook: type=${eventType}`,
    JSON.stringify(verified).slice(0, 1500),
  );

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );
  const moffinApiKey = Deno.env.get("MOFFIN_API_KEY") ?? "";
  const moffinBase =
    (Deno.env.get("MOFFIN_BASE_URL") ?? "https://app.moffin.mx/api/v1").replace(/\/$/, "");

  const solutionsBaseUrl = moffinSolutionsBaseUrl();
  let solutionsBearerForWebhook = "";
  let solutionsAuthSchemeForWebhook: MoffinSolutionsAuthScheme = "Bearer";
  if (getMoffinApiFlavor() === "solutions") {
    const solAuth = await resolveMoffinSolutionsBearer(solutionsBaseUrl);
    if (solAuth.ok) {
      solutionsBearerForWebhook = solAuth.bearer;
      solutionsAuthSchemeForWebhook = solAuth.scheme;
    } else {
      console.error("moffin-webhook: auth Solutions omitida:", solAuth.message);
    }
  }

  const moffinReport = extractMoffinReport(data) ?? extractMoffinReport(verified);
  const queryId = moffinReport
    ? extractMoffinQueryIdFromPayload(moffinReport)
    : extractMoffinQueryIdFromPayload(data);
  const extId = findKawiilExternalId(data) ?? findKawiilExternalId(verified);

  let row:
    | {
        id: string;
        consult_type: string;
        project_id: string;
        client_id: string | null;
        organization_id: string;
        requested_by: string | null;
        document_id: string | null;
        moffin_service: string | null;
        rfc: string;
        raw_response: unknown;
      }
    | null = null;

  const rowSelect =
    "id, consult_type, project_id, client_id, organization_id, requested_by, document_id, moffin_service, rfc, raw_response";

  if (queryId) {
    const { data: rows } = await admin
      .from("moffin_consults")
      .select(rowSelect)
      .eq("moffin_query_id", queryId)
      .order("created_at", { ascending: false })
      .limit(1);
    row = (rows?.[0] ?? null) as typeof row;
  }

  if (!row && extId) {
    const m = extId.match(KAWIIL_EXTERNAL_RE);
    if (m) {
      const projectId = m[1];
      const consultType = m[2] as ConsultType;
      const { data: rows } = await admin
        .from("moffin_consults")
        .select(rowSelect)
        .eq("project_id", projectId)
        .eq("consult_type", consultType)
        .order("created_at", { ascending: false })
        .limit(1);
      row = (rows?.[0] ?? null) as typeof row;
    }
  }

  if (!row) {
    console.log("moffin-webhook: sin fila moffin_consults coincidente (evento ignorado)");
    return new Response(
      JSON.stringify({
        ok: true,
        handled: false,
        eventType,
        reason: "no_matching_consult",
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const mergedRaw = {
    ...(moffinReport ?? {}),
    _svixEventType: eventType,
    _svixPayload: verified,
  };

  const consultType = row.consult_type as ConsultType;
  logMoffinWebhookSatPayloadShape(consultType, moffinReport);
  let summary: string | null = null;
  if (moffinReport && typeof moffinReport === "object") {
    if (consultType === "lista_69b") {
      summary = summarizeBlacklist(moffinReport);
    } else if (
      consultType === "constancia_situacion_fiscal" ||
      consultType === "opinion_cumplimiento"
    ) {
      summary = summarizeSatRfc(consultType, moffinReport);
    }
  }

  const mr = moffinReport as Record<string, unknown> | null;
  let st: "success" | "fail" | "pending" | "error" = mr ? mapMoffinReportStatus(mr) : "pending";
  if (
    mr &&
    (consultType === "constancia_situacion_fiscal" || consultType === "opinion_cumplimiento") &&
    moffinMessageImpliesSatStillProcessing(mr)
  ) {
    st = "pending";
  }
  const errMsg =
    st === "fail" || st === "error"
      ? String(
          (mr ? extractMoffinErrorMessage(mr) : null) ??
            mr?.message ??
            mr?.error ??
            (typeof mr?.response === "object" && mr?.response && (mr.response as Record<string, unknown>)?.message) ??
            "Consulta Moffin fallida",
        ).slice(0, 500)
      : null;

  // Reintento Nubarium si el webhook trae FAIL upstream transitorio (Solutions CSF/32D).
  if (
    mr &&
    (consultType === "constancia_situacion_fiscal" || consultType === "opinion_cumplimiento")
  ) {
    const ciecSecret = nubariumSecretFromEnv();
    const decision = decideNubariumRetry({
      uiStatus: st,
      consultType,
      usesSolutions: webhookRowUsesSolutions(row),
      hasClientId: !!row.client_id,
      hasCiecSecret: ciecSecret.length >= 32,
      rawResponse: row.raw_response,
      report: mr,
    });
    if (decision.retry && row.client_id) {
      const retryRes = await attemptNubariumRetryPost({
        admin,
        ciecSecret,
        solutionsBase: solutionsBaseUrl,
        solutionsBearer: solutionsBearerForWebhook,
        solutionsAuthScheme: solutionsAuthSchemeForWebhook,
        consultType: consultType as NubariumRetryConsultType,
        rfc: row.rfc,
        clientId: row.client_id,
      });
      if (retryRes.ok) {
        const newState = bumpNubariumRetryState(
          decision.prevState,
          decision.nubariumError,
          retryRes.queryId,
        );
        const merged = buildRetryRawResponse(row.raw_response, newState, mr, retryRes.json);
        const patch: Record<string, unknown> = {
          status: "pending",
          error_message: null,
          summary: nubariumRetrySummary(
            consultType as NubariumRetryConsultType,
            newState,
            decision.nubariumError,
          ),
          raw_response: merged,
        };
        if (retryRes.queryId) patch.moffin_query_id = retryRes.queryId;
        const { error: upErr } = await admin
          .from("moffin_consults")
          .update(patch)
          .eq("id", row.id);
        if (upErr) {
          console.error("moffin-webhook nubarium retry update:", upErr.message);
          return new Response(JSON.stringify({ error: upErr.message }), {
            status: 500,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          });
        }
        console.log(
          `nubarium_retry_webhook: consult=${row.id} count=${newState.count}/${2} newQueryId=${retryRes.queryId}`,
        );
        return new Response(
          JSON.stringify({
            ok: true,
            handled: true,
            eventType,
            consultId: row.id,
            nubariumRetry: { count: newState.count, newQueryId: retryRes.queryId },
          }),
          { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      console.warn(
        `nubarium_retry_webhook_failed: consult=${row.id} status=${retryRes.status} msg=${retryRes.message}`,
      );
    }
  }

  let documentId = row.document_id;
  let pdfWarn: string | null = null;
  if (
    st === "success" &&
    !documentId &&
    moffinReport &&
    mr &&
    (consultType === "constancia_situacion_fiscal" || consultType === "opinion_cumplimiento")
  ) {
    const docType =
      consultType === "constancia_situacion_fiscal"
        ? "constancia_situacion_fiscal"
        : "opinion_cumplimiento";
    const extForPdf =
      typeof mr.externalId === "string" ? mr.externalId : extId ?? null;
    const displayName = `${consultType}_${String(row.id).slice(0, 8)}_${Date.now()}`;
    const useSol = webhookRowUsesSolutions(row);
    const uploadOpts = {
      admin,
      orgId: row.organization_id,
      projectId: row.project_id,
      clientId: row.client_id,
      uploadedBy: row.requested_by,
      moffinBase: useSol ? solutionsBaseUrl : moffinBase,
      moffinApiKey: useSol ? solutionsBearerForWebhook : moffinApiKey,
      moffinPdfAuthMode: useSol
        ? (solutionsAuthSchemeForWebhook === "Token" ? ("token" as const) : ("bearer" as const))
        : ("token" as const),
      skipServiceQueries: useSol,
      rfc: row.rfc,
      externalId: extForPdf,
      consultType,
      fileBase: consultType,
      documentDisplayName: displayName,
      documentType: docType,
    };
    let up = await tryUploadSatRfcPdf({ ...uploadOpts, report: mr });
    if (!up.documentId && queryId && (useSol || moffinApiKey.trim())) {
      const refreshed = await fetchMoffinReportJson(
        row,
        moffinBase,
        moffinApiKey,
        queryId,
        solutionsBearerForWebhook,
        solutionsAuthSchemeForWebhook,
      );
      if (refreshed) {
        up = await tryUploadSatRfcPdf({ ...uploadOpts, report: refreshed });
      }
    }
    if (up.documentId) documentId = up.documentId;
    else pdfWarn = up.pdfFailure ?? "descarga PDF falló";
  }

  const combinedError =
    st === "fail" || st === "error"
      ? errMsg
      : st === "pending"
        ? null
        : pdfWarn
          ? `Sin PDF adjunto: ${pdfWarn}`.slice(0, 500)
          : null;

  const patch: Record<string, unknown> = {
    status: st,
    error_message: combinedError,
    summary,
    raw_response: mergedRaw,
    document_id: documentId,
  };
  if (queryId) patch.moffin_query_id = queryId;

  const { error: upErr } = await admin.from("moffin_consults").update(patch).eq("id", row.id);

  if (upErr) {
    console.error("moffin-webhook update:", upErr.message);
    return new Response(JSON.stringify({ error: upErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  return new Response(
    JSON.stringify({
      ok: true,
      handled: true,
      eventType,
      consultId: row.id,
    }),
    { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
  );
});
