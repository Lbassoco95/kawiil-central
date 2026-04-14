import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  decryptFielSecret,
  formatFielMaterial,
} from "../_shared/moffinFielCrypto.ts";
import { mergeMoffinQueryPayloadExtras } from "../_shared/moffinQueryPayloadExtras.ts";
import {
  getMoffinApiFlavor,
  moffinLegacyApiKey,
  moffinLegacyBaseUrl,
  moffinSolutionsBaseUrl,
  moffinSolutionsBearerToken,
} from "../_shared/moffinApiFlavor.ts";
import {
  type SolutionsStaticBearerSource,
  resolveMoffinSolutionsBearer,
} from "../_shared/moffinSolutionsAuth.ts";
import {
  extractMoffinProfileId,
  extractSolutionsQueryId,
  moffinSolutionsGetJson,
  moffinSolutionsPostJson,
} from "../_shared/moffinSolutionsClient.ts";
import {
  moffinQueryPathForConsult,
  moffinQueryServiceSegment,
  moffinSolutionsProfilePath,
  moffinSolutionsQueryPathForConsult,
} from "../_shared/moffinQueryPaths.ts";
import {
  mapMoffinStatus,
  moffinMessageImpliesSatStillProcessing,
} from "../_shared/moffinReportStatus.ts";
import { summarizeSatRfcCertificates } from "../_shared/moffinSatRfc.ts";
import { tryUploadSatRfcPdf } from "../_shared/moffinSatRfcUpload.ts";

/**
 * Moffin OpenAPI: https://app.moffin.mx/api/v1/docs · https://moffin.mx/docs
 * Auth: Authorization: Token <MOFFIN_API_KEY>
 * Base: MOFFIN_BASE_URL (p. ej. https://app.moffin.mx/api/v1 o sandbox).
 *
 * --- Qué hace hoy cada botón en Kawiil ---
 * - Lista 69-B → POST /query/sat_blacklist (por defecto).
 * - «Constancia» y «Opinión» → el mismo POST documentado como consulta de certificados RFC
 *   (`sat_rfc` salvo overrides por secretos; ver moffinQueryPaths.ts).
 *   La respuesta típica incluye certificados FIEL/SELLO con enlaces a archivos `.cer`, no PDF oficiales
 *   de constancia de situación fiscal ni de opinión de cumplimiento del SAT.
 *
 * --- Overrides de ruta (tras confirmar con Moffin) ---
 * - MOFFIN_QUERY_PATH_SAT_BLACKLIST
 * - MOFFIN_QUERY_PATH_CONSTANCIA_SITUACION_FISCAL
 * - MOFFIN_QUERY_PATH_OPINION_CUMPLIMIENTO
 * - MOFFIN_SERVICE_QUERIES_SERVICE (GET /service_queries `service=`, default sat_rfc)
 *
 * --- Preguntas para soporte / cuenta técnica Moffin (plantilla) ---
 * 1) ¿Existe path o producto distinto para constancia y opinión en PDF del SAT?
 * 2) Si todo pasa por sat_rfc: ¿qué campo del body/metadata dispara PDF vs solo certificados?
 * 3) ¿El PDF llega solo en webhook Svix, en GET /report/{id}, o en otro campo?
 * 4) ¿El plan contratado incluye esos PDF o solo validación de certificados?
 *
 * --- Correo listo para copiar a Moffin (soporte / cuenta técnica) ---
 * Asunto: API — constancia y opinión en PDF vs respuesta sat_rfc (solo .cer)
 *
 * Hola,
 *
 * Integramos POST /query/sat_rfc con FIEL. En éxito recibimos solo certificates[].url a archivos .cer
 * (SELLO/FIEL) en almacenamiento firmado, p. ej.:
 *   { "success": true, "data": { "certificates": [
 *     { "url": "https://…/…/sat/XXXXXXXX.cer?...", "type": "SELLO", "state": "Activo" },
 *     { "url": "https://…/…/sat/XXXXXXXX.cer?...", "type": "FIEL", "state": "Activo" }
 *   ]}}
 * Necesitamos los PDF oficiales del SAT: constancia de situación fiscal y opinión de cumplimiento.
 * ¿Existe otro path, query string, campo en el body o metadata para obtener esos PDF?
 * ¿Se entregan en webhook Svix, en GET /report/{id} (¿con qué flags?) u otro endpoint?
 * ¿Nuestro plan contratado incluye esos documentos o únicamente validación de certificados?
 *
 * Gracias.
 *
 * --- Tras respuesta de Moffin (sin redeploy de lógica si solo cambian datos) ---
 * - MOFFIN_QUERY_EXTRA_BODY_CONSTANCIA_SITUACION_FISCAL — JSON objeto fusionado al body (constancia).
 * - MOFFIN_QUERY_EXTRA_BODY_OPINION_CUMPLIMIENTO — igual para opinión (ver moffinQueryPayloadExtras.ts).
 * - MOFFIN_SAT_RFC_EXTRA_PDF_FIELD_NAMES — nombres de campos con URL de PDF separados por coma
 *   (p. ej. constanciaPdfUrl) para que pickSatRfcPdfUrlForConsult los detecte en el JSON.
 *
 * FIEL: .cer/.key cifrados (moffin-fiel); contraseña por solicitud. MOFFIN_FIEL_FIELD_* en secretos.
 * Logs útiles: moffin_service_queries_diag, moffin_sat_pdf, moffin_webhook_sat_rfc_payload_shape.
 */

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type ConsultType = "lista_69b" | "constancia_situacion_fiscal" | "opinion_cumplimiento";

