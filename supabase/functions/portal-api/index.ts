/**
 * portal-api — API única y versionada del portal del cliente (v1).
 *
 * Ruta: POST /functions/v1/portal-api/v1/<operación>  (o body { op: "v1/<operación>" }).
 * Contrato completo: docs/portal/API.md. Las lecturas simples (listas de
 * facturas, documentos, tickets, hilos) van directo por PostgREST con la RLS
 * del usuario; aquí viven las operaciones que necesitan Storage, Auth admin,
 * cifrado o el emisor.
 *
 * Reglas:
 *   · Toda lectura de datos del cliente se hace con el JWT del usuario (RLS).
 *   · service_role solo escribe (Storage, auth.admin, cifrados, bitácora).
 *   · Nada de credenciales de administración sale hacia el portal.
 *   · verify_jwt=false (config.toml): el JWT se valida aquí, porque hay rutas
 *     públicas (registro) y rutas de cron.
 */
import JSZip from "npm:jszip@3.10.1";
import { encryptFielSecret, sha256HexFromBase64File } from "../_shared/moffinFielCrypto.ts";
import {
  ApiError, assertClientAccess, audit, b64ToBytes, buildCtx, corsHeaders, json, requireUser, str, uuid, type Ctx,
} from "../_shared/portal/http.ts";
import { directionForClient, toPortalCfdiRow, validateCfdiXml } from "../_shared/portal/cfdiXml.ts";
import {
  crearEmisor, EmisionRechazada, PacNoConfigurado, FacturapiError,
  facturapiConfigFromEnv, createInvoice, paymentSummary,
  type BorradorFactura,
} from "../_shared/portal/emission/index.ts";
import { publicCsdView } from "../_shared/portal/csd.ts";
import { registerCsd } from "../_shared/portal/csdRegister.ts";
import { suggestCategory } from "../_shared/portal/openclaw.ts";
import { normalizeRfc } from "../_shared/portal/validate.ts";
import { clientIp, GENERIC_ACCOUNT_MESSAGE, guardPublic, registerAccount, turnstileSiteverify, type PublicKind } from "../_shared/portal/publicAuth.ts";
import { sha256Hex } from "../_shared/portal/hash.ts";
import {
  calculateFiscalEstimate,
  calculatePeriodExpense,
  calculatePeriodIncome,
  ivaBasisLabel,
  type FiscalInvoice,
} from "../_shared/portal/fiscalEstimate.ts";
import { dataQualityFromInvoices, vatByRateFromTaxLines } from "../_shared/portal/fiscalMirror.ts";

const API_VERSION = "v1";
const SIGNED_URL_SECONDS = 120;
const PORTAL_URL = (Deno.env.get("PORTAL_PUBLIC_URL") ?? "").replace(/\/+$/, "");
/** Fase espejo (Corte 3): el cliente no carga XML ni emite; solo lee lo publicado por central. */
const MIRROR_READ_ONLY = (Deno.env.get("PORTAL_MIRROR_READ_ONLY") ?? "true").toLowerCase() !== "false";
const PORTAL_EMISOR_MODE = (Deno.env.get("PORTAL_EMISOR") ?? "prueba").trim().toLowerCase();
/** Emisión Facturapi autorizada por Polo: puede operar aunque el espejo SatGo siga en solo lectura. */
const FACTURAPI_EMISSION_ALLOWED = PORTAL_EMISOR_MODE === "facturapi" && !!facturapiConfigFromEnv();

function assertEmissionWritable() {
  if (!MIRROR_READ_ONLY || FACTURAPI_EMISSION_ALLOWED) return;
  throw new ApiError(403, "espejo_solo_lectura", "La emisión no está disponible en la fase espejo.");
}

type TaxProfileNorm = { rfc: string; razon_social: string; regimen_fiscal: string; cp_fiscal: string };

function normalizeTaxProfile(row: Record<string, unknown> | null | undefined): TaxProfileNorm | null {
  if (!row?.rfc) return null;
  const razon = String(row.razon_social ?? row.legal_name ?? "").trim();
  const regimen = String(row.regimen_fiscal ?? row.fiscal_regime ?? "").trim();
  const cp = String(row.cp_fiscal ?? row.fiscal_postal_code ?? "").trim();
  return { rfc: String(row.rfc), razon_social: razon, regimen_fiscal: regimen, cp_fiscal: cp };
}

type Handler = (ctx: Ctx) => Promise<unknown>;

