/**
 * SATgo — 69-B (Efos), CSF, opinión 32D y buzón tributario.
 * Preferencia CSF/32D: e.firma JWE (POST csffiel/ocfiel) → fallback CIEC (GET csf/oc).
 * Buzón: POST comunicadosfiel / notificacionesfiel (solo e.firma JWE).
 * 69-B: GET /api/v2/Efos/rfc/{rfc} (solo Bearer + RFC; 404 = no aparece en lista).
 *
 * Secrets: SATGO_API_KEY (o SATGO_ACCESS_TOKEN), MOFFIN_FIEL_SECRET (≥32) para
 * desencriptar .cer en reposo; CIEC opcional como respaldo (CSF/32D).
 * Docs: https://sat-go.com/cifrar-efirma · https://api.sat-go.com/scalar/v2
 */
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { decryptFielSecret } from "../_shared/moffinFielCrypto.ts";
import { base64FileToBytes } from "../_shared/satgoFielJwe.ts";
import {
  fetchSatgoBuzonWithFielJwe,
  fetchSatgoPdfWithFielJwe,
} from "../_shared/satgoFielClient.ts";

const corsHeaders: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-cron-secret, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

type ConsultType =
  | "lista_69b"
  | "constancia_situacion_fiscal"
  | "opinion_cumplimiento"
  | "buzon_comunicados"
  | "buzon_notificaciones";

function isBuzonConsult(t: ConsultType): boolean {
  return t === "buzon_comunicados" || t === "buzon_notificaciones";
}

function summarizeComunicados(json: Record<string, unknown>): string {
  const total =
    typeof json.totalComunicados === "number"
      ? json.totalComunicados
      : Array.isArray(json.comunicados)
        ? json.comunicados.length
        : 0;
  const list = Array.isArray(json.comunicados) ? json.comunicados : [];
  const unread = list.filter((c) => {
    if (!c || typeof c !== "object") return false;
    return (c as Record<string, unknown>).esLeido === false;
  }).length;
  const titles = list
    .slice(0, 3)
    .map((c) => {
      if (!c || typeof c !== "object") return null;
      const t = (c as Record<string, unknown>).titulo;
      return typeof t === "string" ? t.trim() : null;
    })
    .filter(Boolean) as string[];
  const head = `Buzón comunicados (SATgo): ${total} comunicado(s)${
    unread ? ` · ${unread} sin leer` : ""
  }`;
  return titles.length ? `${head}. ${titles.join(" · ")}` : head;
}

function summarizeNotificaciones(payload: {
  pendientes: Record<string, unknown> | null;
  notificadas: Record<string, unknown> | null;
}): string {
  const count = (j: Record<string, unknown> | null) => {
    if (!j) return 0;
    if (typeof j.totalRegistros === "number") return j.totalRegistros;
    return Array.isArray(j.notificaciones) ? j.notificaciones.length : 0;
  };
  const nPend = count(payload.pendientes);
  const nNotif = count(payload.notificadas);
  const sample = (j: Record<string, unknown> | null) => {
    const list = Array.isArray(j?.notificaciones) ? j!.notificaciones : [];
    return list
      .slice(0, 2)
      .map((n) => {
        if (!n || typeof n !== "object") return null;
        const o = n as Record<string, unknown>;
        const acto = typeof o.acto === "string" ? o.acto.trim() : "";
        const folio = typeof o.folio === "string" ? o.folio.trim() : "";
        return acto || folio || null;
      })
      .filter(Boolean) as string[];
  };
  const titles = [...sample(payload.pendientes), ...sample(payload.notificadas)].slice(0, 3);
  const head = `Buzón notificaciones (SATgo): ${nPend} pendiente(s) · ${nNotif} notificada(s)`;
  return titles.length ? `${head}. ${titles.join(" · ")}` : head;
}

