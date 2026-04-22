import type { ChatAttachmentMeta } from "@/hooks/useChat";
import type { AiProjectDocumentWithFile } from "@/hooks/useAiProjects";
import { mimeTypeForFile } from "@/lib/mimeFromFilename";

/** Por tarea, para no forzar a la VM a inyectar decenas de PDFs en un solo prompt (límite ~200k tokens en el modelo). */
const MAX_KNOWLEDGE_SUPABASE_REFS = 20;
const MAX_KNOWLEDGE_DROPBOX = 12;

/**
 * Construye referencias que la VM (kawiil-agents) puede usar junto a `ai_project_id`:
 * - Supabase Storage: entran en `attachment_refs` (mismo formato que adjuntos del chat).
 * - Solo Dropbox: `knowledge_dropbox_documents` en `input_context` (la VM resuelve por `document_id` / path).
 */
export function buildProjectKnowledgeForAgentDispatch(projectDocs: AiProjectDocumentWithFile[]): {
  supabaseRefs: ChatAttachmentMeta[];
  dropboxDocuments: { document_id: string; name: string; external_path: string }[];
} {
  const supabaseRefs: ChatAttachmentMeta[] = [];
  const dropboxDocuments: { document_id: string; name: string; external_path: string }[] = [];

  for (const row of projectDocs) {
    const d = row.documents;
    if (!d || !row.document_id) continue;
    if (d.file_path) {
      if (supabaseRefs.length >= MAX_KNOWLEDGE_SUPABASE_REFS) break;
      supabaseRefs.push({
        bucket: "documents",
        path: d.file_path,
        name: row.name,
        mime_type: d.mime_type || mimeTypeForFile({ name: row.name, type: d.mime_type || "" }),
      });
    } else if (d.external_path) {
      if (dropboxDocuments.length >= MAX_KNOWLEDGE_DROPBOX) break;
      dropboxDocuments.push({
        document_id: row.document_id,
        name: row.name,
        external_path: d.external_path,
      });
    }
  }

  return { supabaseRefs, dropboxDocuments };
}

/**
 * Conocimiento del proyecto primero, luego adjuntos del chat; evita duplicar bucket+path.
 */
export function mergeAgentAttachmentRefs(
  knowledgeFirst: ChatAttachmentMeta[],
  fromChat: ChatAttachmentMeta[],
): ChatAttachmentMeta[] {
  const seen = new Set<string>();
  const out: ChatAttachmentMeta[] = [];
  for (const r of [...knowledgeFirst, ...fromChat]) {
    const k = `${r.bucket}::${r.path}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(r);
  }
  return out;
}
