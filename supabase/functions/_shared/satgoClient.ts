/**
 * Cliente HTTP SATgo V2 — CSF y opinión de cumplimiento (PDF síncrono).
 * Headers: Authorization Bearer + RFC + Secret (CIEC).
 * Paths: GET /api/v2/Consultar/csf | /api/v2/Consultar/oc
 */

import { satgoBaseUrl } from "./satgoAuth.ts";

export type SatgoConsultKind = "csf" | "oc";

export type SatgoPdfOk = {
  ok: true;
  buf: Uint8Array;
  contentType: string | null;
  httpStatus: number;
};

export type SatgoPdfErr = {
  ok: false;
  message: string;
  httpStatus: number;
  bodyPreview?: string;
};

function consultPath(kind: SatgoConsultKind): string {
  const override =
    kind === "csf"
      ? Deno.env.get("SATGO_PATH_CSF")?.trim()
      : Deno.env.get("SATGO_PATH_OC")?.trim();
  if (override) return override.startsWith("/") ? override : `/${override}`;
  return kind === "csf" ? "/api/v2/Consultar/csf" : "/api/v2/Consultar/oc";
}

export function satgoServiceName(kind: SatgoConsultKind): string {
  return kind === "csf" ? "satgo-csf" : "satgo-oc";
}

export function satgoKindFromConsultType(
  consultType: "constancia_situacion_fiscal" | "opinion_cumplimiento",
): SatgoConsultKind {
  return consultType === "constancia_situacion_fiscal" ? "csf" : "oc";
}

function fetchTimeoutMs(): number {
  const raw = Number(Deno.env.get("SATGO_FETCH_TIMEOUT_MS") ?? "90000");
  if (!Number.isFinite(raw)) return 90_000;
  return Math.min(Math.max(Math.floor(raw), 10_000), 180_000);
}

export async function satgoFetchPdf(opts: {
  bearer: string;
  rfc: string;
  ciec: string;
  kind: SatgoConsultKind;
}): Promise<SatgoPdfOk | SatgoPdfErr> {
  const base = satgoBaseUrl();
  const path = consultPath(opts.kind);
  const url = `${base}${path}`;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), fetchTimeoutMs());
  try {
    const res = await fetch(url, {
      method: "GET",
      headers: {
        Authorization: `Bearer ${opts.bearer}`,
        RFC: opts.rfc.trim().toUpperCase().replace(/\s/g, ""),
        Secret: opts.ciec,
        Accept: "application/pdf,*/*",
      },
      signal: ctrl.signal,
    });
    const buf = new Uint8Array(await res.arrayBuffer());
    const ctype = res.headers.get("content-type");
    const head = new TextDecoder().decode(buf.slice(0, 8));
    if (res.ok && buf.length >= 4 && head.startsWith("%PDF")) {
      return { ok: true, buf, contentType: ctype, httpStatus: res.status };
    }
    const textPreview = new TextDecoder().decode(buf.slice(0, 400)).trim();
    return {
      ok: false,
      httpStatus: res.status,
      message: textPreview || `SATgo ${opts.kind} HTTP ${res.status} (sin PDF)`,
      bodyPreview: textPreview || undefined,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const aborted = /abort/i.test(msg);
    return {
      ok: false,
      httpStatus: aborted ? 504 : 502,
      message: aborted
        ? `Timeout SATgo ${opts.kind} (${fetchTimeoutMs()} ms)`
        : `SATgo ${opts.kind}: ${msg}`,
    };
  } finally {
    clearTimeout(t);
  }
}
