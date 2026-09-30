/**
 * SATgo — CSF y opinión 32D (PDF síncrono).
 * POST JSON: { projectId, consultType: "constancia_situacion_fiscal" | "opinion_cumplimiento" }
 *
 * Secrets: SATGO_API_KEY (o SATGO_ACCESS_TOKEN), MOFFIN_SAT_CIEC_SECRET|MOFFIN_FIEL_SECRET (≥32).
 * Docs: https://api.sat-go.com/scalar/v2
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type ConsultType = "constancia_situacion_fiscal" | "opinion_cumplimiento";

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function satgoBaseUrl(): string {
  return (Deno.env.get("SATGO_BASE_URL") ?? "https://api.sat-go.com").replace(/\/$/, "");
}

function isSatgoConfigured(): boolean {
  return !!(Deno.env.get("SATGO_API_KEY")?.trim() || Deno.env.get("SATGO_ACCESS_TOKEN")?.trim());
}

let cachedBearer: { token: string; expMs: number } | null = null;

function decodeJwtExpMs(token: string): number | null {
  try {
    const parts = token.split(".");
    if (parts.length < 2) return null;
    const pad = "=".repeat((4 - (parts[1].length % 4)) % 4);
    const payload = JSON.parse(atob(parts[1].replace(/-/g, "+").replace(/_/g, "/") + pad)) as {
      exp?: number;
    };
    return typeof payload.exp === "number" ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

function pickAccessToken(jsonBody: Record<string, unknown>): string | null {
  const nested = jsonBody.tokens;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const access = (nested as Record<string, unknown>).access;
    if (access && typeof access === "object" && !Array.isArray(access)) {
      const v = (access as Record<string, unknown>).value;
      if (typeof v === "string" && v.trim()) return v.trim();
    }
  }
  if (typeof jsonBody.token === "string" && jsonBody.token.trim()) return jsonBody.token.trim();
  if (typeof jsonBody.accessToken === "string" && jsonBody.accessToken.trim()) {
    return jsonBody.accessToken.trim();
  }
  return null;
}

async function resolveSatgoBearer(): Promise<
  { ok: true; bearer: string } | { ok: false; message: string; code: string }
> {
  const apiKey = Deno.env.get("SATGO_API_KEY")?.trim() ?? "";
  const access = Deno.env.get("SATGO_ACCESS_TOKEN")?.trim() ?? "";
  if (apiKey) {
    if (cachedBearer && cachedBearer.expMs > Date.now() + 60_000) {
      return { ok: true, bearer: cachedBearer.token };
    }
    const url = `${satgoBaseUrl()}/api/Auth/token-json`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ key: apiKey }),
      });
      const text = await res.text();
      let parsed: Record<string, unknown> = {};
      try {
        parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
      } catch {
        parsed = {};
      }
      if (!res.ok) {
        return {
          ok: false,
          code: "satgo_token_exchange_failed",
          message: `SATgo /Auth/token-json HTTP ${res.status}: ${text.slice(0, 200)}`,
        };
      }
      const bearer = pickAccessToken(parsed);
      if (!bearer) {
        return {
          ok: false,
          code: "satgo_token_exchange_failed",
          message: "SATgo no devolvió access token.",
        };
      }
      cachedBearer = {
        token: bearer,
        expMs: decodeJwtExpMs(bearer) ?? Date.now() + 50 * 60 * 1000,
      };
      return { ok: true, bearer };
    } catch (e) {
      return {
        ok: false,
        code: "satgo_token_exchange_failed",
        message: e instanceof Error ? e.message : String(e),
      };
    }
  }
  if (access) return { ok: true, bearer: access };
  return {
    ok: false,
    code: "satgo_not_configured",
    message: "Configura SATGO_API_KEY o SATGO_ACCESS_TOKEN en Edge Secrets.",
  };
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function decryptCiec(cipherB64: string, secret: string): Promise<string> {
  const combined = base64ToBytes(cipherB64);
  if (combined.length < 13) throw new Error("ciphertext_invalid");
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  const key = await crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["decrypt"]);
  const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return new TextDecoder().decode(plain);
}

function storagePath(orgId: string, clientId: string | null, fileBase: string): string {
  const y = new Date().getUTCFullYear();
  const m = String(new Date().getUTCMonth() + 1).padStart(2, "0");
  const clientSeg = (clientId && String(clientId).trim()) || "sin_cliente";
  const safeBase = fileBase.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 80) || "documento";
  return `${orgId}/satgo/clientes/${clientSeg}/${y}/${m}/${Date.now()}_${safeBase}.pdf`;
}

async function fetchSatgoPdf(opts: {
  bearer: string;
  rfc: string;
  ciec: string;
  kind: "csf" | "oc";
}): Promise<{ ok: true; buf: Uint8Array } | { ok: false; message: string; httpStatus: number }> {
  const path = opts.kind === "csf" ? "/api/v2/Consultar/csf" : "/api/v2/Consultar/oc";
  const url = `${satgoBaseUrl()}${path}`;
  const ctrl = new AbortController();
  const ms = Math.min(
    Math.max(Number(Deno.env.get("SATGO_FETCH_TIMEOUT_MS") ?? "90000") || 90000, 10000),
    180000,
  );
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${opts.bearer}`,
        RFC: opts.rfc,
        Secret: opts.ciec,
        Accept: "application/pdf,*/*",
      },
      signal: ctrl.signal,
    });
    const buf = new Uint8Array(await res.arrayBuffer());
    const head = new TextDecoder().decode(buf.slice(0, 8));
    if (res.ok && buf.length >= 4 && head.startsWith("%PDF")) {
      return { ok: true, buf };
    }
    const preview = new TextDecoder().decode(buf.slice(0, 400)).trim();
    return {
      ok: false,
      httpStatus: res.status,
      message: preview || `SATgo ${opts.kind} HTTP ${res.status}`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      httpStatus: /abort/i.test(msg) ? 504 : 502,
      message: /abort/i.test(msg) ? `Timeout SATgo (${ms} ms)` : msg,
    };
  } finally {
    clearTimeout(t);
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  if (!isSatgoConfigured()) {
    return json(
      {
        error: "satgo_not_configured",
        message: "Configura SATGO_API_KEY en Supabase → Edge Functions → Secrets.",
      },
      503,
    );
  }

  const ciecSecret =
    Deno.env.get("MOFFIN_SAT_CIEC_SECRET")?.trim() ||
    Deno.env.get("MOFFIN_FIEL_SECRET")?.trim() ||
    "";
  if (ciecSecret.length < 32) {
    return json(
      {
        error: "ciec_not_configured",
        message: "MOFFIN_SAT_CIEC_SECRET o MOFFIN_FIEL_SECRET (≥32) requerido.",
      },
      503,
    );
  }

  const rawAuth = req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";
  const accessToken = rawAuth.match(/^Bearer\s+(\S+)/i)?.[1];
  if (!accessToken) return json({ error: "No autorizado" }, 401);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const userClient = createClient(supabaseUrl, anon, {
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
  });
  const { data: userData, error: authErr } = await userClient.auth.getUser(accessToken);
  const user = userData?.user;
  if (authErr || !user) return json({ error: "No autorizado" }, 401);

  let body: { projectId?: string; consultType?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }

  const projectId = body.projectId?.trim() ?? "";
  const consultType = body.consultType as ConsultType | undefined;
  const allowed: ConsultType[] = ["constancia_situacion_fiscal", "opinion_cumplimiento"];
  if (!projectId || !consultType || !allowed.includes(consultType)) {
    return json(
      {
        error: "projectId y consultType (constancia_situacion_fiscal|opinion_cumplimiento) requeridos",
      },
      400,
    );
  }

  const { data: profile } = await userClient
    .from("profiles")
    .select("organization_id")
    .eq("user_id", user.id)
    .single();
  if (!profile?.organization_id) return json({ error: "Perfil no encontrado" }, 403);

  const admin = createClient(supabaseUrl, serviceKey);
  const { data: project, error: projErr } = await admin
    .from("projects")
    .select("id, organization_id, client_id, clients(rfc)")
    .eq("id", projectId)
    .single();
  if (projErr || !project || project.organization_id !== profile.organization_id) {
    return json({ error: "Proyecto no encontrado" }, 404);
  }
  if (!project.client_id) {
    return json({ error: "client_required", message: "El proyecto debe tener cliente." }, 400);
  }

  const rfcRaw =
    (project.clients as { rfc: string | null } | null)?.rfc?.trim().toUpperCase().replace(/\s/g, "") ??
    "";
  if (!rfcRaw) {
    return json({ error: "El cliente no tiene RFC configurado" }, 400);
  }

  const { data: ciecRow } = await admin
    .from("moffin_client_sat_ciec")
    .select("ciec_ciphertext")
    .eq("client_id", project.client_id)
    .maybeSingle();
  if (!ciecRow?.ciec_ciphertext) {
    return json(
      {
        error: "ciec_required",
        message: "Guarda la CIEC del cliente antes de CSF/32D (SATgo).",
      },
      400,
    );
  }

  let ciecPlain: string;
  try {
    ciecPlain = await decryptCiec(ciecRow.ciec_ciphertext, ciecSecret);
  } catch (e) {
    return json(
      { error: "ciec_decrypt_failed", message: e instanceof Error ? e.message : String(e) },
      500,
    );
  }

  const satAuth = await resolveSatgoBearer();
  if (!satAuth.ok) return json({ error: satAuth.code, message: satAuth.message }, 503);

  const kind = consultType === "constancia_situacion_fiscal" ? "csf" : "oc";
  const serviceName = kind === "csf" ? "satgo-csf" : "satgo-oc";
  const pdfRes = await fetchSatgoPdf({
    bearer: satAuth.bearer,
    rfc: rfcRaw,
    ciec: ciecPlain,
    kind,
  });

  if (!pdfRes.ok) {
    const { data: rowErr } = await admin
      .from("moffin_consults")
      .insert({
        organization_id: project.organization_id,
        project_id: projectId,
        client_id: project.client_id,
        rfc: rfcRaw,
        consult_type: consultType,
        moffin_service: serviceName,
        status: "error",
        error_message: `Origen: SATgo. ${pdfRes.message}`.slice(0, 500),
        raw_response: {
          provider: "satgo",
          kind,
          httpStatus: pdfRes.httpStatus,
          message: pdfRes.message,
        },
        requested_by: user.id,
      })
      .select("id")
      .single();
    return json(
      {
        error: "satgo_api_error",
        message: pdfRes.message,
        statusCode: pdfRes.httpStatus,
        consultId: rowErr?.id,
        provider: "satgo",
      },
      422,
    );
  }

  const path = storagePath(project.organization_id, project.client_id, consultType);
  const { error: upErr } = await admin.storage.from("documents").upload(path, pdfRes.buf, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (upErr) {
    return json({ error: "storage_upload_failed", message: upErr.message }, 500);
  }

  const displayName = `${consultType}_${Date.now()}.pdf`;
  const { data: doc, error: docErr } = await admin
    .from("documents")
    .insert({
      name: displayName,
      file_path: path,
      file_size: pdfRes.buf.length,
      mime_type: "application/pdf",
      source: "supabase",
      organization_id: project.organization_id,
      project_id: projectId,
      client_id: project.client_id,
      document_type: consultType,
      uploaded_by: user.id,
    })
    .select("id")
    .single();
  if (docErr) {
    return json({ error: "document_insert_failed", message: docErr.message }, 500);
  }

  const label =
    consultType === "constancia_situacion_fiscal"
      ? "Constancia de situación fiscal (SATgo)"
      : "Opinión de cumplimiento 32D (SATgo)";

  const { data: inserted, error: insErr } = await admin
    .from("moffin_consults")
    .insert({
      organization_id: project.organization_id,
      project_id: projectId,
      client_id: project.client_id,
      rfc: rfcRaw,
      consult_type: consultType,
      moffin_service: serviceName,
      status: "success",
      summary: `${label} · PDF listo (${pdfRes.buf.length} bytes)`,
      raw_response: {
        provider: "satgo",
        kind,
        pdfBytes: pdfRes.buf.length,
      },
      document_id: doc.id,
      requested_by: user.id,
    })
    .select("id, status, summary, document_id, created_at")
    .single();

  if (insErr) return json({ error: insErr.message }, 500);

  return json({ consult: inserted, provider: "satgo" });
});
