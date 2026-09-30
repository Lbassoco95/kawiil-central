/**
 * SATgo con e.firma (multipart + X-Fiel-Encryption: JWE).
 * PDF: POST /api/v2/Consultar/csffiel | /ocfiel
 * Buzón: POST /api/v2/Consultar/comunicadosfiel | /notificacionesfiel (JSON)
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
