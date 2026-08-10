import { useState, useRef, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Upload, FileText, Loader2, Link2, Plus, Eye, PenTool, FileSpreadsheet, Presentation, FileType, ExternalLink, Trash2, FolderOpen, Archive, Camera } from "lucide-react";
import { FileDropzone } from "@/components/shared/FileDropzone";
import { documentsLimits, withLimits, STANDARD_BATCH_MAX_FILES } from "@/lib/fileIntake/limits";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { formatDateMX } from "@/lib/dateUtils";
import { ACCEPTED_DOCUMENT_EXTENSIONS } from "@/lib/documentTypes";
import { logActivity } from "@/lib/activityLog";
import { sanitizeStorageFileName } from "@/lib/storageFilename";
import { getZipIntakeMarker } from "@/lib/fileIntake/zipMarkers";
import {
  invokeProcessDocumentForBinaryFile,
  postProcessUploadedDocument,
} from "@/lib/fileIntake/zipUploadPipeline";
import { KAWIIL_TEAM_ROOT } from "@/lib/dropboxConfig";
import { extractDropboxFilenameFromUrl, getDropboxLinkDisplayLabel } from "@/lib/dropboxLinkLabel";
import { DocumentPreviewDialog } from "@/components/documents/DocumentPreviewDialog";
import { DropboxUploadDialog } from "@/components/documents/DropboxUploadDialog";
import { DropboxFilePicker } from "@/components/projects/DropboxFilePicker";
import { SendToSignDialog } from "@/components/documents/SendToSignDialog";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";
import {
  DuplicateFileResolutionDialog,
  type DuplicateResolutionChoice,
} from "@/components/shared/DuplicateFileResolutionDialog";
import {
  filenameKey,
  nextDistinctFilename,
  fileWithName,
} from "@/lib/duplicateUpload";
import { replaceSupabaseStoredDocumentFile } from "@/lib/supabaseDocumentReplace";
import { mimeTypeForFile } from "@/lib/mimeFromFilename";

interface Props {
  documentIds: string[];
  onDocumentAdded: (updatedIds: string[]) => void;
  projectId: string;
  clientDropboxPath?: string;
  disabled?: boolean;
  /** Muestra el botón "Escanear" (captura con cámara → tarea/paso + Dropbox). */
  allowScan?: boolean;
}

