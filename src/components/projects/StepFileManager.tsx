import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Upload, FileText, Loader2, Link2, Plus, Eye, PenTool, FileSpreadsheet, Presentation, FileType, ExternalLink, Trash2, FolderOpen } from "lucide-react";
import { FileDropzone } from "@/components/shared/FileDropzone";
import { documentsLimits, withLimits } from "@/lib/fileIntake/limits";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { formatDateMX } from "@/lib/dateUtils";
import { ACCEPTED_DOCUMENT_EXTENSIONS } from "@/lib/documentTypes";
import { logActivity } from "@/lib/activityLog";
import { sanitizeStorageFileName } from "@/lib/storageFilename";
import { DocumentPreviewDialog } from "@/components/documents/DocumentPreviewDialog";
import { DropboxUploadDialog } from "@/components/documents/DropboxUploadDialog";
import { DropboxFilePicker } from "@/components/projects/DropboxFilePicker";
import { SendToSignDialog } from "@/components/documents/SendToSignDialog";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";

interface Props {
  documentIds: string[];
  onDocumentAdded: (updatedIds: string[]) => void;
  projectId: string;
  clientDropboxPath?: string;
  disabled?: boolean;
}

export function StepFileManager({ documentIds, onDocumentAdded, projectId, clientDropboxPath, disabled }: Props) {
  const { user } = useAuth();
  const [uploading, setUploading] = useState(false);
  const [showDropboxInput, setShowDropboxInput] = useState(false);
  const [dropboxUrl, setDropboxUrl] = useState("");
  const [savingLink, setSavingLink] = useState(false);
  const [previewDoc, setPreviewDoc] = useState<any>(null);
  const [dropboxUploadFile, setDropboxUploadFile] = useState<File | null>(null);
  const [showDropboxUpload, setShowDropboxUpload] = useState(false);
  const [signDoc, setSignDoc] = useState<{ name: string; url: string } | null>(null);
  const [deleteDoc, setDeleteDoc] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [showDropboxPicker, setShowDropboxPicker] = useState(false);
  const dropboxFileRef = useRef<HTMLInputElement>(null);
  const [pendingLocalFiles, setPendingLocalFiles] = useState<File[]>([]);
  const localUploadLimits = withLimits(documentsLimits, { accept: ACCEPTED_DOCUMENT_EXTENSIONS });

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
    const folderPath = clientDropboxPath || "/Kawiil Mx";
    createDropboxDoc.mutate({ docType, docName, folderPath });
  };

  const { data: documents = [] } = useQuery({
    queryKey: ["step-docs", ...documentIds],
    queryFn: async () => {
      if (documentIds.length === 0) return [];
      const { data, error } = await supabase
        .from("documents")
        .select("id, name, mime_type, file_path, file_size, created_at, source, external_path")
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
      const linkName = dropboxUrl.includes("dropbox.com")
        ? decodeURIComponent(dropboxUrl.split("/").pop()?.split("?")[0] || "Enlace Dropbox")
        : "Enlace externo";
      const { data: doc, error } = await supabase
        .from("documents")
        .insert({
          name: linkName,
          external_path: dropboxUrl.trim(),
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
    const { data: doc, error: docErr } = await supabase
      .from("documents")
      .insert({
        name: file.name,
        file_path: path,
        mime_type: file.type,
        file_size: file.size,
        organization_id: orgId!,
        project_id: projectId,
        uploaded_by: user.id,
        source: "supabase" as const,
      })
      .select()
      .single();
    if (docErr) throw docErr;
    logActivity({ entityType: "document", entityId: doc.id, action: "file_uploaded", details: { name: file.name } });
    return doc.id as string;
  };

  const handleLocalDropzoneChange = async (files: File[]) => {
    if (files.length === 0 || !user) return;
    setPendingLocalFiles(files);
    setUploading(true);
    const addedIds: string[] = [];
    let failed = 0;
    try {
      for (const f of files) {
        try {
          const id = await uploadOneLocal(f);
          if (id) addedIds.push(id);
        } catch (err: any) {
          failed += 1;
          console.error("[StepFileManager] upload local fallo", f.name, err);
        }
      }
      if (addedIds.length > 0) {
        onDocumentAdded([...documentIds, ...addedIds]);
        toast.success(`${addedIds.length} archivo(s) subidos`);
      }
      if (failed > 0) toast.error(`${failed} archivo(s) fallaron`);
    } finally {
      setUploading(false);
      setPendingLocalFiles([]);
    }
  };

  const handleDropboxFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setDropboxUploadFile(file);
      setShowDropboxUpload(true);
    }
    if (dropboxFileRef.current) dropboxFileRef.current.value = "";
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
    setDropboxUploadFile(null);
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
          {/* Upload to Dropbox - primary action */}
          <input ref={dropboxFileRef} type="file" className="hidden" accept={ACCEPTED_DOCUMENT_EXTENSIONS} onChange={handleDropboxFileSelect} />
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
        onClose={() => { setShowDropboxUpload(false); setDropboxUploadFile(null); }}
        file={dropboxUploadFile}
        initialPath={clientDropboxPath || "/Kawiil Mx"}
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

      <DropboxFilePicker
        open={showDropboxPicker}
        onClose={() => setShowDropboxPicker(false)}
        initialPath={clientDropboxPath || "/Kawiil Mx"}
        onSelect={handleDropboxPickerSelect}
      />
    </div>
  );
}
