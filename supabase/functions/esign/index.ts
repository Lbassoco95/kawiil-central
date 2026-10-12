/**
 * Firma electrónica SIMPLE interna (cartas, instrucciones a agentes aduanales,
 * documentos internos). No sustituye WeTrust/PSC para contratos.
 *
 * Acciones con sesión (JWT): create | cancel | remind | download
 * Acciones por token de firmante: get | sign | decline
 *   - Firmante externo: basta el token del link (/firmar/:token).
 *   - Firmante interno (user_id): además exige sesión del mismo usuario.
 *
 * Secrets: SUPABASE_URL/ANON/SERVICE_ROLE, AZURE_*|MICROSOFT_* (Graph app-only),
 * SENDER_EMAIL, SITE_URL|PUBLIC_APP_URL.
 * Deploy: verify_jwt = false (config.toml); la auth se valida dentro.
 */
import { createClient, type SupabaseClient } from "npm:@supabase/supabase-js@2";
import { PDFDocument, rgb, StandardFonts, type PDFFont } from "npm:pdf-lib@1.17.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BUCKET = "esign";
const MAX_PDF_BYTES = 15 * 1024 * 1024;
const MAX_SIGNATURE_BYTES = 600 * 1024;
const MAX_MAIL_ATTACHMENT_BYTES = 3 * 1024 * 1024;
const SIMPLE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_FILE_HOSTS = [/(^|\.)dropbox\.com$/i, /(^|\.)dropboxusercontent\.com$/i, /(^|\.)supabase\.co$/i];

class HttpError extends Error {
  constructor(public status: number, message: string, public code?: string) {
    super(message);
  }
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  const d = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(d)).map((b) => b.toString(16).padStart(2, "0")).join("");
}

function b64ToBytes(b64: string): Uint8Array {
  const clean = b64.includes(",") ? b64.split(",")[1] : b64;
  const bin = atob(clean);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bytesToB64(bytes: Uint8Array): string {
  let s = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    s += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(s);
}

const isPdf = (b: Uint8Array) =>
  b.length > 4 && b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46;
const isPng = (b: Uint8Array) =>
  b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47;

function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function fmtMx(iso: string): string {
  return new Date(iso).toLocaleString("es-MX", {
    timeZone: "America/Mexico_City",
    dateStyle: "medium",
    timeStyle: "short",
  }) + " (CDMX)";
}

// ---------- Correo (Graph app-only, mismo patrón que send-pipeline-email) ----------
async function graphToken(): Promise<string> {
  const tenant = Deno.env.get("AZURE_TENANT_ID") || Deno.env.get("MICROSOFT_TENANT_ID");
  const clientId = Deno.env.get("AZURE_CLIENT_ID") || Deno.env.get("MICROSOFT_CLIENT_ID");
  const secret = Deno.env.get("AZURE_CLIENT_SECRET") || Deno.env.get("MICROSOFT_CLIENT_SECRET");
  if (!tenant || !clientId || !secret) throw new Error("Faltan AZURE_* o MICROSOFT_* para enviar correo");
  const res = await fetch(`https://login.microsoftonline.com/${tenant}/oauth2/v2.0/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: secret,
      scope: "https://graph.microsoft.com/.default",
      grant_type: "client_credentials",
    }),
  });
  const j = await res.json();
  if (!res.ok) throw new Error(`Token Graph: ${JSON.stringify(j).slice(0, 300)}`);
  return j.access_token as string;
}

async function sendMail(opts: {
  to: string;
  subject: string;
  html: string;
  attachment?: { name: string; bytes: Uint8Array };
}) {
  const sender = Deno.env.get("SENDER_EMAIL") || "comercial@kawiil.mx";
  const token = await graphToken();
  const message: Record<string, unknown> = {
    subject: opts.subject,
    body: { contentType: "HTML", content: opts.html },
    toRecipients: [{ emailAddress: { address: opts.to } }],
  };
  if (opts.attachment) {
    message.attachments = [{
      "@odata.type": "#microsoft.graph.fileAttachment",
      name: opts.attachment.name,
      contentType: "application/pdf",
      contentBytes: bytesToB64(opts.attachment.bytes),
    }];
  }
  const res = await fetch(`https://graph.microsoft.com/v1.0/users/${encodeURIComponent(sender)}/sendMail`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ message, saveToSentItems: true }),
  });
  if (!res.ok) throw new Error(`Graph sendMail: ${(await res.text()).slice(0, 300)}`);
}