export function StepFileManager({ documentIds, onDocumentAdded, projectId, clientDropboxPath, disabled, allowScan }: Props) {
  const { user } = useAuth();
  const [uploading, setUploading] = useState(false);
  const scanFileRef = useRef<HTMLInputElement>(null);
  const [showDropboxInput, setShowDropboxInput] = useState(false);
  const [dropboxUrl, setDropboxUrl] = useState("");
  const [savingLink, setSavingLink] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<any>(null);
  const [dropboxUploadFile, setDropboxUploadFile] = useState<File | null>(null);
  const [dropboxUploadQueue, setDropboxUploadQueue] = useState<File[]>([]);
  const [showDropboxUpload, setShowDropboxUpload] = useState(false);
  const [signDoc, setSignDoc] = useState<{ name: string; url: string } | null>(null);
  const [deleteDoc, setDeleteDoc] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showDropboxPicker, setShowDropboxPicker] = useState(false);
  const dropboxFileRef = useRef<HTMLInputElement>(null);
  const [pendingLocalFiles, setPendingLocalFiles] = useState<File[]>([]);
  const [dupOpen, setDupOpen] = useState(false);
  const [dupName, setDupName] = useState("");
  const dupResolver = useRef<((c: DuplicateResolutionChoice) => void) | null>(null);
  const localUploadLimits = withLimits(documentsLimits, { accept: ACCEPTED_DOCUMENT_EXTENSIONS });

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

  const createDropboxDoc = useMutation({
    mutationFn: async ({ docType, docName, folderPath }: { docType: string; docName: string; folderPath: string }) => {
      const { data, error } = await supabase.functions.invoke("dropbox-browse", {
        body: { action: "create_office_doc", doc_type: docType, doc_name: docName, folder_path: folderPath },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);
      return data as { success: boolean; name: string; path: string; url: string };
    },
    onSuccess: async (data) => {
      toast.success(`${data.name} creado en Dropbox`);
      // Auto-register as document linked to this project
      if (user && data.url) {
        try {
          const { data: orgId } = await supabase.rpc("get_user_org_id", { _user_id: user.id });
          const { data: doc, error } = await supabase
            .from("documents")
            .insert({
              name: data.name,
              external_path: data.url,
              organization_id: orgId!,
              project_id: projectId,
              uploaded_by: user.id,
              source: "dropbox" as const,
            })
            .select()
            .single();
          if (!error && doc) {
            onDocumentAdded([...documentIds, doc.id]);
          }
        } catch {}
        // Open the Dropbox share URL (which opens in Dropbox web with Office editing)
        window.open(data.url, "_blank");
      }
    },
    onError: (err: Error) => toast.error("Error al crear documento: " + err.message),
  });

  const handleCreateDoc = (docType: "docx" | "xlsx" | "pptx") => {
    const labels = { docx: "Word", xlsx: "Excel", pptx: "PowerPoint" };
    const docName = `${labels[docType]} - ${new Date().toLocaleDateString("es-MX")}.${docType}`;
    const folderPath = clientDropboxPath || KAWIIL_TEAM_ROOT;
    createDropboxDoc.mutate({ docType, docName, folderPath });
  };

  const { data: documents = [] } = useQuery({
    queryKey: ["step-docs", ...documentIds],
    queryFn: async () => {
      if (documentIds.length === 0) return [];
      const { data, error } = await supabase
        .from("documents")
        .select(
          "id, name, mime_type, file_path, file_size, created_at, source, external_path, parent_document_id, archive_path, metadata"
        )
        .in("id", documentIds);
      if (error) throw error;
      return data;
    },
    enabled: documentIds.length > 0,
  });

  const handleSaveDropboxLink = async () => {
    if (!dropboxUrl.trim() || !user) return;
    setSavingLink(true);
    try {
      const { data: orgId } = await supabase.rpc("get_user_org_id", { _user_id: user.id });
      const trimmedUrl = dropboxUrl.trim();
      const linkName = trimmedUrl.includes("dropbox.com")
        ? extractDropboxFilenameFromUrl(trimmedUrl) ?? getDropboxLinkDisplayLabel(trimmedUrl)
        : "Enlace externo";
      const { data: doc, error } = await supabase
        .from("documents")
        .insert({
          name: linkName,
          external_path: trimmedUrl,
          organization_id: orgId!,
          project_id: projectId,
          uploaded_by: user.id,
          source: "dropbox" as const,
        })
        .select()
        .single();
      if (error) throw error;
      onDocumentAdded([...documentIds, doc.id]);
      logActivity({ entityType: "document", entityId: doc.id, action: "created", details: { name: linkName, source: "dropbox" } });
      toast.success("Enlace de Dropbox guardado");
      setDropboxUrl("");
      setShowDropboxInput(false);
    } catch (err: any) {
      toast.error("Error: " + err.message);
    } finally {
      setSavingLink(false);
    }
  };

  const uploadOneLocal = async (file: File): Promise<string | null> => {
    if (!user) return null;
    const { data: orgId } = await supabase.rpc("get_user_org_id", { _user_id: user.id });
    const safeName = sanitizeStorageFileName(file.name);
    const path = `${orgId}/${projectId}/${Date.now()}_${safeName}`;
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
        organization_id: orgId!,
        project_id: projectId,
        uploaded_by: user.id,
        source: "supabase" as const,
        metadata: marker?.kind === "server_deferred" ? { zip_container: true } : {},
      })
      .select()
      .single();
    if (docErr) throw docErr;
    logActivity({ entityType: "document", entityId: doc.id, action: "file_uploaded", details: { name: file.name } });
    await postProcessUploadedDocument(doc.id as string, file);
    if (marker?.kind === "from_expanded_zip") {
      invokeProcessDocumentForBinaryFile(file, doc.id as string);
    }
    return doc.id as string;
  };

  const handleLocalDropzoneChange = async (files: File[]) => {
    if (files.length === 0 || !user) return;
    setPendingLocalFiles(files);
    setUploading(true);
    const addedIds: string[] = [];
    let failed = 0;
    let replaced = 0;
    const { data: orgId } = await supabase.rpc("get_user_org_id", { _user_id: user.id });
    const nameKeys = new Set(documents.map((d) => filenameKey(d.name)));
    try {
      for (const raw of files) {
        let f = raw;
        try {
          const match = documents.find(
            (d) => filenameKey(d.name) === filenameKey(f.name)
          );
          if (match) {
            const choice = await duplicatePrompt(f.name);
            if (choice === "skip") continue;
            if (choice === "copy") {
              f = fileWithName(f, nextDistinctFilename(f.name, nameKeys));
            } else {
              await replaceSupabaseStoredDocumentFile({
                documentId: match.id as string,
                file: f,
                pathDirectoryPrefix: `${orgId}/${projectId}`,
              });
              await postProcessUploadedDocument(match.id as string, f);
              if (getZipIntakeMarker(f)?.kind !== "server_deferred") {
                supabase.functions
                  .invoke("process-document", { body: { document_id: match.id } })
                  .catch(() => {});
              }
              if (getZipIntakeMarker(f)?.kind === "from_expanded_zip") {
                invokeProcessDocumentForBinaryFile(f, match.id as string);
              }
              replaced += 1;
              nameKeys.add(filenameKey(f.name));
              continue;
            }
          }
          const id = await uploadOneLocal(f);
          if (id) {
            addedIds.push(id);
            nameKeys.add(filenameKey(f.name));
          }
        } catch (err: any) {
          failed += 1;
          console.error("[StepFileManager] upload local fallo", f.name, err);
        }
      }
      if (addedIds.length > 0) {
        onDocumentAdded([...documentIds, ...addedIds]);
        toast.success(`${addedIds.length} archivo(s) subidos`);
      }
      if (replaced > 0) toast.success(`${replaced} archivo(s) reemplazados`);
      if (failed > 0) toast.error(`${failed} archivo(s) fallaron`);
    } finally {
      setUploading(false);
      setPendingLocalFiles([]);
    }
  };

  const handleDropboxFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const list = Array.from(e.target.files ?? []).slice(0, STANDARD_BATCH_MAX_FILES);
    if (dropboxFileRef.current) dropboxFileRef.current.value = "";
    if (!list.length) return;
    setDropboxUploadQueue(list.slice(1));
    setDropboxUploadFile(list[0]);
    setShowDropboxUpload(true);
  };

  // Escaneo: captura con la cámara y reutiliza el flujo de subida a Dropbox
  // (handleDropboxUploaded crea el registro `documents` y lo enlaza al paso/término).
  const handleScanCapture = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (scanFileRef.current) scanFileRef.current.value = "";
    if (!file) return;
    const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
    const renamed = fileWithName(file, `escaneo_${Date.now()}.${ext}`);
    setDropboxUploadQueue([]);
    setDropboxUploadFile(renamed);
    setShowDropboxUpload(true);
  };

  const handleDropboxUploaded = async (result: { name: string; path: string; url: string }) => {
    if (!user) return;
    try {
      const { data: orgId } = await supabase.rpc("get_user_org_id", { _user_id: user.id });
      const { data: doc, error } = await supabase
        .from("documents")
        .insert({
          name: result.name,
          external_path: result.url || result.path,
          organization_id: orgId!,
          project_id: projectId,
          uploaded_by: user.id,
          source: "dropbox" as const,
        })
        .select()
        .single();
      if (error) throw error;
      onDocumentAdded([...documentIds, doc.id]);
      logActivity({ entityType: "document", entityId: doc.id, action: "file_uploaded", details: { name: result.name, source: "dropbox", dropbox_path: result.path } });
    } catch (err: any) {
      toast.error("Error al registrar documento: " + err.message);
    }
    setDropboxUploadQueue((q) => {
      if (q.length) {
        setDropboxUploadFile(q[0]);
        return q.slice(1);
      }
      setShowDropboxUpload(false);
      setDropboxUploadFile(null);
      return [];
    });
  };

  const handleDropboxPickerSelect = async (file: { name: string; url: string }) => {
    if (!user) return;
    try {
      const { data: orgId } = await supabase.rpc("get_user_org_id", { _user_id: user.id });
      const { data: doc, error } = await supabase
        .from("documents")
        .insert({
          name: file.name,
          external_path: file.url,
          organization_id: orgId!,
          project_id: projectId,
          uploaded_by: user.id,
          source: "dropbox" as const,
        })
        .select()
        .single();
      if (error) throw error;
      onDocumentAdded([...documentIds, doc.id]);
      logActivity({ entityType: "document", entityId: doc.id, action: "created", details: { name: file.name, source: "dropbox_picker" } });
      toast.success(`"${file.name}" vinculado desde Dropbox`);
    } catch (err: any) {
      toast.error("Error: " + err.message);
    }
  };

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-muted-foreground">Archivos</label>
        <div className="flex items-center gap-1">
          {/* Escanear (captura con cámara → paso/término + Dropbox) */}
          {allowScan && (
            <>
              <input
                ref={scanFileRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={handleScanCapture}
              />
              <Button
                variant="outline"
                size="sm"
                className="h-7 text-xs gap-1"
                disabled={disabled}
                onClick={() => scanFileRef.current?.click()}
              >
                <Camera className="h-3 w-3" />
                Escanear
              </Button>
            </>
          )}
          {/* Upload to Dropbox - primary action */}
          <input
            ref={dropboxFileRef}
            type="file"
            className="hidden"
            multiple
            accept={ACCEPTED_DOCUMENT_EXTENSIONS}
            onChange={handleDropboxFileSelect}
          />
          <Button
            variant="outline"
            size="sm"
            className="h-7 text-xs gap-1"
            disabled={disabled}
            onClick={() => dropboxFileRef.current?.click()}
          >
            <Upload className="h-3 w-3" />
            Subir a Dropbox
          </Button>
          {/* Browse Dropbox files */}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1"
            disabled={disabled}
            onClick={() => setShowDropboxPicker(true)}
          >
            <FolderOpen className="h-3 w-3" />
          </Button>
          {/* Link Dropbox URL */}
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1"
            disabled={disabled}
            onClick={() => setShowDropboxInput(!showDropboxInput)}
          >
            <Link2 className="h-3 w-3" />
          </Button>
          {/* Upload to local storage (multi + drag + ZIP) */}
          <FileDropzone
            files={pendingLocalFiles}
            onChange={handleLocalDropzoneChange}
            limits={localUploadLimits}
            variant="button"
            disabled={uploading || disabled}
            showChips={false}
            buttonLabel="Local"
            buttonSize="sm"
            buttonVariant="ghost"
            className="shrink-0"
            enableFolderPicker
          />
          {/* Create Office doc in Dropbox */}
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 text-xs gap-1"
                disabled={disabled || createDropboxDoc.isPending}
              >
                {createDropboxDoc.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
                Office
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuItem onClick={() => handleCreateDoc("docx")}>
                <FileType className="h-3.5 w-3.5 mr-2 text-blue-600" />
                Word
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleCreateDoc("xlsx")}>
                <FileSpreadsheet className="h-3.5 w-3.5 mr-2 text-green-600" />
                Excel
              </DropdownMenuItem>
              <DropdownMenuItem onClick={() => handleCreateDoc("pptx")}>
                <Presentation className="h-3.5 w-3.5 mr-2 text-orange-600" />
                PowerPoint
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      {showDropboxInput && (
        <div className="flex items-center gap-2">
          <Input
            placeholder="Pega el enlace de Dropbox aquí..."
            className="h-8 text-xs"
            value={dropboxUrl}
            onChange={(e) => setDropboxUrl(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleSaveDropboxLink()}
          />
          <Button
            variant="default"
            size="sm"
            className="h-8 text-xs shrink-0"
            disabled={!dropboxUrl.trim() || savingLink}
            onClick={handleSaveDropboxLink}
          >
            {savingLink ? <Loader2 className="h-3 w-3 animate-spin" /> : <Plus className="h-3 w-3" />}
          </Button>
        </div>
      )}

      {documents.length > 0 ? (
        <div className="space-y-1">
          {documents.map((doc) => (
            <div
              key={doc.id}
              className="flex items-center gap-2 rounded px-2 py-1.5 text-xs bg-background border border-border/50 hover:bg-accent/50 transition-colors"
            >
              <div
                className="flex items-center gap-2 flex-1 min-w-0 cursor-pointer"
                onClick={() => setPreviewDoc(doc)}
              >
                {doc.source === "dropbox" ? (
                  <Link2 className="h-3.5 w-3.5 text-blue-500 shrink-0" />
                ) : (doc as { metadata?: { zip_container?: boolean } }).metadata?.zip_container ||
                  doc.mime_type?.includes("zip") ? (
                  <Archive className="h-3.5 w-3.5 text-amber-600 shrink-0" />
                ) : (
                  <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                )}
                <span className="truncate flex-1">{doc.name}</span>
              </div>
              {/* Open in Dropbox to resume editing */}
              {doc.external_path && (
                <button
                  className="shrink-0 p-0.5 rounded hover:bg-primary/10 transition-colors"
                  title="Abrir en Dropbox"
                  onClick={(e) => {
                    e.stopPropagation();
                    window.open(doc.external_path!, "_blank");
                  }}
                >
                  <ExternalLink className="h-3 w-3 text-primary" />
                </button>
              )}
              {doc.external_path && (
                <button
                  className="shrink-0 p-0.5 rounded hover:bg-primary/10 transition-colors"
                  title="Enviar a firma"
                  onClick={(e) => {
                    e.stopPropagation();
                    setSignDoc({ name: doc.name, url: doc.external_path! });
                  }}
                >
                  <PenTool className="h-3 w-3 text-primary" />
                </button>
              )}
              <Eye
                className="h-3 w-3 text-muted-foreground shrink-0 cursor-pointer"
                onClick={() => setPreviewDoc(doc)}
              />
              <button
                className="shrink-0 p-0.5 rounded hover:bg-destructive/10 transition-colors"
                title="Eliminar archivo"
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteDoc(doc.id);
                }}
              >
                <Trash2 className="h-3 w-3 text-destructive" />
              </button>
              <span className="text-muted-foreground shrink-0">{formatDateMX(doc.created_at)}</span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-xs text-muted-foreground italic">Sin archivos adjuntos</p>
      )}

      <DocumentPreviewDialog
        open={!!previewDoc}
        onOpenChange={(o) => { if (!o) setPreviewDoc(null); }}
        document={previewDoc}
      />

      <DropboxUploadDialog
        open={showDropboxUpload}
        onClose={() => {
          setShowDropboxUpload(false);
          setDropboxUploadFile(null);
          setDropboxUploadQueue([]);
        }}
        file={dropboxUploadFile}
        initialPath={clientDropboxPath || KAWIIL_TEAM_ROOT}
        onUploaded={handleDropboxUploaded}
      />

      <SendToSignDialog
        open={!!signDoc}
        onClose={() => setSignDoc(null)}
        fileUrl={signDoc?.url}
        fileName={signDoc?.name}
      />

      <DeleteConfirmDialog
        open={!!deleteDoc}
        onOpenChange={(o) => { if (!o) setDeleteDoc(null); }}
        title="¿Eliminar este archivo?"
        description="Se desvinculará del paso. Si es un archivo de Dropbox, no se eliminará de Dropbox."
        isPending={deleting}
        onConfirm={async () => {
          if (!deleteDoc) return;
          setDeleting(true);
          try {
            await supabase.from("documents").delete().eq("id", deleteDoc);
            onDocumentAdded(documentIds.filter((id) => id !== deleteDoc));
            toast.success("Archivo eliminado del paso");
          } catch (err: any) {
            toast.error("Error: " + err.message);
          } finally {
            setDeleting(false);
            setDeleteDoc(null);
          }
        }}
      />

      <DuplicateFileResolutionDialog
        open={dupOpen}
        fileName={dupName}
        onResolve={onDupResolve}
      />

      <DropboxFilePicker
        open={showDropboxPicker}
        onClose={() => setShowDropboxPicker(false)}
        initialPath={clientDropboxPath || KAWIIL_TEAM_ROOT}
        onSelect={handleDropboxPickerSelect}
      />
    </div>
  );
}
