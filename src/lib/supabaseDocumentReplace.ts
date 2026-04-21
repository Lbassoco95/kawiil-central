import { supabase } from "@/integrations/supabase/client";
import { sanitizeStorageFileName } from "@/lib/storageFilename";
import { mimeTypeForFile } from "@/lib/mimeFromFilename";

/**
 * Sustituye el binario en Storage y la fila `documents`, y deja extracción en pendiente para reprocesar.
 */
export async function replaceSupabaseStoredDocumentFile(opts: {
  documentId: string;
  file: File;
  /** Prefijo tipo `${orgId}/${projectOrAiId}` sin barra final */
  pathDirectoryPrefix: string;
}): Promise<void> {
  const { documentId, file, pathDirectoryPrefix } = opts;

  const { data: docRow, error: fetchErr } = await supabase
    .from("documents")
    .select("id, file_path")
    .eq("id", documentId)
    .single();
  if (fetchErr || !docRow?.id) throw new Error("No se encontró el documento");

  if (docRow.file_path) {
    await supabase.storage.from("documents").remove([docRow.file_path]);
  }

  await supabase
    .from("extracted_documents")
    .update({
      extraction_status: "pending",
      extraction_error: null,
      ai_summary: null,
    })
    .eq("document_id", documentId);

  const safeName = sanitizeStorageFileName(file.name);
  const filePath = `${pathDirectoryPrefix}/${Date.now()}_${safeName}`;
  const { error: storageErr } = await supabase.storage
    .from("documents")
    .upload(filePath, file, { upsert: true });
  if (storageErr) throw new Error(storageErr.message);

  const mime = mimeTypeForFile(file);
  const { error: updErr } = await supabase
    .from("documents")
    .update({
      name: file.name,
      file_path: filePath,
      file_size: file.size,
      mime_type: mime,
    })
    .eq("id", documentId);
  if (updErr) throw new Error(updErr.message);
}