function emailHtml(o: { heading: string; intro: string; button?: { label: string; url: string }; note?: string }) {
  return `<!doctype html><html><body style="margin:0;background:#f5f5f4;font-family:Arial,Helvetica,sans-serif;color:#1c1917">
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:24px">
<table width="560" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:12px;padding:32px">
<tr><td>
<h2 style="margin:0 0 12px;font-size:20px">${esc(o.heading)}</h2>
<p style="margin:0 0 20px;font-size:14px;line-height:1.6;white-space:pre-line">${esc(o.intro)}</p>
${o.button ? `<p style="margin:0 0 20px"><a href="${esc(o.button.url)}" style="background:#0f766e;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-size:14px;display:inline-block">${esc(o.button.label)}</a></p>
<p style="margin:0 0 16px;font-size:12px;color:#78716c">Si el botón no funciona, copia este enlace:<br>${esc(o.button.url)}</p>` : ""}
${o.note ? `<p style="margin:0;font-size:12px;color:#78716c">${esc(o.note)}</p>` : ""}
</td></tr></table>
<p style="font-size:11px;color:#a8a29e;margin-top:12px">Kawiil · Firma electrónica simple</p>
</td></tr></table></body></html>`;
}

function siteBase(): string {
  const b = (Deno.env.get("SITE_URL") || Deno.env.get("PUBLIC_APP_URL") || "").replace(/\/$/, "");
  if (!b) throw new Error("SITE_URL no configurada en Edge Functions (Secrets)");
  return b;
}

// ---------- Contexto ----------
type Svc = SupabaseClient;

async function requireUser(req: Request, svc: Svc, url: string, anon: string) {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader) throw new HttpError(401, "Sesión requerida", "login_required");
  const userClient = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
  const { data, error } = await userClient.auth.getUser();
  if (error || !data.user) throw new HttpError(401, "Sesión inválida", "login_required");
  const { data: prof } = await svc
    .from("profiles")
    .select("organization_id, full_name, email")
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (!prof) throw new HttpError(403, "Perfil no encontrado");
  return { user: data.user, orgId: prof.organization_id as string, fullName: prof.full_name as string, email: prof.email as string };
}

async function optionalUserId(req: Request, url: string, anon: string): Promise<string | null> {
  const authHeader = req.headers.get("Authorization");
  if (!authHeader || authHeader === `Bearer ${anon}`) return null;
  try {
    const c = createClient(url, anon, { global: { headers: { Authorization: authHeader } } });
    const { data } = await c.auth.getUser();
    return data.user?.id ?? null;
  } catch {
    return null;
  }
}

async function signedUrl(svc: Svc, path: string, seconds = 3600): Promise<string | null> {
  const { data } = await svc.storage.from(BUCKET).createSignedUrl(path, seconds);
  return data?.signedUrl ?? null;
}

async function download(svc: Svc, path: string): Promise<Uint8Array> {
  const { data, error } = await svc.storage.from(BUCKET).download(path);
  if (error || !data) throw new Error(`No se pudo leer ${path}: ${error?.message}`);
  return new Uint8Array(await data.arrayBuffer());
}

async function fetchRemotePdf(rawUrl: string): Promise<Uint8Array> {
  let u: URL;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new HttpError(400, "file_url inválida");
  }
  if (u.protocol !== "https:" || !ALLOWED_FILE_HOSTS.some((r) => r.test(u.hostname))) {
    throw new HttpError(400, "Origen de archivo no permitido (solo Dropbox o Supabase)");
  }
  if (/dropbox\.com$/i.test(u.hostname)) {
    u.searchParams.delete("raw");
    u.searchParams.set("dl", "1");
  }
  const r = await fetch(u.toString(), { redirect: "follow" });
  if (!r.ok) throw new HttpError(400, `No se pudo descargar el archivo (${r.status})`);
  const bytes = new Uint8Array(await r.arrayBuffer());
  return bytes;
}

// ---------- PDF: firmas posicionadas + hoja de firmas ----------
/** Recuadro de firma: coordenadas normalizadas 0..1, origen arriba-izquierda, page base 1. */
type SignField = { page: number; x: number; y: number; w: number; h: number };

