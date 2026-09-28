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
import { crearEmisor, EmisionRechazada, PacNoConfigurado, type BorradorFactura } from "../_shared/portal/emission/index.ts";
import { publicCsdView } from "../_shared/portal/csd.ts";
import { registerCsd } from "../_shared/portal/csdRegister.ts";
import { suggestCategory } from "../_shared/portal/openclaw.ts";
import { normalizeRfc } from "../_shared/portal/validate.ts";
import { clientIp, GENERIC_ACCOUNT_MESSAGE, guardPublic, registerAccount, turnstileSiteverify, type PublicKind } from "../_shared/portal/publicAuth.ts";
import { sha256Hex } from "../_shared/portal/hash.ts";

const API_VERSION = "v1";
const SIGNED_URL_SECONDS = 120;
const PORTAL_URL = (Deno.env.get("PORTAL_PUBLIC_URL") ?? "").replace(/\/+$/, "");

type Handler = (ctx: Ctx) => Promise<unknown>;

// ── Utilidades ──────────────────────────────────────────────────────
async function clientRfcs(ctx: Ctx, clientId: string): Promise<{ org: string; rfcs: string[] }> {
  const { data: c } = await ctx.admin.from("clients").select("organization_id, rfc").eq("id", clientId).single();
  const { data: tp } = await ctx.admin.from("fis_tax_profiles").select("rfc").eq("client_id", clientId).eq("active", true);
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
  const { data: tp } = await ctx.admin.from("fis_tax_profiles")
    .select("rfc, razon_social, regimen_fiscal, cp_fiscal").eq("client_id", clientId).eq("is_default", true).eq("active", true).maybeSingle();
  const { data: reg } = await ctx.admin.from("portal_csd_registry")
    .select("id, certificate_id, cert_serial, cert_not_before, cert_not_after, revoked_at, use_count")
    .eq("client_id", clientId).is("revoked_at", null).order("cert_not_after", { ascending: false }).limit(1).maybeSingle();
  const { data: settings } = await ctx.admin.from("portal_client_settings").select("emission_enabled, origin").eq("client_id", clientId).maybeSingle();
  const user = requireUser(ctx);
  const { data: dossier } = await user.rpc("portal_emission_dossier", { _client_id: clientId });
  const { data: usage } = await user.rpc("portal_basic_usage", { _client_id: clientId });
  return { tp, reg, settings, dossier, usage };
}

function borradorFrom(ctx: Ctx, tp: { rfc: string; razon_social: string; regimen_fiscal: string; cp_fiscal: string } | null): BorradorFactura {
  const b = (ctx.body.borrador ?? {}) as Partial<BorradorFactura>;
  // El emisor SIEMPRE sale del perfil fiscal verificado, no del navegador.
  return {
    ...(b as BorradorFactura),
    moneda: "MXN",
    emisor: tp ? { rfc: tp.rfc, nombre: tp.razon_social, regimen: tp.regimen_fiscal, cp: tp.cp_fiscal } : (undefined as never),
  };
}

const validarFactura: Handler = async (ctx) => {
  const clientId = uuid(ctx.body.client_id, "el cliente");
  await assertClientAccess(ctx, clientId, ["administrador"]);
  const e = await emissionContext(ctx, clientId);
  const emisor = crearEmisor(Deno.env.get("PORTAL_EMISOR"));
  const v = await emisor.validar(borradorFrom(ctx, e.tp), {
    csd: e.reg ? { serial: e.reg.cert_serial, notBefore: e.reg.cert_not_before, notAfter: e.reg.cert_not_after, revoked: !!e.reg.revoked_at } : null,
  });
  return { validacion: v, expediente: e.dossier, emision_habilitada: !!e.settings?.emission_enabled, uso_basico: e.usage, emisor: emisor.nombre };
};