/** Evita guardar blobs enormes si SATgo embebe PDFs en base64. */
function sanitizeBuzonJson(json: Record<string, unknown>): Record<string, unknown> {
  const clone = JSON.parse(JSON.stringify(json)) as Record<string, unknown>;
  const stripHeavy = (arrKey: string) => {
    const arr = clone[arrKey];
    if (!Array.isArray(arr)) return;
    clone[arrKey] = arr.map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return item;
      const o = { ...(item as Record<string, unknown>) };
      for (const k of Object.keys(o)) {
        const v = o[k];
        if (typeof v === "string" && v.length > 2000) {
          o[k] = `[omitido ${v.length} chars]`;
        } else if (v && typeof v === "object" && !Array.isArray(v)) {
          const nested = { ...(v as Record<string, unknown>) };
          for (const nk of Object.keys(nested)) {
            const nv = nested[nk];
            if (typeof nv === "string" && nv.length > 2000) {
              nested[nk] = `[omitido ${nv.length} chars]`;
            }
          }
          o[k] = nested;
        }
      }
      return o;
    });
  };
  stripHeavy("comunicados");
  stripHeavy("notificaciones");
  return clone;
}

type BuzonStoredPdf = {
  documentId: string;
  filePath: string;
  fileName: string;
  kind: string;
  folioOrId?: string | null;
};

function decodePossiblyBase64Pdf(raw: unknown): Uint8Array | null {
  if (typeof raw !== "string" || !raw.trim()) return null;
  let s = raw.trim();
  const dataUri = /^data:application\/pdf;base64,/i.exec(s);
  if (dataUri) s = s.slice(dataUri[0].length);
  // Quitar whitespace/newlines comunes en base64
  s = s.replace(/\s/g, "");
  try {
    const bytes = base64ToBytes(s);
    const head = new TextDecoder().decode(bytes.slice(0, 5));
    if (bytes.length >= 5 && head.startsWith("%PDF")) return bytes;
  } catch {
    /* ignore */
  }
  return null;
}

function pickPdfBytesFromObj(o: Record<string, unknown>): {
  bytes: Uint8Array | null;
  fileName: string | null;
} {
  const fileName =
    (typeof o.pdfFileName === "string" && o.pdfFileName.trim()) ||
    (typeof o.fileName === "string" && o.fileName.trim()) ||
    null;
  const candidates = [o.pdfContent, o.fileContent, o.content, o.pdfBase64, o.archivo];
  for (const c of candidates) {
    const bytes = decodePossiblyBase64Pdf(c);
    if (bytes) return { bytes, fileName };
  }
  return { bytes: null, fileName };
}

