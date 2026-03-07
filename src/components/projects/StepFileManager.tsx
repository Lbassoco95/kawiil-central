import { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Upload, FileText, Loader2, Link2, Plus, Eye, PenTool } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";
import { formatDateMX } from "@/lib/dateUtils";
import { logActivity } from "@/lib/activityLog";
import { DocumentPreviewDialog } from "@/components/documents/DocumentPreviewDialog";
import { DropboxUploadDialog } from "@/components/documents/DropboxUploadDialog";
import { SendToSignDialog } from "@/components/documents/SendToSignDialog";

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
  const fileRef = useRef<HTMLInputElement>(null);
  const dropboxFileRef = useRef<HTMLInputElement>(null);

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

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setUploading(true);
    try {
      const { data: orgId } = await supabase.rpc("get_user_org_id", { _user_id: user.id });
      const path = `${orgId}/${projectId}/${Date.now()}_${file.name}`;
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
      onDocumentAdded([...documentIds, doc.id]);
      logActivity({ entityType: "document", entityId: doc.id, action: "file_uploaded", details: { name: file.name } });
      toast.success(`"${file.name}" subido`);
    } catch (err: any) {
      toast.error("Error: " + err.message);
    } finally {
      setUploading(false);
      if (fileRef.current) fileRef.current.value = "";
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

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between">
        <label className="text-xs font-medium text-muted-foreground">Archivos</label>
        <div className="flex items-center gap-1">
          {/* Upload to Dropbox - primary action */}
          <input ref={dropboxFileRef} type="file" className="hidden" onChange={handleDropboxFileSelect} />
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
          {/* Upload to local storage */}
          <input ref={fileRef} type="file" className="hidden" onChange={handleUpload} />
          <Button
            variant="ghost"
            size="sm"
            className="h-7 text-xs gap-1"
            disabled={uploading || disabled}
            onClick={() => fileRef.current?.click()}
          >
            {uploading ? <Loader2 className="h-3 w-3 animate-spin" /> : <FileText className="h-3 w-3" />}
            Local
          </Button>
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
    </div>
  );
}