function periodBounds(year: number, month: number): { start: string; end: string } {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = `${year}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  return { start, end };
}

async function loadMirrorInvoices(ctx: Ctx, clientId: string): Promise<{ invoices: FiscalInvoice[]; rows: Record<string, unknown>[] }> {
  const user = requireUser(ctx);
  // Sesión autenticada: nunca mezclar fixtures didácticos (is_test) con CFDI reales.
  const { data: rows, error } = await user.from("portal_cfdi").select("id, direction, issued_at, payment_method, subtotal, total, vat_transferred, vat_withheld, income_tax_withheld, detail_status, sat_status, issuer_rfc, issuer_name, receiver_rfc, receiver_name, flags, category_name, category_status, uuid").eq("client_id", clientId).or("is_test.is.null,is_test.eq.false").limit(5000);
  if (error) throw new ApiError(400, "consulta", "No se pudieron consultar las facturas del espejo.");
  const ids = (rows ?? []).map((r: { id: string }) => r.id);
  const taxByCfdi = new Map<string, { tax: string; kind: "transfer" | "withholding"; rate: number | null; amount: number }[]>();
  const payByRelated = new Map<string, { paidAt: string; amount: number }[]>();
  if (ids.length) {
    const { data: taxes } = await ctx.admin.from("portal_cfdi_tax_lines").select("cfdi_id, tax, kind, rate, amount").in("cfdi_id", ids);
    for (const line of taxes ?? []) {
      const list = taxByCfdi.get(line.cfdi_id) ?? [];
      list.push({ tax: line.tax, kind: line.kind, rate: line.rate, amount: Number(line.amount) });
      taxByCfdi.set(line.cfdi_id, list);
    }
    const { data: links } = await ctx.admin.from("portal_payment_links").select("related_cfdi_id, paid_at, paid_amount").in("related_cfdi_id", ids);
    for (const link of links ?? []) {
      const list = payByRelated.get(link.related_cfdi_id) ?? [];
      list.push({ paidAt: String(link.paid_at), amount: Number(link.paid_amount) });
      payByRelated.set(link.related_cfdi_id, list);
    }
  }
  const invoices: FiscalInvoice[] = (rows ?? []).map((r: Record<string, unknown>) => {
    const method = r.payment_method === "PUE" || r.payment_method === "PPD" ? r.payment_method : null;
    const lines = taxByCfdi.get(String(r.id)) ?? [];
    return {
      id: String(r.id),
      direction: r.direction === "emitida" ? "emitida" : "recibida",
      issuedAt: String(r.issued_at ?? ""),
      paymentMethod: method,
      subtotal: Number(r.subtotal ?? 0),
      total: Number(r.total ?? 0),
      vatTransferred: Number(r.vat_transferred ?? 0),
      vatWithheld: Number(r.vat_withheld ?? 0),
      incomeTaxWithheld: Number(r.income_tax_withheld ?? 0),
      vatByRate: vatByRateFromTaxLines(lines),
      payments: payByRelated.get(String(r.id)),
      detailComplete: r.detail_status === "complete",
    };
  });
  return { invoices, rows: (rows ?? []) as Record<string, unknown>[] };
}

// ── Utilidades ──────────────────────────────────────────────────────
async function clientRfcs(ctx: Ctx, clientId: string): Promise<{ org: string; rfcs: string[] }> {
  const { data: c } = await ctx.admin.from("portal_companies").select("organization_id, rfc").eq("id", clientId).single();
  const { data: tp } = await ctx.admin.from("portal_tax_profiles").select("rfc").eq("client_id", clientId).eq("active", true);
  const rfcs = [c?.rfc, ...(tp ?? []).map((t: { rfc: string }) => t.rfc)].filter(Boolean).map((r) => normalizeRfc(r as string));
  return { org: c!.organization_id, rfcs: [...new Set(rfcs)] };
}

async function upload(ctx: Ctx, bucket: string, path: string, bytes: Uint8Array, contentType: string, upsert = false) {
  const { error } = await ctx.admin.storage.from(bucket).upload(path, bytes, { contentType, upsert });
  if (error && !/exists/i.test(error.message)) throw new ApiError(500, "storage", error.message);
}

function randomPassword(): string {
  const a = new Uint8Array(24);
  crypto.getRandomValues(a);
  return btoa(String.fromCharCode(...a));
}

// ── Operaciones ─────────────────────────────────────────────────────

// ── Operaciones públicas (C3) ───────────────────────────────────────
const envInt = (k: string, d: number) => {
  const n = Number(Deno.env.get(k));
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : d;
};

/** ¿El cerco de rutas corrió en esta petición? Se pregunta POR PostgREST, que es quien corre el pre-request (V1). */
async function routeGuardStatus(ctx: Ctx): Promise<{ ok: boolean; [k: string]: unknown }> {
  const { data, error } = await ctx.anon.rpc("portal_route_guard_status");
  if (error || !data) return { ok: false, error: "sin_diagnostico" };
  return data as { ok: boolean };
}

function publicGuardDeps(ctx: Ctx) {
  const salt = Deno.env.get("PORTAL_RL_SALT") || Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") || "";
  const secret = Deno.env.get("TURNSTILE_SECRET_KEY");
  return {
    turnstileSecret: secret,
    verifyTurnstile: (token: string, ip: string | null) => turnstileSiteverify(secret!, token, ip),
    async rateLimit(bucket: string, keyHash: string, limit: number, windowSeconds: number) {
      const { data, error } = await ctx.admin.rpc("portal_rate_limit_hit", { _bucket: bucket, _key_hash: keyHash, _limit: limit, _window_seconds: windowSeconds });
      // Si el límite no se puede consultar, se cierra (no se abre).
      return error || !data ? { allowed: false } : (data as { allowed: boolean });
    },
    hash: (v: string) => sha256Hex(new TextEncoder().encode(`${salt}|${v}`)),
    routeGuardOk: async () => (await routeGuardStatus(ctx)).ok === true,
    limits: {
      ipPerWindow: envInt("PORTAL_RL_IP_PER_WINDOW", 10),
      emailPerWindow: envInt("PORTAL_RL_EMAIL_PER_WINDOW", 3),
      windowSeconds: envInt("PORTAL_RL_WINDOW_SECONDS", 3600),
    },
  };
}

async function publicGuard(ctx: Ctx, kind: PublicKind, email: string) {
  const g = await guardPublic(publicGuardDeps(ctx), { kind, captchaToken: ctx.body.captcha_token as string, ip: clientIp(ctx.req.headers), email });
  if (!g.ok) throw new ApiError(g.status, g.code, g.message);
}

function publicEmail(ctx: Ctx): string {
  const email = str(ctx.body.email, "el correo", 254).toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ApiError(400, "dato_invalido", "El correo no es válido.");
  return email;
}

/** Registro público. Captcha + límite + cerco verificado. Responde igual exista o no el correo. */
const registrar: Handler = async (ctx) => {
  const email = publicEmail(ctx);
  const password = str(ctx.body.password, "la contraseña", 128);
  const fullName = str(ctx.body.full_name, "el nombre", 200);
  if (password.length < 10) throw new ApiError(400, "dato_invalido", "La contraseña debe tener al menos 10 caracteres.");
  if (ctx.body.acepta_aviso !== true || ctx.body.acepta_terminos !== true) {
    throw new ApiError(400, "legal", "Debe aceptar el aviso de privacidad y los términos para crear su cuenta.");
  }
  await publicGuard(ctx, "registro", email);
  const r = await registerAccount({
    async createUser(e, p, n) {
      const { data, error } = await ctx.admin.auth.admin.createUser({
        email: e, password: p, email_confirm: false,
        user_metadata: { kawiil_portal: true, full_name: n },
        app_metadata: { kawiil_portal: true, portal_created_via: "registro" },
      });
      if (data?.user) return { userId: data.user.id };
      if (error && /already|registered|exists/i.test(error.message)) return { exists: true as const };
      return { error: error?.message ?? "desconocido" };
    },
    async recordLegal(userId, e) {
      const ua = ctx.req.headers.get("user-agent")?.slice(0, 300) ?? null;
      for (const kind of ["aviso_privacidad", "terminos"]) {
        const { data: doc } = await ctx.admin.rpc("portal_current_legal", { _kind: kind });
        if (doc?.id) {
          await ctx.admin.from("portal_legal_acceptances").insert({ user_id: userId, user_email: e, document_id: doc.id, kind, version: doc.version, user_agent: ua });
        }
      }
    },
    async sendConfirmation(e) {
      await ctx.anon.auth.resend({ type: "signup", email: e, options: { emailRedirectTo: `${PORTAL_URL}/ingresar` } });
    },
    async audit(userId) {
      ctx.userId = userId;
      await audit(ctx, "cuenta_registro", null, "portal_accounts", userId, {});
      ctx.userId = null;
    },
  }, { email, password, fullName });
  if (!r.ok) throw new ApiError(r.status, r.code, r.message);
  return { ok: true, message: r.message };
};

const recuperar: Handler = async (ctx) => {
  const email = publicEmail(ctx);
  await publicGuard(ctx, "recuperacion", email);
  await ctx.anon.auth.resetPasswordForEmail(email, { redirectTo: `${PORTAL_URL}/restablecer` }).catch(() => undefined);
  return { ok: true, message: GENERIC_ACCOUNT_MESSAGE };
};

const reenviarConfirmacion: Handler = async (ctx) => {
  const email = publicEmail(ctx);
  await publicGuard(ctx, "reenvio", email);
  await ctx.anon.auth.resend({ type: "signup", email, options: { emailRedirectTo: `${PORTAL_URL}/ingresar` } }).catch(() => undefined);
  return { ok: true, message: GENERIC_ACCOUNT_MESSAGE };
};

/** Diagnóstico público del cerco (solo booleanos y un conteo). */
const diagnosticoCerco: Handler = async (ctx) => {
  const g = await routeGuardStatus(ctx);
  return { cerco: g, captcha_configurado: !!Deno.env.get("TURNSTILE_SECRET_KEY") };
};

/** Enlace firmado de vida corta para un archivo que la RLS del usuario ya deja ver. */
const enlaceArchivo: Handler = async (ctx) => {
  const user = requireUser(ctx);
  const kind = str(ctx.body.kind, "el tipo de archivo", 40);
  const id = uuid(ctx.body.id, "el identificador");
  let bucket = "portal";
  let path: string | null = null;
  let clientId: string | null = null;
  let fileName = "archivo";
  let action = "archivo_descarga";
  if (kind === "documento") {
    const { data } = await user.from("portal_documents").select("client_id, storage_path, file_name, status").eq("id", id).maybeSingle();
    if (data) { path = data.storage_path; clientId = data.client_id; fileName = data.file_name; action = "documento_descarga"; }
  } else if (kind === "cfdi_xml" || kind === "cfdi_pdf") {
    const { data } = await user.from("portal_cfdi").select("client_id, xml_path, pdf_path, uuid").eq("id", id).maybeSingle();
    if (data) { path = kind === "cfdi_xml" ? data.xml_path : data.pdf_path; clientId = data.client_id; fileName = `${data.uuid}.${kind === "cfdi_xml" ? "xml" : "pdf"}`; }
  } else if (kind === "ticket" || kind === "ticket_cfdi_xml" || kind === "ticket_cfdi_pdf") {
    bucket = "juun";
    const { data } = await user.from("portal_tickets_v").select("client_id, file_path, cfdi_xml_path, cfdi_pdf_path, cfdi_uuid").eq("id", id).maybeSingle();
    if (data) {
      clientId = data.client_id;
      path = kind === "ticket" ? data.file_path : kind === "ticket_cfdi_xml" ? data.cfdi_xml_path : data.cfdi_pdf_path;
      fileName = kind === "ticket" ? path?.split("/").pop() ?? "ticket" : `${data.cfdi_uuid}.${kind.endsWith("xml") ? "xml" : "pdf"}`;
    }
  } else if (kind === "adjunto") {
    const { data } = await user.from("portal_message_attachments").select("client_id, storage_path, file_name").eq("id", id).maybeSingle();
    if (data) { path = data.storage_path; clientId = data.client_id; fileName = data.file_name; }
  } else {
    throw new ApiError(400, "dato_invalido", "Tipo de archivo desconocido.");
  }
  if (!path || !clientId) throw new ApiError(404, "no_encontrado", "El archivo no existe o no tiene acceso.");
  const { data: signed, error } = await ctx.admin.storage.from(bucket).createSignedUrl(path, SIGNED_URL_SECONDS, { download: fileName });
  if (error || !signed) throw new ApiError(500, "storage", "No se pudo generar el enlace.");
  await audit(ctx, action, clientId, kind, id, { expira_en_segundos: SIGNED_URL_SECONDS });
  return { url: signed.signedUrl, expires_in: SIGNED_URL_SECONDS };
};

/** Carga manual de XML o ZIP: valida CFDI, pertenencia al RFC del cliente y duplicados por UUID. */
const cargarFacturas: Handler = async (ctx) => {
  const clientId = uuid(ctx.body.client_id, "el cliente");
  await assertClientAccess(ctx, clientId, ["administrador", "operativo"]);
  const files = Array.isArray(ctx.body.files) ? (ctx.body.files as { name: string; base64: string }[]) : [];
  if (files.length === 0 || files.length > 20) throw new ApiError(400, "dato_invalido", "Envíe entre 1 y 20 archivos XML o ZIP.");
  const { org, rfcs } = await clientRfcs(ctx, clientId);
  if (rfcs.length === 0) throw new ApiError(400, "sin_rfc", "El cliente no tiene RFC registrado.");

  const xmls: { name: string; text: string }[] = [];
  for (const f of files) {
    const bytes = b64ToBytes(String(f.base64 ?? ""));
    if (bytes.length > 10 * 1024 * 1024) throw new ApiError(400, "dato_invalido", `«${f.name}» pasa de 10 MB.`);
    if (/\.zip$/i.test(f.name)) {
      const zip = await JSZip.loadAsync(bytes);
      const entries = Object.values(zip.files).filter((e) => !e.dir && /\.xml$/i.test(e.name));
      if (entries.length > 500) throw new ApiError(400, "dato_invalido", "El ZIP trae más de 500 XML.");
      for (const e of entries) xmls.push({ name: `${f.name}/${e.name}`, text: await e.async("string") });
    } else if (/\.xml$/i.test(f.name)) {
      xmls.push({ name: f.name, text: new TextDecoder().decode(bytes) });
    } else {
      xmls.push({ name: f.name, text: "" });
    }
  }

  const results: { archivo: string; estado: "cargada" | "duplicada" | "rechazada"; uuid?: string; motivo?: string }[] = [];
  for (const x of xmls) {
    const v = validateCfdiXml(x.text);
    if (!v.ok || !v.parsed) { results.push({ archivo: x.name, estado: "rechazada", motivo: v.errors.join(" ") || "No es un XML." }); continue; }
    const dir = directionForClient(v.parsed, rfcs);
    if (!dir) { results.push({ archivo: x.name, estado: "rechazada", uuid: v.parsed.uuid!, motivo: "El CFDI no es del RFC del cliente (ni como emisor ni como receptor)." }); continue; }
    const { data: dup } = await ctx.admin.from("portal_cfdi").select("id").eq("client_id", clientId).eq("uuid", v.parsed.uuid!).maybeSingle();
    if (dup) { results.push({ archivo: x.name, estado: "duplicada", uuid: v.parsed.uuid! }); continue; }
    const xmlPath = `${org}/${clientId}/cfdi/${v.parsed.uuid}.xml`;
    await upload(ctx, "portal", xmlPath, new TextEncoder().encode(x.text), "application/xml");
    const { error } = await ctx.admin.from("portal_cfdi").insert({
      organization_id: org, client_id: clientId, source: "carga_xml", xml_path: xmlPath, created_by: ctx.userId,
      ...toPortalCfdiRow(v.parsed, dir),
    });
    if (error) { results.push({ archivo: x.name, estado: /duplicate/i.test(error.message) ? "duplicada" : "rechazada", uuid: v.parsed.uuid!, motivo: error.message }); continue; }
    results.push({ archivo: x.name, estado: "cargada", uuid: v.parsed.uuid! });
  }
  await audit(ctx, "cfdi_carga", clientId, "portal_cfdi", null, {
    cargadas: results.filter((r) => r.estado === "cargada").length,
    duplicadas: results.filter((r) => r.estado === "duplicada").length,
    rechazadas: results.filter((r) => r.estado === "rechazada").length,
  });
  return { results, verificacion: "estructura: el estatus ante el SAT se actualiza con Moffin" };
};

async function emissionContext(ctx: Ctx, clientId: string) {
  // Esquema OS (legal_name/fiscal_*) o central (razon_social/regimen_fiscal).
  let tpRaw: Record<string, unknown> | null = null;
  {
    const a = await ctx.admin.from("portal_tax_profiles")
      .select("rfc, legal_name, fiscal_regime, fiscal_postal_code, razon_social, regimen_fiscal, cp_fiscal")
      .eq("client_id", clientId).eq("is_default", true).eq("active", true).maybeSingle();
    if (!a.error) tpRaw = (a.data as Record<string, unknown> | null) ?? null;
    else {
      const b = await ctx.admin.from("portal_tax_profiles")
        .select("rfc, legal_name, fiscal_regime, fiscal_postal_code")
        .eq("client_id", clientId).eq("is_default", true).eq("active", true).maybeSingle();
      tpRaw = (b.data as Record<string, unknown> | null) ?? null;
    }
  }
  const tp = normalizeTaxProfile(tpRaw);
  let reg: {
    id: string; certificate_id?: string; cert_serial: string | null;
    cert_not_before: string | null; cert_not_after: string | null; revoked_at: string | null; use_count?: number;
  } | null = null;
  {
    const r = await ctx.admin.from("portal_csd_registry")
      .select("id, certificate_id, cert_serial, cert_not_before, cert_not_after, revoked_at, use_count")
      .eq("client_id", clientId).is("revoked_at", null).order("cert_not_after", { ascending: false }).limit(1).maybeSingle();
    if (!r.error) reg = r.data as typeof reg;
  }
  const { data: settings } = await ctx.admin.from("portal_client_settings").select("emission_enabled, origin").eq("client_id", clientId).maybeSingle();
  const user = requireUser(ctx);
  let dossier: { complete?: boolean; checks?: unknown[]; origin?: string } | null = null;
  let usage: { usadas?: number; limite?: number; origin?: string } | null = null;
  try {
    const d = await user.rpc("portal_emission_dossier", { _client_id: clientId });
    if (!d.error) dossier = d.data as typeof dossier;
  } catch { /* OS baseline sin RPC */ }
  try {
    const u = await user.rpc("portal_basic_usage", { _client_id: clientId });
    if (!u.error) usage = u.data as typeof usage;
  } catch { /* OS baseline sin RPC */ }
  // Facturapi: expediente mínimo = perfil fiscal + emisión habilitada (CSD en org Facturapi).
  if (!dossier && PORTAL_EMISOR_MODE === "facturapi") {
    const checks = [
      { key: "perfil_fiscal", ok: !!(tp?.rfc && tp.razon_social && tp.regimen_fiscal && tp.cp_fiscal), label: "Datos fiscales", detail: tp?.rfc ?? "Falta perfil" },
      { key: "facturapi", ok: FACTURAPI_EMISSION_ALLOWED, label: "Facturapi", detail: FACTURAPI_EMISSION_ALLOWED ? "Configurado" : "Kawiil conectará la organización Facturapi" },
      { key: "emision", ok: !!settings?.emission_enabled, label: "Emisión", detail: settings?.emission_enabled ? "Activa" : "Apagada hasta activación" },
    ];
    dossier = { complete: checks.every((c) => c.ok), checks, origin: "facturapi" };
  }
  return { tp, reg, settings, dossier, usage };
}

function borradorFrom(ctx: Ctx, tp: TaxProfileNorm | null): BorradorFactura {
  const b = (ctx.body.borrador ?? {}) as Partial<BorradorFactura>;
  // El emisor SIEMPRE sale del perfil fiscal verificado, no del navegador.
  return {
    ...(b as BorradorFactura),
    moneda: "MXN",
    emisor: tp ? { rfc: tp.rfc, nombre: tp.razon_social, regimen: tp.regimen_fiscal, cp: tp.cp_fiscal } : (undefined as never),
  };
}

const validarFactura: Handler = async (ctx) => {
  assertEmissionWritable();
  const clientId = uuid(ctx.body.client_id, "el cliente");
  await assertClientAccess(ctx, clientId, ["administrador"]);
  const e = await emissionContext(ctx, clientId);
  const emisor = crearEmisor(Deno.env.get("PORTAL_EMISOR"));
  const omitirCsd = emisor.nombre === "facturapi";
  const v = await emisor.validar(borradorFrom(ctx, e.tp), {
    csd: e.reg ? { serial: e.reg.cert_serial, notBefore: e.reg.cert_not_before, notAfter: e.reg.cert_not_after, revoked: !!e.reg.revoked_at } : null,
    omitirCsd,
  });
  return { validacion: v, expediente: e.dossier, emision_habilitada: !!e.settings?.emission_enabled, uso_basico: e.usage, emisor: emisor.nombre };
};

const crearFactura: Handler = async (ctx) => {
  assertEmissionWritable();
  const clientId = uuid(ctx.body.client_id, "el cliente");
  await assertClientAccess(ctx, clientId, ["administrador"], false);
  const e = await emissionContext(ctx, clientId);
  if (!e.settings?.emission_enabled) throw new ApiError(403, "emision_apagada", "La emisión no está habilitada para este cliente. Kawiil la activa cuando el expediente está completo.");
  if (e.dossier && e.dossier.complete === false) throw new ApiError(403, "expediente_incompleto", "El expediente de emisión está incompleto.", e.dossier);
  if (e.usage?.origin === "basico" && Number(e.usage.usadas) >= Number(e.usage.limite)) {
    throw new ApiError(402, "limite_basico", `Llegó al límite de ${e.usage.limite} facturas incluidas en el nivel básico. Para seguir facturando, contrate un plan con Kawiil desde «Mensajes».`);
  }
  const emisor = crearEmisor(Deno.env.get("PORTAL_EMISOR"));
  const borrador = borradorFrom(ctx, e.tp);
  const ectx = {
    csd: e.reg ? { serial: e.reg.cert_serial, notBefore: e.reg.cert_not_before, notAfter: e.reg.cert_not_after, revoked: !!e.reg.revoked_at } : null,
    omitirCsd: emisor.nombre === "facturapi",
  };
  try {
    const out = await emisor.emitir(borrador, ectx);
    const facturapiId = (out as { facturapiId?: string }).facturapiId ?? null;
    const { org } = await clientRfcs(ctx, clientId);
    const xmlPath = `${org}/${clientId}/emitidas/${out.uuid}.xml`;
    try {
      await upload(ctx, "portal", xmlPath, new TextEncoder().encode(out.xml), "application/xml");
    } catch { /* bucket opcional en OS */ }
    const { data: cfdi, error } = await ctx.admin.from("portal_cfdi").insert({
      client_id: clientId,
      uuid: out.uuid,
      direction: "emitida",
      source: out.esPrueba ? "emision_prueba" : (emisor.nombre === "facturapi" ? "emision_facturapi" : "emision_portal"),
      is_test: out.esPrueba,
      version: "4.0",
      issued_at: out.fechaTimbrado,
      issuer_rfc: borrador.emisor.rfc,
      issuer_name: borrador.emisor.nombre,
      receiver_rfc: normalizeRfc(borrador.receptor.rfc),
      receiver_name: borrador.receptor.nombre,
      voucher_type: "I",
      payment_form: borrador.formaPago,
      payment_method: borrador.metodoPago,
      currency: "MXN",
      subtotal: out.totales.subtotal,
      vat_transferred: out.totales.iva,
      total: out.totales.total,
      detail_status: "complete",
      sat_status: out.esPrueba ? "unknown" : "vigente",
      xml_path: xmlPath,
    }).select("id").single();
    if (error) throw new ApiError(500, "registro", error.message);
    await ctx.admin.from("portal_emissions").insert({
      client_id: clientId, requested_by: ctx.userId, emisor: emisor.nombre, status: "emitida", draft: borrador, cfdi_id: cfdi.id,
      facturapi_invoice_id: facturapiId,
    });
    if (facturapiId) {
      await ctx.admin.from("portal_facturapi_invoices").upsert({
        client_id: clientId, cfdi_id: cfdi.id, facturapi_id: facturapiId, uuid: out.uuid, tipo: "I",
        livemode: !out.esPrueba, status: out.esPrueba ? "valid" : "valid", payload: { totales: out.totales },
      }, { onConflict: "client_id,facturapi_id" });
    }
    if (!out.esPrueba && e.reg && emisor.nombre !== "facturapi") {
      await ctx.admin.from("portal_csd_registry").update({ last_used_at: new Date().toISOString(), use_count: (e.reg.use_count ?? 0) + 1 }).eq("id", e.reg.id);
      await audit(ctx, "csd_uso", clientId, "portal_csd_registry", e.reg.id, { uuid: out.uuid });
    }
    await audit(ctx, "emision", clientId, "portal_cfdi", cfdi.id, { uuid: out.uuid, emisor: emisor.nombre, prueba: out.esPrueba, total: out.totales.total });
    return { cfdi_id: cfdi.id, uuid: out.uuid, prueba: out.esPrueba, totales: out.totales, facturapi_id: facturapiId, emisor: emisor.nombre };
  } catch (err) {
    if (err instanceof EmisionRechazada) {
      await ctx.admin.from("portal_emissions").insert({
        client_id: clientId, requested_by: ctx.userId, emisor: emisor.nombre, status: "rechazada", draft: borrador, errors: err.errores,
      });
      await audit(ctx, "emision_rechazada", clientId, "portal_emissions", null, { errores: err.errores.length });
      throw new ApiError(422, "validacion", err.message, err.errores);
    }
    if (err instanceof PacNoConfigurado) throw new ApiError(503, "pac_no_configurado", err.message);
    if (err instanceof FacturapiError) throw new ApiError(err.status >= 400 && err.status < 600 ? err.status : 502, err.code, err.message, err.details);
    throw err;
  }
};

/** Complemento de pago (CFDI tipo P) vía Facturapi — docs/guides/invoices/pago */
const crearComplementoPago: Handler = async (ctx) => {
  assertEmissionWritable();
  if (PORTAL_EMISOR_MODE !== "facturapi") {
    throw new ApiError(503, "facturapi_requerido", "El complemento de pago requiere PORTAL_EMISOR=facturapi.");
  }
  const cfg = facturapiConfigFromEnv();
  if (!cfg) throw new ApiError(503, "facturapi_not_configured", "Falta FACTURAPI_SECRET_KEY en secretos (central/ensayo).");
  const clientId = uuid(ctx.body.client_id, "el cliente");
  await assertClientAccess(ctx, clientId, ["administrador"], false);
  const e = await emissionContext(ctx, clientId);
  if (!e.settings?.emission_enabled) throw new ApiError(403, "emision_apagada", "La emisión no está habilitada para este cliente.");

  const formaPago = str(ctx.body.forma_pago ?? ctx.body.payment_form ?? "03", "la forma de pago", 3);
  const related = Array.isArray(ctx.body.related) ? ctx.body.related as Record<string, unknown>[] : [];
  if (related.length === 0) throw new ApiError(400, "dato_invalido", "Indica al menos una factura PPD a pagar.");

  const related_documents = [];
  for (const item of related) {
    const amount = Number(item.amount);
    if (!(amount > 0)) throw new ApiError(400, "dato_invalido", "Cada pago debe tener monto mayor a cero.");
    let facturapiId = typeof item.facturapi_id === "string" ? item.facturapi_id : "";
    const relatedUuid = typeof item.uuid === "string" ? item.uuid.trim().toUpperCase() : "";
    if (!facturapiId && relatedUuid) {
      const { data: link } = await ctx.admin.from("portal_facturapi_invoices")
        .select("facturapi_id").eq("client_id", clientId).eq("uuid", relatedUuid).maybeSingle();
      facturapiId = link?.facturapi_id ?? "";
    }
    if (facturapiId) {
      related_documents.push(await paymentSummary(cfg, facturapiId, amount));
    } else if (relatedUuid) {
      // Fallback manual si la factura no se emitió por Facturapi en esta org.
      const installment = Number(item.installment) || 1;
      const lastBalance = Number(item.last_balance ?? amount);
      const taxes = Array.isArray(item.taxes) ? item.taxes : [{ base: Math.round((amount / 1.16) * 100) / 100, type: "IVA", rate: 0.16 }];
      related_documents.push({ uuid: relatedUuid, amount, installment, last_balance: lastBalance, taxes });
    } else {
      throw new ApiError(400, "dato_invalido", "Cada partida necesita facturapi_id o uuid de la factura PPD.");
    }
  }

  const customer = (ctx.body.customer ?? {}) as Record<string, unknown>;
  const taxId = normalizeRfc(String(customer.tax_id ?? customer.rfc ?? ""));
  const legalName = String(customer.legal_name ?? customer.nombre ?? "").trim();
  const taxSystem = String(customer.tax_system ?? customer.regimen ?? "601");
  const zip = String(customer.zip ?? customer.cp ?? "").trim();
  if (!taxId || !legalName || !zip) {
    throw new ApiError(400, "dato_invalido", "Faltan datos del receptor (RFC, nombre, CP) para el complemento.");
  }

  const created = await createInvoice(cfg, {
    type: "P",
    customer: {
      legal_name: legalName,
      tax_id: taxId,
      tax_system: taxSystem,
      address: { zip, country: "MEX" },
    },
    complements: [{ type: "pago", data: [{ payment_form: formaPago, related_documents }] }],
  });

  const uuidPago = (created.uuid ?? crypto.randomUUID()).toUpperCase();
  const paidAmount = related_documents.reduce((s, d) => s + Number((d as { amount?: number }).amount ?? 0), 0);
  const { data: cfdi, error } = await ctx.admin.from("portal_cfdi").insert({
    client_id: clientId,
    uuid: uuidPago,
    direction: "emitida",
    source: "emision_facturapi",
    is_test: created.livemode === false,
    version: "4.0",
    issued_at: created.stamp?.date ?? new Date().toISOString(),
    issuer_rfc: e.tp?.rfc ?? null,
    issuer_name: e.tp?.razon_social ?? null,
    receiver_rfc: taxId,
    receiver_name: legalName,
    voucher_type: "P",
    payment_form: formaPago,
    payment_method: null,
    currency: "MXN",
    subtotal: 0,
    total: 0,
    detail_status: "complete",
    sat_status: created.livemode === false ? "unknown" : "vigente",
  }).select("id").single();
  if (error) throw new ApiError(500, "registro", error.message);

  await ctx.admin.from("portal_facturapi_invoices").upsert({
    client_id: clientId, cfdi_id: cfdi.id, facturapi_id: created.id, uuid: uuidPago, tipo: "P",
    livemode: !!created.livemode, status: created.status ?? "valid",
    related_uuid: (related_documents[0] as { uuid?: string })?.uuid ?? null,
    payload: { related_documents, paid_amount: paidAmount },
  }, { onConflict: "client_id,facturapi_id" });

  // Vincular pagos a CFDI PPD locales si existen.
  for (const doc of related_documents as { uuid?: string; amount?: number }[]) {
    if (!doc.uuid) continue;
    const { data: relatedCfdi } = await ctx.admin.from("portal_cfdi")
      .select("id").eq("client_id", clientId).eq("uuid", doc.uuid.toUpperCase()).maybeSingle();
    if (relatedCfdi) {
      await ctx.admin.from("portal_payment_links").insert({
        payment_cfdi_id: cfdi.id,
        related_cfdi_id: relatedCfdi.id,
        paid_at: created.stamp?.date ?? new Date().toISOString(),
        paid_amount: Number(doc.amount ?? 0),
      });
    }
  }

  await audit(ctx, "emision", clientId, "portal_cfdi", cfdi.id, { uuid: uuidPago, tipo: "P", facturapi_id: created.id, paid_amount: paidAmount });
  return {
    cfdi_id: cfdi.id,
    uuid: uuidPago,
    facturapi_id: created.id,
    prueba: created.livemode === false,
    paid_amount: paidAmount,
    related_documents,
  };
};

const catalogosBuscar: Handler = async (ctx) => {
  const clientId = uuid(ctx.body.client_id, "el cliente");
  await assertClientAccess(ctx, clientId, ["administrador", "operativo", "consulta"]);
  const catalog = str(ctx.body.catalog ?? "c_ClaveProdServ", "el catálogo", 40);
  const q = str(ctx.body.q ?? ctx.body.query ?? "", "la búsqueda", 200);
  const limit = Math.min(40, Math.max(1, Number(ctx.body.limit) || 12));
  const { data, error } = await requireUser(ctx).rpc("portal_sat_catalog_suggest", {
    _catalog: catalog, _q: q, _limit: limit,
  });
  if (error) throw new ApiError(400, "catalogo", error.message);
  return { catalog, q, results: data ?? [] };
};

const plantillasListar: Handler = async (ctx) => {
  const clientId = uuid(ctx.body.client_id, "el cliente");
  await assertClientAccess(ctx, clientId, ["administrador", "operativo", "consulta"]);
  const kind = ctx.body.kind === "concepto" ? "concepto" : "factura";
  const table = kind === "concepto" ? "portal_concept_templates" : "portal_invoice_templates";
  const { data, error } = await requireUser(ctx).from(table).select("*").eq("client_id", clientId).order("updated_at", { ascending: false }).limit(100);
  if (error) throw new ApiError(400, "plantillas", error.message);
  return { kind, plantillas: data ?? [] };
};

const plantillasGuardar: Handler = async (ctx) => {
  const clientId = uuid(ctx.body.client_id, "el cliente");
  await assertClientAccess(ctx, clientId, ["administrador", "operativo"]);
  const kind = ctx.body.kind === "concepto" ? "concepto" : "factura";
  let internalId = String(ctx.body.internal_id ?? "").trim();
  if (!internalId) internalId = `auto-${crypto.randomUUID().slice(0, 8)}`;
  const label = str(ctx.body.label ?? internalId, "la etiqueta", 120);

  if (kind === "concepto") {
    const row = {
      client_id: clientId,
      internal_id: internalId,
      label,
      descripcion: str(ctx.body.descripcion, "la descripción", 1000),
      clave_prod_serv: str(ctx.body.clave_prod_serv, "la clave SAT", 8).replace(/\D/g, ""),
      clave_unidad: String(ctx.body.clave_unidad ?? "E48").toUpperCase(),
      cantidad: Number(ctx.body.cantidad) || 1,
      valor_unitario: Number(ctx.body.valor_unitario) || 0,
      objeto_imp: ctx.body.objeto_imp === "01" ? "01" : "02",
      iva_tasa: ctx.body.objeto_imp === "01" ? null : (Number(ctx.body.iva_tasa) || 0.16),
      created_by: ctx.userId,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await ctx.admin.from("portal_concept_templates").upsert(row, { onConflict: "client_id,internal_id" }).select("*").single();
    if (error) throw new ApiError(400, "plantillas", error.message);
    return { kind, plantilla: data };
  }

  const row = {
    client_id: clientId,
    internal_id: internalId,
    label,
    receptor_rfc: ctx.body.receptor_rfc ? normalizeRfc(String(ctx.body.receptor_rfc)) : null,
    receptor_nombre: ctx.body.receptor_nombre ? String(ctx.body.receptor_nombre).toUpperCase() : null,
    receptor_regimen: ctx.body.receptor_regimen ? String(ctx.body.receptor_regimen) : null,
    receptor_cp: ctx.body.receptor_cp ? String(ctx.body.receptor_cp) : null,
    uso_cfdi: String(ctx.body.uso_cfdi ?? "G03"),
    forma_pago: String(ctx.body.forma_pago ?? "03"),
    metodo_pago: ctx.body.metodo_pago === "PPD" ? "PPD" : "PUE",
    conceptos: Array.isArray(ctx.body.conceptos) ? ctx.body.conceptos : [],
    created_by: ctx.userId,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await ctx.admin.from("portal_invoice_templates").upsert(row, { onConflict: "client_id,internal_id" }).select("*").single();
  if (error) throw new ApiError(400, "plantillas", error.message);
  return { kind, plantilla: data };
};

const plantillasCargar: Handler = async (ctx) => {
  const clientId = uuid(ctx.body.client_id, "el cliente");
  await assertClientAccess(ctx, clientId, ["administrador", "operativo", "consulta"]);
  const kind = ctx.body.kind === "concepto" ? "concepto" : "factura";
  const internalId = str(ctx.body.internal_id, "el id interno", 80);
  const table = kind === "concepto" ? "portal_concept_templates" : "portal_invoice_templates";
  const { data, error } = await requireUser(ctx).from(table).select("*").eq("client_id", clientId).eq("internal_id", internalId).maybeSingle();
  if (error) throw new ApiError(400, "plantillas", error.message);
  if (!data) throw new ApiError(404, "no_encontrada", "No hay plantilla con ese id interno.");
  return { kind, plantilla: data };
};

const clientesListar: Handler = async (ctx) => {
  const clientId = uuid(ctx.body.client_id, "el cliente");
  await assertClientAccess(ctx, clientId, ["administrador", "operativo", "consulta"]);
  const { data, error } = await requireUser(ctx).from("portal_customers")
    .select("*").eq("client_id", clientId).order("updated_at", { ascending: false }).limit(100);
  if (error) throw new ApiError(400, "clientes", error.message);
  return { clientes: data ?? [] };
};

const clientesGuardar: Handler = async (ctx) => {
  const clientId = uuid(ctx.body.client_id, "el cliente");
  await assertClientAccess(ctx, clientId, ["administrador", "operativo"]);
  let internalId = String(ctx.body.internal_id ?? "").trim();
  if (!internalId) internalId = `cli-${crypto.randomUUID().slice(0, 8)}`;
  const row = {
    client_id: clientId,
    internal_id: internalId,
    label: str(ctx.body.label ?? ctx.body.nombre ?? internalId, "la etiqueta", 120),
    rfc: normalizeRfc(str(ctx.body.rfc, "el RFC", 13)),
    nombre: str(ctx.body.nombre, "el nombre", 300).toUpperCase(),
    regimen: String(ctx.body.regimen ?? "601"),
    cp: str(ctx.body.cp, "el CP", 5),
    uso_cfdi: String(ctx.body.uso_cfdi ?? "G03"),
    email: ctx.body.email ? String(ctx.body.email) : null,
    created_by: ctx.userId,
    updated_at: new Date().toISOString(),
  };
  const { data, error } = await ctx.admin.from("portal_customers").upsert(row, { onConflict: "client_id,internal_id" }).select("*").single();
  if (error) throw new ApiError(400, "clientes", error.message);
  return { cliente: data };
};

/** Nota de crédito (CFDI tipo E) vía Facturapi. */
const crearNotaCredito: Handler = async (ctx) => {
  assertEmissionWritable();
  if (PORTAL_EMISOR_MODE !== "facturapi") {
    throw new ApiError(503, "facturapi_requerido", "La nota de crédito requiere PORTAL_EMISOR=facturapi.");
  }
  const cfg = facturapiConfigFromEnv();
  if (!cfg) throw new ApiError(503, "facturapi_not_configured", "Falta FACTURAPI_SECRET_KEY.");
  const clientId = uuid(ctx.body.client_id, "el cliente");
  await assertClientAccess(ctx, clientId, ["administrador"], false);
  const e = await emissionContext(ctx, clientId);
  if (!e.settings?.emission_enabled) throw new ApiError(403, "emision_apagada", "La emisión no está habilitada para este cliente.");
  const borrador = borradorFrom(ctx, e.tp);
  const relatedUuid = typeof ctx.body.related_uuid === "string" ? ctx.body.related_uuid.trim().toUpperCase() : "";
  const body: Record<string, unknown> = {
    type: "E",
    use: borrador.receptor.uso || "G02",
    payment_form: borrador.formaPago || "03",
    payment_method: borrador.metodoPago || "PUE",
    currency: "MXN",
    customer: {
      legal_name: borrador.receptor.nombre.trim(),
      tax_id: borrador.receptor.rfc.trim().toUpperCase(),
      tax_system: borrador.receptor.regimen,
      address: { zip: borrador.receptor.cp, country: "MEX" },
    },
    items: borrador.conceptos.map((c) => ({
      quantity: Number(c.cantidad),
      product: {
        description: c.descripcion.trim(),
        product_key: c.claveProdServ,
        unit_key: c.claveUnidad || "E48",
        price: Number(c.valorUnitario),
        tax_included: false,
        taxability: c.objetoImp,
        taxes: c.objetoImp === "02" && typeof c.ivaTasa === "number"
          ? [{ type: "IVA", rate: c.ivaTasa }]
          : [],
      },
    })),
  };
  if (relatedUuid) {
    body.related_documents = [{ relationship: "01", documents: [relatedUuid] }];
  }
  const created = await createInvoice(cfg, body);
  const uuidNc = (created.uuid ?? crypto.randomUUID()).toUpperCase();
  const total = Number(created.total ?? 0);
  const { data: cfdi, error } = await ctx.admin.from("portal_cfdi").insert({
    client_id: clientId,
    uuid: uuidNc,
    direction: "emitida",
    source: "emision_facturapi",
    is_test: created.livemode === false,
    version: "4.0",
    issued_at: created.stamp?.date ?? new Date().toISOString(),
    issuer_rfc: e.tp?.rfc ?? null,
    issuer_name: e.tp?.razon_social ?? null,
    receiver_rfc: normalizeRfc(borrador.receptor.rfc),
    receiver_name: borrador.receptor.nombre,
    voucher_type: "E",
    payment_form: borrador.formaPago,
    payment_method: borrador.metodoPago,
    currency: "MXN",
    subtotal: Number(borrador.conceptos.reduce((s, c) => s + c.cantidad * c.valorUnitario, 0).toFixed(2)),
    total,
    detail_status: "complete",
    sat_status: created.livemode === false ? "unknown" : "vigente",
  }).select("id").single();
  if (error) throw new ApiError(500, "registro", error.message);
  await ctx.admin.from("portal_facturapi_invoices").upsert({
    client_id: clientId, cfdi_id: cfdi.id, facturapi_id: created.id, uuid: uuidNc, tipo: "E",
    livemode: !!created.livemode, status: created.status ?? "valid",
    related_uuid: relatedUuid || null, payload: { type: "E" },
  }, { onConflict: "client_id,facturapi_id" });
  await audit(ctx, "emision", clientId, "portal_cfdi", cfdi.id, { uuid: uuidNc, tipo: "E", facturapi_id: created.id });
  return { cfdi_id: cfdi.id, uuid: uuidNc, facturapi_id: created.id, prueba: created.livemode === false, total };
};

/**
 * Carga del CSD (C1, C2, C5): autorización previa → validación en memoria →
 * cifrado con secretos propios → guardado en una transacción. Si algo falla no
 * se guarda nada. La respuesta y la bitácora nunca llevan llave ni contraseña.
 */
const cargarCsd: Handler = async (ctx) => {
  const clientId = uuid(ctx.body.client_id, "el cliente");
  await assertClientAccess(ctx, clientId, ["administrador"]);
  const via = ctx.isPortal ? "portal" : "central";
  const cerB64 = str(ctx.body.cer_base64, "el archivo .cer", 20_000).replace(/^data:[^,]*,/, "");
  const keyB64 = str(ctx.body.key_base64, "el archivo .key", 20_000).replace(/^data:[^,]*,/, "");
  const password = str(ctx.body.password, "la contraseña de la llave", 200);
  const r = await registerCsd({
    via,
    secrets: {
      key: Deno.env.get("PORTAL_CSD_KEY_SECRET"),
      password: Deno.env.get("PORTAL_CSD_SECRET"),
      fiel: Deno.env.get("MOFFIN_FIEL_SECRET"),
    },
    async preconditions() {
      const { data, error } = await ctx.admin.rpc("portal_csd_upload_check", { _client_id: clientId, _actor: ctx.userId, _via: via });
      if (error) throw new ApiError(500, "autorizacion", "No se pudo revisar la autorización.");
      return data as { ok: boolean; missing: { key: string; label: string }[] };
    },
    clientRfcs: async () => (await clientRfcs(ctx, clientId)).rfcs,
    encrypt: encryptFielSecret,
    fingerprint: sha256HexFromBase64File,
    async store(row) {
      const { data, error } = await ctx.admin.rpc("portal_csd_store", {
        _client_id: clientId, _actor: ctx.userId, _via: via,
        _cert_ciphertext: row.certCiphertext, _key_ciphertext: row.keyCiphertext, _password_ciphertext: row.passwordCiphertext,
        _serial: row.serialHex, _subject_rfc: row.subjectRfc, _not_before: row.notBefore, _not_after: row.notAfter, _fingerprint: row.fingerprint,
      });
      if (error) throw new ApiError(500, "guardado", "No se pudo guardar el certificado. No se guardó nada; intente de nuevo.");
      return { registryId: data?.registry_id, duplicate: data?.duplicate === true };
    },
    audit: (action, details) => audit(ctx, action, clientId, "portal_csd_registry", null, details),
  }, { cerB64, keyB64, password });
  if (!r.ok) throw new ApiError(r.status, r.code, r.message, r.missing);
  return { csd: publicCsdView({ registry_id: r.registryId, cert_serial: r.meta.serial, cert_not_before: r.meta.notBefore, cert_not_after: r.meta.notAfter, registered_via: via }) };
};

/** Qué falta para poder cargar el CSD (para la pantalla, antes de pedir archivos). */
const requisitosCsd: Handler = async (ctx) => {
  const clientId = uuid(ctx.body.client_id, "el cliente");
  await assertClientAccess(ctx, clientId, ["administrador"]);
  const { data, error } = await requireUser(ctx).rpc("portal_csd_upload_check", {
    _client_id: clientId, _actor: ctx.userId, _via: ctx.isPortal ? "portal" : "central",
  });
  if (error) throw new ApiError(403, "sin_permiso", error.message);
  return data;
};

const estadoCsd: Handler = async (ctx) => {
  const clientId = uuid(ctx.body.client_id, "el cliente");
  const { data, error } = await requireUser(ctx).rpc("portal_csd_status", { _client_id: clientId });
  if (error) throw new ApiError(403, "sin_permiso", error.message);
  return { csd: (data ?? []).map((r: Record<string, unknown>) => publicCsdView(r)) };
};

const revocarCsd: Handler = async (ctx) => {
  const registryId = uuid(ctx.body.registry_id, "el certificado");
  const { data: row } = await requireUser(ctx).from("portal_csd_registry").select("id, client_id, revoked_at").eq("id", registryId).maybeSingle();
  if (!row) throw new ApiError(404, "no_encontrado", "Certificado no encontrado.");
  await assertClientAccess(ctx, row.client_id, ["administrador"]);
  if (!row.revoked_at) {
    await ctx.admin.from("portal_csd_registry").update({ revoked_at: new Date().toISOString(), revoked_by: ctx.userId }).eq("id", registryId);
    // Revocar también apaga la emisión: el expediente deja de estar completo.
    await ctx.admin.from("portal_client_settings").update({ emission_enabled: false, emission_changed_at: new Date().toISOString(), emission_changed_by: ctx.userId }).eq("client_id", row.client_id);
    await audit(ctx, "csd_revocacion", row.client_id, "portal_csd_registry", registryId, {});
  }
  return { ok: true };
};

/**
 * Borra de Storage, en el acto, los archivos que dejó en cola una solicitud de baja
 * (adjuntos, tickets sin facturar, documentos publicados). Lo que falle queda en la
 * cola y portal-notify lo reintenta.
 */
async function drainRequestFiles(ctx: Ctx, requestId: string): Promise<number> {
  const { data: rows } = await ctx.admin.from("portal_storage_purge_queue")
    .select("id, bucket, path").eq("deletion_request_id", requestId).is("done_at", null).limit(1000);
  const byBucket = new Map<string, { id: number; path: string }[]>();
  for (const r of rows ?? []) byBucket.set(r.bucket, [...(byBucket.get(r.bucket) ?? []), { id: r.id, path: r.path }]);
  let n = 0;
  for (const [bucket, items] of byBucket) {
    const { error } = await ctx.admin.storage.from(bucket).remove(items.map((i) => i.path));
    await ctx.admin.rpc("portal_purge_queue_done", { _ids: items.map((i) => i.id), _error: error ? error.message : null });
    if (!error) n += items.length;
  }
  return n;
}

function plazoAnios(v: unknown): 5 | 10 {
  if (v === undefined || v === null || v === 5 || v === "5") return 5;
  if (v === 10 || v === "10") return 10;
  throw new ApiError(400, "plazo", "El plazo de resguardo solo puede ser de 5 o 10 años.");
}

/**
 * Eliminación de la cuenta desde el portal (C4, B1–B3; requisito de App Store y Google Play).
 * La base decide qué se elimina, qué se resguarda y si está bloqueada
 * (portal_execute_account_deletion). La titular de un básico elige 5 (preseleccionado)
 * o 10 años. Después: usuario de Auth (sesiones y tokens caen con él), archivos de
 * Storage y verificación de B2, que queda registrada en la solicitud.
 */
const eliminarCuenta: Handler = async (ctx) => {
  requireUser(ctx);
  if (!ctx.isPortal) throw new ApiError(403, "sin_permiso", "Solo cuentas del portal.");
  if (ctx.body.confirmacion !== "ELIMINAR") throw new ApiError(400, "confirmacion", "Escriba ELIMINAR para confirmar.");
  const years = plazoAnios(ctx.body.plazo_anios);
  const uid = ctx.userId!;
  const { data: acc } = await ctx.admin.from("portal_accounts").select("email").eq("user_id", uid).maybeSingle();
  const { data: res, error } = await ctx.admin.rpc("portal_execute_account_deletion", { _uid: uid, _years: years });
  if (error || !res) throw new ApiError(500, "eliminacion", "No se pudo procesar la eliminación. No se borró nada; intente de nuevo.");
  if (res.bloqueada) {
    throw new ApiError(409, "eliminacion_bloqueada", "Su cuenta no se puede eliminar todavía.", res.bloqueos);
  }
  const { error: delErr } = await ctx.admin.auth.admin.deleteUser(uid);
  await ctx.admin.rpc("portal_finish_account_deletion", { _request_id: res.request_id, _ok: !delErr, _error: delErr?.message ?? null });
  await drainRequestFiles(ctx, res.request_id);
  const { data: check } = await ctx.admin.rpc("portal_offboarding_record_verification", {
    _request_id: res.request_id, _subject: uid, _email: acc?.email ?? null,
  });
  // Bitácora del hecho sin identificar a la persona (ya está seudonimizada).
  ctx.userId = null;
  await audit(ctx, "cuenta_eliminada", null, "portal_deletion_requests", res.request_id, {
    via: "portal", resultado: delErr ? "error_auth" : "ok", verificacion: check?.ok === true,
  });
  if (delErr) throw new ApiError(500, "eliminacion", "Sus datos ya se procesaron, pero falta cerrar su acceso. Intente de nuevo o escríbanos.");
  return { ok: true, resultado: res.result, verificacion: { ok: check?.ok === true } };
};

async function requireStaff(ctx: Ctx, admin = false) {
  requireUser(ctx);
  if (!ctx.isStaff) throw new ApiError(403, "sin_permiso", "Solo el equipo de Kawiil.");
  if (admin) {
    const { data } = await ctx.admin.from("portal_accounts").select("operator_level").eq("user_id", ctx.userId).maybeSingle();
    if (!data?.operator_level || data.operator_level < 3) throw new ApiError(403, "sin_permiso", "Solo G3/G4.");
  }
}

const invitar: Handler = async (ctx) => {
  await requireStaff(ctx, true);
  const email = str(ctx.body.email, "el correo", 254).toLowerCase();
  const fullName = str(ctx.body.full_name, "el nombre", 200);
  const clientId = uuid(ctx.body.client_id, "el cliente");
  const role = str(ctx.body.role, "el rol", 20);
  const tier = (ctx.body.tier as string) ?? "premier";
  // V1: sin cerco verificado no se crea ni se vincula ninguna cuenta.
  if (!(await routeGuardStatus(ctx)).ok) {
    throw new ApiError(503, "cerco_no_verificado", "El cerco de rutas del portal no está verificado; la vinculación de cuentas está bloqueada.");
  }
  let userId: string | null = null;
  const { data: created, error } = await ctx.admin.auth.admin.createUser({
    email, password: randomPassword(), email_confirm: true,
    user_metadata: { kawiil_portal: true, full_name: fullName },
    app_metadata: { kawiil_portal: true, portal_created_via: "invitacion" },
  });
  if (created?.user) userId = created.user.id;
  else if (error && /already|registered|exists/i.test(error.message)) {
    const { data: acc } = await ctx.admin.from("portal_accounts").select("user_id").eq("email", email).maybeSingle();
    if (!acc) throw new ApiError(409, "correo_de_staff", "Ese correo ya tiene cuenta en Kawiil OS y no es del portal.");
    userId = acc.user_id;
  } else throw new ApiError(500, "invitacion", error?.message ?? "No se pudo invitar.");
  const { error: linkErr } = await ctx.user!.rpc("portal_staff_link_account", { _user_id: userId, _client_id: clientId, _role: role, _tier: tier });
  if (linkErr) throw new ApiError(400, "vinculacion", linkErr.message);
  await audit(ctx, "invitacion", clientId, "portal_accounts", userId, { email, role, tier });
  await ctx.anon.auth.resetPasswordForEmail(email, { redirectTo: `${PORTAL_URL}/restablecer` });
  return { user_id: userId };
};

/**
 * B4 · Baja de un cliente premier desde central (G3/G4, doble confirmación).
 * Body: { client_id, confirmacion: "DAR DE BAJA", rfc }  → ejecuta.
 *       { request_id }                                 → reintenta lo que faltó en Auth.
 * La base vuelve a comprobar rol y confirmaciones; aquí se borran los usuarios de
 * Auth, los archivos de Storage y se registra la verificación de B2.
 */
const bajaCliente: Handler = async (ctx) => {
  await requireStaff(ctx, true);
  let requestId: string;
  let clientId: string;
  let usuarios: string[];
  let result: unknown = null;
  if (ctx.body.request_id) {
    requestId = uuid(ctx.body.request_id, "la solicitud");
    const { data: req } = await ctx.admin.from("portal_deletion_requests").select("client_id, status").eq("id", requestId).maybeSingle();
    if (!req?.client_id) throw new ApiError(404, "no_encontrado", "Solicitud no encontrada.");
    clientId = req.client_id;
    const { data: inOrg } = await ctx.user!.rpc("portal_staff_in_client_org", { _uid: ctx.userId, _client_id: clientId });
    if (inOrg !== true) throw new ApiError(403, "sin_permiso", "Solo G3/G4 de la organización del cliente.");
    const { data: pend } = await ctx.admin.rpc("portal_client_offboarding_pending", { _request_id: requestId });
    usuarios = (pend as string[] | null) ?? [];
  } else {
    clientId = uuid(ctx.body.client_id, "el cliente");
    const { data: res, error } = await ctx.admin.rpc("portal_client_offboarding_execute", {
      _client_id: clientId, _actor: ctx.userId,
      _confirmacion: typeof ctx.body.confirmacion === "string" ? ctx.body.confirmacion : "",
      _dato: typeof ctx.body.rfc === "string" ? ctx.body.rfc : "",
    });
    if (error || !res) throw new ApiError(500, "baja", "No se pudo procesar la baja. No se borró nada; intente de nuevo.");
    if (res.rechazada) {
      const msg: Record<string, string> = {
        sin_rol: "Solo G3/G4 de la organización del cliente puede dar de baja.",
        confirmacion: "Escriba DAR DE BAJA para confirmar.",
        dato_no_coincide: "El RFC no coincide con el del cliente.",
        bloqueada: "Este cliente no se puede dar de baja desde aquí.",
      };
      throw new ApiError(res.motivo === "sin_rol" ? 403 : 400, `baja_${res.motivo}`, msg[res.motivo] ?? "Baja rechazada.", res.bloqueos);
    }
    requestId = res.request_id;
    usuarios = res.usuarios ?? [];
    result = res.result;
  }
  const errores: string[] = [];
  for (const u of usuarios) {
    const { error } = await ctx.admin.auth.admin.deleteUser(u);
    if (error) errores.push(error.message);
  }
  const { data: status } = await ctx.admin.rpc("portal_client_offboarding_finish", {
    _request_id: requestId, _error: errores.length ? errores.join("; ").slice(0, 400) : null,
  });
  await drainRequestFiles(ctx, requestId);
  const { data: check } = await ctx.admin.rpc("portal_offboarding_record_verification", { _request_id: requestId });
  return { request_id: requestId, estado: status, resultado: result, verificacion: check, cuentas_pendientes: errores.length };
};

const facturarTicket: Handler = async (ctx) => {
  await requireStaff(ctx);
  const receiptId = uuid(ctx.body.receipt_id, "el ticket");
  const { data: r } = await ctx.user!.from("portal_tickets").select("id, client_id, organization_id").eq("id", receiptId).maybeSingle();
  if (!r) throw new ApiError(404, "no_encontrado", "Ticket no encontrado.");
  const xmlText = new TextDecoder().decode(b64ToBytes(str(ctx.body.xml_base64, "el XML", 8_000_000)));
  const pdfBytes = b64ToBytes(str(ctx.body.pdf_base64, "el PDF", 14_000_000));
  const v = validateCfdiXml(xmlText);
  if (!v.ok || !v.parsed) throw new ApiError(422, "cfdi_invalido", v.errors.join(" "));
  const now = new Date(v.parsed.fecha ?? Date.now());
  const base = `${r.organization_id}/juun/clients/${r.client_id}/${now.getUTCFullYear()}/${String(now.getUTCMonth() + 1).padStart(2, "0")}/cfdi/${v.parsed.uuid}`;
  await upload(ctx, "juun", `${base}.xml`, new TextEncoder().encode(xmlText), "application/xml");
  await upload(ctx, "juun", `${base}.pdf`, pdfBytes, "application/pdf");
  const { error } = await ctx.user!.rpc("portal_staff_ticket_mark_invoiced", {
    _receipt_id: receiptId, _uuid: v.parsed.uuid, _xml_path: `${base}.xml`, _pdf_path: `${base}.pdf`, _total: v.parsed.total,
    _rfc_emisor: v.parsed.emisor.rfc, _rfc_receptor: v.parsed.receptor.rfc, _issue_date: v.parsed.fecha,
  });
  if (error) throw new ApiError(400, "facturacion", error.message);
  // La factura del gasto también alimenta el tablero del cliente.
  const portalXml = `${r.organization_id}/${r.client_id}/cfdi/${v.parsed.uuid}.xml`;
  await upload(ctx, "portal", portalXml, new TextEncoder().encode(xmlText), "application/xml");
  await ctx.admin.from("portal_cfdi").upsert({
    organization_id: r.organization_id, client_id: r.client_id, source: "carga_xml", xml_path: portalXml, created_by: ctx.userId,
    ...toPortalCfdiRow(v.parsed, "recibida"),
  }, { onConflict: "client_id,uuid", ignoreDuplicates: true });
  return { ok: true, uuid: v.parsed.uuid };
};

const sugerirCategorias: Handler = async (ctx) => {
  await requireStaff(ctx);
  const ids = Array.isArray(ctx.body.cfdi_ids) ? (ctx.body.cfdi_ids as string[]).slice(0, 50) : [];
  const gw = { url: Deno.env.get("OPENCLAW_GATEWAY_URL"), token: Deno.env.get("OPENCLAW_GATEWAY_TOKEN"), model: Deno.env.get("OPENCLAW_MODEL"), path: Deno.env.get("OPENCLAW_GATEWAY_PATH") };
  if (!gw.url) return { sugeridas: 0, apagado: true, motivo: "OPENCLAW_GATEWAY_URL no configurada" };
  const { data: rows } = await ctx.user!.from("portal_cfdi").select("id, organization_id, nombre_emisor, rfc_emisor, descripcion, clave_prod_serv, total, category_status").in("id", ids);
  const { data: cats } = await ctx.user!.from("portal_expense_categories").select("id, name").eq("active", true);
  let n = 0;
  for (const row of rows ?? []) {
    if (row.category_status === "confirmada") continue;
    const s = await suggestCategory(gw, { nombreEmisor: row.nombre_emisor, rfcEmisor: row.rfc_emisor, descripcion: row.descripcion, claveProdServ: row.clave_prod_serv, total: row.total }, cats ?? []);
    if (s) { await ctx.admin.rpc("portal_set_category_suggestion", { _cfdi_id: row.id, _category_id: s.categoryId, _model: s.model }); n++; }
  }
  return { sugeridas: n, nota: "Las sugerencias no son definitivas: confírmelas en «Facturas → Por confirmar»." };
};

const avisar: Handler = async (ctx) => {
  await requireStaff(ctx);
  const clientId = uuid(ctx.body.client_id, "el cliente");
  await assertClientAccess(ctx, clientId, [], true);
  const asunto = str(ctx.body.asunto, "el asunto", 200);
  const mensaje = str(ctx.body.mensaje, "el mensaje", 4000);
  const { data: to } = await ctx.admin.rpc("portal_client_admin_emails", { _client_id: clientId });
  await ctx.admin.rpc("portal_enqueue", { _channel: "correo", _event: "aviso_equipo", _client_id: clientId, _payload: { asunto, mensaje, to } });
  return { ok: true, destinatarios: (to ?? []).length };
};

const sesionActual: Handler = async (ctx) => {
  const { data, error } = await requireUser(ctx).rpc("portal_me");
  if (error) throw new ApiError(403, "sin_permiso", "No se pudo consultar la sesión.");
  return data;
};

const registrarAcceso: Handler = async (ctx) => {
  const { error } = await requireUser(ctx).rpc("portal_log_access", {});
  if (error) throw new ApiError(403, "sin_permiso", "No se pudo registrar el acceso.");
  return { ok: true };
};

const legalActual: Handler = async (ctx) => {
  const kind = str(ctx.body.kind, "el tipo de texto", 40);
  const { data, error } = await requireUser(ctx).rpc("portal_current_legal", { _kind: kind });
  if (error) throw new ApiError(403, "sin_permiso", "No se pudo consultar el texto legal.");
  return data;
};

const aceptarLegal: Handler = async (ctx) => {
  const kind = str(ctx.body.kind, "el tipo de texto", 40);
  const clientId = ctx.body.client_id ? uuid(ctx.body.client_id, "el cliente") : null;
  const { error } = await requireUser(ctx).rpc("portal_accept_legal", {
    _kind: kind, _client_id: clientId, _user_agent: typeof ctx.body.user_agent === "string" ? ctx.body.user_agent.slice(0, 300) : null,
  });
  if (error) throw new ApiError(403, "sin_permiso", "No se pudo registrar la aceptación.");
  return { ok: true };
};

const activarBasico: Handler = async (ctx) => {
  const { error } = await requireUser(ctx).rpc("portal_activate_basic", {
    _razon_social: str(ctx.body.razon_social, "la razón social", 200), _rfc: str(ctx.body.rfc, "el RFC", 13),
  });
  if (error) throw new ApiError(400, "activacion", error.message);
  return { ok: true };
};

const tablero: Handler = async (ctx) => {
  const clientId = uuid(ctx.body.client_id, "el cliente");
  await assertClientAccess(ctx, clientId, ["administrador", "consulta"]);
  const year = Number(ctx.body.year);
  const month = Number(ctx.body.month);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new ApiError(400, "dato_invalido", "Indique año y mes válidos.");
  }

  const { data: settings } = await requireUser(ctx).from("portal_client_settings").select("iva_basis").eq("client_id", clientId).maybeSingle();
  const ivaBasis = settings?.iva_basis === "issuance" ? "issuance" as const : "cash_flow" as const;

  // Preferir resumen publicado por central si existe (espejo).
  // Ignorar resúmenes didácticos / smoke (is_test) que contaminan KPI del demo Bassoco.
  const publishedRes = await requireUser(ctx).from("portal_fiscal_summaries")
    .select("payload, quality, iva_basis, published_at").eq("client_id", clientId).eq("period_year", year).eq("period_month", month).maybeSingle();
  const published = publishedRes.error ? null : publishedRes.data;
  const publishedQuality = published?.quality && typeof published.quality === "object"
    ? published.quality as Record<string, unknown>
    : null;
  const publishedIsTest = publishedQuality?.is_test === true
    || /demostraci[oó]n|sin validez fiscal|smoke/i.test(String((published?.payload as { leyenda?: string } | null)?.leyenda ?? ""));
  if (published?.payload && typeof published.payload === "object" && !publishedIsTest) {
    return {
      ...(published.payload as object),
      iva_basis: published.iva_basis ?? ivaBasis,
      iva_basis_label: ivaBasisLabel((published.iva_basis === "issuance" ? "issuance" : "cash_flow")),
      calidad: published.quality ?? {},
      espejo: true,
      resumen_publicado_en: published.published_at,
      leyenda: "Cifras publicadas por Kawiil desde central. Solo lectura.",
    };
  }

  // Cálculo local del espejo a partir de CFDI ya publicados.
  const { start, end } = periodBounds(year, month);
  const { invoices, rows } = await loadMirrorInvoices(ctx, clientId);
  const estimate = calculateFiscalEstimate(invoices, start, end, ivaBasis);
  const quality = dataQualityFromInvoices(rows.map((r) => ({ detail_status: String(r.detail_status ?? "metadata") })));
  const inMonth = rows.filter((r) => {
    const d = String(r.issued_at ?? "").slice(0, 10);
    return d >= start && d <= end;
  });
  // Gasto / ingreso del periodo = base gravable (subtotal); IVA en cuadro aparte.
  const periodExpense = calculatePeriodExpense(invoices, start, end);
  const gasto = periodExpense.gasto_subtotal;
  const periodIncome = calculatePeriodIncome(invoices, start, end);
  const ingreso = periodIncome.ingreso_bruto;
  const marcas = inMonth.filter((r) => Array.isArray(r.flags) && (r.flags as unknown[]).length > 0).map((r) => ({
    cfdi_id: r.id, emisor: r.issuer_name ?? r.issuer_rfc, total: r.total, fecha: r.issued_at, flags: r.flags,
  }));

  // Compatibilidad con RPC portal_dashboard cuando exista (cadena de ensayo en central).
  const { data: rpcData, error: rpcError } = await requireUser(ctx).rpc("portal_dashboard", {
    _client_id: clientId, _year: year, _month: month,
  });
  if (!rpcError && rpcData && typeof rpcData === "object") {
    return {
      ...rpcData,
      // Sobrescribe con regla Polo: bruto = subtotal; IVA en cuadro aparte.
      gasto_total: gasto,
      gasto_subtotal: gasto,
      gasto_basis: "subtotal",
      ingreso_total: ingreso,
      ingreso_bruto: ingreso,
      ingreso_basis: "subtotal",
      ingreso_regla: "pue_emision_ppd_complemento_subtotal",
      ingreso_pue_count: periodIncome.pue_count,
      ingreso_ppd_complement_count: periodIncome.ppd_complement_count,
      ingreso_pendiente_cobranza: periodIncome.pending_cobranza,
      iva_basis: ivaBasis,
      iva_basis_label: ivaBasisLabel(ivaBasis),
      retenciones: {
        iva_retenido_a_la_empresa: estimate.vatWithheldFromCompany,
        iva_retenido_por_la_empresa: estimate.vatWithheldByCompany,
        isr_retenido_a_la_empresa: estimate.incomeTaxWithheldFromCompany,
        isr_retenido_por_la_empresa: estimate.incomeTaxWithheldByCompany,
      },
      iva: { trasladado: estimate.vatTransferred, acreditable: estimate.vatCreditable, facturas_sin_desglose: quality.metadata_only },
      iva_estimado: estimate.estimatedVat,
      iva_flujo: {
        trasladado: estimate.vatTransferred,
        acreditable: estimate.vatCreditable,
        estimado: estimate.estimatedVat,
        por_tasa: estimate.byRate,
        pendientes_de_pago: estimate.pendingPayment,
      },
      calidad: quality,
      espejo: MIRROR_READ_ONLY,
    };
  }

  return {
    gasto_total: Math.round(gasto * 100) / 100,
    gasto_subtotal: Math.round(gasto * 100) / 100,
    gasto_basis: "subtotal",
    gasto_mes_anterior: 0,
    ingreso_total: Math.round(ingreso * 100) / 100,
    ingreso_bruto: Math.round(ingreso * 100) / 100,
    ingreso_basis: "subtotal",
    ingreso_regla: "pue_emision_ppd_complemento_subtotal",
    ingreso_pue_count: periodIncome.pue_count,
    ingreso_ppd_complement_count: periodIncome.ppd_complement_count,
    ingreso_pendiente_cobranza: periodIncome.pending_cobranza,
    ingreso_mes_anterior: 0,
    por_categoria: [],
    por_proveedor: [],
    por_mes: [],
    iva: { trasladado: estimate.vatTransferred, acreditable: estimate.vatCreditable, facturas_sin_desglose: quality.metadata_only },
    iva_estimado: estimate.estimatedVat,
    retenciones: {
      iva_retenido_a_la_empresa: estimate.vatWithheldFromCompany,
      iva_retenido_por_la_empresa: estimate.vatWithheldByCompany,
      isr_retenido_a_la_empresa: estimate.incomeTaxWithheldFromCompany,
      isr_retenido_por_la_empresa: estimate.incomeTaxWithheldByCompany,
    },
    iva_flujo: {
      trasladado: estimate.vatTransferred,
      acreditable: estimate.vatCreditable,
      estimado: estimate.estimatedVat,
      por_tasa: estimate.byRate,
      pendientes_de_pago: estimate.pendingPayment,
    },
    iva_basis: ivaBasis,
    iva_basis_label: ivaBasisLabel(ivaBasis),
    calidad: quality,
    marcas,
    por_confirmar: inMonth.filter((r) => r.category_status !== "confirmada").length,
    espejo: true,
    leyenda: "Estimación a partir de las facturas de tu cuenta (ingreso/gasto = subtotal; IVA aparte). No es una declaración presentada.",
  };
};

type CfdiListRow = Record<string, unknown> & { id: string };

async function enrichFacturasCobranza(ctx: Ctx, rows: CfdiListRow[]) {
  const ids = rows.map((r) => r.id as string);
  const paidByRelated = new Map<string, { paid: number; count: number; payments: { paid_at: string; paid_amount: number }[] }>();
  const conceptIssuesByCfdi = new Map<string, { faltante: number; invalida: number; no_cuadra: number; label: string | null }>();
  if (ids.length) {
    const [{ data: links }, { data: concepts }] = await Promise.all([
      ctx.admin.from("portal_payment_links").select("related_cfdi_id, paid_at, paid_amount").in("related_cfdi_id", ids),
      ctx.admin.from("portal_cfdi_concepts").select("cfdi_id, product_service_key, description").in("cfdi_id", ids),
    ]);
    for (const link of links ?? []) {
      const key = String(link.related_cfdi_id);
      const cur = paidByRelated.get(key) ?? { paid: 0, count: 0, payments: [] };
      const amount = Number(link.paid_amount ?? 0);
      cur.paid += amount;
      cur.count += 1;
      cur.payments.push({ paid_at: String(link.paid_at ?? ""), paid_amount: amount });
      paidByRelated.set(key, cur);
    }
    const byCfdi = new Map<string, { product_service_key: string | null; description: string }[]>();
    for (const concept of concepts ?? []) {
      const key = String(concept.cfdi_id);
      const list = byCfdi.get(key) ?? [];
      list.push({
        product_service_key: concept.product_service_key ?? null,
        description: String(concept.description ?? ""),
      });
      byCfdi.set(key, list);
    }
    for (const [cfdiId, lines] of byCfdi) {
      let faltante = 0;
      let invalida = 0;
      let no_cuadra = 0;
      for (const line of lines) {
        const key = String(line.product_service_key ?? "").trim();
        if (!key) { faltante += 1; continue; }
        if (!/^\d{8}$/.test(key)) { invalida += 1; continue; }
        const d = line.description.toLowerCase();
        if (["15101514", "15101505", "15101515"].includes(key) && /consultor|servicio|asesor|honorario|contab|fiscal|legal|auditor/.test(d)) {
          no_cuadra += 1;
        }
      }
      const totalIssues = faltante + invalida + no_cuadra;
      let label: string | null = null;
      if (totalIssues === 0) label = null;
      else if (faltante && !invalida && !no_cuadra) label = faltante === 1 ? "Falta clave de producto" : `${faltante} partidas sin clave`;
      else if (no_cuadra && !faltante && !invalida) label = "Clave no cuadra con el concepto";
      else if (invalida && !faltante && !no_cuadra) label = "Clave inválida";
      else label = "Revisar claves de producto";
      conceptIssuesByCfdi.set(cfdiId, { faltante, invalida, no_cuadra, label });
    }
  }
  return rows.map((c) => {
    const pay = paidByRelated.get(String(c.id)) ?? { paid: 0, count: 0, payments: [] as { paid_at: string; paid_amount: number }[] };
    const keys = conceptIssuesByCfdi.get(String(c.id)) ?? { faltante: 0, invalida: 0, no_cuadra: 0, label: null };
    const metodo = c.payment_method === "PUE" || c.payment_method === "PPD" ? c.payment_method : null;
    const voucher = typeof c.voucher_type === "string" ? c.voucher_type : null;
    const total = Number(c.total ?? 0);
    const detailPending = c.detail_status !== "complete" && total <= 0.009 && !metodo;
    let cobranza_estado = "no_aplica";
    let cobranza_label = "Sin dato de cobro";
    if (voucher === "E") { cobranza_estado = "no_aplica"; cobranza_label = "Descuento"; }
    else if (voucher === "P") { cobranza_estado = "no_aplica"; cobranza_label = "Complemento"; }
    else if (metodo === "PUE") { cobranza_estado = "pagado"; cobranza_label = "Cobrado"; }
    else if (metodo === "PPD") {
      if (pay.paid <= 0.009) { cobranza_estado = "pendiente"; cobranza_label = "Pendiente por cobrar"; }
      else if (pay.paid + 0.009 < total) { cobranza_estado = "parcial"; cobranza_label = "Cobrado parcial"; }
      else { cobranza_estado = "pagado"; cobranza_label = "Cobrado"; }
    } else if (!detailPending && total > 0.009) {
      cobranza_estado = "por_revisar";
      cobranza_label = "Por revisar";
    }
    return {
      id: c.id,
      uuid: c.uuid,
      direction: c.direction,
      source: c.source,
      detail_status: c.detail_status,
      fecha: c.issued_at,
      rfc_emisor: c.issuer_rfc,
      nombre_emisor: c.issuer_name,
      rfc_receptor: c.receiver_rfc,
      nombre_receptor: c.receiver_name,
      voucher_type: voucher,
      forma_pago: c.payment_form,
      metodo_pago: metodo,
      subtotal: c.subtotal,
      total: c.total,
      sat_status: c.sat_status,
      xml_path: c.xml_path,
      pdf_path: c.pdf_path,
      is_test: c.is_test,
      flags: c.flags,
      category_name: c.category_name,
      category_status: c.category_status,
      paid_amount: Math.round(pay.paid * 100) / 100,
      payments_count: pay.count,
      payments: pay.payments,
      cobranza_estado,
      cobranza_label,
      clave_issues_label: keys.label,
      clave_faltante: keys.faltante,
      clave_invalida: keys.invalida,
      clave_no_cuadra: keys.no_cuadra,
    };
  });
}

const listarFacturas: Handler = async (ctx) => {
  const clientId = uuid(ctx.body.client_id, "el cliente");
  await assertClientAccess(ctx, clientId, ["administrador", "operativo", "consulta"]);
  const filters = (ctx.body.filters ?? {}) as Record<string, unknown>;
  const direction = ctx.body.direction === "emitida" ? "emitida" : "recibida";
  let query = requireUser(ctx).from("portal_cfdi").select(
    "id, uuid, direction, source, detail_status, issued_at, issuer_rfc, issuer_name, receiver_rfc, receiver_name, voucher_type, payment_form, payment_method, subtotal, total, sat_status, xml_path, pdf_path, is_test, flags, category_name, category_status",
  ).eq("client_id", clientId).eq("direction", direction).or("is_test.is.null,is_test.eq.false").order("issued_at", { ascending: false }).limit(200);
  if (typeof filters.desde === "string" && filters.desde) query = query.gte("issued_at", filters.desde);
  if (typeof filters.hasta === "string" && filters.hasta) query = query.lte("issued_at", `${filters.hasta}T23:59:59`);
  const rfc = typeof filters.rfc === "string" ? filters.rfc.replace(/[^A-Za-z0-9&Ñ]/g, "") : "";
  if (rfc) query = query.or(`issuer_rfc.ilike.%${rfc}%,receiver_rfc.ilike.%${rfc}%`);
  if (Number.isFinite(Number(filters.min)) && filters.min !== "") query = query.gte("total", Number(filters.min));
  if (Number.isFinite(Number(filters.max)) && filters.max !== "") query = query.lte("total", Number(filters.max));
  if (typeof filters.estatus === "string" && filters.estatus) query = query.eq("sat_status", filters.estatus);
  if (typeof filters.metodo === "string" && (filters.metodo === "PUE" || filters.metodo === "PPD")) {
    query = query.eq("payment_method", filters.metodo);
  }
  const { data: raw, error } = await query;
  if (error) throw new ApiError(400, "consulta", "No se pudieron consultar las facturas.");
  const facturas = await enrichFacturasCobranza(ctx, (raw ?? []) as CfdiListRow[]);
  const cobranzaFilter = typeof filters.cobranza === "string" ? filters.cobranza : "";
  const filtered = cobranzaFilter
    ? facturas.filter((f) => f.cobranza_estado === cobranzaFilter)
    : facturas;
  return { facturas: filtered, espejo: MIRROR_READ_ONLY, carga_cliente_habilitada: !MIRROR_READ_ONLY };
};

/** Buscar CFDI del periodo en representación local; si no hay, persistir solicitud de descarga. */
const periodoFacturas: Handler = async (ctx) => {
  const clientId = uuid(ctx.body.client_id, "el cliente");
  await assertClientAccess(ctx, clientId, ["administrador", "operativo", "consulta"]);
  const direction = ctx.body.direction === "emitida" ? "emitida" : "recibida";
  const periodKind = ctx.body.period_kind === "semana" || ctx.body.period_kind === "rango"
    ? ctx.body.period_kind
    : "mes";
  const desde = str(ctx.body.desde, "la fecha inicial", 10);
  const hasta = str(ctx.body.hasta, "la fecha final", 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(desde) || !/^\d{4}-\d{2}-\d{2}$/.test(hasta)) {
    throw new ApiError(400, "dato_invalido", "Usa fechas YYYY-MM-DD.");
  }
  if (hasta < desde) throw new ApiError(400, "dato_invalido", "La fecha final debe ser ≥ inicial.");
  const solicitar = ctx.body.solicitar === true;

  const { data: raw, error } = await requireUser(ctx).from("portal_cfdi").select(
    "id, uuid, direction, source, detail_status, issued_at, issuer_rfc, issuer_name, receiver_rfc, receiver_name, voucher_type, payment_form, payment_method, subtotal, total, sat_status, xml_path, pdf_path, is_test, flags, category_name, category_status",
  ).eq("client_id", clientId).eq("direction", direction)
    .or("is_test.is.null,is_test.eq.false")
    .gte("issued_at", desde)
    .lte("issued_at", `${hasta}T23:59:59`)
    .order("issued_at", { ascending: false })
    .limit(200);
  if (error) throw new ApiError(400, "consulta", "No se pudieron consultar las facturas del periodo.");

  const facturas = await enrichFacturasCobranza(ctx, (raw ?? []) as CfdiListRow[]);

  const { data: existingRows } = await ctx.admin.from("portal_cfdi_period_requests")
    .select("id, status, created_at, period_start, period_end")
    .eq("client_id", clientId)
    .eq("direction", direction)
    .eq("period_start", desde)
    .eq("period_end", hasta)
    .order("created_at", { ascending: false })
    .limit(1);
  const existingReq = existingRows?.[0] ?? null;

  if (facturas.length > 0) {
    if (existingReq && existingReq.status !== "lista") {
      await ctx.admin.from("portal_cfdi_period_requests")
        .update({ status: "lista", updated_at: new Date().toISOString() })
        .eq("id", existingReq.id);
    }
    await audit(ctx, "cfdi_periodo_consulta", clientId, "portal_cfdi_period_requests", existingReq?.id ?? null, {
      direction, desde, hasta, count: facturas.length, coverage: "con_datos",
    });
    return {
      coverage: "con_datos",
      count: facturas.length,
      facturas,
      desde,
      hasta,
      request: existingReq
        ? { id: existingReq.id, status: "lista", created_at: existingReq.created_at }
        : null,
      requested_now: false,
      message: `${facturas.length} factura${facturas.length === 1 ? "" : "s"} ya descargada${facturas.length === 1 ? "" : "s"} en tu cuenta (${desde} → ${hasta}).`,
    };
  }

  let request = existingReq
    ? { id: existingReq.id as string, status: String(existingReq.status), created_at: String(existingReq.created_at) }
    : null;
  let requestedNow = false;

  if (solicitar) {
    await assertClientAccess(ctx, clientId, ["administrador", "operativo"]);
    const { data: inserted, error: insErr } = await ctx.admin.from("portal_cfdi_period_requests").insert({
      client_id: clientId,
      direction,
      period_kind: periodKind,
      period_start: desde,
      period_end: hasta,
      status: "solicitada",
      requested_by: ctx.userId,
      note: `Solicitud desde ${direction === "emitida" ? "Ingresos" : "Egresos"}`,
    }).select("id, status, created_at").single();
    if (insErr || !inserted) {
      throw new ApiError(400, "solicitud", insErr?.message ?? "No se pudo guardar la solicitud de descarga.");
    }
    request = { id: inserted.id, status: inserted.status, created_at: inserted.created_at };
    requestedNow = true;
    await audit(ctx, "cfdi_periodo_solicitud", clientId, "portal_cfdi_period_requests", inserted.id, {
      direction, desde, hasta, period_kind: periodKind,
    });
  }

  return {
    coverage: "sin_datos",
    count: 0,
    facturas: [],
    desde,
    hasta,
    request,
    requested_now: requestedNow,
    message: requestedNow
      ? `Descarga solicitada para ${desde} → ${hasta}. Queda registrada; cuando Kawiil la publique, vuelve a buscar.`
      : request
        ? `Sin facturas aún en ${desde} → ${hasta}. Ya hay una solicitud (${request.status}).`
        : `Sin facturas descargadas en ${desde} → ${hasta}. Puedes solicitar la descarga.`,
  };
};

const detalleFactura: Handler = async (ctx) => {
  const clientId = uuid(ctx.body.client_id, "el cliente");
  await assertClientAccess(ctx, clientId, ["administrador", "operativo", "consulta"]);
  const cfdiId = uuid(ctx.body.cfdi_id, "la factura");
  const { data: cfdi, error } = await requireUser(ctx).from("portal_cfdi").select("*").eq("client_id", clientId).eq("id", cfdiId).maybeSingle();
  if (error || !cfdi) throw new ApiError(404, "no_encontrado", "No se encontró la factura.");
  const [{ data: taxLines }, { data: concepts }, { data: payments }] = await Promise.all([
    ctx.admin.from("portal_cfdi_tax_lines").select("tax, kind, rate, factor, base, amount").eq("cfdi_id", cfdiId),
    ctx.admin.from("portal_cfdi_concepts").select("product_service_key, description, quantity, unit_value, amount, discount").eq("cfdi_id", cfdiId),
    ctx.admin.from("portal_payment_links").select("paid_at, paid_amount, payment_cfdi_id").eq("related_cfdi_id", cfdiId),
  ]);
  const paidAmount = (payments ?? []).reduce((s, p) => s + Number(p.paid_amount ?? 0), 0);
  const paymentIds = [...new Set((payments ?? []).map((p) => p.payment_cfdi_id).filter(Boolean))];
  let complementos: { id: string; uuid: string; paid_at: string; paid_amount: number }[] = [];
  if (paymentIds.length) {
    const { data: payCfdis } = await ctx.admin.from("portal_cfdi")
      .select("id, uuid").in("id", paymentIds);
    const byId = new Map((payCfdis ?? []).map((r) => [String(r.id), String(r.uuid)]));
    complementos = (payments ?? []).map((p) => ({
      id: String(p.payment_cfdi_id),
      uuid: byId.get(String(p.payment_cfdi_id)) ?? String(p.payment_cfdi_id),
      paid_at: String(p.paid_at),
      paid_amount: Number(p.paid_amount),
    }));
  }
  const flags = Array.isArray(cfdi.flags) ? cfdi.flags as { code?: string; reason?: string }[] : [];
  const ncRelated = flags.find((f) => String(f.code ?? "").toLowerCase() === "nota_credito");
  const ncUuidMatch = ncRelated?.reason?.match(/[0-9A-Fa-f]{8}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{4}-[0-9A-Fa-f]{12}/);
  let notaCreditoDe: { id: string; uuid: string } | null = null;
  if (ncUuidMatch) {
    const { data: related } = await requireUser(ctx).from("portal_cfdi")
      .select("id, uuid").eq("client_id", clientId).eq("uuid", ncUuidMatch[0].toUpperCase()).maybeSingle();
    if (related) notaCreditoDe = { id: related.id, uuid: related.uuid };
  }
  const { data: notasSobreEsta } = await requireUser(ctx).from("portal_cfdi")
    .select("id, uuid, total, issued_at, flags")
    .eq("client_id", clientId)
    .eq("voucher_type", "E");
  const notasCredito = (notasSobreEsta ?? []).filter((n) => {
    const reason = Array.isArray(n.flags)
      ? (n.flags as { code?: string; reason?: string }[])
        .find((f) => String(f.code ?? "").toLowerCase() === "nota_credito")?.reason ?? ""
      : "";
    return reason.toUpperCase().includes(String(cfdi.uuid).toUpperCase());
  }).map((n) => ({ id: n.id, uuid: n.uuid, total: n.total, fecha: n.issued_at }));

  return {
    factura: {
      id: cfdi.id,
      uuid: cfdi.uuid,
      direction: cfdi.direction,
      fecha: cfdi.issued_at,
      rfc_emisor: cfdi.issuer_rfc,
      nombre_emisor: cfdi.issuer_name,
      rfc_receptor: cfdi.receiver_rfc,
      nombre_receptor: cfdi.receiver_name,
      voucher_type: cfdi.voucher_type ?? null,
      forma_pago: cfdi.payment_form,
      metodo_pago: cfdi.payment_method,
      subtotal: cfdi.subtotal,
      total: cfdi.total,
      vat_transferred: cfdi.vat_transferred,
      vat_withheld: cfdi.vat_withheld,
      income_tax_withheld: cfdi.income_tax_withheld,
      sat_status: cfdi.sat_status,
      detail_status: cfdi.detail_status,
      category_name: cfdi.category_name,
      category_status: cfdi.category_status,
      flags: cfdi.flags,
      xml_path: cfdi.xml_path,
      pdf_path: cfdi.pdf_path,
      is_test: cfdi.is_test,
      paid_amount: Math.round(paidAmount * 100) / 100,
    },
    impuestos: taxLines ?? [],
    conceptos: concepts ?? [],
    pagos: payments ?? [],
    complementos,
    notas_credito: notasCredito,
    nota_credito_de: notaCreditoDe,
    calidad: cfdi.detail_status === "complete" ? "completa" : "solo_metadatos",
    espejo: true,
  };
};

const listarAlertas: Handler = async (ctx) => {
  const clientId = uuid(ctx.body.client_id, "el cliente");
  await assertClientAccess(ctx, clientId, ["administrador", "operativo", "consulta"]);
  const { data, error } = await requireUser(ctx).from("portal_fiscal_alerts")
    .select("id, alert_type, severity, title, detail, related_uuid, detected_at, published_at")
    .eq("client_id", clientId).order("published_at", { ascending: false }).limit(200);
  if (error) throw new ApiError(400, "consulta", "No se pudieron consultar las alertas.");
  return { alertas: data ?? [] };
};

const listarNotificacionesSat: Handler = async (ctx) => {
  const clientId = uuid(ctx.body.client_id, "el cliente");
  await assertClientAccess(ctx, clientId, ["administrador", "operativo", "consulta"]);
  const { data, error } = await requireUser(ctx).from("portal_sat_notifications")
    .select("id, title, body, notification_type, notified_at, obtained_at, file_name, published_at")
    .eq("client_id", clientId).order("published_at", { ascending: false }).limit(200);
  if (error) throw new ApiError(400, "consulta", "No se pudieron consultar las notificaciones del SAT.");
  return { notificaciones: data ?? [] };
};

const solicitarCancelacion: Handler = async (ctx) => {
  const { error } = await requireUser(ctx).rpc("portal_cancel_request", {
    _cfdi_id: uuid(ctx.body.cfdi_id, "la factura"), _motivo: str(ctx.body.motivo, "el motivo", 2),
    _folio_sustitucion: typeof ctx.body.folio_sustitucion === "string" && ctx.body.folio_sustitucion ? ctx.body.folio_sustitucion : null,
    _comment: typeof ctx.body.comment === "string" && ctx.body.comment ? ctx.body.comment.slice(0, 1000) : null,
  });
  if (error) throw new ApiError(400, "cancelacion", error.message);
  return { ok: true };
};

const listarDocumentos: Handler = async (ctx) => {
  const clientId = uuid(ctx.body.client_id, "el cliente");
  await assertClientAccess(ctx, clientId, ["administrador", "operativo", "consulta"]);
  const { data, error } = await requireUser(ctx).from("portal_documents")
    .select("id, title, doc_type, period_year, period_month, published_at, obtained_at, opinion_result, file_name")
    .eq("client_id", clientId)
    .order("period_year", { ascending: false }).order("period_month", { ascending: false });
  if (error) throw new ApiError(400, "consulta", "No se pudieron consultar los documentos.");
  return { documentos: data ?? [] };
};

const descargarDocumento: Handler = async (ctx) => {
  const id = uuid(ctx.body.document_id, "el documento");
  const { error } = await requireUser(ctx).rpc("portal_document_mark_read", { _document_id: id });
  if (error) throw new ApiError(403, "sin_permiso", "No tiene acceso al documento.");
  ctx.body.kind = "documento";
  ctx.body.id = id;
  return enlaceArchivo(ctx);
};

const listarTickets: Handler = async (ctx) => {
  const clientId = uuid(ctx.body.client_id, "el cliente");
  await assertClientAccess(ctx, clientId, ["administrador", "operativo", "consulta"]);
  const [{ data: tickets, error }, { data: merchants }] = await Promise.all([
    requireUser(ctx).from("portal_tickets_v").select("*").eq("client_id", clientId).order("created_at", { ascending: false }).limit(100),
    requireUser(ctx).from("portal_merchants").select("id, name, slug, window_type, window_days").eq("active", true).order("name"),
  ]);
  if (error) throw new ApiError(400, "consulta", "No se pudieron consultar los tickets.");
  return { tickets: tickets ?? [], merchants: merchants ?? [] };
};

const registrarTicket: Handler = async (ctx) => {
  const clientId = uuid(ctx.body.client_id, "el cliente");
  await assertClientAccess(ctx, clientId, ["administrador", "operativo"]);
  const bytes = b64ToBytes(str(ctx.body.file_base64, "el archivo", 15_000_000));
  if (bytes.length > 10 * 1024 * 1024) throw new ApiError(400, "dato_invalido", "El archivo pasa de 10 MB.");
  const name = str(ctx.body.file_name, "el nombre del archivo", 240).replace(/[^a-zA-Z0-9._-]/g, "_");
  const mime = typeof ctx.body.mime_type === "string" ? ctx.body.mime_type : "application/octet-stream";
  const { org } = await clientRfcs(ctx, clientId);
  const d = new Date();
  const path = `${org}/juun/clients/${clientId}/${d.getUTCFullYear()}/${String(d.getUTCMonth() + 1).padStart(2, "0")}/receipts/${Date.now()}_${name}`;
  await upload(ctx, "juun", path, bytes, mime);
  const { data, error } = await requireUser(ctx).rpc("portal_ticket_register", {
    _client_id: clientId, _file_path: path, _file_hash: str(ctx.body.file_hash, "la huella", 128),
    _merchant_id: ctx.body.merchant_id || null, _merchant_name: ctx.body.merchant_name || null,
    _receipt_date: ctx.body.receipt_date || null, _folio: ctx.body.folio || null, _total: ctx.body.total ?? null,
  });
  if (error) {
    await ctx.admin.storage.from("juun").remove([path]);
    throw new ApiError(400, "ticket", error.message);
  }
  return data;
};

const listarHilos: Handler = async (ctx) => {
  const clientId = uuid(ctx.body.client_id, "el cliente");
  await assertClientAccess(ctx, clientId, ["administrador", "operativo", "consulta"]);
  const { data, error } = await requireUser(ctx).from("portal_threads").select("id, subject, status, kind, last_message_at")
    .eq("client_id", clientId).order("last_message_at", { ascending: false });
  if (error) throw new ApiError(400, "consulta", "No se pudieron consultar las conversaciones.");
  return { hilos: data ?? [] };
};

const leerHilo: Handler = async (ctx) => {
  const id = uuid(ctx.body.thread_id, "la conversación");
  const user = requireUser(ctx);
  const [{ data: messages, error }, { data: attachments }, { data: readState }] = await Promise.all([
    user.from("portal_messages").select("id, author_kind, author_name, body, created_at").eq("thread_id", id).order("created_at"),
    user.from("portal_message_attachments").select("id, message_id, file_name, portal_messages!inner(thread_id)").eq("portal_messages.thread_id", id),
    user.rpc("portal_thread_read_state", { _thread_id: id }),
  ]);
  if (error) throw new ApiError(403, "sin_permiso", "No tiene acceso a la conversación.");
  await user.rpc("portal_thread_mark_read", { _thread_id: id });
  return { mensajes: messages ?? [], adjuntos: attachments ?? [], lectura: readState };
};

async function messageAttachments(ctx: Ctx, clientId: string, threadId: string) {
  const files = Array.isArray(ctx.body.files) ? ctx.body.files as Record<string, unknown>[] : [];
  const { org } = await clientRfcs(ctx, clientId);
  const out = [];
  for (const file of files.slice(0, 10)) {
    const bytes = b64ToBytes(str(file.base64, "el adjunto", 28_000_000));
    if (bytes.length > 20 * 1024 * 1024) throw new ApiError(400, "dato_invalido", "Un adjunto pasa de 20 MB.");
    const name = str(file.name, "el nombre del adjunto", 240).replace(/[^a-zA-Z0-9._-]/g, "_");
    const path = `${org}/${clientId}/mensajes/${threadId}/${Date.now()}_${name}`;
    await upload(ctx, "portal", path, bytes, typeof file.type === "string" ? file.type : "application/octet-stream");
    out.push({ storage_path: path, file_name: name, mime_type: file.type || "application/octet-stream", size_bytes: bytes.length });
  }
  return out;
}

const enviarMensaje: Handler = async (ctx) => {
  const clientId = uuid(ctx.body.client_id, "el cliente");
  await assertClientAccess(ctx, clientId, ["administrador", "operativo"]);
  const body = str(ctx.body.body, "el mensaje", 10_000);
  let threadId = typeof ctx.body.thread_id === "string" && ctx.body.thread_id ? uuid(ctx.body.thread_id, "la conversación") : null;
  if (!threadId) {
    const { data, error } = await requireUser(ctx).rpc("portal_thread_create", {
      _client_id: clientId, _subject: str(ctx.body.subject || "Consulta", "el asunto", 200), _body: body,
    });
    if (error) throw new ApiError(400, "mensaje", error.message);
    threadId = data as string;
    const attachments = await messageAttachments(ctx, clientId, threadId);
    if (attachments.length) await requireUser(ctx).rpc("portal_message_send", { _thread_id: threadId, _body: "(adjuntos)", _attachments: attachments });
  } else {
    const attachments = await messageAttachments(ctx, clientId, threadId);
    const { error } = await requireUser(ctx).rpc("portal_message_send", { _thread_id: threadId, _body: body, _attachments: attachments });
    if (error) throw new ApiError(400, "mensaje", error.message);
  }
  return { thread_id: threadId };
};

const planBajaCuenta: Handler = async (ctx) => {
  const { data, error } = await requireUser(ctx).rpc("portal_account_deletion_plan", {});
  if (error) throw new ApiError(403, "sin_permiso", "No se pudo preparar el plan de baja.");
  return data;
};

/** Únicas operaciones sin sesión. Todas las demás responden 401 sin JWT válido (V3). */
const PUBLIC_OPS = new Set(["cuenta.registrar", "cuenta.recuperar", "cuenta.reenviar_confirmacion", "diagnostico.cerco"]);

const ROUTES: Record<string, Handler> = {
  "cuenta.registrar": registrar,
  "cuenta.recuperar": recuperar,
  "cuenta.reenviar_confirmacion": reenviarConfirmacion,
  "diagnostico.cerco": diagnosticoCerco,
  "sesion.actual": sesionActual,
  "sesion.registrar_acceso": registrarAcceso,
  "legal.actual": legalActual,
  "legal.aceptar": aceptarLegal,
  "cuenta.activar_basico": async (ctx) => {
    if (MIRROR_READ_ONLY) {
      throw new ApiError(
        403,
        "espejo_solo_lectura",
        "En esta fase no hay alta automática: Kawiil vincula y publica la empresa desde central.",
      );
    }
    return activarBasico(ctx);
  },
  "cuenta.plan_baja": planBajaCuenta,
  "cuenta.eliminar": eliminarCuenta,
  "archivos.enlace": enlaceArchivo,
  "tablero.consultar": tablero,
  "facturas.listar": listarFacturas,
  "facturas.periodo": periodoFacturas,
  "facturas.detalle": detalleFactura,
  "facturas.cargar": async (ctx) => {
    if (MIRROR_READ_ONLY) throw new ApiError(403, "espejo_solo_lectura", "En esta fase el cliente no carga XML; las facturas las publica Kawiil desde central.");
    return cargarFacturas(ctx);
  },
  "facturas.validar": validarFactura,
  "facturas.crear": crearFactura,
  "facturas.complemento_pago": crearComplementoPago,
  "facturas.nota_credito": crearNotaCredito,
  "catalogos.buscar": catalogosBuscar,
  "plantillas.listar": plantillasListar,
  "plantillas.guardar": plantillasGuardar,
  "plantillas.cargar": plantillasCargar,
  "clientes.listar": clientesListar,
  "clientes.guardar": clientesGuardar,
  "facturas.solicitar_cancelacion": async (ctx) => {
    if (MIRROR_READ_ONLY) throw new ApiError(403, "espejo_solo_lectura", "Las cancelaciones las gestiona Kawiil en central durante la fase espejo.");
    return solicitarCancelacion(ctx);
  },
  "alertas.listar": listarAlertas,
  "sat.notificaciones": listarNotificacionesSat,
  "documentos.listar": listarDocumentos,
  "documentos.descargar": descargarDocumento,
  "tickets.listar": listarTickets,
  "tickets.registrar": registrarTicket,
  "mensajes.listar": listarHilos,
  "mensajes.leer": leerHilo,
  "mensajes.enviar": enviarMensaje,
  "csd.cargar": async (ctx) => {
    if (MIRROR_READ_ONLY) {
      throw new ApiError(
        403,
        "espejo_solo_lectura",
        "En la fase espejo no se carga CSD en Kawiil OS. La emisión no aplica; FIEL/CIEC solo viven en central.",
      );
    }
    return cargarCsd(ctx);
  },
  "csd.estado": estadoCsd,
  "csd.requisitos": async (ctx) => {
    if (MIRROR_READ_ONLY) {
      throw new ApiError(
        403,
        "espejo_solo_lectura",
        "En la fase espejo no se gestiona CSD desde el portal.",
      );
    }
    return requisitosCsd(ctx);
  },
  "csd.revocar": async (ctx) => {
    if (MIRROR_READ_ONLY) {
      throw new ApiError(
        403,
        "espejo_solo_lectura",
        "En la fase espejo no se gestiona CSD desde el portal.",
      );
    }
    return revocarCsd(ctx);
  },
  "central/invitar": invitar,
  "central/cliente.baja": bajaCliente,
  "central/tickets.facturar": facturarTicket,
  "central/categorias.sugerir": sugerirCategorias,
  "central/avisar": avisar,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "method_not_allowed" }, 405);
  try {
    const ctx = await buildCtx(req);
    const fromPath = new URL(req.url).pathname.split("/portal-api/")[1] ?? "";
    const op = (fromPath || String(ctx.body.op ?? "")).replace(/^\/+/, "");
    const [version, ...rest] = op.split("/");
    if (version !== API_VERSION) return json({ error: "version_no_soportada", message: `Use /${API_VERSION}/<operación>.` }, 404);
    const handler = ROUTES[rest.join("/")];
    if (!handler) return json({ error: "operacion_desconocida" }, 404);
    if (!PUBLIC_OPS.has(rest.join("/")) && !ctx.userId) return json({ error: "no_autorizado", message: "Inicie sesión." }, 401);
    return json({ version: API_VERSION, data: await handler(ctx) });
  } catch (err) {
    if (err instanceof ApiError) return json({ error: err.code, message: err.message, details: err.details }, err.status);
    console.error("portal-api", err);
    return json({ error: "interno", message: "Ocurrió un error. Intente de nuevo." }, 500);
  }
});