const MAX_FIELDS_PER_SIGNER = 10;

function parseFields(raw: unknown, pageCount: number): SignField[] {
  if (raw == null) return [];
  if (!Array.isArray(raw) || raw.length > MAX_FIELDS_PER_SIGNER) {
    throw new HttpError(400, `Máximo ${MAX_FIELDS_PER_SIGNER} recuadros de firma por firmante`);
  }
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);
  return raw.map((f) => {
    const page = num((f as SignField)?.page), x = num((f as SignField)?.x), y = num((f as SignField)?.y);
    const w = num((f as SignField)?.w), h = num((f as SignField)?.h);
    if (!Number.isInteger(page) || page < 1 || page > pageCount) throw new HttpError(400, "Recuadro de firma con página inválida");
    if ([x, y, w, h].some((n) => Number.isNaN(n)) || w < 0.03 || h < 0.02 || x < 0 || y < 0 || x + w > 1.0001 || y + h > 1.0001) {
      throw new HttpError(400, "Recuadro de firma fuera de la página");
    }
    return { page, x, y, w, h };
  });
}
function winAnsi(s: string): string {
  // Helvetica estándar solo soporta WinAnsi; reemplaza lo demás.
  return s.replace(/[^ -~ -ÿ]/g, "?");
}

function wrap(text: string, font: PDFFont, size: number, maxW: number): string[] {
  const words = winAnsi(text).split(/\s+/);
  const lines: string[] = [];
  let cur = "";
  for (const w of words) {
    const t = cur ? `${cur} ${w}` : w;
    if (font.widthOfTextAtSize(t, size) > maxW && cur) {
      lines.push(cur);
      cur = w;
    } else cur = t;
  }
  if (cur) lines.push(cur);
  return lines;
}