function inferAccountTypeFromRfc(rfc: string): "PM" | "PF" {
  const core = rfc.trim().toUpperCase().replace(/\s/g, "");
  return core.length === 12 ? "PM" : "PF";
}

function moffinAccountType(
  clientType: string | null | undefined,
  rfc: string,
): "PM" | "PF" {
  if (clientType === "persona_moral") return "PM";
  if (clientType === "persona_fisica") return "PF";
  return inferAccountTypeFromRfc(rfc);
}

/** Cuerpo útil de lista 69-B en distintas formas (POST inicial, GET /report/{id}). */
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

type MoffinConsultDbRow = {
  id: string;
  organization_id: string;
  project_id: string;
  client_id: string | null;
  consult_type: string;
  rfc: string;
  moffin_query_id: string | null;
  moffin_service?: string | null;
  document_id: string | null;
  requested_by: string | null;
  raw_response: unknown;
};

type MoffinPersistUploadOpts = {
  moffinBase: string;
  moffinApiKey: string;
  pdfAuthMode?: "token" | "bearer";
  skipServiceQueries?: boolean;
};

function rowUsesSolutionsSnapshot(row: {
  consult_type: string;
  moffin_service?: string | null;
}): boolean {
  if (getMoffinApiFlavor() !== "solutions") return false;
  const s = String(row.moffin_service ?? "");
  return s === "csf" || s === "compliance-opinion";
}

function persistUploadForRow(
  row: MoffinConsultDbRow,
  solutionsBase: string,
  solutionsBearer: string,
  legacyBase: string,
  legacyToken: string,
): MoffinPersistUploadOpts {
  if (rowUsesSolutionsSnapshot(row)) {
    return {
      moffinBase: solutionsBase,
      moffinApiKey: solutionsBearer,
      pdfAuthMode: "bearer",
      skipServiceQueries: true,
    };
  }
  return {
    moffinBase: legacyBase,
    moffinApiKey: legacyToken,
    pdfAuthMode: "token",
    skipServiceQueries: false,
  };
}

async function fetchMoffinReportSnapshotForRow(
  row: MoffinConsultDbRow,
  legacyBase: string,
  legacyToken: string,
  solutionsBase: string,
  solutionsBearer: string,
): Promise<
  { ok: true; json: Record<string, unknown> } | { ok: false; message: string; status: number }
> {
  const qid = row.moffin_query_id?.trim();
  if (!qid) {
    return { ok: false, message: "sin moffin_query_id", status: 400 };
  }
  if (rowUsesSolutionsSnapshot(row)) {
    const r = await moffinSolutionsGetJson(solutionsBase, solutionsBearer, qid);
    if (!r.ok) return { ok: false, message: r.message, status: r.status };
    return { ok: true, json: r.json };
  }
  return fetchMoffinReportById(legacyBase, legacyToken, qid);
}

async function fetchMoffinReportById(
  moffinBase: string,
  moffinKey: string,
  queryId: string,
): Promise<
  { ok: true; json: Record<string, unknown> } | { ok: false; message: string; status: number }
