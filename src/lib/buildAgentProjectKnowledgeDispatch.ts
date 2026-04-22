import type { ChatAttachmentMeta } from "@/hooks/useChat";
import type { AiProjectDocumentWithFile } from "@/hooks/useAiProjects";
import { mimeTypeForFile } from "@/lib/mimeFromFilename";
import { DEFAULT_AGENT_MAX_KNOWLEDGE_BYTES } from "@/lib/agentDispatchInputContext";

/**
 * Límite de cantidad; el presupuesto de bytes puede parar antes (expedientes pesados),
 * aunque aún existan "huecos" de tope.
 */
export const MAX_KNOWLEDGE_SUPABASE_REFS = 20;
export const MAX_KNOWLEDGE_DROPBOX = 12;

/** Dropbox sin `file_size` en BD: cota heurística. */
export const DEFAULT_DROPBOX_ESTIMATED_BYTES = 1_000_000;
/** Storage con `file_size` null. */
export const DEFAULT_UNKNOWN_FILE_BYTES = 3_000_000;

export type BuildProjectKnowledgeOptions = {
  /**
   * Subconjunto de `documents.id`. Si se omite o vacío, se consideran todos
   * (tras ordenar y capar). Si se pasa, solo esas filas.
   */
  includedDocumentIds?: string[] | null;
  maxSupabaseRefs?: number;
  maxDropbox?: number;
  /**
   * Suma tope de `file_size` (y heurísticas) antes de dejar de añadir refs.
   * Por defecto de proyecto o `DEFAULT_AGENT_MAX_KNOWLEDGE_BYTES` en la app.
   */
  maxTotalBytes?: number;
};

export type BuildProjectKnowledgeResult = {
  supabaseRefs: ChatAttachmentMeta[];
  dropboxDocuments: { document_id: string; name: string; external_path: string }[];
  /** Suma de estimaciones (bytes) usada para el presupuesto. */
  includedBytesEstimate: number;
  skippedForByteBudget: number;
  includedDocumentIds: string[];
};

function sortByCreatedAtDesc(docs: AiProjectDocumentWithFile[]): AiProjectDocumentWithFile[] {
  return [...docs].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );
}

function estBytesForRow(row: AiProjectDocumentWithFile): { kind: "supa" | "drop"; est: number } | null {
  const d = row.documents;
  if (!d || !row.document_id) return null;
  if (d.file_path) {
    const fs = d.file_size;
    return { kind: "supa", est: fs != null && fs > 0 ? fs : DEFAULT_UNKNOWN_FILE_BYTES };
  }
  if (d.external_path) {
    return { kind: "drop", est: DEFAULT_DROPBOX_ESTIMATED_BYTES };
  }
  return null;
}

/**
 * Heurística basta para avisar en la UI; el texto extraído en la VM puede ser mayor (p. ej. XLSX).
 */
export function roughEstimateDocTokensForDispatch(bytes: number): number {
  return Math.ceil((bytes || 0) / 4);
}

/**
 * Construye referencias para la VM: orden por fecha, subconjunto opcional, tope de cantidad
 * y tope de bytes (expedientes grandes).
 */
export function buildProjectKnowledgeForAgentDispatch(
  projectDocs: AiProjectDocumentWithFile[],
  options?: BuildProjectKnowledgeOptions,
): BuildProjectKnowledgeResult {
  const maxSupa = options?.maxSupabaseRefs ?? MAX_KNOWLEDGE_SUPABASE_REFS;
  const maxDrop = options?.maxDropbox ?? MAX_KNOWLEDGE_DROPBOX;
  const maxBytes = options?.maxTotalBytes ?? DEFAULT_AGENT_MAX_KNOWLEDGE_BYTES;
  const includeIds = options?.includedDocumentIds;

  let working: AiProjectDocumentWithFile[];
  if (includeIds != null) {
    if (includeIds.length === 0) {
      return {
        supabaseRefs: [],
        dropboxDocuments: [],
        includedBytesEstimate: 0,
        skippedForByteBudget: 0,
        includedDocumentIds: [],
      };
    }
    working = projectDocs.filter((r) => r.document_id && includeIds.includes(r.document_id!));
  } else {
    working = projectDocs;
  }
  working = sortByCreatedAtDesc(working);

  const prepared: {
    row: AiProjectDocumentWithFile;
    kind: "supa" | "drop";
    est: number;
  }[] = [];
  for (const row of working) {
    const e = estBytesForRow(row);
    if (!e) continue;
    prepared.push({ row, ...e });
  }

  const supabaseRefs: ChatAttachmentMeta[] = [];
  const dropboxDocuments: { document_id: string; name: string; external_path: string }[] = [];
  const includedDocumentIds: string[] = [];
  let bytes = 0;
  let skippedForByteBudget = 0;

  for (const p of prepared) {
    if (p.kind === "supa") {
      if (supabaseRefs.length >= maxSupa) break;
      const d = p.row.documents;
      if (!d?.file_path || !p.row.document_id) continue;
      if (bytes + p.est > maxBytes) {
        skippedForByteBudget += 1;
        continue;
      }
      bytes += p.est;
      supabaseRefs.push({
        bucket: "documents",
        path: d.file_path,
        name: p.row.name,
        mime_type: d.mime_type || mimeTypeForFile({ name: p.row.name, type: d.mime_type || "" }),
      });
      includedDocumentIds.push(p.row.document_id);
    } else {
      if (dropboxDocuments.length >= maxDrop) break;
      const d = p.row.documents;
      if (!d?.external_path || !p.row.document_id) continue;
      if (bytes + p.est > maxBytes) {
        skippedForByteBudget += 1;
        continue;
      }
      bytes += p.est;
      dropboxDocuments.push({
        document_id: p.row.document_id,
        name: p.row.name,
        external_path: d.external_path,
      });
      includedDocumentIds.push(p.row.document_id);
    }
  }

  return {
    supabaseRefs,
    dropboxDocuments,
    includedBytesEstimate: bytes,
    skippedForByteBudget,
    includedDocumentIds: [...new Set(includedDocumentIds)],
  };
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
