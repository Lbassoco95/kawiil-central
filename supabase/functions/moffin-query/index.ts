import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import {
  decryptFielSecret,
  formatFielMaterial,
} from "../_shared/moffinFielCrypto.ts";

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
  if (s === "SUCCESS") return "success";
  if (s === "PENDING") return "pending";
  if (s === "FAIL") return "fail";
  return "error";
}

function summarizeBlacklist(resp: Record<string, unknown>): string {
  const inner = resp?.response as Record<string, unknown> | null | undefined;
  if (!inner || typeof inner !== "object") {
    return resp?.status === "PENDING"
      ? "Consulta en proceso (Moffin)"
      : "Sin detalle en respuesta";
  }
  const rfc = inner.RFC ?? inner.rfc;
  const est = inner.Estatus ?? inner.estatus;
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
    return `Certificados: ${types} (ajustar heurística type si falta constancia/opinión)`;
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

async function uploadPdfFromUrl(
  admin: ReturnType<typeof createClient>,
  orgId: string,
  projectId: string,
  clientId: string | null,
  userId: string,
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
  const path = `${orgId}/moffin/${projectId}/${Date.now()}_${fileBase}.pdf`;
  const { error: upErr } = await admin.storage.from("documents").upload(path, buf, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (upErr) {
    console.error("moffin storage upload:", upErr.message);
    return null;
  }
  const { data: doc, error: docErr } = await admin
    .from("documents")
    .insert({
      name: `${fileBase}.pdf`,
      file_path: path,
      file_size: buf.length,
      mime_type: "application/pdf",
      source: "supabase",
      organization_id: orgId,
      project_id: projectId,
      client_id: clientId,
      document_type: documentType,
      uploaded_by: userId,
    })
    .select("id")
    .single();
  if (docErr) {
    console.error("moffin document insert:", docErr.message);
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

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) {
    return new Response(JSON.stringify({ error: "No autorizado" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const userClient = createClient(supabaseUrl, supabaseAnon, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: authError } = await userClient.auth.getUser();
  if (authError || !user) {
    return new Response(JSON.stringify({ error: "No autorizado" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let body: { projectId?: string; consultType?: ConsultType; fielPassword?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: "JSON inválido" }), {
      status: 400,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
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
      }),
      { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } },
    );
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
  if (
    moffinStatus === "success" &&
    (consultType === "constancia_situacion_fiscal" || consultType === "opinion_cumplimiento")
  ) {
    const pdfUrl = pickCertificateUrl(consultType, json);
    if (pdfUrl) {
      const docType =
        consultType === "constancia_situacion_fiscal"
          ? "constancia_situacion_fiscal"
          : "opinion_cumplimiento";
      documentId = await uploadPdfFromUrl(
        admin,
        project.organization_id,
        projectId,
        project.client_id,
        user.id,
        pdfUrl,
        consultType,
        docType,
      );
    }
  }

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
      error_message: errMsg,
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