const crearFactura: Handler = async (ctx) => {
  const clientId = uuid(ctx.body.client_id, "el cliente");
  await assertClientAccess(ctx, clientId, ["administrador"], false);
  const e = await emissionContext(ctx, clientId);
  if (!e.settings?.emission_enabled) throw new ApiError(403, "emision_apagada", "La emisión no está habilitada para este cliente. Kawiil la activa cuando el expediente está completo.");
  if (!e.dossier?.complete) throw new ApiError(403, "expediente_incompleto", "El expediente de emisión está incompleto.", e.dossier);
  if (e.usage?.origin === "basico" && Number(e.usage.usadas) >= Number(e.usage.limite)) {
    throw new ApiError(402, "limite_basico", `Llegó al límite de ${e.usage.limite} facturas incluidas en el nivel básico. Para seguir facturando, contrate un plan con Kawiil desde «Mensajes».`);
  }
  const emisor = crearEmisor(Deno.env.get("PORTAL_EMISOR"));
  const borrador = borradorFrom(ctx, e.tp);
  const ectx = { csd: e.reg ? { serial: e.reg.cert_serial, notBefore: e.reg.cert_not_before, notAfter: e.reg.cert_not_after, revoked: !!e.reg.revoked_at } : null };
  try {
    const out = await emisor.emitir(borrador, ectx);
    const { org } = await clientRfcs(ctx, clientId);
    const xmlPath = `${org}/${clientId}/emitidas/${out.uuid}.xml`;
    await upload(ctx, "portal", xmlPath, new TextEncoder().encode(out.xml), "application/xml");
    const { data: cfdi, error } = await ctx.admin.from("portal_cfdi").insert({
      organization_id: org, client_id: clientId, uuid: out.uuid, direction: "emitida",
      source: out.esPrueba ? "emision_prueba" : "emision_portal", is_test: out.esPrueba, version: "4.0",
      fecha: out.fechaTimbrado, rfc_emisor: borrador.emisor.rfc, nombre_emisor: borrador.emisor.nombre,
      rfc_receptor: normalizeRfc(borrador.receptor.rfc), nombre_receptor: borrador.receptor.nombre, tipo_comprobante: "I",
      uso_cfdi: borrador.receptor.uso, forma_pago: borrador.formaPago, metodo_pago: borrador.metodoPago, moneda: "MXN",
      subtotal: out.totales.subtotal, iva_trasladado: out.totales.iva, total: out.totales.total,
      clave_prod_serv: borrador.conceptos[0]?.claveProdServ, descripcion: borrador.conceptos[0]?.descripcion,
      sat_status: out.esPrueba ? "desconocido" : "vigente", xml_path: xmlPath, created_by: ctx.userId,
    }).select("id").single();
    if (error) throw new ApiError(500, "registro", error.message);
    await ctx.admin.from("portal_emissions").insert({
      organization_id: org, client_id: clientId, requested_by: ctx.userId, emisor: emisor.nombre, status: "emitida", draft: borrador, cfdi_id: cfdi.id,
    });
    if (!out.esPrueba && e.reg) {
      // Uso real de la llave del CSD (solo el emisor PAC sella).
      await ctx.admin.from("portal_csd_registry").update({ last_used_at: new Date().toISOString(), use_count: (e.reg.use_count ?? 0) + 1 }).eq("id", e.reg.id);
      await audit(ctx, "csd_uso", clientId, "portal_csd_registry", e.reg.id, { uuid: out.uuid });
    }
    await audit(ctx, "emision", clientId, "portal_cfdi", cfdi.id, { uuid: out.uuid, emisor: emisor.nombre, prueba: out.esPrueba, total: out.totales.total });
    return { cfdi_id: cfdi.id, uuid: out.uuid, prueba: out.esPrueba, totales: out.totales };
  } catch (err) {
    if (err instanceof EmisionRechazada) {
      const { org } = await clientRfcs(ctx, clientId);
      await ctx.admin.from("portal_emissions").insert({ organization_id: org, client_id: clientId, requested_by: ctx.userId, emisor: emisor.nombre, status: "rechazada", draft: borrador, errors: err.errores });
      await audit(ctx, "emision_rechazada", clientId, "portal_emissions", null, { errores: err.errores.length });
      throw new ApiError(422, "validacion", err.message, err.errores);
    }
    if (err instanceof PacNoConfigurado) throw new ApiError(503, "pac_no_configurado", err.message);
    throw err;
  }
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
 * Eliminación de la cuenta desde el portal (C4; requisito de App Store y Google Play).
 * La base decide qué se borra, qué se conserva y si está bloqueada
 * (portal_execute_account_deletion). Después se borra el usuario de Auth y los
 * archivos salen por la cola de borrado (portal-notify).
 */
const eliminarCuenta: Handler = async (ctx) => {
  requireUser(ctx);
  if (!ctx.isPortal) throw new ApiError(403, "sin_permiso", "Solo cuentas del portal.");
  if (ctx.body.confirmacion !== "ELIMINAR") throw new ApiError(400, "confirmacion", "Escriba ELIMINAR para confirmar.");
  const uid = ctx.userId!;
  const { data: res, error } = await ctx.admin.rpc("portal_execute_account_deletion", { _uid: uid });
  if (error || !res) throw new ApiError(500, "eliminacion", "No se pudo procesar la eliminación. No se borró nada; intente de nuevo.");
  if (res.bloqueada) {
    throw new ApiError(409, "eliminacion_bloqueada", "Su cuenta no se puede eliminar todavía.", res.bloqueos);
  }
  const { error: delErr } = await ctx.admin.auth.admin.deleteUser(uid);
  await ctx.admin.rpc("portal_finish_account_deletion", { _request_id: res.request_id, _ok: !delErr, _error: delErr?.message ?? null });
  // Bitácora del hecho sin identificar a la persona (ya está seudonimizada).
  ctx.userId = null;
  await audit(ctx, "cuenta_eliminada", null, "portal_deletion_requests", res.request_id, { via: "portal", resultado: delErr ? "error_auth" : "ok" });
  if (delErr) throw new ApiError(500, "eliminacion", "Sus datos ya se procesaron, pero falta cerrar su acceso. Intente de nuevo o escríbanos.");
  return { ok: true, resultado: res.result };
};

// ── Central → app ───────────────────────────────────────────────────
async function requireStaff(ctx: Ctx, admin = false) {
  requireUser(ctx);
  if (!ctx.isStaff) throw new ApiError(403, "sin_permiso", "Solo el equipo de Kawiil.");
  if (admin) {
    const { data } = await ctx.user!.rpc("portal_is_staff_admin", { _uid: ctx.userId });
    if (data !== true) throw new ApiError(403, "sin_permiso", "Solo G3/G4.");
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

const facturarTicket: Handler = async (ctx) => {
  await requireStaff(ctx);
  const receiptId = uuid(ctx.body.receipt_id, "el ticket");
  const { data: r } = await ctx.user!.from("fis_receipts").select("id, client_id, organization_id").eq("id", receiptId).maybeSingle();
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

/** Únicas operaciones sin sesión. Todas las demás responden 401 sin JWT válido (V3). */
const PUBLIC_OPS = new Set(["cuenta.registrar", "cuenta.recuperar", "cuenta.reenviar_confirmacion", "diagnostico.cerco"]);

const ROUTES: Record<string, Handler> = {
  "cuenta.registrar": registrar,
  "cuenta.recuperar": recuperar,
  "cuenta.reenviar_confirmacion": reenviarConfirmacion,
  "diagnostico.cerco": diagnosticoCerco,
  "cuenta.eliminar": eliminarCuenta,
  "archivos.enlace": enlaceArchivo,
  "facturas.cargar": cargarFacturas,
  "facturas.validar": validarFactura,
  "facturas.crear": crearFactura,
  "csd.cargar": cargarCsd,
  "csd.estado": estadoCsd,
  "csd.requisitos": requisitosCsd,
  "csd.revocar": revocarCsd,
  "central/invitar": invitar,
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
