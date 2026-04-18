import { supabase } from "@/integrations/supabase/client";
import { sanitizeStorageFileName } from "@/lib/storageFilename";

const TMP_BUCKET = "tmp-zips";

export interface ExpandZipEdgeOptions {
  /** Tamano maximo total descomprimido en bytes (debe coincidir con limite del Edge). */
  maxTotalUncompressedBytes?: number;
}

export interface ExpandZipEdgeResult {
  files: File[];
  warnings: string[];
}

interface UnzipBatchResponse {
  files: Array<{
    name: string;
    size: number;
    path: string;
    signedUrl: string;
  }>;
  warnings?: string[];
}

function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

/**
 * Expande un ZIP grande delegando a la Edge Function `unzip-batch`.
 * Sube el ZIP a `tmp-zips/{userId}/{uuid}.zip`, invoca la Edge y descarga
 * cada entrada como `File`.
 */
export async function expandZipInEdge(
  zipFile: File,
  options: ExpandZipEdgeOptions = {}
): Promise<ExpandZipEdgeResult> {
  const { data: userData, error: userErr } = await supabase.auth.getUser();
  if (userErr || !userData?.user) {
    throw new Error("Sesion no valida para descomprimir ZIP en servidor");
  }
  const userId = userData.user.id;
  const safeName = sanitizeStorageFileName(zipFile.name) || "archivo.zip";
  const path = `${userId}/${uuid()}_${safeName}`;

  const { error: uploadErr } = await supabase.storage
    .from(TMP_BUCKET)
    .upload(path, zipFile, {
      contentType: "application/zip",
      upsert: false,
    });
  if (uploadErr) {
    throw new Error(`No se pudo subir el ZIP a ${TMP_BUCKET}: ${uploadErr.message}`);
  }

  let resp: { data: UnzipBatchResponse | null; error: { message: string } | null };
  try {
    resp = (await supabase.functions.invoke("unzip-batch", {
      body: {
        bucket: TMP_BUCKET,
        path,
        maxTotalUncompressedBytes: options.maxTotalUncompressedBytes,
      },
    })) as typeof resp;
  } catch (err) {
    await supabase.storage.from(TMP_BUCKET).remove([path]).catch(() => {});
    throw err instanceof Error ? err : new Error(String(err));
  }

  if (resp.error || !resp.data) {
    await supabase.storage.from(TMP_BUCKET).remove([path]).catch(() => {});
    throw new Error(resp.error?.message ?? "Error en unzip-batch");
  }

  const files: File[] = [];
  for (const entry of resp.data.files) {
    try {
      const downloaded = await fetch(entry.signedUrl);
      if (!downloaded.ok) {
        throw new Error(`HTTP ${downloaded.status}`);
      }
      const blob = await downloaded.blob();
      files.push(
        new File([blob], entry.name, {
          type: blob.type || "application/octet-stream",
          lastModified: Date.now(),
        })
      );
    } catch (err) {
      // Solo notificamos como warning para no abortar todo el batch.
      // eslint-disable-next-line no-console
      console.warn("[expandZipInEdge] descarga fallo", entry.name, err);
    }
  }

  // El bucket `tmp-zips` tiene lifecycle 24h, pero limpiamos eagerly.
  await supabase.storage.from(TMP_BUCKET).remove([path]).catch(() => {});

  return { files, warnings: resp.data.warnings ?? [] };
}
