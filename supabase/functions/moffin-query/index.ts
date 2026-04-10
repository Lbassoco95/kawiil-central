import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  decryptFielSecret,
  formatFielMaterial,
} from "../_shared/moffinFielCrypto.ts";
import { uploadMoffinPdfFromUrl } from "../_shared/moffinPdfDownload.ts";
import {
  extractReportLevelPdfUrl,
  pickSatRfcPdfUrl,
  summarizeSatRfcCertificates,
} from "../_shared/moffinSatRfc.ts";

/**
 * Moffin OpenAPI: https://app.moffin.mx/api/v1/docs (ReDoc en https://moffin.mx/docs)
 * - Lista 69-B / contribuyentes: POST /query/sat_blacklist
 * - Certificados SAT (constancia / opinión en certificates[].type): POST /query/sat_rfc
 * Auth: Authorization: Token <MOFFIN_API_KEY>
 * Producción base: https://app.moffin.mx/api/v1 — Sandbox: https://sandbox.moffin.mx/api/v1
 *
 * Constancia / opinión (sat_rfc): suelen requerir e.firma. Se guardan .cer/.key cifrados (moffin-fiel);
 * la contraseña va en cada solicitud (fielPassword). Nombres de campos: MOFFIN_FIEL_FIELD_* en Supabase.
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

function mapMoffinStatus(
  s: string | undefined,
): "success" | "fail" | "pending" | "error" {
  const u = String(s ?? "").trim().toUpperCase();
  if (u === "SUCCESS") return "success";
  if (u === "PENDING") return "pending";
  if (u === "FAIL") return "fail";
  return "error";
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
  const st = String(resp?.status ?? "").toUpperCase();
  if (!inner) {
    return st === "PENDING" ? "Consulta en proceso (Moffin)" : "Sin detalle en respuesta";
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

function pickPdfForConsult(consultType: ConsultType, report: Record<string, unknown>): string | null {
  if (consultType === "constancia_situacion_fiscal" || consultType === "opinion_cumplimiento") {
    const top = extractReportLevelPdfUrl(report);
    if (top) return top;
    return pickSatRfcPdfUrl(consultType, report);
  }
  return extractReportLevelPdfUrl(report);
}

type MoffinConsultDbRow = {
  id: string;
  organization_id: string;
  project_id: string;
  client_id: string | null;
  consult_type: string;
  moffin_query_id: string | null;
  document_id: string | null;
  requested_by: string | null;
  raw_response: unknown;
};

async function fetchMoffinReportById(
  moffinBase: string,
  moffinKey: string,
  queryId: string,
): Promise<
  { ok: true; json: Record<string, unknown> } | { ok: false; message: string; status: number }
> {
  const url = `${moffinBase}/report/${encodeURIComponent(queryId)}?withPDF=true`;
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

async function persistMoffinReportToConsult(
  admin: ReturnType<typeof createClient>,
  row: MoffinConsultDbRow,
  report: Record<string, unknown>,
  fallbackUserId: string,
  moffinApiKey: string,
): Promise<{ error?: string }> {
  const allowed: ConsultType[] = ["lista_69b", "constancia_situacion_fiscal", "opinion_cumplimiento"];
  if (!allowed.includes(row.consult_type as ConsultType)) {
    return { error: "Tipo de consulta no reconocido" };
  }
  const ct = row.consult_type as ConsultType;
  const st = mapMoffinStatus(String(report.status ?? ""));
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
    const pdfUrl = pickPdfForConsult(ct, report);
    const docType =
      ct === "constancia_situacion_fiscal" ? "constancia_situacion_fiscal" : "opinion_cumplimiento";
    if (!pdfUrl) {
      pdfFailure = "sin URL de PDF en respuesta Moffin";
    } else {
      const up = await uploadMoffinPdfFromUrl({
        admin,
        orgId: row.organization_id,
        projectId: row.project_id,
        clientId: row.client_id,
        uploadedBy: uploadUid,
        url: pdfUrl,
        fileBase: ct,
        documentDisplayName: `${ct}_${String(row.id).slice(0, 8)}_${Date.now()}`,
        documentType: docType,
        moffinApiKey,
      });
      if (up.documentId) documentId = up.documentId;
      else pdfFailure = up.failureReason ?? "descarga PDF falló";
    }
  }

  const prev = row.raw_response;
  const prevObj =
    prev && typeof prev === "object" && !Array.isArray(prev) ? (prev as Record<string, unknown>) : {};
  const mergedRaw = {
    ...prevObj,
    moffinGetReportSnapshot: report,
    _refreshedAt: new Date().toISOString(),
  };

  const reportId = report.id != null ? String(report.id) : row.moffin_query_id;

  const patch: Record<string, unknown> = {
    status: st,
    error_message:
      st === "success"
        ? pdfFailure
          ? `PDF no guardado: ${pdfFailure}`.slice(0, 500)
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

  const moffinKey = Deno.env.get("MOFFIN_API_KEY");
  const moffinBase =
    (Deno.env.get("MOFFIN_BASE_URL") ?? "https://app.moffin.mx/api/v1").replace(/\/$/, "");
  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const supabaseAnon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  if (!moffinKey) {
    return new Response(
      JSON.stringify({
        error: "moffin_not_configured",
        message: "Configura el secreto MOFFIN_API_KEY en Edge Functions (Supabase).",
      }),
      { status: 503, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
  }

  const rawAuth =
    req.headers.get("Authorization") ??
    req.headers.get("authorization") ??
    "";
  const bearerMatch = rawAuth.match(/^Bearer\s+(\S+)/i);
  const accessToken = bearerMatch?.[1];
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
    "id, organization_id, project_id, client_id, consult_type, moffin_query_id, document_id, requested_by, raw_response";

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
    const results: Array<{ id: string; ok: boolean; error?: string; newStatus?: string }> = [];
    for (const row of pendingRows ?? []) {
      const qid = row.moffin_query_id as string;
      const fr = await fetchMoffinReportById(moffinBase, moffinKey, qid);
      if (!fr.ok) {
        results.push({ id: row.id, ok: false, error: fr.message });
        continue;
      }
      const pe = await persistMoffinReportToConsult(
        admin,
        row as MoffinConsultDbRow,
        fr.json,
        user.id,
        moffinKey,
      );
      if (pe.error) {
        results.push({ id: row.id, ok: false, error: pe.error });
      } else {
        results.push({
          id: row.id,
          ok: true,
          newStatus: mapMoffinStatus(String(fr.json.status ?? "")),
        });
      }
    }
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
    const results: Array<{ id: string; ok: boolean; error?: string; newStatus?: string }> = [];
    for (const row of pendingRows ?? []) {
      const qid = row.moffin_query_id as string;
      const fr = await fetchMoffinReportById(moffinBase, moffinKey, qid);
      if (!fr.ok) {
        results.push({ id: row.id, ok: false, error: fr.message });
        continue;
      }
      const pe = await persistMoffinReportToConsult(
        admin,
        row as MoffinConsultDbRow,
        fr.json,
        user.id,
        moffinKey,
      );
      if (pe.error) {
        results.push({ id: row.id, ok: false, error: pe.error });
      } else {
        results.push({
          id: row.id,
          ok: true,
          newStatus: mapMoffinStatus(String(fr.json.status ?? "")),
        });
      }
    }
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

  const accountType = moffinAccountType(clientRow?.client_type, rfcRaw);
  const externalId = `kawiil-${projectId}-${consultType}-${Date.now()}`;

  const path =
    consultType === "lista_69b" ? "/query/sat_blacklist" : "/query/sat_rfc";
  const moffinUrl = `${moffinBase}${path}`;

  const payload: Record<string, string> = {
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
            "Configura MOFFIN_FIEL_SECRET (≥32 caracteres) en Edge Functions para usar constancia u opinión con FIEL almacenada.",
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
            "Configura el certificado (.cer) y la llave privada (.key) del cliente en Contabilidad antes de consultar constancia u opinión.",
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
  }

  let moffinRes: Response;
  try {
    moffinRes = await fetch(moffinUrl, {
      method: "POST",
      headers: {
        Authorization: `Token ${moffinKey}`,
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
        moffin_service: consultType === "lista_69b" ? "sat_blacklist" : "sat_rfc",
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

  const moffinStatus = mapMoffinStatus(String(json.status ?? ""));
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
  const moffinQueryIdStr = json.id != null ? String(json.id) : null;

  if (
    moffinStatus === "success" &&
    (consultType === "constancia_situacion_fiscal" || consultType === "opinion_cumplimiento")
  ) {
    const docType =
      consultType === "constancia_situacion_fiscal"
        ? "constancia_situacion_fiscal"
        : "opinion_cumplimiento";
    const displayBase = `${consultType}_${Date.now()}`;
    let sawPdfUrl = false;

    const tryUploadFromReport = async (report: Record<string, unknown>) => {
      const pdfUrl = pickPdfForConsult(consultType, report);
      if (!pdfUrl) return;
      sawPdfUrl = true;
      const up = await uploadMoffinPdfFromUrl({
        admin,
        orgId: project.organization_id,
        projectId,
        clientId: project.client_id,
        uploadedBy: user.id,
        url: pdfUrl,
        fileBase: consultType,
        documentDisplayName: displayBase,
        documentType: docType,
        moffinApiKey: moffinKey,
      });
      if (up.documentId) {
        documentId = up.documentId;
        pdfSidecarError = null;
      } else {
        pdfSidecarError = up.failureReason ?? "descarga PDF falló";
      }
    };

    await tryUploadFromReport(json);
    if (!documentId && moffinQueryIdStr) {
      const fr = await fetchMoffinReportById(moffinBase, moffinKey, moffinQueryIdStr);
      if (fr.ok) await tryUploadFromReport(fr.json);
    }
    if (!documentId) {
      if (!sawPdfUrl) {
        pdfSidecarError = "sin URL de PDF en respuesta Moffin";
      } else if (!pdfSidecarError) {
        pdfSidecarError = "no se pudo guardar el PDF";
      }
    }
  }

  const insertErrorMessage =
    !moffinRes.ok
      ? errMsg
      : pdfSidecarError
        ? `PDF no guardado: ${pdfSidecarError}`.slice(0, 500)
        : null;

  const { data: inserted, error: insErr } = await admin
    .from("moffin_consults")
    .insert({
      organization_id: project.organization_id,
      project_id: projectId,
      client_id: project.client_id,
      rfc: rfcRaw,
      consult_type: consultType,
      moffin_service: consultType === "lista_69b" ? "sat_blacklist" : "sat_rfc",
      status: moffinRes.ok ? moffinStatus : "error",
      error_message: insertErrorMessage,
      summary,
      raw_response: json,
      moffin_query_id: json.id != null ? String(json.id) : null,
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
