/**
 * SATgo con e.firma (multipart + X-Fiel-Encryption: JWE).
 * PDF: POST /api/v2/Consultar/csffiel | /ocfiel
 * Buzón: POST /api/v2/Consultar/comunicadosfiel | /notificacionesfiel (JSON)
 * CFDI: POST /api/v2/consultar/facfiel (+ descargametadatafiel)
 */
function satgoBaseUrl(): string {
  return (Deno.env.get("SATGO_BASE_URL") ?? "https://api.sat-go.com").replace(/\/$/, "");
}

function fetchTimeoutMs(): number {
  return Math.min(
    Math.max(Number(Deno.env.get("SATGO_FETCH_TIMEOUT_MS") ?? "90000") || 90000, 10000),
    180000,
  );
}

function buildFielJweForm(opts: {
  certBytes: Uint8Array;
  keyJwe: string;
  passwordJwe: string;
}): FormData {
  const form = new FormData();
  form.append(
    "Certificado",
    new Blob([opts.certBytes], { type: "application/pkix-cert" }),
    "fiel.cer",
  );
  form.append(
    "llavePrivada",
    new Blob([opts.keyJwe], { type: "application/jose" }),
    "llave.jwe",
  );
  form.append("Contrasena", opts.passwordJwe);
  return form;
}

export type SatgoFielPdfOk = { ok: true; buf: Uint8Array };
export type SatgoFielPdfErr = { ok: false; message: string; httpStatus: number };

