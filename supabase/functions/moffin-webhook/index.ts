/**
 * Webhook Svix (Moffin): verifica firma y actualiza moffin_consults cuando llega el resultado asíncrono.
 *
 * Configuración:
 * - Supabase Secrets: MOFFIN_SVIX_SIGNING_SECRET = whsec_... (del portal Svix / Moffin)
 * - En Svix, la URL debe ser: https://<ref>.supabase.co/functions/v1/moffin-webhook
 *   (NO uses moffin-query: esa función exige JWT de usuario.)
 *
 * Deploy: verify_jwt = false (ver supabase/config.toml)
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { buildMoffinPdfStoragePath } from "../_shared/moffinStoragePath.ts";
import { Webhook } from "npm:svix";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, svix-id, svix-timestamp, svix-signature",
};

type ConsultType = "lista_69b" | "constancia_situacion_fiscal" | "opinion_cumplimiento";

const KAWIIL_EXTERNAL_RE =
  /^kawiil-([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})-(lista_69b|constancia_situacion_fiscal|opinion_cumplimiento)-(\d+)$/i;

function mapMoffinStatus(
  s: string | undefined,
): "success" | "fail" | "pending" | "error" {
  const u = String(s ?? "").trim().toUpperCase();
  if (u === "SUCCESS") return "success";
  if (u === "PENDING") return "pending";
  if (u === "FAIL") return "fail";
  return "error";
}

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

function certMatchesConstancia(type: string): boolean {
  return /constancia|situaci[oó]n|CIF|csf|identific/i.test(type);
}

function certMatchesOpinion(type: string): boolean {
  return /opini[oó]n|cumplimiento|OIC|positiva|negativa/i.test(type);
}

function summarizeSatRfc(
  consultType: "constancia_situacion_fiscal" | "opinion_cumplimiento",
  resp: Record<string, unknown>,
): string {
  const r = resp?.response as Record<string, unknown> | null | undefined;
  if (!r || typeof r !== "object") {
    return resp?.status === "PENDING"
      ? "Certificados SAT: consulta en proceso"
      : "Sin respuesta de certificados";
  }
  const data = r.data as Record<string, unknown> | null | undefined;
  const certs = (data?.certificates as Array<Record<string, unknown>> | undefined) ?? [];
  const pred =
    consultType === "constancia_situacion_fiscal"
      ? certMatchesConstancia
      : certMatchesOpinion;
  const match = certs.find((c) => pred(String(c.type ?? "")));
  if (match) {
    return `Certificado (${match.type}): ${match.state ?? ""}`.trim();
  }
  if (certs.length) {
    const types = certs.map((c) => String(c.type ?? "?")).join(", ");
    return `Certificados: ${types}`;
  }
  const exists = r.exists;
  const ok = r.success;
  return `SAT RFC: success=${ok}, exists=${exists}`;
}

function pickCertificateUrl(
  consultType: "constancia_situacion_fiscal" | "opinion_cumplimiento",
  resp: Record<string, unknown>,
): string | null {
  const r = resp?.response as Record<string, unknown> | null | undefined;
  const data = r?.data as Record<string, unknown> | null | undefined;
  const certs = (data?.certificates as Array<Record<string, unknown>> | undefined) ?? [];
  const pred =
    consultType === "constancia_situacion_fiscal"
      ? certMatchesConstancia
      : certMatchesOpinion;
  const match = certs.find((c) => pred(String(c.type ?? "")));
  const url = String(match?.url ?? "");
  if (url.startsWith("http")) return url;
  const firstHttp = certs.map((c) => String(c.url ?? "")).find((u) => u.startsWith("http"));
  return firstHttp ?? null;
}

function pickPdfForConsult(
  consultType: "constancia_situacion_fiscal" | "opinion_cumplimiento",
  report: Record<string, unknown>,
): string | null {
  const u = pickCertificateUrl(consultType, report);
  if (u) return u;
  const top = String(report.pdfURL ?? "");
  return top.startsWith("http") ? top : null;
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

function firstNumericId(obj: unknown): string | null {
  const report = extractMoffinReport(obj);
  if (!report) return null;
  const id = report.id;
  if (typeof id === "number" || typeof id === "string") return String(id);
  return null;
}

async function uploadPdfFromUrl(
  admin: ReturnType<typeof createClient>,
  orgId: string,
  projectId: string,
  clientId: string | null,
  uploadedBy: string | null,
  url: string,
  fileBase: string,
  documentType: string,
): Promise<string | null> {
  const res = await fetch(url);
  if (!res.ok) return null;
  const buf = new Uint8Array(await res.arrayBuffer());
  const head = new TextDecoder().decode(buf.slice(0, 8));
  if (buf.length < 4 || !head.startsWith("%PDF")) {
    return null;
  }
  const path = buildMoffinPdfStoragePath(orgId, clientId, fileBase);
  const { error: upErr } = await admin.storage.from("documents").upload(path, buf, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (upErr) {
    console.error("moffin-webhook storage upload:", upErr.message);
    return null;
  }
  const insertRow: Record<string, unknown> = {
    name: `${fileBase}.pdf`,
    file_path: path,
    file_size: buf.length,
    mime_type: "application/pdf",
    source: "supabase",
    organization_id: orgId,
    project_id: projectId,
    client_id: clientId,
    document_type: documentType,
  };
  if (uploadedBy) insertRow.uploaded_by = uploadedBy;
  const { data: doc, error: docErr } = await admin
    .from("documents")
    .insert(insertRow)
    .select("id")
    .single();
  if (docErr) {
    console.error("moffin-webhook document insert:", docErr.message);
    return null;
  }
  return doc.id;
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

  const moffinReport = extractMoffinReport(data) ?? extractMoffinReport(verified);
  const queryId = moffinReport ? firstNumericId(moffinReport) : firstNumericId(data);
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
      }
    | null = null;

  if (queryId) {
    const { data: rows } = await admin
      .from("moffin_consults")
      .select(
        "id, consult_type, project_id, client_id, organization_id, requested_by, document_id",
      )
      .eq("moffin_query_id", queryId)
      .order("created_at", { ascending: false })
      .limit(1);
    row = rows?.[0] ?? null;
  }

  if (!row && extId) {
    const m = extId.match(KAWIIL_EXTERNAL_RE);
    if (m) {
      const projectId = m[1];
      const consultType = m[2] as ConsultType;
      const { data: rows } = await admin
        .from("moffin_consults")
        .select(
          "id, consult_type, project_id, client_id, organization_id, requested_by, document_id",
        )
        .eq("project_id", projectId)
        .eq("consult_type", consultType)
        .order("created_at", { ascending: false })
        .limit(1);
      row = rows?.[0] ?? null;
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

  const st = moffinReport ? mapMoffinStatus(String(moffinReport.status ?? "")) : "pending";
  const mr = moffinReport as Record<string, unknown> | null;
  const errMsg =
    st === "fail" || st === "error"
      ? String(
          mr?.message ??
            mr?.error ??
            (typeof mr?.response === "object" && mr?.response && (mr.response as Record<string, unknown>)?.message) ??
            "Consulta Moffin fallida",
        )
      : null;

  let documentId = row.document_id;
  if (
    st === "success" &&
    !documentId &&
    moffinReport &&
    (consultType === "constancia_situacion_fiscal" || consultType === "opinion_cumplimiento")
  ) {
    const pdfUrl = pickPdfForConsult(consultType, moffinReport);
    if (pdfUrl) {
      const docType =
        consultType === "constancia_situacion_fiscal"
          ? "constancia_situacion_fiscal"
          : "opinion_cumplimiento";
      const newDoc = await uploadPdfFromUrl(
        admin,
        row.organization_id,
        row.project_id,
        row.client_id,
        row.requested_by,
        pdfUrl,
        consultType,
        docType,
      );
      if (newDoc) documentId = newDoc;
    }
  }

  const patch: Record<string, unknown> = {
    status: st,
    error_message: errMsg,
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
