/**
 * GET /service_queries con withFileURL=true: enlaces de descarga para sat_rfc (OpenAPI Moffin).
 */

import { isLikelyMoffinDownloadUrl, keyLooksLikePdfDownloadField } from "./moffinSatRfc.ts";

function readServiceQueryRows(json: Record<string, unknown>): unknown[] {
  const sq = json.serviceQueries;
  if (Array.isArray(sq)) return sq;
  const rep = json.reports;
  if (Array.isArray(rep)) return rep;
  const data = json.data;
  if (Array.isArray(data)) return data;
  return [];
}

function parseServiceQueriesJson(text: string): Record<string, unknown> | null {
  try {
    return text ? (JSON.parse(text) as Record<string, unknown>) : {};
  } catch {
    return null;
  }
}

function rowTopKeys(row: unknown): string[] {
  if (!row || typeof row !== "object" || Array.isArray(row)) return [];
  return Object.keys(row as Record<string, unknown>);
}

/** URL en campos conocidos o anidados (pdfURL, fileURL, url https válida, etc.). */
function readPdfUrlFromRowDeep(row: unknown): string | null {
  const visit = (obj: unknown, depth: number): string | null => {
    if (depth > 14 || obj == null) return null;
    if (typeof obj !== "object") return null;
    if (Array.isArray(obj)) {
      for (const x of obj) {
        const r = visit(x, depth + 1);
        if (r) return r;
      }
      return null;
    }
    const o = obj as Record<string, unknown>;
    for (const [k, v] of Object.entries(o)) {
      if (typeof v === "string" && isLikelyMoffinDownloadUrl(v)) {
        const kn = k.replace(/_/g, "").toLowerCase();
        if (keyLooksLikePdfDownloadField(k) || kn === "url" || kn === "href" || kn === "link") {
          return v.trim();
        }
      }
    }
    for (const v of Object.values(o)) {
      const r = visit(v, depth + 1);
      if (r) return r;
    }
    return null;
  };
  return visit(row, 0);
}

function pickPdfFromRows(
  rows: unknown[],
  reportId: string,
  externalId: string,
): string | null {
  const rid = reportId.trim();
  const ext = externalId.trim();

  const matchRow = (row: unknown): boolean => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return false;
    const o = row as Record<string, unknown>;
    if (rid && o.id != null && String(o.id) === rid) return true;
    if (ext && typeof o.externalId === "string" && o.externalId === ext) return true;
    return false;
  };

  const hit = rows.find(matchRow);
  if (hit) {
    const u = readPdfUrlFromRowDeep(hit);
    if (u) return u;
  }
  for (const row of rows) {
    const u = readPdfUrlFromRowDeep(row);
    if (u) return u;
  }
  return null;
}

function logDiag(ctx: string, info: Record<string, unknown>) {
  console.log(JSON.stringify({ moffin_service_queries_diag: ctx, ...info }));
}

type FetchSqResult = { rows: unknown[]; json: Record<string, unknown> | null; ok: boolean; status: number };

async function fetchServiceQueriesOnce(
  moffinBase: string,
  moffinKey: string,
  rfc: string,
  withExternalFilter: string | null,
  phase: string,
): Promise<FetchSqResult> {
  const base = moffinBase.replace(/\/$/, "");
  const params = new URLSearchParams();
  params.set("limit", "100");
  params.set("offset", "0");
  params.set("order", "DESC");
  params.set("withFileURL", "true");
  params.set("service", "sat_rfc");
  if (rfc.trim()) params.set("search", rfc.trim());
  if (withExternalFilter) {
    params.set("filter", JSON.stringify({ externalId__eq: withExternalFilter }));
  }
  const url = `${base}/service_queries?${params.toString()}`;
  const res = await fetch(url, {
    headers: { Authorization: `Token ${moffinKey.trim()}` },
  });
  const text = await res.text();
  const json = parseServiceQueriesJson(text);
  const rows = json && res.ok ? readServiceQueryRows(json) : [];

  if (!res.ok) {
    logDiag("http_error", {
      phase,
      httpStatus: res.status,
      jsonTopKeys: json ? Object.keys(json) : [],
      bodySample: text.slice(0, 200),
    });
    return { rows: [], json, ok: false, status: res.status };
  }

  if (!json) {
    logDiag("parse_error", { phase, httpStatus: res.status });
    return { rows: [], json: null, ok: false, status: res.status };
  }

  if (rows.length === 0) {
    logDiag("empty_rows", {
      phase,
      httpStatus: res.status,
      jsonTopKeys: Object.keys(json),
    });
  }

  return { rows, json, ok: true, status: res.status };
}

function logNoPdfInRows(
  phase: string,
  rows: unknown[],
  reportId: string,
  externalId: string,
) {
  if (rows.length === 0) return;
  const first = rows[0];
  logDiag("rows_sin_pdf_url_reconocible", {
    phase,
    rowCount: rows.length,
    firstRowKeys: rowTopKeys(first),
    secondRowKeys: rows[1] ? rowTopKeys(rows[1]) : [],
    targetReportId: reportId || null,
    targetExternalIdSuffix: externalId ? externalId.slice(-24) : null,
  });
}

/** Obtiene pdfURL de service_queries (withFileURL + withPDF); prioriza fila por id o externalId. */
export async function fetchMoffinPdfUrlViaServiceQueries(
  moffinBase: string,
  moffinKey: string,
  opts: { reportId: string; rfc: string; externalId?: string | null },
): Promise<string | null> {
  const ext = opts.externalId?.trim() ?? "";
  const rid = String(opts.reportId).trim();
  const rfc = opts.rfc.trim();

  if (ext) {
    const r1 = await fetchServiceQueriesOnce(moffinBase, moffinKey, rfc, ext, "filter_externalId");
    if (r1.rows.length) {
      const u = pickPdfFromRows(r1.rows, rid, ext);
      if (u) return u;
      logNoPdfInRows("filter_externalId", r1.rows, rid, ext);
    }
  }

  const r2 = await fetchServiceQueriesOnce(moffinBase, moffinKey, rfc, null, "search_rfc_only");
  if (!r2.rows.length) return null;
  const u2 = pickPdfFromRows(r2.rows, rid, ext);
  if (u2) return u2;
  logNoPdfInRows("search_rfc_only", r2.rows, rid, ext);
  return null;
}