export async function fetchSatgoPdfWithFielJwe(opts: {
  bearer: string;
  rfc: string;
  kind: "csf" | "oc";
  /** Bytes crudos del .cer (en claro). */
  certBytes: Uint8Array;
  /** JWE compacto del .key. */
  keyJwe: string;
  /** JWE compacto de la contraseña. */
  passwordJwe: string;
}): Promise<SatgoFielPdfOk | SatgoFielPdfErr> {
  const path =
    opts.kind === "csf"
      ? "/api/v2/Consultar/csffiel"
      : "/api/v2/Consultar/ocfiel";
  const url = `${satgoBaseUrl()}${path}`;
  const form = buildFielJweForm(opts);
  const ms = fetchTimeoutMs();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.bearer}`,
        RFC: opts.rfc,
        "X-Fiel-Encryption": "JWE",
        Accept: "application/pdf,*/*",
      },
      body: form,
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
      message: preview || `SATgo ${opts.kind}fiel HTTP ${res.status}`,
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

export type SatgoFielJsonOk = {
  ok: true;
  httpStatus: number;
  json: Record<string, unknown>;
  requestId?: string | null;
};
export type SatgoFielJsonErr = { ok: false; message: string; httpStatus: number };

export type SatgoBuzonKind = "comunicados" | "notificaciones";

/**
 * Buzón tributario (metadata JSON). Sin descarga de PDFs por defecto.
 * notificaciones: usa requestId para reutilizar sesión SAT entre pendientes/notificadas.
 */
export async function fetchSatgoBuzonWithFielJwe(opts: {
  bearer: string;
  rfc: string;
  kind: SatgoBuzonKind;
  certBytes: Uint8Array;
  keyJwe: string;
  passwordJwe: string;
  /** Solo notificaciones: notificadas | pendientes */
  tipoNotificacion?: "notificadas" | "pendientes";
  /** Solo notificaciones: reusar sesión SAT */
  requestId?: string | null;
  /** comunicados: descargar PDF acuse (default false = solo títulos) */
  descargar?: boolean;
  /** notificaciones: descargar PDFs (default false) */
  descargarNotificaciones?: boolean;
}): Promise<SatgoFielJsonOk | SatgoFielJsonErr> {
  const qs = new URLSearchParams();
  if (opts.kind === "comunicados") {
    qs.set("descargar", opts.descargar === true ? "true" : "false");
  } else {
    qs.set("tipoNotificacion", opts.tipoNotificacion ?? "notificadas");
    qs.set(
      "descargarNotificaciones",
      opts.descargarNotificaciones === true ? "true" : "false",
    );
    if (opts.requestId?.trim()) qs.set("requestId", opts.requestId.trim());
  }

  const path =
    opts.kind === "comunicados"
      ? "/api/v2/Consultar/comunicadosfiel"
      : "/api/v2/Consultar/notificacionesfiel";
  const url = `${satgoBaseUrl()}${path}?${qs.toString()}`;
  const form = buildFielJweForm(opts);
  const ms = fetchTimeoutMs();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.bearer}`,
        RFC: opts.rfc,
        "X-Fiel-Encryption": "JWE",
        Accept: "application/json",
      },
      body: form,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (!res.ok) {
      const preview =
        (typeof parsed === "string" && parsed) ||
        (parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? String(
              (parsed as Record<string, unknown>).errorMessage ??
                (parsed as Record<string, unknown>).message ??
                text.slice(0, 400),
            )
          : text.slice(0, 400).trim());
      return {
        ok: false,
        httpStatus: res.status,
        message: preview || `SATgo ${opts.kind}fiel HTTP ${res.status}`,
      };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false,
        httpStatus: res.status,
        message: text.slice(0, 400).trim() || `SATgo ${opts.kind}fiel: respuesta no JSON`,
      };
    }
    const json = parsed as Record<string, unknown>;
    if (json.success === false) {
      return {
        ok: false,
        httpStatus: res.status,
        message: String(json.errorMessage ?? json.message ?? "SATgo success=false").slice(0, 400),
      };
    }
    const headerReq =
      res.headers.get("X-RequestId") ??
      res.headers.get("x-requestid") ??
      null;
    const bodyReq = typeof json.requestId === "string" ? json.requestId : null;
    return {
      ok: true,
      httpStatus: res.status,
      json,
      requestId: bodyReq || headerReq,
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

export type SatgoFacTipo = "emitidos" | "recibidos";

export type SatgoFacComprobante = {
  uuid?: string;
  rfcEmisor?: string;
  razonSocialEmisor?: string;
  rfcReceptor?: string;
  razonSocialReceptor?: string;
  fechaEmision?: string;
  total?: number;
  subtotal?: number;
  estadoDeComprobante?: string;
  tipoDeComprobante?: string;
  metodoPago?: string;
  formaPago?: string;
  moneda?: string;
  [key: string]: unknown;
};

/**
 * Descarga / consulta CFDI emitidos|recibidos con FIEL JWE.
 * Docs: https://sat-go.com/docs · POST /api/v2/consultar/facfiel
 *
 * tipoBusqueda: 1 = rango de fechas (default); 0 = UUID puntual (enrich).
 */
export async function fetchSatgoFacFielWithJwe(opts: {
  bearer: string;
  rfc: string;
  tipo: SatgoFacTipo;
  certBytes: Uint8Array;
  keyJwe: string;
  passwordJwe: string;
  /** YYYY-MM-DD HH:mm:ss — requerido si tipoBusqueda=1 */
  fechaInicial?: string;
  /** YYYY-MM-DD HH:mm:ss — requerido si tipoBusqueda=1 */
  fechaFinal?: string;
  /** UUID del CFDI — requerido si tipoBusqueda=0 */
  uuid?: string;
  /** 0 = UUID · 1 = fecha (default 1) */
  tipoBusqueda?: 0 | 1;
  /** -1 Todos | 0 Cancelados | 1 Vigentes */
  estatusFactura?: number;
  /** true = descarga masiva (folioDescarga); false = respuesta con comprobantes */
  solicitaMetadata?: boolean;
  descargaComprobantes?: boolean;
  descargaPdfs?: boolean;
  requestId?: string | null;
}): Promise<SatgoFielJsonOk | SatgoFielJsonErr> {
  const tipoBusqueda = opts.tipoBusqueda === 0 ? "0" : "1";
  const qs = new URLSearchParams({
    tipo: opts.tipo,
    tipoBusqueda,
    solicitaMetadata: opts.solicitaMetadata === true ? "true" : "false",
    estatusFactura: String(
      Number.isFinite(opts.estatusFactura) ? opts.estatusFactura! : -1,
    ),
    descargaComprobantes: opts.descargaComprobantes === true ? "true" : "false",
    descargaPdfs: opts.descargaPdfs === true ? "true" : "false",
  });
  if (tipoBusqueda === "0") {
    const uuid = String(opts.uuid ?? "").trim();
    if (!uuid) {
      return { ok: false, httpStatus: 400, message: "uuid_required_for_tipoBusqueda_0" };
    }
    qs.set("UUID", uuid);
  } else {
    qs.set("fecha_inicial", opts.fechaInicial ?? "");
    qs.set("fecha_final", opts.fechaFinal ?? "");
  }
  if (opts.requestId?.trim()) qs.set("requestId", opts.requestId.trim());

  const url = `${satgoBaseUrl()}/api/v2/consultar/facfiel?${qs.toString()}`;
  const form = buildFielJweForm(opts);
  const ms = fetchTimeoutMs();
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${opts.bearer}`,
        RFC: opts.rfc,
        "X-Fiel-Encryption": "JWE",
        Accept: "application/json",
      },
      body: form,
      signal: ctrl.signal,
    });
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = null;
    }
    if (!res.ok) {
      const preview =
        (typeof parsed === "string" && parsed) ||
        (parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? String(
              (parsed as Record<string, unknown>).errorMessage ??
                (parsed as Record<string, unknown>).message ??
                text.slice(0, 400),
            )
          : text.slice(0, 400).trim());
      return {
        ok: false,
        httpStatus: res.status,
        message: preview || `SATgo facfiel HTTP ${res.status}`,
      };
    }
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return {
        ok: false,
        httpStatus: res.status,
        message: text.slice(0, 400).trim() || "SATgo facfiel: respuesta no JSON",
      };
    }
    const json = parsed as Record<string, unknown>;
    if (json.success === false) {
      return {
        ok: false,
        httpStatus: res.status,
        message: String(json.errorMessage ?? json.message ?? "SATgo success=false").slice(
          0,
          400,
        ),
      };
    }
    const headerReq =
      res.headers.get("X-RequestId") ?? res.headers.get("x-requestid") ?? null;
    const bodyReq = typeof json.requestId === "string" ? json.requestId : null;
    return {
      ok: true,
      httpStatus: res.status,
      json,
      requestId: bodyReq || headerReq,
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

/** Extrae arreglo de comprobantes de una respuesta facfiel / metadata. */
export function extractSatgoFacComprobantes(
  json: Record<string, unknown>,
): SatgoFacComprobante[] {
  const candidates = [json.comprobantes, json.Comprobantes, json.data, json.items];
  for (const c of candidates) {
    if (Array.isArray(c)) return c as SatgoFacComprobante[];
  }
  const nested = json.result;
  if (nested && typeof nested === "object" && !Array.isArray(nested)) {
    const n = nested as Record<string, unknown>;
    for (const c of [n.comprobantes, n.Comprobantes, n.items]) {
      if (Array.isArray(c)) return c as SatgoFacComprobante[];
    }
  }
  return [];
}

function looksLikeXml(text: string): boolean {
  const t = text.trim().replace(/^\uFEFF/, "");
  return t.startsWith("<") && /<(?:[A-Za-z0-9_]+:)?Comprobante\b/i.test(t);
}

function decodeMaybeBase64Xml(raw: string): string | null {
  const trimmed = raw.trim();
  if (looksLikeXml(trimmed)) return trimmed;
  // data:application/xml;base64,...
  const dataUrl = trimmed.match(/^data:[^;]+;base64,(.+)$/i);
  const b64 = (dataUrl?.[1] ?? trimmed).replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]+=*$/.test(b64) || b64.length < 40) return null;
  try {
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    const text = new TextDecoder().decode(bytes);
    return looksLikeXml(text) ? text : null;
  } catch {
    return null;
  }
}

/**
 * Extrae XML de un comprobante SATgo (campos variables según descargaComprobantes).
 * No usa DOM; solo detecta texto/XML o base64.
 */
export function extractXmlFromSatgoComprobante(
  c: SatgoFacComprobante,
): string | null {
  const keys = [
    "xml",
    "Xml",
    "XML",
    "xmlContent",
    "xmlBase64",
    "XmlBase64",
    "archivoXml",
    "archivoXML",
    "comprobanteXml",
    "comprobanteXML",
    "file",
    "File",
    "contenido",
    "content",
  ];
  for (const k of keys) {
    const v = c[k];
    if (typeof v === "string" && v.trim()) {
      const xml = decodeMaybeBase64Xml(v);
      if (xml) return xml;
    }
  }
  return null;
}

/** Normaliza monto desde campos alternos del listado facfiel (Total/monto/…). */
export function pickSatgoAmount(c: SatgoFacComprobante, ...keys: string[]): number | null {
  for (const k of keys) {
    const v = c[k];
    if (typeof v === "number" && Number.isFinite(v)) return v;
    if (typeof v === "string" && v.trim()) {
      const n = Number(v.replace(/,/g, "").trim());
      if (Number.isFinite(n)) return n;
    }
  }
  return null;
}
