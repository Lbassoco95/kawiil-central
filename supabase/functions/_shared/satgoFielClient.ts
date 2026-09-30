/**
 * SATgo CSF/32D con e.firma (multipart + opcional X-Fiel-Encryption: JWE).
 * POST /api/v2/Consultar/csffiel | /ocfiel
 */
function satgoBaseUrl(): string {
  return (Deno.env.get("SATGO_BASE_URL") ?? "https://api.sat-go.com").replace(/\/$/, "");
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

  const ctrl = new AbortController();
  const ms = Math.min(
    Math.max(Number(Deno.env.get("SATGO_FETCH_TIMEOUT_MS") ?? "90000") || 90000, 10000),
    180000,
  );
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
