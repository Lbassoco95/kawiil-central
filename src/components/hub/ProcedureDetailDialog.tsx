import { useState, useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import {
  useProcedureVersions,
  useProcedureComments,
  useCreateProcedureComment,
  useDeleteProcedureComment,
  useUploadNewVersion,
} from "@/hooks/useInternalDespacho";
import { useUserRole } from "@/hooks/useUserRole";
import { useOrgUsers } from "@/hooks/useOrgUsers";
import { formatMX } from "@/lib/dateUtils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Separator } from "@/components/ui/separator";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  History,
  MessageCircle,
  Upload,
  Download,
  FileText,
  Eye,
  Trash2,
  Loader2,
  Send,
  X,
} from "lucide-react";

interface ProcedureDetailDialogProps {
  procedure: any;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function ProcedureDetailDialog({ procedure, open, onOpenChange }: ProcedureDetailDialogProps) {
  const { user } = useAuth();
  const { isAdminOrManager } = useUserRole();
  const { data: orgUsers = [] } = useOrgUsers();
  const { data: versions = [], isLoading: versionsLoading } = useProcedureVersions(procedure?.id);
  const { data: comments = [], isLoading: commentsLoading } = useProcedureComments(procedure?.id);
  const createComment = useCreateProcedureComment();
  const deleteComment = useDeleteProcedureComment();
  const uploadVersion = useUploadNewVersion();

  const [tab, setTab] = useState<"preview" | "versions" | "comments">("preview");
  const [commentText, setCommentText] = useState("");
  const [newVersionDialogOpen, setNewVersionDialogOpen] = useState(false);
  const [newVersionFile, setNewVersionFile] = useState<File | null>(null);
  const [newVersionNotes, setNewVersionNotes] = useState("");
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  const getUserName = (userId: string) => {
    const u = orgUsers.find((u: any) => u.user_id === userId);
    return u?.full_name || "Usuario";
  };

  useEffect(() => {
    if (open && procedure?.file_path) {
      loadPreview(procedure.file_path);
    }
    return () => { if (previewUrl) URL.revokeObjectURL(previewUrl); };
  }, [open, procedure?.file_path]);

  const loadPreview = async (filePath: string) => {
    setPreviewUrl(null);
    const { data } = await supabase.storage.from("documents").download(filePath);
    if (data) {
      const url = URL.createObjectURL(data);
      setPreviewUrl(url);
    }
  };

  const handleDownloadVersion = async (filePath: string) => {
    const { data } = await supabase.storage.from("documents").createSignedUrl(filePath, 60, { download: true });
    if (data?.signedUrl) window.open(data.signedUrl, "_blank");
  };

  const handlePreviewVersion = async (filePath: string) => {
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    await loadPreview(filePath);
    setTab("preview");
  };

  const handleSubmitComment = () => {
    if (!commentText.trim() || !procedure) return;
    createComment.mutate(
      { procedureId: procedure.id, content: commentText.trim() },
      { onSuccess: () => setCommentText("") }
    );
  };

  const handleUploadNewVersion = () => {
    if (!newVersionFile || !procedure) return;
    uploadVersion.mutate(
      {
        procedureId: procedure.id,
        file: newVersionFile,
        changeNotes: newVersionNotes.trim() || undefined,
        currentVersion: procedure.current_version || versions.length || 1,
      },
      {
        onSuccess: () => {
          setNewVersionDialogOpen(false);
          setNewVersionFile(null);
          setNewVersionNotes("");
        },
      }
    );
  };

  if (!procedure) return null;

  const isPdf = procedure.mime_type === "application/pdf";
  const isImage = procedure.mime_type?.startsWith("image/");

  return (
    <>
      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent className="sm:max-w-4xl max-h-[90vh] flex flex-col">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-4 w-4 text-primary" />
              {procedure.title}
              <span className="text-xs text-muted-foreground font-normal bg-secondary/60 px-2 py-0.5 rounded-full">
                v{procedure.current_version || 1}
              </span>
            </DialogTitle>
            {procedure.description && (
              <p className="text-sm text-muted-foreground">{procedure.description}</p>
            )}
          </DialogHeader>

          {/* Tab pills */}
          <div className="flex gap-1.5 pt-1">
            {[
              { key: "preview" as const, label: "Vista previa", icon: Eye },
              { key: "versions" as const, label: `Versiones (${versions.length})`, icon: History },
              { key: "comments" as const, label: `Comentarios (${comments.length})`, icon: MessageCircle },
            ].map((t) => (
              <button
                key={t.key}
                onClick={() => setTab(t.key)}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  tab === t.key
                    ? "bg-primary text-primary-foreground"
                    : "bg-secondary/60 text-muted-foreground hover:bg-secondary hover:text-foreground"
                }`}
              >
                <t.icon className="h-3 w-3" />
                {t.label}
              </button>
            ))}

            {isAdminOrManager && (
              <Button size="sm" variant="outline" className="ml-auto h-7 text-xs" onClick={() => setNewVersionDialogOpen(true)}>
                <Upload className="h-3 w-3 mr-1" />
                Nueva versión
              </Button>
            )}
          </div>

          <Separator />

          {/* Content area */}
          <div className="flex-1 min-h-0 overflow-y-auto">
            {tab === "preview" && (
              <div className="h-[500px]">
                {!previewUrl ? (
                  <div className="flex items-center justify-center h-full">
                    <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
                  </div>
                ) : isPdf ? (
                  <iframe src={previewUrl} className="w-full h-full rounded-lg border" title="Vista previa" />
                ) : isImage ? (
                  <div className="flex items-center justify-center h-full">
                    <img src={previewUrl} alt={procedure.title} className="max-w-full max-h-full object-contain rounded-lg" />
                  </div>
                ) : (
                  <div className="flex flex-col items-center justify-center h-full gap-3 text-muted-foreground">
                    <FileText className="h-12 w-12 opacity-40" />
                    <p className="text-sm">Vista previa no disponible para este tipo de archivo</p>
                    <Button variant="outline" size="sm" onClick={() => handleDownloadVersion(procedure.file_path)}>
                      <Download className="h-3.5 w-3.5 mr-1.5" />
                      Descargar para consultar
                    </Button>
                  </div>
                )}
              </div>
            )}

            {tab === "versions" && (
              <div className="space-y-1">
                {versionsLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : versions.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-8">Sin historial de versiones</p>
                ) : (
                  versions.map((v: any, i: number) => (
                    <div key={v.id} className={`flex items-center justify-between gap-3 rounded-lg px-3 py-2.5 ${i === 0 ? "bg-primary/5 ring-1 ring-primary/10" : "hover:bg-secondary/30"}`}>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-foreground">v{v.version_number}</span>
                          {i === 0 && <span className="text-[10px] bg-primary/10 text-primary px-1.5 py-0.5 rounded-full font-medium">Actual</span>}
                        </div>
                        {v.change_notes && <p className="text-xs text-muted-foreground mt-0.5">{v.change_notes}</p>}
                        <p className="text-[11px] text-muted-foreground mt-0.5">
                          {getUserName(v.uploaded_by)} · {formatMX(v.created_at, "dd MMM yyyy, HH:mm")}
                          {v.file_size && ` · ${(v.file_size / 1024).toFixed(0)} KB`}
                        </p>
                      </div>
                      <div className="flex items-center gap-1 shrink-0">
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => handlePreviewVersion(v.file_path)}>
                          <Eye className="h-3 w-3" />
                        </Button>
                        <Button variant="ghost" size="sm" className="h-7 text-xs" onClick={() => handleDownloadVersion(v.file_path)}>
                          <Download className="h-3 w-3" />
                        </Button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {tab === "comments" && (
              <div className="space-y-3">
                {commentsLoading ? (
                  <div className="flex justify-center py-8">
                    <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                  </div>
                ) : comments.length === 0 ? (
                  <p className="text-sm text-muted-foreground text-center py-6">Sin comentarios aún. ¡Sé el primero!</p>
                ) : (
                  comments.map((c: any) => (
                    <div key={c.id} className="group flex gap-2.5 px-1">
                      <div className="h-7 w-7 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                        <span className="text-[10px] font-semibold text-primary">
                          {getUserName(c.user_id).split(" ").map((n: string) => n[0]).join("").slice(0, 2)}
                        </span>
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium text-foreground">{getUserName(c.user_id)}</span>
                          <span className="text-[11px] text-muted-foreground">{formatMX(c.created_at, "dd MMM, HH:mm")}</span>
                          {(c.user_id === user?.id || isAdminOrManager) && (
                            <button
                              className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                              onClick={() => deleteComment.mutate({ id: c.id, procedureId: procedure.id })}
                            >
                              <Trash2 className="h-3 w-3" />
                            </button>
                          )}
                        </div>
                        <p className="text-sm text-foreground mt-0.5 whitespace-pre-wrap">{c.content}</p>
                      </div>
                    </div>
                  ))
                )}

                {/* Comment input */}
                <div className="flex gap-2 pt-2 border-t border-border/40">
                  <Textarea
                    value={commentText}
                    onChange={(e) => setCommentText(e.target.value)}
                    placeholder="Escribe un comentario..."
                    className="resize-none min-h-[36px] max-h-[100px] text-sm bg-secondary/30 border-0 rounded-xl"
                    rows={1}
                    onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); handleSubmitComment(); } }}
                  />
                  <Button
                    size="sm"
                    onClick={handleSubmitComment}
                    disabled={!commentText.trim() || createComment.isPending}
                    className="h-9 w-9 shrink-0 rounded-xl p-0"
                  >
                    {createComment.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Send className="h-3.5 w-3.5" />}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* New Version Dialog */}
      <Dialog open={newVersionDialogOpen} onOpenChange={setNewVersionDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Subir nueva versión</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div>
              <Label>Archivo *</Label>
              <Input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.txt,.md,image/*" onChange={(e) => setNewVersionFile(e.target.files?.[0] ?? null)} />
              {newVersionFile && <p className="text-xs text-muted-foreground mt-1">{newVersionFile.name}</p>}
            </div>
            <div>
              <Label>Notas del cambio (opcional)</Label>
              <Textarea
                value={newVersionNotes}
                onChange={(e) => setNewVersionNotes(e.target.value)}
                placeholder="Ej: Se actualizó la sección de procedimientos de alta..."
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNewVersionDialogOpen(false)}>Cancelar</Button>
            <Button onClick={handleUploadNewVersion} disabled={uploadVersion.isPending || !newVersionFile}>
              {uploadVersion.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Subir v{(procedure?.current_version || 1) + 1}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
