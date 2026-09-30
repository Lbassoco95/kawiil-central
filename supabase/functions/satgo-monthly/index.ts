/**
 * Descarga mensual CSF/32D vía SATgo (PDF síncrono).
 * Auth: x-cron-secret = CRON_SECRET
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-cron-secret",
};

type ConsultType = "constancia_situacion_fiscal" | "opinion_cumplimiento";
const TYPES: ConsultType[] = ["constancia_situacion_fiscal", "opinion_cumplimiento"];
const MAX = 40;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function satgoBaseUrl(): string {
  return (Deno.env.get("SATGO_BASE_URL") ?? "https://api.sat-go.com").replace(/\/$/, "");
}

let cachedBearer: { token: string; expMs: number } | null = null;

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

async function resolveBearer(): Promise<string | null> {
  const apiKey = Deno.env.get("SATGO_API_KEY")?.trim() ?? "";
  const access = Deno.env.get("SATGO_ACCESS_TOKEN")?.trim() ?? "";
  if (apiKey) {
    if (cachedBearer && cachedBearer.expMs > Date.now() + 60_000) return cachedBearer.token;
    const res = await fetch(`${satgoBaseUrl()}/api/Auth/token-json`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({ key: apiKey }),
    });
    const text = await res.text();
    let parsed: Record<string, unknown> = {};
    try {
      parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      /* ignore */
    }
    if (!res.ok) return null;
    const bearer = pickAccessToken(parsed);
    if (!bearer) return null;
    cachedBearer = { token: bearer, expMs: Date.now() + 50 * 60 * 1000 };
    return bearer;
  }
  return access || null;
}

function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function decryptCiec(cipherB64: string, secret: string): Promise<string> {
  const combined = base64ToBytes(cipherB64);
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(secret));
  const key = await crypto.subtle.importKey("raw", digest, { name: "AES-GCM" }, false, ["decrypt"]);
  return new TextDecoder().decode(await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data));
}

