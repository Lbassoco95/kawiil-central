import { useCallback, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { FileText, Share2 } from "lucide-react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { formatMX } from "@/lib/dateUtils";
import { logEntityActivity } from "@/lib/activityLog";
import { sanitizeStorageFileName } from "@/lib/storageFilename";
import { ACCEPTED_DOCUMENT_EXTENSIONS } from "@/lib/documentTypes";
import { documentsLimits, withLimits } from "@/lib/fileIntake/limits";
import { getZipIntakeMarker } from "@/lib/fileIntake/zipMarkers";
import { invokeProcessDocumentForBinaryFile, postProcessUploadedDocument } from "@/lib/fileIntake/zipUploadPipeline";
import { filenameKey, nextDistinctFilename, fileWithName } from "@/lib/duplicateUpload";
import { replaceSupabaseStoredDocumentFile } from "@/lib/supabaseDocumentReplace";
import { mimeTypeForFile } from "@/lib/mimeFromFilename";
import { FileDropzone } from "@/components/shared/FileDropzone";
import { DocumentPreviewDialog } from "@/components/documents/DocumentPreviewDialog";
import {
  DuplicateFileResolutionDialog,
  type DuplicateResolutionChoice,
} from "@/components/shared/DuplicateFileResolutionDialog";
import type { Database, Json } from "@/integrations/supabase/types";

type LawsuitRow = Database["public"]["Tables"]["project_lawsuits"]["Row"];
type DocumentRow = Database["public"]["Tables"]["documents"]["Row"];

const LAWSUIT_ID_KEY = "lawsuit_id";

interface Props {
  lawsuit: LawsuitRow;
  clientId?: string | null;
}

function ReadBadge({ status }: { status?: string }) {
  if (status === "completed") return <span className="text-[10px] text-green-700 shrink-0">Leído por IA</span>;
  if (status === "failed") return <span className="text-[10px] text-muted-foreground shrink-0">Sin lectura IA</span>;
  return <span className="text-[10px] text-muted-foreground shrink-0">Leyendo…</span>;
}

/**
 * Expediente del juicio: se arrastran (o eligen) archivos, carpetas o .zip y se guardan igual
 * que en los demás módulos: Storage + fila en `documents` ligada al proyecto (y al cliente),
 * y lectura con IA (resumen y datos clave). El vínculo con el juicio va en `metadata.lawsuit_id`.
 */
export function LawsuitDocumentsPanel({ lawsuit, clientId }: Props) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [pendingFiles, setPendingFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<DocumentRow | null>(null);
  const [dupOpen, setDupOpen] = useState(false);
  const [dupName, setDupName] = useState("");
  const dupResolver = useRef<((c: DuplicateResolutionChoice) => void) | null>(null);
  const limits = withLimits(documentsLimits, { accept: ACCEPTED_DOCUMENT_EXTENSIONS });
  const queryKey = ["lawsuit-documents", lawsuit.id];

  const { data: docs = [], isLoading } = useQuery({
    queryKey,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("documents")
        .select("*")
        .eq("project_id", lawsuit.project_id)
        .eq(`metadata->>${LAWSUIT_ID_KEY}`, lawsuit.id)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as DocumentRow[];
    },
  });

  const docIds = docs.map((d) => d.id);
  const { data: readStatus = {} } = useQuery({
    queryKey: ["lawsuit-documents-read", lawsuit.id, docIds.join(",")],
    enabled: docIds.length > 0,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("extracted_documents")
        .select("document_id, extraction_status")
        .in("document_id", docIds);
      if (error) throw error;
      return Object.fromEntries((data ?? []).map((r) => [r.document_id, r.extraction_status])) as Record<string, string>;
    },
    // Mientras haya documentos recién subidos sin leer, revisa cada pocos segundos.
    refetchInterval: (q) => {
      const st = (q.state.data ?? {}) as Record<string, string>;
      return docIds.some((id) => !st[id] || st[id] === "processing" || st[id] === "pending") ? 8000 : false;
    },
  });

  const duplicatePrompt = useCallback((fileName: string) => {
    setDupName(fileName);
    setDupOpen(true);
    return new Promise<DuplicateResolutionChoice>((resolve) => {
      dupResolver.current = resolve;
    });
  }, []);

  const onDupResolve = useCallback((c: DuplicateResolutionChoice) => {
    setDupOpen(false);
    dupResolver.current?.(c);
    dupResolver.current = null;
  }, []);

  const uploadOne = async (file: File, orgId: string) => {
    const path = `${orgId}/${lawsuit.project_id}/${Date.now()}_${sanitizeStorageFileName(file.name)}`;
    const { error: upErr } = await supabase.storage.from("documents").upload(path, file);
    if (upErr) throw upErr;
    const lower = file.name.toLowerCase();
    const isZip = lower.endsWith(".zip") || file.type === "application/zip" || file.type === "application/x-zip-compressed";
    const mime = isZip ? file.type || "application/zip" : mimeTypeForFile(file);
    const marker = getZipIntakeMarker(file);
    const { data: doc, error: docErr } = await supabase
      .from("documents")
      .insert({
        name: file.name,
        file_path: path,
        mime_type: mime || null,
        file_size: file.size,
        organization_id: orgId,
        project_id: lawsuit.project_id,
        client_id: clientId ?? null,
        uploaded_by: user!.id,
        source: "supabase" as const,
        metadata: {
          [LAWSUIT_ID_KEY]: lawsuit.id,
          ...(marker?.kind === "server_deferred" ? { zip_container: true } : {}),
        },
      })
      .select()
      .single();
    if (docErr) throw docErr;
    void logEntityActivity(user!.id, orgId, {
      entityType: "document",
      entityId: doc.id,
      action: "file_uploaded",
      details: { name: file.name, lawsuit_id: lawsuit.id },
    });
    await postProcessUploadedDocument(doc.id as string, file);
    // Lectura con IA (resumen y datos clave): la usan las sugerencias de etapas del juicio.
    if (marker?.kind !== "server_deferred") invokeProcessDocumentForBinaryFile(file, doc.id as string);
  };

  const toggleShared = async (d: DocumentRow) => {
    const meta = (d.metadata && typeof d.metadata === "object" && !Array.isArray(d.metadata) ? d.metadata : {}) as Record<string, Json>;
    const next = { ...meta, client_shared: meta.client_shared !== true };
    const { error } = await supabase.from("documents").update({ metadata: next }).eq("id", d.id);
    if (error) {
      toast.error("No se pudo actualizar: " + error.message);
      return;
    }
    toast.success(next.client_shared ? "Compartido con el cliente" : "Ya no se comparte con el cliente");
    queryClient.invalidateQueries({ queryKey });
  };

  const handleFiles = async (files: File[]) => {
    if (files.length === 0 || !user) return;
    setPendingFiles(files);
    setUploading(true);
    let added = 0;
    let replaced = 0;
    let failed = 0;
    try {
      const { data: orgId } = await supabase.rpc("get_user_org_id", { _user_id: user.id });
      if (!orgId) throw new Error("No se pudo identificar la organización");
      const nameKeys = new Set(docs.map((d) => filenameKey(d.name)));
      for (const raw of files) {
        let f = raw;
        try {
          const match = docs.find((d) => filenameKey(d.name) === filenameKey(f.name));
          if (match) {
            const choice = await duplicatePrompt(f.name);
            if (choice === "skip") continue;
            if (choice === "copy") {
              f = fileWithName(f, nextDistinctFilename(f.name, nameKeys));
            } else {
              await replaceSupabaseStoredDocumentFile({
                documentId: match.id,
                file: f,
                pathDirectoryPrefix: `${orgId}/${lawsuit.project_id}`,
              });
              await postProcessUploadedDocument(match.id, f);
              if (getZipIntakeMarker(f)?.kind !== "server_deferred") {
                supabase.functions.invoke("process-document", { body: { document_id: match.id } }).catch(() => {});
              }
              if (getZipIntakeMarker(f)?.kind === "from_expanded_zip") {
                invokeProcessDocumentForBinaryFile(f, match.id);
              }
              replaced += 1;
              continue;
            }
          }
          await uploadOne(f, orgId as string);
          nameKeys.add(filenameKey(f.name));
          added += 1;
        } catch (err) {
          failed += 1;
          console.error("[LawsuitDocumentsPanel] upload falló", f.name, err);
        }
      }
      if (added > 0) toast.success(`${added} archivo(s) subidos al expediente`);
      if (replaced > 0) toast.success(`${replaced} archivo(s) reemplazados`);
      if (failed > 0) toast.error(`${failed} archivo(s) fallaron`);
      queryClient.invalidateQueries({ queryKey });
      queryClient.invalidateQueries({ queryKey: ["documents"] });
    } catch (e) {
      toast.error("Error al subir archivos: " + (e instanceof Error ? e.message : ""));
    } finally {
      setUploading(false);
      setPendingFiles([]);
    }
  };

  return (
    <div className="space-y-3">
      <FileDropzone
        files={pendingFiles}
        onChange={handleFiles}
        limits={limits}
        variant="area"
        disabled={uploading}
        showChips={false}
        hint={uploading ? "Subiendo…" : "Arrastra aquí el expediente"}
        subhint="Varios archivos, una carpeta o un .zip (se expande). Se guardan en los documentos del proyecto."
        className="text-xs"
        enableFolderPicker
      />

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Cargando…</p>
      ) : docs.length === 0 ? (
        <p className="text-xs text-muted-foreground text-center">Aún no hay archivos en el expediente.</p>
      ) : (
        <ul className="divide-y divide-border/50 rounded-lg border">
          {docs.map((d) => {
            const shared = (d.metadata as { client_shared?: unknown } | null)?.client_shared === true;
            return (
              <li key={d.id} className="flex items-center">
                <button
                  className="flex items-center gap-3 flex-1 min-w-0 px-3 py-2 text-left hover:bg-secondary/30"
                  onClick={() => setPreviewDoc(d)}
                >
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />
                  <span className="text-sm flex-1 truncate">{d.name}</span>
                  <ReadBadge status={readStatus[d.id]} />
                  <span className="text-[11px] text-muted-foreground shrink-0">
                    {formatMX(d.created_at, "dd MMM yyyy")}
                  </span>
                </button>
                <button
                  type="button"
                  className={`mr-2 flex items-center gap-1 rounded border px-1.5 py-0.5 text-[10px] shrink-0 ${
                    shared
                      ? "bg-blue-500/10 text-blue-700 border-blue-500/30"
                      : "text-muted-foreground hover:bg-secondary/40"
                  }`}
                  title={shared ? "Dejar de compartir con el cliente" : "Compartir con el cliente"}
                  onClick={() => void toggleShared(d)}
                >
                  <Share2 className="h-3 w-3" />
                  {shared ? "Compartido con el cliente" : "Interno"}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      <DocumentPreviewDialog
        open={!!previewDoc}
        onOpenChange={(o) => {
          if (!o) setPreviewDoc(null);
        }}
        document={previewDoc}
      />
      <DuplicateFileResolutionDialog open={dupOpen} fileName={dupName} onResolve={onDupResolve} />
    </div>
  );
}