> {
  const url =
    `${moffinBase}/report/${encodeURIComponent(queryId)}?withPDF=true&withFileURL=true`;
  const res = await fetch(url, {
    headers: { Authorization: `Token ${moffinKey}` },
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    return { ok: false, message: "Respuesta de Moffin no es JSON válido", status: res.status };
  }
  if (!res.ok) {
    const msg =
      (typeof json.message === "string" && json.message) ||
      (typeof json.error === "string" && json.error) ||
      `HTTP ${res.status}`;
    return { ok: false, message: msg, status: res.status };
  }
  return { ok: true, json };
}

/** Misma regla que al persistir: CSF/32D pueden quedar en cola aunque `status` raíz sea SUCCESS. */
function resolvedMoffinConsultUiStatus(
  consultType: ConsultType,
  report: Record<string, unknown>,
): "success" | "fail" | "pending" | "error" {
  let st = mapMoffinStatus(String(report.status ?? ""));
  if (
    (consultType === "constancia_situacion_fiscal" || consultType === "opinion_cumplimiento") &&
    moffinMessageImpliesSatStillProcessing(report)
  ) {
    st = "pending";
  }
  return st;
}

async function persistMoffinReportToConsult(
  admin: ReturnType<typeof createClient>,
  row: MoffinConsultDbRow,
  report: Record<string, unknown>,
  fallbackUserId: string,
  upload: MoffinPersistUploadOpts,
): Promise<{ error?: string }> {
  const allowed: ConsultType[] = ["lista_69b", "constancia_situacion_fiscal", "opinion_cumplimiento"];
  if (!allowed.includes(row.consult_type as ConsultType)) {
    return { error: "Tipo de consulta no reconocido" };
  }
  const ct = row.consult_type as ConsultType;
  const st = resolvedMoffinConsultUiStatus(ct, report);
  let summary: string | null = null;
  if (ct === "lista_69b") summary = summarizeBlacklist(report);
  else summary = summarizeSatRfc(ct, report);

  const errMsg =
    st === "fail" || st === "error"
      ? String(report.message ?? report.error ?? "Moffin reportó un fallo")
      : null;

  const uploadUid = row.requested_by ?? fallbackUserId;
  let documentId = row.document_id;
  let pdfFailure: string | null = null;

  if (st === "success" && !documentId && (ct === "constancia_situacion_fiscal" || ct === "opinion_cumplimiento")) {
    const docType =
      ct === "constancia_situacion_fiscal" ? "constancia_situacion_fiscal" : "opinion_cumplimiento";
    const prevRaw =
      row.raw_response && typeof row.raw_response === "object" && !Array.isArray(row.raw_response)
        ? (row.raw_response as Record<string, unknown>)
        : {};
    const ext =
      typeof report.externalId === "string"
        ? report.externalId
        : typeof prevRaw.externalId === "string"
          ? prevRaw.externalId
          : null;
    const up = await tryUploadSatRfcPdf({
      admin,
      orgId: row.organization_id,
      projectId: row.project_id,
      clientId: row.client_id,
      uploadedBy: uploadUid,
      moffinBase: upload.moffinBase,
      moffinApiKey: upload.moffinApiKey,
      moffinPdfAuthMode: upload.pdfAuthMode ?? "token",
      skipServiceQueries: upload.skipServiceQueries ?? false,
      rfc: row.rfc,
      externalId: ext,
      consultType: ct,
      report,
      fileBase: ct,
      documentDisplayName: `${ct}_${String(row.id).slice(0, 8)}_${Date.now()}`,
      documentType: docType,
    });
    if (up.documentId) documentId = up.documentId;
    else pdfFailure = up.pdfFailure;
  }

  const prev = row.raw_response;
  const prevObj =
    prev && typeof prev === "object" && !Array.isArray(prev) ? (prev as Record<string, unknown>) : {};
  const mergedRaw = {
    ...prevObj,
    moffinGetReportSnapshot: report,
    _refreshedAt: new Date().toISOString(),
  };

  const reportId =
    extractSolutionsQueryId(report) ??
    (report.id != null ? String(report.id) : null) ??
    row.moffin_query_id;

  const patch: Record<string, unknown> = {
    status: st,
    error_message:
      st === "success"
        ? pdfFailure
          ? `Sin PDF adjunto: ${pdfFailure}`.slice(0, 500)
          : null
        : errMsg,
    summary,
    raw_response: mergedRaw,
    document_id: documentId,
  };
  if (reportId) patch.moffin_query_id = reportId;
  if (typeof report.uuid === "string") patch.moffin_uuid = report.uuid;

  const { error: upErr } = await admin.from("moffin_consults").update(patch).eq("id", row.id);
  if (upErr) return { error: upErr.message };
  return {};
}

async function refreshPendingConsultRows(
  admin: ReturnType<typeof createClient>,
  rows: MoffinConsultDbRow[] | null | undefined,
  legacyBase: string,
  legacyToken: string,
  solutionsBase: string,
  solutionsBearer: string,
  userId: string,
): Promise<Array<{ id: string; ok: boolean; error?: string; newStatus?: string }>> {
  const list = rows ?? [];
  return Promise.all(
    list.map(async (row) => {
      const rowTyped = row as MoffinConsultDbRow;
      const fr = await fetchMoffinReportSnapshotForRow(
        rowTyped,
        legacyBase,
        legacyToken,
        solutionsBase,
        solutionsBearer,
      );
      if (!fr.ok) {
        return { id: row.id, ok: false, error: fr.message };
      }
      const pe = await persistMoffinReportToConsult(
        admin,
        rowTyped,
        fr.json,
        userId,
        persistUploadForRow(rowTyped, solutionsBase, solutionsBearer, legacyBase, legacyToken),
      );
      if (pe.error) {
        return { id: row.id, ok: false, error: pe.error };
      }
      return {
        id: row.id,
        ok: true,
        newStatus: resolvedMoffinConsultUiStatus(rowTyped.consult_type as ConsultType, fr.json),
      };
    }),
  );
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

  const flavor = getMoffinApiFlavor();
  const solutionsOAuthConfigured =
    !!(Deno.env.get("MOFFIN_SOLUTIONS_CLIENT_ID")?.trim() && Deno.env.get("MOFFIN_SOLUTIONS_CLIENT_SECRET")?.trim());
  const solutionsStaticConfigured = moffinSolutionsBearerToken().length > 0;
  const moffinKey = Deno.env.get("MOFFIN_API_KEY")?.trim() ?? "";
  const moffinBase =
    (Deno.env.get("MOFFIN_BASE_URL") ?? "https://app.moffin.mx/api/v1").replace(/\/$/, "");
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const solutionsAnyAuthConfigured =
    solutionsOAuthConfigured || solutionsStaticConfigured;
  if (!moffinKey && !(flavor === "solutions" && solutionsAnyAuthConfigured)) {
    return new Response(
      JSON.stringify({
        error: "moffin_not_configured",
        message:
          "Configura MOFFIN_API_KEY (API legacy app.moffin / lista 69-B) o, para Solutions, MOFFIN_SOLUTIONS_CLIENT_ID + MOFFIN_SOLUTIONS_CLIENT_SECRET (OAuth) y/o MOFFIN_SOLUTIONS_BEARER (JWT de /oauth/token). Ver documentación Moffin Solutions.",
      }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const solutionsBase = moffinSolutionsBaseUrl();
  let solutionsBearer = "";
  /** oauth = JWT vía /oauth/token; static = MOFFIN_SOLUTIONS_BEARER / MOFFIN_API_KEY (suele fallar 401 en profile). */
  let solutionsAuthVia: "oauth" | "static" | null = null;
  /** Si auth es static, de qué variable salió el Bearer (para mensajes 401). */
  let solutionsStaticSource: SolutionsStaticBearerSource | null = null;
  if (flavor === "solutions") {
    const solAuth = await resolveMoffinSolutionsBearer(solutionsBase);
    if (!solAuth.ok) {
      const errCode =
        "code" in solAuth && solAuth.code === "oauth_incomplete"
          ? "moffin_solutions_oauth_incomplete"
          : "moffin_solutions_auth";
      return new Response(
        JSON.stringify({
          error: errCode,
          message: solAuth.message,
        }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    solutionsBearer = solAuth.bearer;
    solutionsAuthVia = solAuth.via;
    if (solAuth.via === "static") {
      solutionsStaticSource = solAuth.staticSource;
    }
  }
  const legacyBase = flavor === "solutions" ? moffinLegacyBaseUrl() : moffinBase;
  const legacyToken = (flavor === "solutions" ? moffinLegacyApiKey() : moffinKey).trim();

  const rawAuth =
    req.headers.get("Authorization") ??
    req.headers.get("authorization") ??
    "";
  const bearerMatch = rawAuth.match(/^Bearer\s+(\S+)/i);
  const accessToken = bearerMatch?.[1];

  // ── pg_cron branch: refreshAllPending via service_role_key (no user JWT needed) ──
  if (accessToken && accessToken === serviceKey) {
    let cronBody: Record<string, unknown> = {};
    try { cronBody = await req.json(); } catch { /* empty body is fine */ }
    if (cronBody.refreshAllPending) {
      const admin = createClient(supabaseUrl, serviceKey);
      const consultSelect =
        "id, organization_id, project_id, client_id, consult_type, rfc, moffin_query_id, moffin_service, document_id, requested_by, raw_response";
      const { data: pendingRows, error: pre } = await admin
        .from("moffin_consults")
        .select(consultSelect)
        .or("status.eq.pending,and(status.eq.success,document_id.is.null)")
        .not("moffin_query_id", "is", null)
        .order("created_at", { ascending: true })
        .limit(50);
      if (pre) {
        console.error("cron refreshAllPending select:", pre.message);
        return new Response(JSON.stringify({ error: pre.message }), {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }
      console.log(`cron refreshAllPending: ${pendingRows?.length ?? 0} rows`);
      const results = await refreshPendingConsultRows(
        admin,
        pendingRows as MoffinConsultDbRow[] | undefined,
        legacyBase,
        legacyToken,
        solutionsBase,
        solutionsBearer,
        "cron-system",
      );
      return new Response(
        JSON.stringify({ source: "cron", refreshed: results.length, results }),
        { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
  }
  // ── end pg_cron branch ──
  if (!accessToken) {
    return new Response(JSON.stringify({ error: "No autorizado" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userClient = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const { data: userData, error: authError } = await userClient.auth.getUser(accessToken);
  const user = userData?.user;
  if (authError || !user) {
    console.error("moffin-query auth:", authError?.message ?? "sin usuario");
    return new Response(JSON.stringify({ error: "No autorizado" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: {
    projectId?: string;
    consultType?: ConsultType;
    fielPassword?: string;
    refreshPendingForProjectId?: string;
    refreshPendingForClientId?: string;
  };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "JSON inválido" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(supabaseUrl, serviceKey);

  const { data: profile, error: profErr } = await userClient
    .from("profiles")
    .select("organization_id")
    .eq("user_id", user.id)
    .single();
  if (profErr || !profile?.organization_id) {
    return new Response(JSON.stringify({ error: "Perfil no encontrado" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const orgId = profile.organization_id;

  const refreshProjectId =
    typeof body.refreshPendingForProjectId === "string"
      ? body.refreshPendingForProjectId.trim()
      : "";
  const refreshClientId =
    typeof body.refreshPendingForClientId === "string"
      ? body.refreshPendingForClientId.trim()
      : "";

  const consultSelect =
    "id, organization_id, project_id, client_id, consult_type, rfc, moffin_query_id, moffin_service, document_id, requested_by, raw_response";

  if (refreshProjectId) {
    const { data: projCheck, error: pce } = await userClient
      .from("projects")
      .select("id, organization_id")
      .eq("id", refreshProjectId)
      .single();
    if (pce || !projCheck || projCheck.organization_id !== orgId) {
      return new Response(JSON.stringify({ error: "Proyecto no encontrado" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: pendingRows, error: pre } = await admin
      .from("moffin_consults")
      .select(consultSelect)
      .eq("project_id", refreshProjectId)
      .eq("organization_id", orgId)
      .or("status.eq.pending,and(status.eq.success,document_id.is.null)")
      .not("moffin_query_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(15);
    if (pre) {
      return new Response(JSON.stringify({ error: pre.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const results = await refreshPendingConsultRows(
      admin,
      pendingRows as MoffinConsultDbRow[] | undefined,
      legacyBase,
      legacyToken,
      solutionsBase,
      solutionsBearer,
      user.id,
    );
    return new Response(
      JSON.stringify({
        refresh: true,
        scope: "project",
        pendingFound: pendingRows?.length ?? 0,
        results,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (refreshClientId) {
    const { data: clientCheck, error: cce } = await userClient
      .from("clients")
      .select("id, organization_id")
      .eq("id", refreshClientId)
      .single();
    if (cce || !clientCheck || clientCheck.organization_id !== orgId) {
      return new Response(JSON.stringify({ error: "Cliente no encontrado" }), {
        status: 404,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: pendingRows, error: cre } = await admin
      .from("moffin_consults")
      .select(consultSelect)
      .eq("client_id", refreshClientId)
      .eq("organization_id", orgId)
      .or("status.eq.pending,and(status.eq.success,document_id.is.null)")
      .not("moffin_query_id", "is", null)
      .order("created_at", { ascending: false })
      .limit(15);
    if (cre) {
      return new Response(JSON.stringify({ error: cre.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const results = await refreshPendingConsultRows(
      admin,
      pendingRows as MoffinConsultDbRow[] | undefined,
      legacyBase,
      legacyToken,
      solutionsBase,
      solutionsBearer,
      user.id,
    );
    return new Response(
      JSON.stringify({
        refresh: true,
        scope: "client",
        pendingFound: pendingRows?.length ?? 0,
        results,
      }),
      { status: 200, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const projectId = body.projectId?.trim();
  const consultType = body.consultType;
  const fielPassword =
    typeof body.fielPassword === "string" ? body.fielPassword.trim() : "";
  const allowed: ConsultType[] = [
    "lista_69b",
    "constancia_situacion_fiscal",
    "opinion_cumplimiento",
  ];
  if (!projectId || !consultType || !allowed.includes(consultType)) {
    return new Response(
      JSON.stringify({
        error: "projectId y consultType requeridos",
        consultTypeValues: allowed,
        hint:
          "Para sincronizar consultas pendientes usa refreshPendingForProjectId o refreshPendingForClientId.",
      }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const { data: project, error: projErr } = await userClient
    .from("projects")
    .select("id, organization_id, client_id, clients(rfc, client_type)")
    .eq("id", projectId)
    .single();

  if (projErr || !project) {
    return new Response(JSON.stringify({ error: "Proyecto no encontrado" }), {
      status: 404,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (project.organization_id !== profile.organization_id) {
    return new Response(JSON.stringify({ error: "Sin acceso al proyecto" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const clientRow = project.clients as { rfc: string | null; client_type: string | null } | null;
  const rfcRaw = clientRow?.rfc?.trim().toUpperCase().replace(/\s/g, "") ?? "";
  if (!rfcRaw) {
    return new Response(
      JSON.stringify({ error: "El cliente del proyecto no tiene RFC configurado" }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  if (
    flavor === "solutions" &&
    (consultType === "constancia_situacion_fiscal" || consultType === "opinion_cumplimiento")
  ) {
    const ciecSecret =
      Deno.env.get("MOFFIN_SAT_CIEC_SECRET")?.trim() ||
      Deno.env.get("MOFFIN_FIEL_SECRET")?.trim() ||
      "";
    if (ciecSecret.length < 32) {
      return new Response(
        JSON.stringify({
          error: "ciec_not_configured",
          message:
            "Configura MOFFIN_SAT_CIEC_SECRET o MOFFIN_FIEL_SECRET (≥32 caracteres) para CIEC cifrada y perfil SAT Solutions.",
        }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    if (!project.client_id) {
      return new Response(
        JSON.stringify({
          error: "client_required",
          message: "El proyecto debe tener un cliente asociado.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    const { data: ciecRow } = await admin
      .from("moffin_client_sat_ciec")
      .select("ciec_ciphertext, moffin_profile_id")
      .eq("client_id", project.client_id)
      .maybeSingle();
    if (!ciecRow?.ciec_ciphertext) {
      return new Response(
        JSON.stringify({
          error: "ciec_required",
          message:
            "Guarda la CIEC del cliente en Contabilidad (Moffin Solutions) antes de constancia u opinión SAT.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }
    let ciecPlain: string;
    try {
      ciecPlain = await decryptFielSecret(ciecRow.ciec_ciphertext, ciecSecret);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return new Response(
        JSON.stringify({ error: "ciec_decrypt_failed", message: msg }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let profileId: number | null =
      typeof ciecRow.moffin_profile_id === "number" ? ciecRow.moffin_profile_id : null;
    if (profileId == null) {
      const profRes = await moffinSolutionsPostJson(
        solutionsBase,
        solutionsBearer,
        moffinSolutionsProfilePath(),
        { rfc: rfcRaw, ciec: ciecPlain },
      );
      if (!profRes.ok) {
        const hint401 =
          profRes.status === 401
            ? solutionsAuthVia === "oauth"
              ? "401 con JWT de OAuth: revisa que Moffin haya habilitado consultas SAT (Solutions) para este clientId; prueba el mismo Bearer con curl a /query/sat/profile. Si Moffin usa otro host o credenciales, confírmalo con ellos."
              : solutionsStaticSource === "solutions_bearer_env"
                ? "401 con MOFFIN_SOLUTIONS_BEARER: ese valor no es un accessToken aceptado por solutions-api (expiró, otro ambiente o no es el de POST …/oauth/token). Renueva el token o borra el secreto y configura MOFFIN_SOLUTIONS_CLIENT_ID + MOFFIN_SOLUTIONS_CLIENT_SECRET para que Kawiil obtenga el Bearer por OAuth."
                : "401 con Bearer tomado de MOFFIN_API_KEY: esa clave es de app.moffin (lista 69-B), no sirve para perfil SAT en Solutions. En Supabase define MOFFIN_SOLUTIONS_CLIENT_ID + MOFFIN_SOLUTIONS_CLIENT_SECRET (credenciales OAuth que entrega Moffin para Solutions) o MOFFIN_SOLUTIONS_BEARER = accessToken devuelto por POST …/oauth/token."
            : undefined;
        return new Response(
          JSON.stringify({
            error: "moffin_profile_failed",
            message: profRes.message,
            statusCode: profRes.status,
            authUsed: solutionsAuthVia,
            ...(solutionsAuthVia === "static" && solutionsStaticSource
              ? { bearerSource: solutionsStaticSource }
              : {}),
            ...(hint401 ? { hint: hint401 } : {}),
          }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
      profileId = extractMoffinProfileId(profRes.json);
      if (profileId != null) {
        await admin
          .from("moffin_client_sat_ciec")
          .update({ moffin_profile_id: profileId, updated_at: new Date().toISOString() })
          .eq("client_id", project.client_id);
      } else {
        return new Response(
          JSON.stringify({
            error: "moffin_profile_invalid",
            message: "Moffin no devolvió profileId al crear el perfil SAT.",
          }),
          { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
        );
      }
    }

    const satPath = moffinSolutionsQueryPathForConsult(consultType);
    const moffinServiceName = moffinQueryServiceSegment(satPath);
    const satRes = await moffinSolutionsPostJson(solutionsBase, solutionsBearer, satPath, {
      rfc: rfcRaw,
    });
    if (!satRes.ok) {
      const { data: rowErr } = await admin
        .from("moffin_consults")
        .insert({
          organization_id: project.organization_id,
          project_id: projectId,
          client_id: project.client_id,
          rfc: rfcRaw,
          consult_type: consultType,
          moffin_service: moffinServiceName,
          status: "error",
          error_message: satRes.message,
          raw_response: { _error: satRes.message, _status: satRes.status },
          requested_by: user.id,
        })
        .select("id")
        .single();
      const hint401Sat =
        satRes.status === 401
          ? solutionsAuthVia === "oauth"
            ? "401 en Solutions (CSF/32D) con OAuth: revisa permisos del clientId en Moffin o token expirado."
            : solutionsStaticSource === "solutions_bearer_env"
              ? "401 en CSF/32D: MOFFIN_SOLUTIONS_BEARER inválido o expirado; renueva con /oauth/token o usa MOFFIN_SOLUTIONS_CLIENT_ID + MOFFIN_SOLUTIONS_CLIENT_SECRET."
              : "401 en CSF/32D: no uses MOFFIN_API_KEY como Bearer en Solutions; configura OAuth (CLIENT_ID + CLIENT_SECRET) o MOFFIN_SOLUTIONS_BEARER con accessToken de /oauth/token."
          : undefined;
      return new Response(
        JSON.stringify({
          error: "moffin_api_error",
          message: satRes.message,
          statusCode: satRes.status,
          consultId: rowErr?.id,
          ...(solutionsAuthVia === "static" && solutionsStaticSource
            ? { bearerSource: solutionsStaticSource }
            : {}),
          ...(hint401Sat ? { hint: hint401Sat } : {}),
        }),
        { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const json = satRes.json;
    let moffinStatus = mapMoffinStatus(String(json.status ?? ""));
    if (
      satRes.ok &&
      (consultType === "opinion_cumplimiento" || consultType === "constancia_situacion_fiscal")
    ) {
      if (moffinMessageImpliesSatStillProcessing(json)) {
        moffinStatus = "pending";
      } else if (
        extractSolutionsQueryId(json) &&
        moffinStatus === "error" &&
        (json.status === undefined || String(json.status ?? "").trim() === "")
      ) {
        moffinStatus = "pending";
      }
    }
    const summary = summarizeSatRfc(consultType, json);
    const moffinQueryIdStr = extractSolutionsQueryId(json);
    let documentId: string | null = null;
    let pdfSidecarError: string | null = null;
    const solUpload = {
      moffinBase: solutionsBase,
      moffinApiKey: solutionsBearer,
      pdfAuthMode: "bearer" as const,
      skipServiceQueries: true,
    };
    const runSolUpload = async (report: Record<string, unknown>) => {
      const r = await tryUploadSatRfcPdf({
        admin,
        orgId: project.organization_id,
        projectId,
        clientId: project.client_id,
        uploadedBy: user.id,
        ...solUpload,
        rfc: rfcRaw,
        externalId: null,
        consultType,
        report,
        fileBase: consultType,
        documentDisplayName: `${consultType}_${Date.now()}`,
        documentType:
          consultType === "constancia_situacion_fiscal"
            ? "constancia_situacion_fiscal"
            : "opinion_cumplimiento",
      });
      if (r.documentId) {
        documentId = r.documentId;
        pdfSidecarError = null;
      } else {
        pdfSidecarError = r.pdfFailure;
      }
    };
    if (moffinStatus === "success") {
      await runSolUpload(json);
    }
    if (!documentId && moffinQueryIdStr) {
      const fr = await moffinSolutionsGetJson(solutionsBase, solutionsBearer, moffinQueryIdStr);
      if (fr.ok) await runSolUpload(fr.json);
    }

    const insertErrorMessage =
      moffinStatus === "fail" || moffinStatus === "error"
        ? String(json.message ?? json.error ?? "Consulta Moffin fallida").slice(0, 500)
        : moffinStatus === "pending"
          ? null
          : pdfSidecarError
            ? `Sin PDF adjunto: ${pdfSidecarError}`.slice(0, 500)
            : null;

    const { data: inserted, error: insErr } = await admin
      .from("moffin_consults")
      .insert({
        organization_id: project.organization_id,
        project_id: projectId,
        client_id: project.client_id,
        rfc: rfcRaw,
        consult_type: consultType,
        moffin_service: moffinServiceName,
        status: moffinStatus,
        error_message: insertErrorMessage,
        summary,
        raw_response: json,
        moffin_query_id: moffinQueryIdStr,
        moffin_uuid: typeof json.uuid === "string" ? json.uuid : null,
        document_id: documentId,
        requested_by: user.id,
      })
      .select("id, status, summary, document_id, created_at")
      .single();

    if (insErr) {
      console.error("moffin_consults insert:", insErr.message);
      return new Response(JSON.stringify({ error: insErr.message }), {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ consult: inserted }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const accountType = moffinAccountType(clientRow?.client_type, rfcRaw);
  const externalId = `kawiil-${projectId}-${consultType}-${Date.now()}`;

  const path = moffinQueryPathForConsult(consultType);
  const moffinServiceName = moffinQueryServiceSegment(path);
  const moffinUrl = `${legacyBase}${path}`;

  const payload: Record<string, unknown> = {
    rfc: rfcRaw,
    accountType,
    externalId,
  };

  if (consultType !== "lista_69b") {
    const fielSecret = Deno.env.get("MOFFIN_FIEL_SECRET") ?? "";
    if (fielSecret.length < 32) {
      return new Response(
        JSON.stringify({
          error: "fiel_storage_not_configured",
          message:
            "Configura MOFFIN_FIEL_SECRET (≥32 caracteres) en Edge Functions para consultas RFC (constancia/opinión) con FIEL almacenada.",
        }),
        { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!project.client_id) {
      return new Response(
        JSON.stringify({
          error: "client_required",
          message: "El proyecto debe tener un cliente asociado para consultas con FIEL.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const { data: fielRow } = await admin
      .from("moffin_client_fiel")
      .select("cert_ciphertext, key_ciphertext")
      .eq("client_id", project.client_id)
      .maybeSingle();

    if (!fielRow) {
      return new Response(
        JSON.stringify({
          error: "fiel_required",
          message:
            "Configura el certificado (.cer) y la llave privada (.key) del cliente en Contabilidad antes de las consultas RFC (constancia/opinión).",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    if (!fielPassword) {
      return new Response(
        JSON.stringify({
          error: "fiel_password_required",
          message: "Ingresa la contraseña de la e.firma para esta consulta.",
        }),
        { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    let certB64: string;
    let keyB64: string;
    try {
      certB64 = await decryptFielSecret(fielRow.cert_ciphertext, fielSecret);
      keyB64 = await decryptFielSecret(fielRow.key_ciphertext, fielSecret);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      return new Response(
        JSON.stringify({
          error: "fiel_decrypt_failed",
          message: msg,
        }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } },
      );
    }

    const certField = Deno.env.get("MOFFIN_FIEL_FIELD_CERT") ?? "certificate";
    const keyField = Deno.env.get("MOFFIN_FIEL_FIELD_KEY") ?? "privateKey";
    const passField = Deno.env.get("MOFFIN_FIEL_FIELD_PASSWORD") ?? "password";
    const certFmt = Deno.env.get("MOFFIN_FIEL_CERT_FORMAT") === "utf8" ? "utf8" : "b64";
    const keyFmt = Deno.env.get("MOFFIN_FIEL_KEY_FORMAT") === "utf8" ? "utf8" : "b64";

    payload[certField] = formatFielMaterial(certB64, certFmt);
    payload[keyField] = formatFielMaterial(keyB64, keyFmt);
    payload[passField] = fielPassword;
    payload.metadata = { tags: [`kawiil:${consultType}`] };
    if (
      consultType === "constancia_situacion_fiscal" ||
      consultType === "opinion_cumplimiento"
    ) {
      mergeMoffinQueryPayloadExtras(payload, consultType);
    }
  }

  let moffinRes: Response;
  try {
    moffinRes = await fetch(moffinUrl, {
      method: "POST",
      headers: {
        Authorization: `Token ${legacyToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const { data: row } = await admin
      .from("moffin_consults")
      .insert({
        organization_id: project.organization_id,
        project_id: projectId,
        client_id: project.client_id,
        rfc: rfcRaw,
        consult_type: consultType,
        moffin_service: moffinServiceName,
        status: "error",
        error_message: msg,
        raw_response: {},
        requested_by: user.id,
      })
      .select("id")
      .single();

    return new Response(
      JSON.stringify({ error: "moffin_fetch_failed", message: msg, consultId: row?.id }),
      { status: 502, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const text = await moffinRes.text();
  let json: Record<string, unknown> = {};
  try {
    json = text ? JSON.parse(text) : {};
  } catch {
    json = { _parseError: true, _body: text.slice(0, 2000) };
  }

  let moffinStatus = mapMoffinStatus(String(json.status ?? ""));
  if (
    moffinRes.ok &&
    (consultType === "opinion_cumplimiento" || consultType === "constancia_situacion_fiscal") &&
    moffinMessageImpliesSatStillProcessing(json)
  ) {
    moffinStatus = "pending";
  }
  const errMsg =
    moffinRes.ok
      ? null
      : (json.message as string) ||
        (json.error as string) ||
        `HTTP ${moffinRes.status}`;

  let summary: string | null = null;
  if (consultType === "lista_69b") {
    summary = summarizeBlacklist(json);
  } else {
    summary = summarizeSatRfc(consultType, json);
  }

  let documentId: string | null = null;
  let pdfSidecarError: string | null = null;
  const moffinQueryIdStr =
    extractSolutionsQueryId(json) ?? (json.id != null ? String(json.id) : null);

  if (
    moffinStatus === "success" &&
    (consultType === "constancia_situacion_fiscal" || consultType === "opinion_cumplimiento")
  ) {
    const docType =
      consultType === "constancia_situacion_fiscal"
        ? "constancia_situacion_fiscal"
        : "opinion_cumplimiento";
    const displayBase = `${consultType}_${Date.now()}`;

    const runSatUpload = async (report: Record<string, unknown>) => {
      const r = await tryUploadSatRfcPdf({
        admin,
        orgId: project.organization_id,
        projectId,
        clientId: project.client_id,
        uploadedBy: user.id,
        moffinBase: legacyBase,
        moffinApiKey: legacyToken,
        rfc: rfcRaw,
        externalId,
        consultType,
        report,
        fileBase: consultType,
        documentDisplayName: displayBase,
        documentType: docType,
      });
      if (r.documentId) {
        documentId = r.documentId;
        pdfSidecarError = null;
      } else {
        pdfSidecarError = r.pdfFailure;
      }
    };

    await runSatUpload(json);
    if (!documentId && moffinQueryIdStr) {
      const fr = await fetchMoffinReportById(legacyBase, legacyToken, moffinQueryIdStr);
      if (fr.ok) await runSatUpload(fr.json);
    }
  }

  const insertErrorMessage =
    !moffinRes.ok
      ? errMsg
      : moffinStatus === "pending"
        ? null
        : pdfSidecarError
          ? `Sin PDF adjunto: ${pdfSidecarError}`.slice(0, 500)
          : null;

  const { data: inserted, error: insErr } = await admin
    .from("moffin_consults")
    .insert({
      organization_id: project.organization_id,
      project_id: projectId,
      client_id: project.client_id,
      rfc: rfcRaw,
      consult_type: consultType,
      moffin_service: moffinServiceName,
      status: moffinRes.ok ? moffinStatus : "error",
      error_message: insertErrorMessage,
      summary,
      raw_response: json,
      moffin_query_id:
        extractSolutionsQueryId(json) ?? (json.id != null ? String(json.id) : null),
      moffin_uuid: typeof json.uuid === "string" ? json.uuid : null,
      document_id: documentId,
      requested_by: user.id,
    })
    .select("id, status, summary, document_id, created_at")
    .single();

  if (insErr) {
    console.error("moffin_consults insert:", insErr.message);
    return new Response(JSON.stringify({ error: insErr.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  if (!moffinRes.ok) {
    return new Response(
      JSON.stringify({
        error: "moffin_api_error",
        message: errMsg,
        statusCode: moffinRes.status,
        consult: inserted,
      }),
      { status: 422, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  return new Response(JSON.stringify({ consult: inserted }), {
    status: 200,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