async function buildSignedPdf(
  original: Uint8Array,
  meta: { title: string; originalSha: string; requestId: string },
  signers: Array<{ name: string; email: string; signed_at: string; ip: string | null; png: Uint8Array; fields?: SignField[] }>,
): Promise<Uint8Array> {
  const pdf = await PDFDocument.load(original, { ignoreEncryption: true });
  // Estampa cada firma en su recuadro (solo páginas sin rotación; la hoja de firmas las cubre todas).
  const originalPages = pdf.getPages();
  for (const s of signers) {
    if (!s.fields?.length) continue;
    const sigImg = await pdf.embedPng(s.png);
    for (const f of s.fields) {
      const pg = originalPages[f.page - 1];
      if (!pg || pg.getRotation().angle % 360 !== 0) continue;
      const { width: PW, height: PH } = pg.getSize();
      const bw = f.w * PW, bh = f.h * PH, bx = f.x * PW, by = PH - f.y * PH - bh;
      const sc = Math.min(bw / sigImg.width, bh / sigImg.height);
      pg.drawImage(sigImg, {
        x: bx + (bw - sigImg.width * sc) / 2,
        y: by + (bh - sigImg.height * sc) / 2,
        width: sigImg.width * sc,
        height: sigImg.height * sc,
      });
    }
  }
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const W = 595, H = 842, M = 48;
  let page = pdf.addPage([W, H]);
  let y = H - M;

  const header = (p: typeof page) => {
    p.drawText("Hoja de firmas electrónicas", { x: M, y: H - M, size: 18, font: bold, color: rgb(0.06, 0.46, 0.43) });
  };
  header(page);
  y -= 28;
  for (const l of wrap(`Documento: ${meta.title}`, font, 11, W - 2 * M)) {
    page.drawText(l, { x: M, y, size: 11, font });
    y -= 15;
  }
  page.drawText(winAnsi(`Folio: ${meta.requestId}`), { x: M, y, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
  y -= 13;
  page.drawText(`SHA-256 del documento original:`, { x: M, y, size: 9, font, color: rgb(0.4, 0.4, 0.4) });
  y -= 12;
  page.drawText(meta.originalSha, { x: M, y, size: 8, font, color: rgb(0.4, 0.4, 0.4) });
  y -= 14;
  page.drawLine({ start: { x: M, y }, end: { x: W - M, y }, thickness: 0.5, color: rgb(0.8, 0.8, 0.8) });
  y -= 20;

  const BLOCK = 120;
  for (const s of signers) {
    if (y - BLOCK < M + 30) {
      page = pdf.addPage([W, H]);
      header(page);
      y = H - M - 40;
    }
    const img = await pdf.embedPng(s.png);
    const boxW = 200, boxH = 80;
    const scale = Math.min(boxW / img.width, boxH / img.height);
    page.drawRectangle({
      x: M, y: y - boxH, width: boxW, height: boxH,
      borderColor: rgb(0.85, 0.85, 0.85), borderWidth: 0.5,
    });
    page.drawImage(img, {
      x: M + (boxW - img.width * scale) / 2,
      y: y - boxH + (boxH - img.height * scale) / 2,
      width: img.width * scale,
      height: img.height * scale,
    });
    const tx = M + boxW + 20;
    page.drawText(winAnsi(s.name), { x: tx, y: y - 14, size: 12, font: bold });
    page.drawText(winAnsi(s.email), { x: tx, y: y - 30, size: 10, font });
    page.drawText(winAnsi(`Firmado: ${fmtMx(s.signed_at)}`), { x: tx, y: y - 46, size: 9, font, color: rgb(0.3, 0.3, 0.3) });
    page.drawText(winAnsi(`IP: ${s.ip ?? "n/d"}`), { x: tx, y: y - 60, size: 9, font, color: rgb(0.3, 0.3, 0.3) });
    y -= BLOCK;
  }

  const foot = wrap(
    "Firma electrónica simple conforme al Código de Comercio. Esta hoja documenta la identidad declarada (correo electrónico), fecha, hora, dirección IP y huella SHA-256 del documento original. No constituye firma electrónica avanzada ni constancia NOM-151.",
    font, 8, W - 2 * M,
  );
  let fy = M + foot.length * 10;
  for (const l of foot) {
    page.drawText(l, { x: M, y: fy, size: 8, font, color: rgb(0.5, 0.5, 0.5) });
    fy -= 10;
  }
  return await pdf.save();
}

// ---------- Lógica ----------

type SignerRow = {
  id: string; request_id: string; organization_id: string; sign_order: number; name: string; email: string;
  user_id: string | null; token: string; status: string; signed_at: string | null; signed_ip: string | null;
  signature_path: string | null;
  fields: SignField[] | null;
};
type RequestRow = {
  id: string; organization_id: string; created_by: string; title: string; message: string | null;
  file_name: string; status: string; sequential: boolean; original_path: string; original_sha256: string;
  signed_path: string | null; expires_at: string;
};

function isExpired(r: RequestRow) {
  return new Date(r.expires_at).getTime() < Date.now();
}

function canSignNow(r: RequestRow, s: SignerRow, all: SignerRow[]): boolean {
  if (r.status !== "pending" || isExpired(r) || s.status !== "pending") return false;
  if (!r.sequential) return true;
  return !all.some((o) => o.status === "pending" && o.sign_order < s.sign_order);
}

/** Notifica (correo + campana) a quienes les toca firmar ahora y aún no se les ha avisado. */
async function notifyTurn(svc: Svc, r: RequestRow, all: SignerRow[], creatorName: string, force = false) {
  const base = siteBase();
  const targets = all.filter((s) => canSignNow(r, s, all) && (force || !s.notified_at));
  for (const s of targets) {
    const url = `${base}/firmar/${s.token}`;
    try {
      await sendMail({
        to: s.email,
        subject: `Documento pendiente de firma: ${r.title}`,
        html: emailHtml({
          heading: "Tienes un documento por firmar",
          intro: `Hola ${s.name},\n\n${creatorName} te envió "${r.title}" para firma electrónica.${r.message ? `\n\n"${r.message}"` : ""}`,
          button: { label: "Revisar y firmar", url },
          note: `El enlace es personal y vence el ${fmtMx(r.expires_at)}. No lo reenvíes.`,
        }),
      });
      await svc.from("esign_signers").update({ notified_at: new Date().toISOString() }).eq("id", s.id);
    } catch (e) {
      console.error("esign notify mail", s.email, e instanceof Error ? e.message : e);
    }
    if (s.user_id) {
      await svc.from("notifications").insert({
        user_id: s.user_id,
        organization_id: r.organization_id,
        type: "esign",
        title: "Documento por firmar",
        body: r.title,
        entity_type: "esign_request",
        entity_id: r.id,
        source_user_id: r.created_by,
      });
    }
  }
}

async function finalizeIfComplete(svc: Svc, r: RequestRow, creator: { email: string | null; name: string }) {
  const { data: signers } = await svc.from("esign_signers").select("*").eq("request_id", r.id).order("sign_order");
  const all = (signers ?? []) as SignerRow[];
  if (!all.length || !all.every((s) => s.status === "signed")) return all;

  const original = await download(svc, r.original_path);
  const parts = [];
  for (const s of all) {
    parts.push({
      name: s.name,
      email: s.email,
      signed_at: s.signed_at!,
      ip: s.signed_ip,
      png: await download(svc, s.signature_path!),
      fields: s.fields ?? [],
    });
  }
  const out = await buildSignedPdf(original, { title: r.title, originalSha: r.original_sha256, requestId: r.id }, parts);
  const signedPath = `${r.organization_id}/requests/${r.id}/signed.pdf`;
  const up = await svc.storage.from(BUCKET).upload(signedPath, out, { contentType: "application/pdf", upsert: true });
  if (up.error) throw new Error(up.error.message);
  const signedSha = await sha256Hex(out);

  // Solo una ejecución concurrente "gana" el cierre y manda los correos.
  const { data: won } = await svc
    .from("esign_requests")
    .update({ status: "completed", signed_path: signedPath, signed_sha256: signedSha, completed_at: new Date().toISOString() })
    .eq("id", r.id)
    .eq("status", "pending")
    .select("id");
  if (!won?.length) return all;

  const base = siteBase();
  const recipients = new Map<string, { email: string; name: string; token?: string; user_id?: string | null }>();
  for (const s of all) recipients.set(s.email.toLowerCase(), { email: s.email, name: s.name, token: s.token, user_id: s.user_id });
  if (creator.email && !recipients.has(creator.email.toLowerCase())) {
    recipients.set(creator.email.toLowerCase(), { email: creator.email, name: creator.name });
  }
  const attach = out.length <= MAX_MAIL_ATTACHMENT_BYTES
    ? { name: `${r.file_name.replace(/\.pdf$/i, "")}-firmado.pdf`, bytes: out }
    : undefined;
  for (const rc of recipients.values()) {
    try {
      await sendMail({
        to: rc.email,
        subject: `Documento firmado: ${r.title}`,
        html: emailHtml({
          heading: "Documento firmado por todas las partes",
          intro: `"${r.title}" ya fue firmado por todos los participantes.${attach ? " Adjuntamos la copia firmada." : ""}`,
          button: rc.token ? { label: "Ver documento firmado", url: `${base}/firmar/${rc.token}` } : undefined,
          note: `Huella SHA-256 del original: ${r.original_sha256}`,
        }),
        attachment: attach,
      });
    } catch (e) {
      console.error("esign final mail", rc.email, e instanceof Error ? e.message : e);
    }
  }
  await svc.from("notifications").insert({
    user_id: r.created_by,
    organization_id: r.organization_id,
    type: "esign",
    title: "Documento firmado por todos",
    body: r.title,
    entity_type: "esign_request",
    entity_id: r.id,
  });
  return all;
}

// ---------- Handlers ----------
async function loadBySignerToken(svc: Svc, token: string) {
  if (!token || token.length < 32) throw new HttpError(404, "Link inválido o expirado");
  const { data: s } = await svc.from("esign_signers").select("*").eq("token", token).maybeSingle();
  if (!s) throw new HttpError(404, "Link inválido o expirado");
  const { data: r } = await svc.from("esign_requests").select("*").eq("id", s.request_id).single();
  if (!r) throw new HttpError(404, "Solicitud no encontrada");
  const { data: all } = await svc.from("esign_signers").select("*").eq("request_id", r.id).order("sign_order");
  return { signer: s as SignerRow, request: r as RequestRow, all: (all ?? []) as SignerRow[] };
}

async function assertSignerIdentity(signer: SignerRow, req: Request, url: string, anon: string) {
  if (!signer.user_id) return;
  const uid = await optionalUserId(req, url, anon);
  if (uid !== signer.user_id) {
    throw new HttpError(401, "Inicia sesión en Kawiil Central con tu cuenta para firmar este documento", "login_required");
  }
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const svc = createClient(url, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!);
    const body = await req.json();
    const { action } = body;

    // ===== Crear solicitud =====
    if (action === "create") {
      const ctx = await requireUser(req, svc, url, anon);
      const title = String(body.title ?? "").trim();
      if (!title) throw new HttpError(400, "Título requerido");
      const rawSigners = Array.isArray(body.signers) ? body.signers : [];
      if (!rawSigners.length || rawSigners.length > 10) throw new HttpError(400, "Entre 1 y 10 firmantes");

      let pdf: Uint8Array;
      if (body.file_base64) pdf = b64ToBytes(String(body.file_base64));
      else if (body.file_url) pdf = await fetchRemotePdf(String(body.file_url));
      else throw new HttpError(400, "Falta el archivo (file_url o file_base64)");
      if (pdf.length > MAX_PDF_BYTES) throw new HttpError(400, "El PDF excede 15 MB");
      if (!isPdf(pdf)) throw new HttpError(400, "Solo se pueden firmar archivos PDF. Convierte el documento a PDF primero.");
      let pageCount = 1;
      try {
        pageCount = (await PDFDocument.load(pdf, { ignoreEncryption: true })).getPageCount();
      } catch {
        throw new HttpError(400, "El PDF está dañado o protegido");
      }

      // Resolver firmantes (internos validados contra la organización)
      const seen = new Set<string>();
      const signers: Array<{ name: string; email: string; user_id: string | null; sign_order: number; fields: SignField[] }> = [];
      for (let i = 0; i < rawSigners.length; i++) {
        const rs = rawSigners[i];
        let name = String(rs.name ?? "").trim();
        let email = String(rs.email ?? "").trim();
        let userId: string | null = null;
        if (rs.user_id) {
          const { data: p } = await svc
            .from("profiles")
            .select("user_id, full_name, email, organization_id")
            .eq("user_id", rs.user_id)
            .maybeSingle();
          if (!p || p.organization_id !== ctx.orgId) throw new HttpError(400, "Firmante interno inválido");
          userId = p.user_id;
          name = p.full_name || name;
          email = p.email || email;
        }
        if (!name || !SIMPLE_EMAIL.test(email)) throw new HttpError(400, `Firmante ${i + 1}: nombre y correo válidos requeridos`);
        const k = email.toLowerCase();
        if (seen.has(k)) throw new HttpError(400, `Firmante duplicado: ${email}`);
        seen.add(k);
        signers.push({ name, email, user_id: userId, sign_order: body.sequential ? i : 0, fields: parseFields(rs.fields, pageCount) });
      }

      console.log("esign create", JSON.stringify({ pageCount, signers: signers.map((sg) => ({ internal: !!sg.user_id, fields: sg.fields.length })) }));
      const requestId = crypto.randomUUID();
      const originalPath = `${ctx.orgId}/requests/${requestId}/original.pdf`;
      const up = await svc.storage.from(BUCKET).upload(originalPath, pdf, { contentType: "application/pdf" });
      if (up.error) throw new Error(up.error.message);

      const days = Math.min(Math.max(Number(body.expires_days) || 30, 1), 90);
      const fileName = String(body.file_name ?? `${title}.pdf`).slice(0, 200);
      const { data: reqRow, error: rErr } = await svc.from("esign_requests").insert({
        id: requestId,
        organization_id: ctx.orgId,
        created_by: ctx.user.id,
        title,
        message: body.message ? String(body.message).slice(0, 2000) : null,
        file_name: fileName,
        sequential: !!body.sequential,
        client_id: body.client_id ?? null,
        project_id: body.project_id ?? null,
        original_path: originalPath,
        original_sha256: await sha256Hex(pdf),
        expires_at: new Date(Date.now() + days * 86400000).toISOString(),
      }).select("*").single();
      if (rErr) {
        await svc.storage.from(BUCKET).remove([originalPath]);
        throw new Error(rErr.message);
      }
      const { data: sRows, error: sErr } = await svc.from("esign_signers").insert(
        signers.map((s) => ({ ...s, request_id: requestId, organization_id: ctx.orgId })),
      ).select("*");
      if (sErr) {
        await svc.from("esign_requests").delete().eq("id", requestId);
        await svc.storage.from(BUCKET).remove([originalPath]);
        throw new Error(sErr.message);
      }

      await notifyTurn(svc, reqRow as RequestRow, sRows as SignerRow[], ctx.fullName);
      return json({ success: true, request_id: requestId });
    }

    // ===== Previsualizar un PDF remoto (para colocar firmas antes de crear) =====
    if (action === "preview") {
      await requireUser(req, svc, url, anon);
      if (!body.file_url) throw new HttpError(400, "Falta file_url");
      const bytes = await fetchRemotePdf(String(body.file_url));
      if (bytes.length > MAX_PDF_BYTES) throw new HttpError(400, "El PDF excede 15 MB");
      if (!isPdf(bytes)) throw new HttpError(400, "Solo se pueden firmar archivos PDF. Convierte el documento a PDF primero.");
      return json({ file_base64: bytesToB64(bytes) });
    }

    // ===== Cancelar / recordar / descargar (staff) =====
    if (action === "cancel" || action === "remind" || action === "download") {
      const ctx = await requireUser(req, svc, url, anon);
      const { data: r } = await svc.from("esign_requests").select("*")
        .eq("id", body.request_id).eq("organization_id", ctx.orgId).maybeSingle();
      if (!r) throw new HttpError(404, "Solicitud no encontrada");
      const request = r as RequestRow;
      const { data: all } = await svc.from("esign_signers").select("*").eq("request_id", request.id).order("sign_order");
      const signers = (all ?? []) as SignerRow[];

      if (action === "download") {
        const allowed = request.created_by === ctx.user.id || signers.some((s) => s.user_id === ctx.user.id) ||
          (await svc.rpc("is_admin_or_manager", { _user_id: ctx.user.id })).data === true;
        if (!allowed) throw new HttpError(403, "Sin acceso");
        const path = body.which === "original" || !request.signed_path ? request.original_path : request.signed_path;
        return json({ url: await signedUrl(svc, path, 300), file_name: request.file_name });
      }

      if (request.created_by !== ctx.user.id) throw new HttpError(403, "Solo quien creó la solicitud puede hacerlo");
      if (request.status !== "pending") throw new HttpError(400, "La solicitud ya no está pendiente");

      if (action === "cancel") {
        await svc.from("esign_requests").update({ status: "cancelled" }).eq("id", request.id);
        return json({ success: true });
      }
      await notifyTurn(svc, request, signers, ctx.fullName, true);
      return json({ success: true });
    }

    // ===== Firmante: ver documento =====
    if (action === "get") {
      const { signer, request, all } = await loadBySignerToken(svc, String(body.token ?? ""));
      await assertSignerIdentity(signer, req, url, anon);
      const { data: creator } = await svc.from("profiles").select("full_name").eq("user_id", request.created_by).maybeSingle();
      const done = request.status === "completed" && request.signed_path;
      let savedSignature: string | null = null;
      if (signer.user_id && signer.status === "pending") {
        const { data: us } = await svc.from("user_signatures").select("image_path").eq("user_id", signer.user_id).maybeSingle();
        if (us) savedSignature = await signedUrl(svc, us.image_path, 600);
      }
      return json({
        request: {
          id: request.id, title: request.title, message: request.message, file_name: request.file_name,
          status: isExpired(request) && request.status === "pending" ? "expired" : request.status,
          created_by_name: creator?.full_name ?? "Kawiil", expires_at: request.expires_at,
        },
        signer: {
          name: signer.name, email: signer.email, status: signer.status, signed_at: signer.signed_at,
          internal: !!signer.user_id, can_sign: canSignNow(request, signer, all),
          fields: signer.fields ?? [],
        },
        progress: all.map((s) => ({ name: s.name, status: s.status })),
        document_url: await signedUrl(svc, done ? request.signed_path! : request.original_path),
        saved_signature_url: savedSignature,
      });
    }

    // ===== Firmante: firmar =====
    if (action === "sign") {
      const { signer, request, all } = await loadBySignerToken(svc, String(body.token ?? ""));
      await assertSignerIdentity(signer, req, url, anon);
      if (!body.consent) throw new HttpError(400, "Debes aceptar el consentimiento para firmar");
      if (!canSignNow(request, signer, all)) {
        throw new HttpError(409, request.status !== "pending" || isExpired(request)
          ? "Esta solicitud ya no está vigente"
          : signer.status !== "pending" ? "Ya firmaste este documento" : "Aún no es tu turno de firmar");
      }

      let png: Uint8Array;
      if (body.use_saved && signer.user_id) {
        const { data: us } = await svc.from("user_signatures").select("image_path").eq("user_id", signer.user_id).maybeSingle();
        if (!us) throw new HttpError(400, "No tienes una firma guardada");
        png = await download(svc, us.image_path);
      } else {
        if (!body.signature_png) throw new HttpError(400, "Falta la firma");
        png = b64ToBytes(String(body.signature_png));
      }
      if (png.length > MAX_SIGNATURE_BYTES) throw new HttpError(400, "La imagen de firma es demasiado grande");
      if (!isPng(png)) throw new HttpError(400, "La firma debe ser una imagen PNG");

      const sigPath = `${request.organization_id}/requests/${request.id}/sig-${signer.id}.png`;
      const up = await svc.storage.from(BUCKET).upload(sigPath, png, { contentType: "image/png", upsert: true });
      if (up.error) throw new Error(up.error.message);

      const ip = (req.headers.get("x-forwarded-for") || "").split(",")[0].trim() || null;
      const { data: upd } = await svc.from("esign_signers").update({
        status: "signed",
        signed_at: new Date().toISOString(),
        signed_ip: ip,
        signed_user_agent: (req.headers.get("user-agent") || "").slice(0, 300),
        signature_path: sigPath,
      }).eq("id", signer.id).eq("status", "pending").select("id");
      if (!upd?.length) throw new HttpError(409, "Ya firmaste este documento");

      const { data: creator } = await svc.from("profiles").select("full_name, email").eq("user_id", request.created_by).maybeSingle();
      const after = await finalizeIfComplete(svc, request, { email: creator?.email ?? null, name: creator?.full_name ?? "Kawiil" });
      const fresh = after.map((s) => (s.id === signer.id ? { ...s, status: "signed" } : s));
      // Si sigue pendiente y es secuencial, avisa al siguiente.
      const { data: cur } = await svc.from("esign_requests").select("*").eq("id", request.id).single();
      if (cur && (cur as RequestRow).status === "pending") {
        const { data: refreshed } = await svc.from("esign_signers").select("*").eq("request_id", request.id).order("sign_order");
        await notifyTurn(svc, cur as RequestRow, (refreshed ?? fresh) as SignerRow[], creator?.full_name ?? "Kawiil");
      }
      return json({ success: true, completed: (cur as RequestRow | null)?.status === "completed" });
    }

    // ===== Firmante: rechazar =====
    if (action === "decline") {
      const { signer, request, all } = await loadBySignerToken(svc, String(body.token ?? ""));
      await assertSignerIdentity(signer, req, url, anon);
      if (!canSignNow(request, signer, all)) throw new HttpError(409, "Esta solicitud ya no está vigente");
      const reason = String(body.reason ?? "").trim().slice(0, 500) || null;
      await svc.from("esign_signers").update({ status: "declined", decline_reason: reason, signed_at: new Date().toISOString() }).eq("id", signer.id);
      await svc.from("esign_requests").update({ status: "declined" }).eq("id", request.id).eq("status", "pending");
      const { data: creator } = await svc.from("profiles").select("full_name, email").eq("user_id", request.created_by).maybeSingle();
      await svc.from("notifications").insert({
        user_id: request.created_by, organization_id: request.organization_id, type: "esign",
        title: `${signer.name} rechazó firmar`, body: request.title, entity_type: "esign_request", entity_id: request.id,
      });
      if (creator?.email) {
        try {
          await sendMail({
            to: creator.email,
            subject: `Firma rechazada: ${request.title}`,
            html: emailHtml({
              heading: "Un firmante rechazó el documento",
              intro: `${signer.name} (${signer.email}) rechazó firmar "${request.title}".${reason ? `\n\nMotivo: ${reason}` : ""}`,
            }),
          });
        } catch (e) {
          console.error("esign decline mail", e instanceof Error ? e.message : e);
        }
      }
      return json({ success: true });
    }

    throw new HttpError(400, "Acción inválida");
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.message, code: e.code }, e.status);
    const message = e instanceof Error ? e.message : "Error desconocido";
    console.error("esign error:", message);
    return json({ error: message }, 500);
  }
});
