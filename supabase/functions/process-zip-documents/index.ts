import { createClient } from "npm:@supabase/supabase-js@2";
import { unzipSync } from "npm:fflate@0.8.2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const BUCKET = "documents";
const SUPPORTED_EXTENSIONS = [
  ".pdf",
  ".xml",
  ".txt",
  ".md",
  ".docx",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".csv",
  ".json",
];
const TEXT_EXTENSIONS = [".txt", ".md", ".csv", ".json"];
const MAX_FILE_SIZE = 10 * 1024 * 1024;
const MAX_ENTRIES = 400;
const MAX_UNCOMPRESSED_BYTES = 500 * 1024 * 1024;

const OPENAI_URL = "https://api.openai.com/v1/embeddings";

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

function isJunkEntry(name: string): boolean {
  if (!name) return true;
  if (name.endsWith("/")) return true;
  if (name.includes("__MACOSX")) return true;
  if (name.endsWith(".DS_Store")) return true;
  if (name.endsWith("Thumbs.db")) return true;
  if (name.includes("..")) return true;
  if (name.startsWith("/")) return true;
  return false;
}

function basenameOf(path: string): string {
  const parts = path.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
}

function sanitizeFileName(name: string): string {
  const normalized = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const cleaned = normalized
    .replace(/[^A-Za-z0-9._\-()!*'+]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned.slice(0, 180) || "archivo";
}

function getExtension(name: string): string {
  const idx = name.lastIndexOf(".");
  return idx >= 0 ? name.slice(idx).toLowerCase() : "";
}

function getMimeType(ext: string): string {
  const map: Record<string, string> = {
    ".pdf": "application/pdf",
    ".xml": "application/xml",
    ".txt": "text/plain",
    ".md": "text/markdown",
    ".csv": "text/csv",
    ".json": "application/json",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".ppt": "application/vnd.ms-powerpoint",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  };
  return map[ext] || "application/octet-stream";
}

function chunkText(text: string): string[] {
  const maxChars = 2450;
  const overlapChars = 350;
  if (text.length <= maxChars) return [text];
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    const end = Math.min(start + maxChars, text.length);
    chunks.push(text.slice(start, end));
    if (end >= text.length) break;
    start = end - overlapChars;
    if (start < 0) start = 0;
  }
  return chunks;
}

const PROCESS_DOC_MIMES = [
  "application/pdf",
  "application/xml",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const authHeader = req.headers.get("Authorization");
    if (!authHeader) return jsonResponse({ error: "No autorizado" }, 401);

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const openaiKey = Deno.env.get("OPENAI_API_KEY");

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();
    if (authError || !user) return jsonResponse({ error: "No autorizado" }, 401);

    const body = (await req.json()) as { parent_document_id?: string };
    const parentId = body.parent_document_id;
    if (!parentId || typeof parentId !== "string") {
      return jsonResponse({ error: "parent_document_id requerido" }, 400);
    }

    const { data: parent, error: parentErr } = await userClient
      .from("documents")
      .select(
        "id, organization_id, client_id, project_id, file_path, name, mime_type, source, uploaded_by, metadata"
      )
      .eq("id", parentId)
      .single();

    if (parentErr || !parent) {
      return jsonResponse({ error: "Documento no encontrado o sin permiso" }, 404);
    }

    if (parent.source !== "supabase" || !parent.file_path) {
      return jsonResponse({ error: "El documento padre debe ser un archivo en almacenamiento" }, 400);
    }

    const isZipMime =
      parent.mime_type === "application/zip" ||
      parent.mime_type === "application/x-zip-compressed" ||
      (parent.name?.toLowerCase().endsWith(".zip") ?? false);
    if (!isZipMime) {
      return jsonResponse({ error: "El documento padre no es un archivo ZIP" }, 400);
    }

    const admin = createClient(supabaseUrl, serviceKey);

    await admin
      .from("documents")
      .update({
        metadata: {
          ...(typeof parent.metadata === "object" && parent.metadata !== null ? parent.metadata : {}),
          zip_extract: { status: "processing", at: new Date().toISOString() },
        },
      })
      .eq("id", parentId);

    const { data: zipBlob, error: dlErr } = await admin.storage
      .from(BUCKET)
      .download(parent.file_path as string);
    if (dlErr || !zipBlob) {
      await admin
        .from("documents")
        .update({
          metadata: {
            ...(typeof parent.metadata === "object" && parent.metadata !== null ? parent.metadata : {}),
            zip_extract: { status: "failed", error: dlErr?.message ?? "download" },
          },
        })
        .eq("id", parentId);
      return jsonResponse({ error: `No se pudo descargar el ZIP: ${dlErr?.message ?? ""}` }, 400);
    }

    const arrayBuffer = await zipBlob.arrayBuffer();
    let unzipped: Record<string, Uint8Array>;
    try {
      unzipped = unzipSync(new Uint8Array(arrayBuffer));
    } catch (e) {
      await admin
        .from("documents")
        .update({
          metadata: {
            ...(typeof parent.metadata === "object" && parent.metadata !== null ? parent.metadata : {}),
            zip_extract: {
              status: "failed",
              error: e instanceof Error ? e.message : "ZIP invalido",
            },
          },
        })
        .eq("id", parentId);
      return jsonResponse({ error: "ZIP invalido o corrupto" }, 400);
    }

    const warnings: string[] = [];
    let totalUncompressed = 0;
    const orgId = parent.organization_id as string;
    const projPart = parent.project_id ? String(parent.project_id) : "no-project";
    const basePrefix = `${orgId}/${projPart}/zip-${parentId}`;

    const pairs = Object.entries(unzipped)
      .filter(([name, raw]) => !isJunkEntry(name) && raw && raw.length > 0)
      .sort(([a], [b]) => a.localeCompare(b));

    let registered = 0;
    let embeddedChunks = 0;
    let skipped = 0;

    for (const [entryName, raw] of pairs) {
      if (registered >= MAX_ENTRIES) {
        warnings.push(`Se alcanzó el máximo de ${MAX_ENTRIES} archivos por extracción`);
        break;
      }
      totalUncompressed += raw.length;
      if (totalUncompressed > MAX_UNCOMPRESSED_BYTES) {
        warnings.push("Se detuvo: volumen descomprimido demasiado grande");
        break;
      }

      const ext = getExtension(basenameOf(entryName));
      if (ext === ".zip") {
        skipped += 1;
        continue;
      }
      if (!SUPPORTED_EXTENSIONS.includes(ext)) {
        skipped += 1;
        continue;
      }
      if (raw.length > MAX_FILE_SIZE) {
        warnings.push(`Omitido (muy grande): ${entryName}`);
        skipped += 1;
        continue;
      }

      const baseName = sanitizeFileName(basenameOf(entryName));
      const mime = getMimeType(ext);
      const destPath = `${basePrefix}/${crypto.randomUUID()}_${baseName}`;
      const blob = new Blob([raw], { type: mime });

      const { error: upErr } = await admin.storage
        .from(BUCKET)
        .upload(destPath, blob, { contentType: mime, upsert: false });
      if (upErr) {
        warnings.push(`No se subió ${baseName}: ${upErr.message}`);
        continue;
      }

      const { data: child, error: insErr } = await admin
        .from("documents")
        .insert({
          organization_id: orgId,
          client_id: parent.client_id,
          project_id: parent.project_id,
          name: baseName,
          source: "supabase",
          file_path: destPath,
          file_size: raw.length,
          mime_type: mime,
          parent_document_id: parentId,
          archive_path: entryName.replace(/^\/*/, ""),
          document_type: ext.replace(".", "").toUpperCase(),
          uploaded_by: parent.uploaded_by ?? user.id,
        })
        .select("id")
        .single();

      if (insErr || !child) {
        warnings.push(`DB ${baseName}: ${insErr?.message ?? "error"}`);
        continue;
      }
      registered += 1;

      if (TEXT_EXTENSIONS.includes(ext) && openaiKey) {
        let text = "";
        try {
          text = new TextDecoder("utf-8", { fatal: false }).decode(raw);
        } catch {
          text = "";
        }
        if (text.trim().length > 30) {
          const chunks = chunkText(text);
          const BATCH = 25;
          for (let i = 0; i < chunks.length; i += BATCH) {
            const batch = chunks.slice(i, i + BATCH);
            const embResp = await fetch(OPENAI_URL, {
              method: "POST",
              headers: {
                Authorization: `Bearer ${openaiKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                input: batch.map((c) => c.replace(/\n+/g, " ").trim()),
                model: "text-embedding-3-small",
                dimensions: 1536,
              }),
            });
            if (embResp.ok) {
              const embData = await embResp.json();
              const rows = batch.map((chunk, idx) => ({
                organization_id: orgId,
                document_id: child.id,
                client_id: parent.client_id,
                project_id: parent.project_id,
                source_type: "document",
                source_id: child.id,
                content: `[${baseName}] ${chunk}`,
                metadata: {
                  filename: baseName,
                  archive_path: entryName,
                  chunk_index: i + idx,
                },
                embedding: JSON.stringify(embData.data[idx].embedding),
                token_count: Math.ceil(chunk.length / 3.5),
              }));
              await admin.from("document_chunks").insert(rows);
              embeddedChunks += rows.length;
            }
          }
        }
      } else if (!TEXT_EXTENSIONS.includes(ext) && PROCESS_DOC_MIMES.includes(mime)) {
        try {
          const procResp = await fetch(`${supabaseUrl}/functions/v1/process-document`, {
            method: "POST",
            headers: {
              Authorization: `Bearer ${serviceKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({ document_id: child.id }),
          });
          if (procResp.ok) {
            const procResult = await procResp.json().catch(() => ({}));
            embeddedChunks += procResult.chunks_created || 0;
          }
        } catch (err) {
          console.error("process-document failed for", baseName, err);
        }
      }
    }

    const parentMeta =
      typeof parent.metadata === "object" && parent.metadata !== null ? parent.metadata : {};
    await admin
      .from("documents")
      .update({
        metadata: {
          ...parentMeta,
          zip_extract: {
            status: "completed",
            at: new Date().toISOString(),
            children_registered: registered,
            skipped_entries: skipped,
            embedded_chunks: embeddedChunks,
            warnings,
          },
        },
      })
      .eq("id", parentId);

    return jsonResponse({
      success: true,
      parent_document_id: parentId,
      registered,
      embedded_chunks: embeddedChunks,
      skipped,
      warnings,
    });
  } catch (err) {
    console.error("process-zip-documents:", err);
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Error desconocido" },
      500
    );
  }
});
