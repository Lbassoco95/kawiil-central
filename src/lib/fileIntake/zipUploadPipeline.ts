import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { getZipIntakeMarker } from "@/lib/fileIntake/zipMarkers";

/**
 * Tras insertar un `documents` asociado a un `File`, dispara extracción en Edge si el ZIP
 * se aplazó al servidor (`server_deferred`).
 */
export async function postProcessUploadedDocument(
  documentId: string,
  file: File
): Promise<void> {
  const m = getZipIntakeMarker(file);
  if (m?.kind !== "server_deferred") return;
  const { error } = await supabase.functions.invoke("process-zip-documents", {
    body: { parent_document_id: documentId },
  });
  if (error) {
    console.error("[zip] process-zip-documents", error);
    toast.error("No se pudo extraer el ZIP en el servidor.");
    return;
  }
  toast.success("ZIP procesado: archivos registrados e indexados.");
}

/** Indexación vía `process-document` para hijos extraídos del ZIP en cliente (PDF, Office, XML). */
export function invokeProcessDocumentForBinaryFile(
  file: File,
  documentId: string
): void {
  const name = file.name.toLowerCase();
  const mime = file.type;
  const processable =
    mime === "application/pdf" ||
    mime === "application/xml" ||
    mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    mime === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
    /\.(pdf|docx|xlsx|xml)$/i.test(name);
  if (!processable) return;
  supabase.functions
    .invoke("process-document", { body: { document_id: documentId } })
    .catch(() => {});
}
