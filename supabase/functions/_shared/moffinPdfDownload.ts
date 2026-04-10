import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { buildMoffinPdfStoragePath } from "./moffinStoragePath.ts";
import { isLikelyMoffinDownloadUrl, keyLooksLikePdfDownloadField } from "./moffinSatRfc.ts";

function extractPdfUrlFromJsonParsed(j: unknown): string | null {
  const walk = (o: unknown): string | null => {
    if (o == null) return null;
    if (Array.isArray(o)) {
      for (const x of o) {
        const r = walk(x);
        if (r) return r;
      }
      return null;
    }
    if (typeof o !== "object") return null;
    const rec = o as Record<string, unknown>;
    for (const [k, v] of Object.entries(rec)) {
      if (typeof v === "string" && keyLooksLikePdfDownloadField(k) && isLikelyMoffinDownloadUrl(v)) {
        return v.trim();
      }
    }
    for (const v of Object.values(rec)) {
      const r = walk(v);
      if (r) return r;
    }
    return null;
  };
  return walk(j);
}

/** Cualquier https en el JSON; prioriza enlaces que parezcan archivo/PDF frente a endpoints de API. */
function extractBestFileUrlFromJsonTree(j: unknown, excludeUrl: string): string | null {
  const found = new Set<string>();
  const visit = (o: unknown) => {
    if (o == null) return;
    if (typeof o === "string") {
      const t = o.trim();
      if (isLikelyMoffinDownloadUrl(t) && t !== excludeUrl) found.add(t);
      return;
    }
    if (Array.isArray(o)) {
      for (const x of o) visit(x);
      return;
    }
    if (typeof o === "object") {
      for (const v of Object.values(o as Record<string, unknown>)) visit(v);
    }
  };
  visit(j);
  if (found.size === 0) return null;
  const score = (u: string): number => {
    const low = u.toLowerCase();
    let s = 0;
    if (/\.pdf(\?|#|$)/i.test(low)) s += 6;
    if (/download|\/file|blob|s3\.|cloudfront|storage|cdn|presigned|signed/i.test(low)) s += 4;
    if (/\/query\/|\/service_queries|\/report\/\d+$/i.test(low)) s -= 3;
    return s;
  };
  return [...found].sort((a, b) => score(b) - score(a))[0] ?? null;
}

/** Si Moffin devolvió JSON con URL anidada en lugar del binario PDF. */
function tryExtractPdfUrlFromJsonBody(buf: Uint8Array, currentUrl: string): string | null {
  const max = Math.min(buf.length, 262144);
  const text = new TextDecoder().decode(buf.slice(0, max)).trim();
  if (!text.startsWith("{") && !text.startsWith("[")) return null;
  try {
    const j = JSON.parse(text) as unknown;
    const named = extractPdfUrlFromJsonParsed(j);
    if (named && named !== currentUrl) return named;
    const best = extractBestFileUrlFromJsonTree(j, currentUrl);
    if (best && best !== currentUrl) return best;
    return null;
  } catch {
    return null;
  }
}

export async function fetchMoffinPdfBytes(
  url: string,
  moffinApiKey?: string | null,
  depth = 0,
): Promise<{ ok: true; buf: Uint8Array } | { ok: false; reason: string }> {
  if (depth > 3) {
    return { ok: false, reason: "demasiadas redirecciones JSON→URL" };
  }
  const attempts: { label: string; headers?: HeadersInit }[] = [];
  if (moffinApiKey?.trim()) {
    attempts.push({
      label: "Token Moffin",
      headers: {
        Authorization: `Token ${moffinApiKey.trim()}`,
        Accept: "application/pdf,application/json;q=0.5,*/*;q=0.3",
      },
    });
  }
  attempts.push({
    label: "sin Token",
    headers: { Accept: "application/pdf,application/json;q=0.5,*/*;q=0.3" },
  });

  let last = "sin intento";
  for (const { label, headers } of attempts) {
    try {
      const res = await fetch(url, { headers, redirect: "follow" });
      if (!res.ok) {
        last = `HTTP ${res.status} (${label})`;
        continue;
      }
      const buf = new Uint8Array(await res.arrayBuffer());
      const head = new TextDecoder().decode(buf.slice(0, 8));
      if (buf.length >= 4 && head.startsWith("%PDF")) {
        return { ok: true, buf };
      }
      const nested = tryExtractPdfUrlFromJsonBody(buf, url);
      if (nested && nested !== url) {
        const inner = await fetchMoffinPdfBytes(nested, moffinApiKey, depth + 1);
        if (inner.ok) return inner;
        last = inner.ok ? last : `${inner.reason} (tras JSON en ${label})`;
        continue;
      }
      last = `cuerpo no es PDF (${label}, ${buf.byteLength} bytes)`;
    } catch (e) {
      last = `${label}: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return { ok: false, reason: last };
}

function decodeBase64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64.replace(/\s/g, ""));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

export async function uploadMoffinPdfFromBytes(opts: {
  admin: ReturnType<typeof createClient>;
  orgId: string;
  projectId: string;
  clientId: string | null;
  uploadedBy: string | null;
  buf: Uint8Array;
  fileBase: string;
  documentDisplayName: string;
  documentType: string;
}): Promise<{ documentId: string | null; failureReason: string | null }> {
  const head = new TextDecoder().decode(opts.buf.slice(0, 8));
  if (opts.buf.length < 4 || !head.startsWith("%PDF")) {
    return { documentId: null, failureReason: "bytes no son PDF válido" };
  }

  const path = buildMoffinPdfStoragePath(opts.orgId, opts.clientId, opts.fileBase);
  const { error: upErr } = await opts.admin.storage.from("documents").upload(path, opts.buf, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (upErr) {
    console.error("moffin storage upload:", upErr.message);
    return { documentId: null, failureReason: `Storage: ${upErr.message}` };
  }

  const name = /\.pdf$/i.test(opts.documentDisplayName)
    ? opts.documentDisplayName
    : `${opts.documentDisplayName}.pdf`;

  const insertRow: Record<string, unknown> = {
    name,
    file_path: path,
    file_size: opts.buf.length,
    mime_type: "application/pdf",
    source: "supabase",
    organization_id: opts.orgId,
    project_id: opts.projectId,
    client_id: opts.clientId,
    document_type: opts.documentType,
  };
  if (opts.uploadedBy) insertRow.uploaded_by = opts.uploadedBy;

  const { data: doc, error: docErr } = await opts.admin
    .from("documents")
    .insert(insertRow)
    .select("id")
    .single();

  if (docErr) {
    console.error("moffin document insert:", docErr.message);
    return { documentId: null, failureReason: `DB: ${docErr.message}` };
  }

  return { documentId: doc.id as string, failureReason: null };
}

export async function uploadMoffinPdfFromUrl(opts: {
  admin: ReturnType<typeof createClient>;
  orgId: string;
  projectId: string;
  clientId: string | null;
  uploadedBy: string | null;
  url: string;
  fileBase: string;
  documentDisplayName: string;
  documentType: string;
  moffinApiKey?: string | null;
}): Promise<{ documentId: string | null; failureReason: string | null }> {
  const dl = await fetchMoffinPdfBytes(opts.url, opts.moffinApiKey);
  if (!dl.ok) {
    return { documentId: null, failureReason: dl.reason };
  }

  const path = buildMoffinPdfStoragePath(opts.orgId, opts.clientId, opts.fileBase);
  const { error: upErr } = await opts.admin.storage.from("documents").upload(path, dl.buf, {
    contentType: "application/pdf",
    upsert: false,
  });
  if (upErr) {
    console.error("moffin storage upload:", upErr.message);
    return { documentId: null, failureReason: `Storage: ${upErr.message}` };
  }

  const name = /\.pdf$/i.test(opts.documentDisplayName)
    ? opts.documentDisplayName
    : `${opts.documentDisplayName}.pdf`;

  const insertRow: Record<string, unknown> = {
    name,
    file_path: path,
    file_size: dl.buf.length,
    mime_type: "application/pdf",
    source: "supabase",
    organization_id: opts.orgId,
    project_id: opts.projectId,
    client_id: opts.clientId,
    document_type: opts.documentType,
  };
  if (opts.uploadedBy) insertRow.uploaded_by = opts.uploadedBy;

  const { data: doc, error: docErr } = await opts.admin
    .from("documents")
    .insert(insertRow)
    .select("id")
    .single();

  if (docErr) {
    console.error("moffin document insert:", docErr.message);
    return { documentId: null, failureReason: `DB: ${docErr.message}` };
  }

  return { documentId: doc.id as string, failureReason: null };
}
