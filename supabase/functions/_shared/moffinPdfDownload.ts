import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";
import { buildMoffinPdfStoragePath } from "./moffinStoragePath.ts";

export async function fetchMoffinPdfBytes(
  url: string,
  moffinApiKey?: string | null,
): Promise<{ ok: true; buf: Uint8Array } | { ok: false; reason: string }> {
  const attempts: { label: string; headers?: HeadersInit }[] = [];
  if (moffinApiKey?.trim()) {
    attempts.push({
      label: "Token Moffin",
      headers: {
        Authorization: `Token ${moffinApiKey.trim()}`,
        Accept: "application/pdf,*/*;q=0.8",
      },
    });
  }
  attempts.push({
    label: "sin Token",
    headers: { Accept: "application/pdf,*/*;q=0.8" },
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
      if (buf.length < 4 || !head.startsWith("%PDF")) {
        last = `cuerpo no es PDF (${label}, ${buf.byteLength} bytes)`;
        continue;
      }
      return { ok: true, buf };
    } catch (e) {
      last = `${label}: ${e instanceof Error ? e.message : String(e)}`;
    }
  }
  return { ok: false, reason: last };
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