async function uploadBuzonPdf(opts: {
  admin: ReturnType<typeof createClient>;
  orgId: string;
  clientId: string;
  projectId: string;
  userId: string | null;
  consultType: string;
  fileBase: string;
  displayName: string;
  buf: Uint8Array;
}): Promise<BuzonStoredPdf | null> {
  const path = storagePath(opts.orgId, opts.clientId, opts.fileBase);
  const { error: upErr } = await opts.admin.storage.from("documents").upload(path, opts.buf, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (upErr) {
    console.error("[satgo-query] buzon pdf upload", upErr.message);
    return null;
  }
  const { data: doc, error: docErr } = await opts.admin
    .from("documents")
    .insert({
      name: opts.displayName,
      file_path: path,
      file_size: opts.buf.length,
      mime_type: "application/pdf",
      source: "supabase",
      organization_id: opts.orgId,
      project_id: opts.projectId,
      client_id: opts.clientId,
      document_type: opts.consultType,
      uploaded_by: opts.userId,
    })
    .select("id")
    .single();
  if (docErr || !doc) {
    console.error("[satgo-query] buzon pdf document insert", docErr?.message);
    return null;
  }
  return {
    documentId: doc.id,
    filePath: path,
    fileName: opts.displayName,
    kind: opts.consultType,
  };
}

/**
 * Extrae PDFs embebidos en comunicados/notificaciones, los sube a storage
 * y deja referencias en el JSON (sin base64).
 */
async function persistBuzonPdfs(opts: {
  admin: ReturnType<typeof createClient>;
  orgId: string;
  clientId: string;
  projectId: string;
  userId: string | null;
  consultType: "buzon_comunicados" | "buzon_notificaciones";
  json: Record<string, unknown>;
}): Promise<{ json: Record<string, unknown>; pdfs: BuzonStoredPdf[]; primaryDocumentId: string | null }> {
  const clone = JSON.parse(JSON.stringify(opts.json)) as Record<string, unknown>;
  const pdfs: BuzonStoredPdf[] = [];

  const saveOne = async (
    item: Record<string, unknown>,
    kindLabel: string,
    idHint: string,
  ) => {
    const { bytes, fileName } = pickPdfBytesFromObj(item);
    // Limpiar blobs siempre
    for (const k of ["pdfContent", "fileContent", "content", "pdfBase64", "archivo"]) {
      if (typeof item[k] === "string" && (item[k] as string).length > 200) {
        item[k] = `[omitido ${(item[k] as string).length} chars]`;
      }
    }
    if (!bytes) return;
    const display =
      (fileName && fileName.endsWith(".pdf") ? fileName : null) ||
      `${kindLabel}_${idHint || Date.now()}.pdf`;
    const stored = await uploadBuzonPdf({
      admin: opts.admin,
      orgId: opts.orgId,
      clientId: opts.clientId,
      projectId: opts.projectId,
      userId: opts.userId,
      consultType: opts.consultType,
      fileBase: `${kindLabel}_${idHint || "doc"}`,
      displayName: display.slice(0, 120),
      buf: bytes,
    });
    if (stored) {
      item.kawiilDocumentId = stored.documentId;
      item.kawiilFilePath = stored.filePath;
      item.kawiilFileName = stored.fileName;
      item.pdfDescargado = true;
      pdfs.push({ ...stored, folioOrId: idHint || null });
    }
  };

  const listKey =
    opts.consultType === "buzon_comunicados" ? "comunicados" : "notificaciones";
  const list = Array.isArray(clone[listKey]) ? (clone[listKey] as unknown[]) : [];
  for (let i = 0; i < list.length; i++) {
    const item = list[i];
    if (!item || typeof item !== "object" || Array.isArray(item)) continue;
    const o = item as Record<string, unknown>;
    const idHint = String(
      o.folio ?? o.id ?? o.titulo ?? o.acto ?? i,
    ).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 40);
    await saveOne(o, listKey === "comunicados" ? "comunicado" : "notif", idHint);

    // Nested PDFs en notificaciones (acto administrativo / acuse)
    for (const nestedKey of ["actoAdministrativoRow", "acuseRow"]) {
      const nested = o[nestedKey];
      if (!nested || typeof nested !== "object" || Array.isArray(nested)) continue;
      const n = nested as Record<string, unknown>;
      await saveOne(n, nestedKey.replace(/Row$/, ""), `${idHint}_${nestedKey}`);
    }
  }
  clone[listKey] = list;

  return {
    json: sanitizeBuzonJson(clone),
    pdfs,
    primaryDocumentId: pdfs[0]?.documentId ?? null,
  };
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function satgoBaseUrl(): string {
  return (Deno.env.get("SATGO_BASE_URL") ?? "https://api.sat-go.com").replace(/\/$/, "");
}

function normalizeRfc(raw: string | null | undefined): string {
  return (raw ?? "").trim().toUpperCase().replace(/\s/g, "");
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

async function resolveSatgoBearer(
  admin: ReturnType<typeof createClient>,
): Promise<{ ok: true; bearer: string } | { ok: false; message: string; code: string }> {
  let apiKey = Deno.env.get("SATGO_API_KEY")?.trim() ?? "";
  let access = Deno.env.get("SATGO_ACCESS_TOKEN")?.trim() ?? "";

  if (!apiKey && !access) {
    try {
      const { data: vaultKey } = await admin.rpc("kawiil_vault_secret", {
        secret_name: "satgo_api_key",
      });
      if (typeof vaultKey === "string" && vaultKey.trim()) apiKey = vaultKey.trim();
    } catch {
      /* ignore */
    }
    if (!apiKey) {
      try {
        const { data: vaultTok } = await admin.rpc("kawiil_vault_secret", {
          secret_name: "satgo_access_token",
        });
        if (typeof vaultTok === "string" && vaultTok.trim()) access = vaultTok.trim();
      } catch {
        /* ignore */
      }
    }
  }

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
    message:
      "Configura SATGO_API_KEY en Edge Secrets o vault.create_secret(..., 'satgo_api_key').",
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

async function fetchSatgoPdfCiec(opts: {
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

  const fielSecret = Deno.env.get("MOFFIN_FIEL_SECRET")?.trim() ?? "";
  const ciecSecret =
    Deno.env.get("MOFFIN_SAT_CIEC_SECRET")?.trim() || fielSecret || "";

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  const cronSecret = Deno.env.get("CRON_SECRET")?.trim() ?? "";
  const incomingCron = req.headers.get("x-cron-secret")?.trim() ?? "";
  const cronOk = !!(cronSecret && incomingCron && cronSecret === incomingCron);

  let userId: string | null = null;
  let orgId: string | null = null;

  if (!cronOk) {
    const rawAuth = req.headers.get("Authorization") ?? req.headers.get("authorization") ?? "";
    const accessToken = rawAuth.match(/^Bearer\s+(\S+)/i)?.[1];
    if (!accessToken) return json({ error: "No autorizado" }, 401);

    const userClient = createClient(supabaseUrl, anon, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
    const { data: userData, error: authErr } = await userClient.auth.getUser(accessToken);
    const user = userData?.user;
    if (authErr || !user) return json({ error: "No autorizado" }, 401);
    userId = user.id;

    const { data: profile } = await userClient
      .from("profiles")
      .select("organization_id")
      .eq("user_id", user.id)
      .single();
    if (!profile?.organization_id) return json({ error: "Perfil no encontrado" }, 403);
    orgId = profile.organization_id;
  }

  let body: { projectId?: string; consultType?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: "JSON inválido" }, 400);
  }

  const projectId = body.projectId?.trim() ?? "";
  const consultType = body.consultType as ConsultType | undefined;
  const allowed: ConsultType[] = [
    "lista_69b",
    "constancia_situacion_fiscal",
    "opinion_cumplimiento",
    "buzon_comunicados",
    "buzon_notificaciones",
  ];
  if (!projectId || !consultType || !allowed.includes(consultType)) {
    return json(
      {
        error:
          "projectId y consultType (lista_69b|constancia_situacion_fiscal|opinion_cumplimiento|buzon_comunicados|buzon_notificaciones) requeridos",
      },
      400,
    );
  }

  const { data: project, error: projErr } = await admin
    .from("projects")
    .select("id, organization_id, client_id, clients(rfc)")
    .eq("id", projectId)
    .single();
  if (projErr || !project) {
    return json({ error: "Proyecto no encontrado" }, 404);
  }
  if (!cronOk && project.organization_id !== orgId) {
    return json({ error: "Proyecto no encontrado" }, 404);
  }
  if (!project.client_id) {
    return json({ error: "client_required", message: "El proyecto debe tener cliente." }, 400);
  }

  const { data: fielRow } = await admin
    .from("client_sat_certificates")
    .select(
      "cert_ciphertext, satgo_key_jwe, satgo_password_jwe, cert_subject_rfc",
    )
    .eq("client_id", project.client_id)
    .eq("cert_type", "fiel")
    .maybeSingle();

  let rfcRaw = normalizeRfc(
    (project.clients as { rfc: string | null } | null)?.rfc,
  );
  if (!rfcRaw) {
    rfcRaw = normalizeRfc(fielRow?.cert_subject_rfc);
  }
  if (!rfcRaw) {
    return json(
      {
        error: "rfc_required",
        message:
          "El cliente no tiene RFC. Agrégalo en la ficha o sube la e.firma (.cer) para tomarlo del certificado.",
      },
      400,
    );
  }

  // Si la ficha no tenía RFC pero el .cer sí, sincronizar a clients.rfc
  const clientRfcOnFile = normalizeRfc(
    (project.clients as { rfc: string | null } | null)?.rfc,
  );
  if (!clientRfcOnFile && rfcRaw) {
    await admin.from("clients").update({ rfc: rfcRaw }).eq("id", project.client_id);
  }

  const satAuth = await resolveSatgoBearer(admin);
  if (!satAuth.ok) return json({ error: satAuth.code, message: satAuth.message }, 503);

  // ---- 69-B vía SATgo Efos (solo Bearer + RFC; no requiere FIEL) ----
  if (consultType === "lista_69b") {
    const url = `${satgoBaseUrl()}/api/v2/Efos/rfc/${encodeURIComponent(rfcRaw)}`;
    let httpStatus = 0;
    let bodyText = "";
    try {
      const res = await fetch(url, {
        method: "GET",
        headers: {
          Authorization: `Bearer ${satAuth.bearer}`,
          Accept: "application/json",
        },
      });
      httpStatus = res.status;
      bodyText = await res.text();
    } catch (e) {
      return json(
        {
          error: "satgo_api_error",
          message: e instanceof Error ? e.message : String(e),
        },
        502,
      );
    }

    let parsed: unknown = null;
    try {
      parsed = bodyText ? JSON.parse(bodyText) : null;
    } catch {
      parsed = bodyText;
    }

    // 404 "RFC No encontrado" = limpio (no está en 69-B)
    const notOnList =
      httpStatus === 404 ||
      (typeof parsed === "string" && /no encontrado/i.test(parsed));
    const onList = httpStatus === 200 && Array.isArray(parsed);

    if (!notOnList && !onList) {
      const { data: rowErr } = await admin
        .from("moffin_consults")
        .insert({
          organization_id: project.organization_id,
          project_id: projectId,
          client_id: project.client_id,
          rfc: rfcRaw,
          consult_type: consultType,
          moffin_service: "satgo-efos",
          status: "error",
          error_message: `Origen: SATgo Efos. HTTP ${httpStatus}: ${bodyText.slice(0, 300)}`.slice(
            0,
            500,
          ),
          raw_response: {
            provider: "satgo",
            kind: "efos",
            httpStatus,
            body: typeof parsed === "string" ? parsed.slice(0, 500) : parsed,
          },
          requested_by: userId,
        })
        .select("id")
        .single();
      return json(
        {
          error: "satgo_api_error",
          message: bodyText.slice(0, 300) || `SATgo Efos HTTP ${httpStatus}`,
          statusCode: httpStatus,
          consultId: rowErr?.id,
          provider: "satgo",
        },
        422,
      );
    }

    const hits = onList ? (parsed as unknown[]) : [];
    const summary = notOnList
      ? `69-B (SATgo): RFC ${rfcRaw} no aparece en la lista negra.`
      : `69-B (SATgo): RFC ${rfcRaw} aparece en la lista (${hits.length} registro(s)).`;

    const { data: inserted, error: insErr } = await admin
      .from("moffin_consults")
      .insert({
        organization_id: project.organization_id,
        project_id: projectId,
        client_id: project.client_id,
        rfc: rfcRaw,
        consult_type: consultType,
        moffin_service: "satgo-efos",
        status: "success",
        summary,
        raw_response: {
          provider: "satgo",
          kind: "efos",
          onList: !notOnList,
          hits,
          httpStatus,
        },
        requested_by: userId,
      })
      .select("id, status, summary, document_id, created_at")
      .single();

    if (insErr) return json({ error: insErr.message }, 500);
    return json({
      consult: inserted,
      provider: "satgo",
      authMode: "efos",
      onList: !notOnList,
    });
  }

  // ---- FIEL JWE / CIEC (CSF, 32D, buzón) ----
  const hasFielJwe = !!(
    fielRow?.satgo_key_jwe?.trim() &&
    fielRow?.satgo_password_jwe?.trim() &&
    fielRow?.cert_ciphertext
  );

  // Buzón tributario exige e.firma JWE (comunicadosfiel / notificacionesfiel).
  if (isBuzonConsult(consultType)) {
    if (!hasFielJwe) {
      return json(
        {
          error: "sat_credentials_required",
          message:
            "El buzón tributario requiere e.firma (.cer/.key + contraseña) guardada como JWE en la ficha del cliente.",
        },
        400,
      );
    }
    if (fielSecret.length < 32) {
      return json(
        {
          error: "fiel_not_configured",
          message: "MOFFIN_FIEL_SECRET (≥32) requerido para leer el .cer en reposo.",
        },
        503,
      );
    }

    let certBytes: Uint8Array;
    try {
      const certB64 = await decryptFielSecret(fielRow!.cert_ciphertext, fielSecret);
      certBytes = base64FileToBytes(certB64);
    } catch (e) {
      return json(
        {
          error: "fiel_decrypt_failed",
          message: e instanceof Error ? e.message : String(e),
        },
        500,
      );
    }

    const keyJwe = fielRow!.satgo_key_jwe!.trim();
    const passwordJwe = fielRow!.satgo_password_jwe!.trim();
    const fielOpts = {
      bearer: satAuth.bearer,
      rfc: rfcRaw,
      certBytes,
      keyJwe,
      passwordJwe,
    };

    if (consultType === "buzon_comunicados") {
      const res = await fetchSatgoBuzonWithFielJwe({
        ...fielOpts,
        kind: "comunicados",
        descargar: true,
      });
      if (!res.ok) {
        const { data: rowErr } = await admin
          .from("moffin_consults")
          .insert({
            organization_id: project.organization_id,
            project_id: projectId,
            client_id: project.client_id,
            rfc: rfcRaw,
            consult_type: consultType,
            moffin_service: "satgo-comunicadosfiel",
            status: "error",
            error_message: `Origen: SATgo (fiel_jwe). ${res.message}`.slice(0, 500),
            raw_response: {
              provider: "satgo",
              kind: "comunicados",
              authMode: "fiel_jwe",
              httpStatus: res.httpStatus,
              message: res.message,
            },
            requested_by: userId,
          })
          .select("id")
          .single();
        return json(
          {
            error: "satgo_api_error",
            message: res.message,
            statusCode: res.httpStatus,
            consultId: rowErr?.id,
            provider: "satgo",
            authMode: "fiel_jwe",
          },
          422,
        );
      }
      const persisted = await persistBuzonPdfs({
        admin,
        orgId: project.organization_id,
        clientId: project.client_id,
        projectId,
        userId,
        consultType: "buzon_comunicados",
        json: res.json,
      });
      const summary = summarizeComunicados(persisted.json);
      const withPdfNote =
        persisted.pdfs.length > 0
          ? `${summary} · ${persisted.pdfs.length} PDF(s) guardado(s)`
          : summary;
      const { data: inserted, error: insErr } = await admin
        .from("moffin_consults")
        .insert({
          organization_id: project.organization_id,
          project_id: projectId,
          client_id: project.client_id,
          rfc: rfcRaw,
          consult_type: consultType,
          moffin_service: "satgo-comunicadosfiel",
          status: "success",
          summary: withPdfNote,
          document_id: persisted.primaryDocumentId,
          raw_response: {
            provider: "satgo",
            kind: "comunicados",
            authMode: "fiel_jwe",
            result: persisted.json,
            pdfs: persisted.pdfs,
          },
          requested_by: userId,
        })
        .select("id, status, summary, document_id, created_at")
        .single();
      if (insErr) return json({ error: insErr.message }, 500);
      return json({
        consult: inserted,
        provider: "satgo",
        authMode: "fiel_jwe",
        pdfCount: persisted.pdfs.length,
      });
    }

    // buzon_notificaciones: pendientes + notificadas con PDFs (reusa requestId)
    const pendRes = await fetchSatgoBuzonWithFielJwe({
      ...fielOpts,
      kind: "notificaciones",
      tipoNotificacion: "pendientes",
      descargarNotificaciones: true,
    });
    if (!pendRes.ok) {
      const { data: rowErr } = await admin
        .from("moffin_consults")
        .insert({
          organization_id: project.organization_id,
          project_id: projectId,
          client_id: project.client_id,
          rfc: rfcRaw,
          consult_type: consultType,
          moffin_service: "satgo-notificacionesfiel",
          status: "error",
          error_message: `Origen: SATgo (fiel_jwe). ${pendRes.message}`.slice(0, 500),
          raw_response: {
            provider: "satgo",
            kind: "notificaciones",
            authMode: "fiel_jwe",
            httpStatus: pendRes.httpStatus,
            message: pendRes.message,
          },
          requested_by: userId,
        })
        .select("id")
        .single();
      return json(
        {
          error: "satgo_api_error",
          message: pendRes.message,
          statusCode: pendRes.httpStatus,
          consultId: rowErr?.id,
          provider: "satgo",
          authMode: "fiel_jwe",
        },
        422,
      );
    }

    let notifRes = await fetchSatgoBuzonWithFielJwe({
      ...fielOpts,
      kind: "notificaciones",
      tipoNotificacion: "notificadas",
      descargarNotificaciones: true,
      requestId: pendRes.requestId,
    });
    // Si el requestId expiró, reintentar sin él
    if (!notifRes.ok && notifRes.httpStatus === 404) {
      notifRes = await fetchSatgoBuzonWithFielJwe({
        ...fielOpts,
        kind: "notificaciones",
        tipoNotificacion: "notificadas",
        descargarNotificaciones: true,
      });
    }

    const pendPersisted = await persistBuzonPdfs({
      admin,
      orgId: project.organization_id,
      clientId: project.client_id,
      projectId,
      userId,
      consultType: "buzon_notificaciones",
      json: pendRes.json,
    });
    const notifPersisted = notifRes.ok
      ? await persistBuzonPdfs({
          admin,
          orgId: project.organization_id,
          clientId: project.client_id,
          projectId,
          userId,
          consultType: "buzon_notificaciones",
          json: notifRes.json,
        })
      : null;

    const allPdfs = [
      ...pendPersisted.pdfs,
      ...(notifPersisted?.pdfs ?? []),
    ];
    const summaryBase = summarizeNotificaciones({
      pendientes: pendPersisted.json,
      notificadas: notifPersisted?.json ?? null,
    });
    const summary =
      allPdfs.length > 0
        ? `${summaryBase} · ${allPdfs.length} PDF(s) guardado(s)`
        : summaryBase;

    const { data: inserted, error: insErr } = await admin
      .from("moffin_consults")
      .insert({
        organization_id: project.organization_id,
        project_id: projectId,
        client_id: project.client_id,
        rfc: rfcRaw,
        consult_type: consultType,
        moffin_service: "satgo-notificacionesfiel",
        status: "success",
        summary,
        document_id: allPdfs[0]?.documentId ?? null,
        raw_response: {
          provider: "satgo",
          kind: "notificaciones",
          authMode: "fiel_jwe",
          pendientes: pendPersisted.json,
          notificadas: notifPersisted?.json ?? null,
          pdfs: allPdfs,
          notificadasError: notifRes.ok
            ? null
            : { httpStatus: notifRes.httpStatus, message: notifRes.message },
        },
        requested_by: userId,
      })
      .select("id, status, summary, document_id, created_at")
      .single();
    if (insErr) return json({ error: insErr.message }, 500);
    return json({
      consult: inserted,
      provider: "satgo",
      authMode: "fiel_jwe",
      pdfCount: allPdfs.length,
    });
  }

  let authMode: "fiel_jwe" | "ciec" | null = hasFielJwe ? "fiel_jwe" : null;
  let ciecPlain: string | null = null;

  if (!hasFielJwe) {
    const { data: ciecRow } = await admin
      .from("moffin_client_sat_ciec")
      .select("ciec_ciphertext")
      .eq("client_id", project.client_id)
      .maybeSingle();
    if (ciecRow?.ciec_ciphertext) {
      if (ciecSecret.length < 32) {
        return json(
          {
            error: "ciec_not_configured",
            message: "MOFFIN_SAT_CIEC_SECRET o MOFFIN_FIEL_SECRET (≥32) requerido.",
          },
          503,
        );
      }
      try {
        ciecPlain = await decryptCiec(ciecRow.ciec_ciphertext, ciecSecret);
        authMode = "ciec";
      } catch (e) {
        return json(
          { error: "ciec_decrypt_failed", message: e instanceof Error ? e.message : String(e) },
          500,
        );
      }
    }
  }

  if (!authMode) {
    return json(
      {
        error: "sat_credentials_required",
        message:
          "Sube la e.firma (.cer/.key + contraseña) en la ficha del cliente (se guarda como JWE para SATgo), o registra la CIEC como respaldo.",
      },
      400,
    );
  }

  if (authMode === "fiel_jwe" && fielSecret.length < 32) {
    return json(
      {
        error: "fiel_not_configured",
        message: "MOFFIN_FIEL_SECRET (≥32) requerido para leer el .cer en reposo.",
      },
      503,
    );
  }

  const kind = consultType === "constancia_situacion_fiscal" ? "csf" : "oc";
  const serviceName =
    authMode === "fiel_jwe"
      ? kind === "csf"
        ? "satgo-csffiel"
        : "satgo-ocfiel"
      : kind === "csf"
        ? "satgo-csf"
        : "satgo-oc";

  let pdfRes:
    | { ok: true; buf: Uint8Array }
    | { ok: false; message: string; httpStatus: number };

  if (authMode === "fiel_jwe") {
    let certB64: string;
    try {
      certB64 = await decryptFielSecret(fielRow!.cert_ciphertext, fielSecret);
    } catch (e) {
      return json(
        {
          error: "fiel_decrypt_failed",
          message: e instanceof Error ? e.message : String(e),
        },
        500,
      );
    }
    pdfRes = await fetchSatgoPdfWithFielJwe({
      bearer: satAuth.bearer,
      rfc: rfcRaw,
      kind,
      certBytes: base64FileToBytes(certB64),
      keyJwe: fielRow!.satgo_key_jwe!.trim(),
      passwordJwe: fielRow!.satgo_password_jwe!.trim(),
    });
  } else {
    pdfRes = await fetchSatgoPdfCiec({
      bearer: satAuth.bearer,
      rfc: rfcRaw,
      ciec: ciecPlain!,
      kind,
    });
  }

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
        error_message: `Origen: SATgo (${authMode}). ${pdfRes.message}`.slice(0, 500),
        raw_response: {
          provider: "satgo",
          kind,
          authMode,
          httpStatus: pdfRes.httpStatus,
          message: pdfRes.message,
        },
        requested_by: userId,
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
        authMode,
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
      uploaded_by: userId,
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
      summary: `${label} · PDF listo (${pdfRes.buf.length} bytes · ${authMode})`,
      raw_response: {
        provider: "satgo",
        kind,
        authMode,
        pdfBytes: pdfRes.buf.length,
      },
      document_id: doc.id,
      requested_by: userId,
    })
    .select("id, status, summary, document_id, created_at")
    .single();

  if (insErr) return json({ error: insErr.message }, 500);

  return json({ consult: inserted, provider: "satgo", authMode });
});
