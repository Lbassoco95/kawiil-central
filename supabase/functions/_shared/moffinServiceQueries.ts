/**
 * GET /service_queries con withFileURL=true: enlaces de descarga para sat_rfc (OpenAPI Moffin).
 */

import { isLikelyMoffinDownloadUrl } from "./moffinSatRfc.ts";

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

const PDF_COLS = ["pdfURL", "pdfUrl", "fileURL", "fileUrl"] as const;

function readPdfUrlFromRow(row: unknown): string | null {
  if (!row || typeof row !== "object" || Array.isArray(row)) return null;
  const o = row as Record<string, unknown>;
  for (const k of PDF_COLS) {
    const v = o[k];
    if (typeof v === "string" && isLikelyMoffinDownloadUrl(v)) return v.trim();
  }
  return null;
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
    const u = readPdfUrlFromRow(hit);
    if (u) return u;
  }
  for (const row of rows) {
    const u = readPdfUrlFromRow(row);
    if (u) return u;
  }
  return null;
}

async function fetchServiceQueriesOnce(
  moffinBase: string,
  moffinKey: string,
  rfc: string,
  withExternalFilter: string | null,
): Promise<unknown[] | null> {
  const base = moffinBase.replace(/\/$/, "");
  const params = new URLSearchParams();
  params.set("limit", "40");
  params.set("offset", "0");
  params.set("order", "DESC");
  params.set("withFileURL", "true");
  params.set("service", "sat_rfc");
  params.set("status", "SUCCESS");
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
  if (!json || !res.ok) return null;
  return readServiceQueryRows(json);
}

/** Obtiene pdfURL de service_queries (withFileURL); prioriza fila por id o externalId. */
export async function fetchMoffinPdfUrlViaServiceQueries(
  moffinBase: string,
  moffinKey: string,
  opts: { reportId: string; rfc: string; externalId?: string | null },
): Promise<string | null> {
  const ext = opts.externalId?.trim() ?? "";
  const rid = String(opts.reportId).trim();
  const rfc = opts.rfc.trim();

  if (ext) {
    const rowsF = await fetchServiceQueriesOnce(moffinBase, moffinKey, rfc, ext);
    if (rowsF?.length) {
      const u = pickPdfFromRows(rowsF, rid, ext);
      if (u) return u;
    }
  }

  const rows = await fetchServiceQueriesOnce(moffinBase, moffinKey, rfc, null);
  if (!rows?.length) return null;
  return pickPdfFromRows(rows, rid, ext);
}
