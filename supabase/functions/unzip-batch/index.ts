import { createClient } from "npm:@supabase/supabase-js@2";
import { unzipSync } from "npm:fflate@0.8.2";

/**
 * Edge function: unzip-batch
 *
 * Recibe `{ bucket, path }` apuntando a un ZIP previamente subido por el cliente.
 * Descomprime con `fflate` (Deno-friendly) y devuelve cada entrada como objeto
 * con URL firmada para descarga directa desde el navegador.
 *
 * Si `destination` se proporciona, en lugar de devolver URLs firmadas del bucket
 * temporal, sube cada archivo a `destination.bucket/destination.prefix/...` y
 * devuelve la URL firmada de la copia final.
 *
 * Operación: deploy con
 *   supabase functions deploy unzip-batch --project-ref qppfampapbxdgednkofc
 * Verifica JWT por defecto (config.toml: verify_jwt = true).
 */

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const DEFAULT_MAX_TOTAL_BYTES = 500 * 1024 * 1024;
const DEFAULT_MAX_FILES = 500;
const DEFAULT_SIGNED_URL_TTL = 60 * 30;
const TMP_BUCKET_DEFAULT = "tmp-zips";

interface RequestBody {
  bucket?: string;
  path: string;
  maxTotalUncompressedBytes?: number;
  maxFiles?: number;
  destination?: { bucket: string; prefix: string };
}

interface ResponseFile {
  name: string;
  size: number;
  path: string;
  signedUrl: string;
}

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

function guessMimeType(name: string): string {
  const ext = name.toLowerCase().split(".").pop() ?? "";
  switch (ext) {
    case "pdf": return "application/pdf";
    case "png": return "image/png";
    case "jpg":
    case "jpeg": return "image/jpeg";
    case "gif": return "image/gif";
    case "webp": return "image/webp";
    case "svg": return "image/svg+xml";
    case "txt":
    case "md": return "text/plain";
    case "csv": return "text/csv";
    case "json": return "application/json";
    case "xml": return "application/xml";
    case "html":
    case "htm": return "text/html";
    case "doc": return "application/msword";
    case "docx": return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
    case "xls": return "application/vnd.ms-excel";
    case "xlsx": return "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
    case "ppt": return "application/vnd.ms-powerpoint";
    case "pptx": return "application/vnd.openxmlformats-officedocument.presentationml.presentation";
    case "zip": return "application/zip";
    default: return "application/octet-stream";
  }
}

function sanitizeFileName(name: string): string {
  const normalized = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");
  const cleaned = normalized
    .replace(/[^A-Za-z0-9._\-()!*'+]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "");
  return cleaned.slice(0, 180) || "archivo";
}

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

    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const {
      data: { user },
      error: authError,
    } = await userClient.auth.getUser();
    if (authError || !user) return jsonResponse({ error: "No autorizado" }, 401);

    const body = (await req.json()) as RequestBody;
    if (!body || typeof body.path !== "string" || body.path.length === 0) {
      return jsonResponse({ error: "path requerido" }, 400);
    }

    const bucket = body.bucket || TMP_BUCKET_DEFAULT;
    const path = body.path;

    // Seguridad: el path debe empezar con `${userId}/` para que el usuario solo
    // pueda procesar ZIPs que el mismo subio.
    if (!path.startsWith(`${user.id}/`)) {
      return jsonResponse({ error: "ZIP no pertenece al usuario" }, 403);
    }

    const maxTotal = Math.min(
      Number(body.maxTotalUncompressedBytes) || DEFAULT_MAX_TOTAL_BYTES,
      DEFAULT_MAX_TOTAL_BYTES
    );
    const maxFiles = Math.min(
      Number(body.maxFiles) || DEFAULT_MAX_FILES,
      DEFAULT_MAX_FILES
    );

    const adminClient = createClient(supabaseUrl, serviceKey);

    const { data: downloadData, error: downloadErr } = await adminClient.storage
      .from(bucket)
      .download(path);
    if (downloadErr || !downloadData) {
      return jsonResponse(
        { error: `No se pudo descargar el ZIP: ${downloadErr?.message ?? "vacio"}` },
        404
      );
    }

    const arrayBuffer = await downloadData.arrayBuffer();
    let unzipped: Record<string, Uint8Array>;
    try {
      unzipped = unzipSync(new Uint8Array(arrayBuffer));
    } catch (err) {
      return jsonResponse(
        { error: `ZIP invalido: ${err instanceof Error ? err.message : String(err)}` },
        400
      );
    }

    const dest = body.destination ?? null;
    const destBucket = dest?.bucket ?? bucket;
    const baseDestPrefix = dest?.prefix ?? `${user.id}/unzipped/${crypto.randomUUID()}`;

    const warnings: string[] = [];
    const outFiles: ResponseFile[] = [];
    let totalBytes = 0;

    for (const [entryName, raw] of Object.entries(unzipped)) {
      if (isJunkEntry(entryName)) continue;
      if (!raw || raw.length === 0) continue;
      if (outFiles.length >= maxFiles) {
        warnings.push(`Se alcanzo el maximo de ${maxFiles} archivos por ZIP`);
        break;
      }
      totalBytes += raw.length;
      if (totalBytes > maxTotal) {
        warnings.push(
          `Se cancelo la extraccion al superar ${(maxTotal / 1024 / 1024).toFixed(0)} MB descomprimidos`
        );
        break;
      }

      const baseName = sanitizeFileName(basenameOf(entryName));
      const mime = guessMimeType(baseName);
      const destPath = `${baseDestPrefix}/${crypto.randomUUID()}_${baseName}`;

      // Convertir Uint8Array a Blob para subida.
      const blob = new Blob([raw], { type: mime });

      const { error: upErr } = await adminClient.storage
        .from(destBucket)
        .upload(destPath, blob, { contentType: mime, upsert: false });
      if (upErr) {
        warnings.push(`No se pudo subir ${baseName}: ${upErr.message}`);
        // Recompensar contador para no bloquear otras subidas.
        totalBytes -= raw.length;
        continue;
      }

      const { data: signed, error: signedErr } = await adminClient.storage
        .from(destBucket)
        .createSignedUrl(destPath, DEFAULT_SIGNED_URL_TTL);
      if (signedErr || !signed?.signedUrl) {
        warnings.push(`No se pudo firmar URL para ${baseName}`);
        continue;
      }

      outFiles.push({
        name: baseName,
        size: raw.length,
        path: destPath,
        signedUrl: signed.signedUrl,
      });
    }

    // Respuesta final.
    return jsonResponse({
      bucket: destBucket,
      basePrefix: baseDestPrefix,
      files: outFiles,
      warnings,
    });
  } catch (err) {
    return jsonResponse(
      { error: err instanceof Error ? err.message : "Error desconocido" },
      500
    );
  }
});