async function fetchPdf(
  bearer: string,
  rfc: string,
  ciec: string,
  kind: "csf" | "oc",
): Promise<{ ok: true; buf: Uint8Array } | { ok: false; message: string; status: number }> {
  const path = kind === "csf" ? "/api/v2/Consultar/csf" : "/api/v2/Consultar/oc";
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 90000);
  try {
    const res = await fetch(`${satgoBaseUrl()}${path}`, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${bearer}`,
        RFC: rfc,
        Secret: ciec,
        Accept: "application/pdf,*/*",
      },
      signal: ctrl.signal,
    });
    const buf = new Uint8Array(await res.arrayBuffer());
    const head = new TextDecoder().decode(buf.slice(0, 8));
    if (res.ok && head.startsWith("%PDF")) return { ok: true, buf };
    return {
      ok: false,
      status: res.status,
      message: new TextDecoder().decode(buf.slice(0, 300)).trim() || `HTTP ${res.status}`,
    };
  } catch (e) {
    return { ok: false, status: 502, message: e instanceof Error ? e.message : String(e) };
  } finally {
    clearTimeout(t);
  }
}

function firstDayOfMonthIso(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const cronSecret = Deno.env.get("CRON_SECRET")?.trim() ?? "";
  const incoming = req.headers.get("x-cron-secret")?.trim() ?? "";
  if (!cronSecret || !incoming || cronSecret !== incoming) {
    return json({ error: "No autorizado" }, 401);
  }

  const bearer = await resolveBearer();
  if (!bearer) return json({ error: "satgo_not_configured" }, 503);

  const ciecSecret =
    Deno.env.get("MOFFIN_SAT_CIEC_SECRET")?.trim() ||
    Deno.env.get("MOFFIN_FIEL_SECRET")?.trim() ||
    "";
  if (ciecSecret.length < 32) return json({ error: "ciec_not_configured" }, 503);

  const admin = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
  );

  const { data: ciecRows, error: ciecErr } = await admin
    .from("moffin_client_sat_ciec")
    .select("organization_id, client_id, ciec_ciphertext, clients(rfc)")
    .not("ciec_ciphertext", "is", null);
  if (ciecErr) return json({ error: ciecErr.message }, 500);

  const monthStart = firstDayOfMonthIso();
  const results: Array<Record<string, unknown>> = [];
  let done = 0;

  for (const row of (ciecRows ?? []) as Array<{
    organization_id: string;
    client_id: string;
    ciec_ciphertext: string;
    clients: { rfc: string | null } | null;
  }>) {
    if (done >= MAX) break;
    const rfc = row.clients?.rfc?.trim().toUpperCase().replace(/\s/g, "") ?? "";
    if (!rfc) {
      results.push({ clientId: row.client_id, skipped: "sin_rfc" });
      continue;
    }
    const { data: proj } = await admin
      .from("projects")
      .select("id")
      .eq("client_id", row.client_id)
      .limit(1)
      .maybeSingle();
    if (!proj?.id) {
      results.push({ clientId: row.client_id, skipped: "sin_proyecto" });
      continue;
    }

    let ciecPlain: string;
    try {
      ciecPlain = await decryptCiec(row.ciec_ciphertext, ciecSecret);
    } catch (e) {
      results.push({
        clientId: row.client_id,
        status: "error",
        message: e instanceof Error ? e.message : String(e),
      });
      continue;
    }

    for (const consultType of TYPES) {
      if (done >= MAX) break;
      const { count } = await admin
        .from("moffin_consults")
        .select("id", { count: "exact", head: true })
        .eq("client_id", row.client_id)
        .eq("consult_type", consultType)
        .in("status", ["success", "pending"])
        .gte("created_at", monthStart);
      if ((count ?? 0) > 0) {
        results.push({ clientId: row.client_id, consultType, skipped: "ya_consultado_este_mes" });
        continue;
      }

      const kind = consultType === "constancia_situacion_fiscal" ? "csf" : "oc";
      const serviceName = kind === "csf" ? "satgo-csf" : "satgo-oc";
      const pdfRes = await fetchPdf(bearer, rfc, ciecPlain, kind);
      if (!pdfRes.ok) {
        await admin.from("moffin_consults").insert({
          organization_id: row.organization_id,
          project_id: proj.id,
          client_id: row.client_id,
          rfc,
          consult_type: consultType,
          moffin_service: serviceName,
          status: "error",
          error_message: `Origen: satgo-monthly. ${pdfRes.message}`.slice(0, 500),
          raw_response: { provider: "satgo", kind, _auto: true, message: pdfRes.message },
          requested_by: null,
        });
        results.push({ clientId: row.client_id, consultType, status: "error" });
        done += 1;
        continue;
      }

      const y = new Date().getUTCFullYear();
      const m = String(new Date().getUTCMonth() + 1).padStart(2, "0");
      const path =
        `${row.organization_id}/satgo/clientes/${row.client_id}/${y}/${m}/` +
        `${Date.now()}_${consultType}.pdf`;
      const { error: upErr } = await admin.storage.from("documents").upload(path, pdfRes.buf, {
        contentType: "application/pdf",
        upsert: false,
      });
      let documentId: string | null = null;
      if (!upErr) {
        const { data: doc } = await admin
          .from("documents")
          .insert({
            name: `${consultType}_monthly_${Date.now()}.pdf`,
            file_path: path,
            file_size: pdfRes.buf.length,
            mime_type: "application/pdf",
            source: "supabase",
            organization_id: row.organization_id,
            project_id: proj.id,
            client_id: row.client_id,
            document_type: consultType,
          })
          .select("id")
          .single();
        documentId = doc?.id ?? null;
      }

      await admin.from("moffin_consults").insert({
        organization_id: row.organization_id,
        project_id: proj.id,
        client_id: row.client_id,
        rfc,
        consult_type: consultType,
        moffin_service: serviceName,
        status: documentId ? "success" : "error",
        error_message: documentId ? null : `Storage: ${upErr?.message ?? "fail"}`.slice(0, 500),
        summary: documentId
          ? `Descarga mensual SATgo · PDF (${pdfRes.buf.length} bytes)`
          : "Descarga mensual SATgo · error PDF",
        raw_response: { provider: "satgo", kind, pdfBytes: pdfRes.buf.length, _auto: true },
        document_id: documentId,
        requested_by: null,
      });
      results.push({
        clientId: row.client_id,
        consultType,
        status: documentId ? "success" : "error",
        documentId,
      });
      done += 1;
    }
  }

  return json({
    source: "cron-monthly",
    provider: "satgo",
    triggered: done,
    clientsWithCiec: ciecRows?.length ?? 0,
    results,
  });
});
