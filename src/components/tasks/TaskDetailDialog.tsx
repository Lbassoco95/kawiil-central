import { useState, useMemo, useRef } from "react";
import { DropboxFilePicker } from "@/components/projects/DropboxFilePicker";
import { DropboxUploadDialog } from "@/components/documents/DropboxUploadDialog";
import { BlockTimeDialog } from "@/components/microsoft/BlockTimeDialog";
import { DocumentPreviewDialog } from "@/components/documents/DocumentPreviewDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useTaskDetail, useAddComment, useUpdateTask } from "@/hooks/useTasks";
import { useAddTaskAssignee, useRemoveTaskAssignee } from "@/hooks/useTaskAssignees";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  MessageSquare, Paperclip, Link, Calendar, User, Flag, Clock,
  Upload, ExternalLink, Send, Plus, X, UserPlus, AlertTriangle, FolderOpen, Pencil, Camera,
  Download, Eye, Link2, Loader2, ScanLine
} from "lucide-react";
import { formatMX } from "@/lib/dateUtils";
import { ACCEPTED_DOCUMENT_EXTENSIONS } from "@/lib/documentTypes";
import { MentionTextarea } from "./MentionTextarea";
import { useProfiles } from "@/hooks/useTasks";
import { SearchableSelect } from "@/components/shared/SearchableSelect";

interface CommentAttachment {
  type: "image" | "dropbox" | "link";
  name: string;
  url: string;
}


interface Props {
  taskId: string | null;
  onClose: () => void;
}

const statusLabels: Record<string, { label: string; color: string }> = {
  pendiente: { label: "Pendiente", color: "bg-muted text-muted-foreground" },
  en_progreso: { label: "En progreso", color: "bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200" },
  en_revision: { label: "En revisión", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200" },
  completada: { label: "Completada", color: "bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200" },
  cancelada: { label: "Cancelada", color: "bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200" },
};

const priorityLabels: Record<string, string> = {
  urgente: "🔴 Urgente",
  alta: "🟠 Alta",
  media: "🟡 Media",
  baja: "🟢 Baja",
};

const CRITICALITY_OPTIONS = [
  { value: "normal", label: "🟢 Normal", color: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400" },
  { value: "atencion", label: "🟡 Atención", color: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400" },
  { value: "critico", label: "🔴 Crítico", color: "bg-red-100 text-red-800 dark:bg-red-900/30 dark:text-red-400" },
];

const DELAY_CATEGORIES = [
  { value: "__none__", label: "Sin atraso" },
  { value: "atraso_cliente", label: "Atraso del cliente" },
  { value: "atraso_sat", label: "Atraso del SAT / autoridad" },
  { value: "recurso_interno", label: "Recurso interno" },
  { value: "dependencia_externa", label: "Dependencia externa" },
  { value: "otro", label: "Otro" },
];

export function TaskDetailDialog({ taskId, onClose }: Props) {
  const { task, isLoading, comments, assignees, documents } = useTaskDetail(taskId ?? undefined);
  const addComment = useAddComment();
  const updateTask = useUpdateTask();
  const addAssignee = useAddTaskAssignee();
  const removeAssignee = useRemoveTaskAssignee();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [commentText, setCommentText] = useState("");
  const [commentMentions, setCommentMentions] = useState<string[]>([]);
  const [commentAttachments, setCommentAttachments] = useState<CommentAttachment[]>([]);
  const [commentUploading, setCommentUploading] = useState(false);
  const [showCommentDropbox, setShowCommentDropbox] = useState(false);
  const [commentLinkInput, setCommentLinkInput] = useState("");
  const [showCommentLinkPopover, setShowCommentLinkPopover] = useState(false);
  const commentFileInputRef = useRef<HTMLInputElement>(null);
  const [newLink, setNewLink] = useState("");
  const [uploading, setUploading] = useState(false);
  const [showBlockTime, setShowBlockTime] = useState(false);
  const [showDropboxPicker, setShowDropboxPicker] = useState(false);
  const { data: orgProfiles } = useProfiles();
  const [scannedFile, setScannedFile] = useState<File | null>(null);
  const [showDropboxUpload, setShowDropboxUpload] = useState(false);
  const [scanInitialPath, setScanInitialPath] = useState("/Kawiil Mx");
  const [previewDoc, setPreviewDoc] = useState<any>(null);

  // Due date editing state
  const [editingDueDate, setEditingDueDate] = useState(false);
  const [newDueDate, setNewDueDate] = useState("");
  const [dueDateReason, setDueDateReason] = useState("");

  const sortedProfiles = useMemo(
    () =>
      (orgProfiles ?? [])
        .map((p) => ({ value: p.user_id, label: p.full_name }))
        .sort((a, b) => a.label.localeCompare(b.label, "es")),
    [orgProfiles]
  );

  if (!taskId) return null;

  const isAssignedUser =
    user &&
    (task?.assigned_to === user.id ||
      assignees.some((a: any) => a.user_id === user.id));

  // Render @mentions as styled spans
  const renderCommentContent = (content: string) => {
    const parts = content.split(/(@\w[\w\s]*\w)/g);
    return parts.map((part, i) => {
      if (part.startsWith("@")) {
        const name = part.slice(1);
        const isKnown = orgProfiles?.some(
          (p) => p.full_name.toLowerCase() === name.toLowerCase()
        );
        if (isKnown) {
          return (
            <span key={i} className="text-primary font-bold">
              {part}
            </span>
          );
        }
      }
      return part;
    });
  };

  const handleStatusChange = (status: string) => {
    updateTask.mutate({ id: taskId, status });
  };

  const handleSendComment = () => {
    if (!commentText.trim()) return;
    addComment.mutate(
      { taskId, content: commentText, mentions: commentMentions },
      {
        onSuccess: () => {
          setCommentText("");
          setCommentMentions([]);
        },
      }
    );
  };

  const handleDueDateSave = () => {
    if (!dueDateReason.trim()) {
      toast.error("Debes indicar el motivo del cambio de fecha");
      return;
    }
    const oldDate = task?.due_date ? formatMX(task.due_date, "dd MMM yyyy") : "Sin fecha";
    const newDateFormatted = newDueDate ? formatMX(newDueDate, "dd MMM yyyy") : "Sin fecha";

    updateTask.mutate({ id: taskId, due_date: newDueDate || null });

    // Auto-comment with reason
    addComment.mutate({
      taskId,
      content: `📅 Fecha límite modificada: ${oldDate} → ${newDateFormatted}\nMotivo: ${dueDateReason}`,
    });

    setEditingDueDate(false);
    setDueDateReason("");
    toast.success("Fecha límite actualizada");
  };

  const handleAddDropboxLink = () => {
    if (!newLink.trim() || !task) return;
    const currentLinks = (task.dropbox_links as any[]) ?? [];
    const updatedLinks = [...currentLinks, { url: newLink.trim(), added_at: new Date().toISOString() }];
    updateTask.mutate({ id: taskId, dropbox_links: updatedLinks });
    setNewLink("");
    toast.success("Enlace agregado");
  };

  const handleDropboxPickerSelect = (file: { name: string; url: string }) => {
    if (!task) return;
    const currentLinks = (task.dropbox_links as any[]) ?? [];
    const updatedLinks = [...currentLinks, { url: file.url, name: file.name, added_at: new Date().toISOString() }];
    updateTask.mutate({ id: taskId, dropbox_links: updatedLinks });
    toast.success(`"${file.name}" vinculado desde Dropbox`);
  };

  const handleRemoveLink = (index: number) => {
    if (!task) return;
    const currentLinks = (task.dropbox_links as any[]) ?? [];
    const updatedLinks = currentLinks.filter((_, i) => i !== index);
    updateTask.mutate({ id: taskId, dropbox_links: updatedLinks });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    setUploading(true);
    try {
      const filePath = `tasks/${taskId}/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage
        .from("documents")
        .upload(filePath, file);

      if (uploadError) throw uploadError;

      const { data: profile } = await supabase
        .from("profiles")
        .select("organization_id")
        .eq("user_id", user.id)
        .single();

      await supabase.from("documents").insert({
        name: file.name,
        file_path: filePath,
        mime_type: file.type,
        file_size: file.size,
        task_id: taskId,
        organization_id: profile!.organization_id,
        uploaded_by: user.id,
        source: "supabase" as const,
      });

      queryClient.invalidateQueries({ queryKey: ["task-documents", taskId] });
      toast.success("Archivo subido correctamente");
    } catch (err: any) {
      toast.error("Error al subir archivo: " + err.message);
    } finally {
      setUploading(false);
    }
  };

  const dropboxLinks = (task?.dropbox_links as any[]) ?? [];

  return (
    <Dialog open={!!taskId} onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-3xl gap-4">
        {isLoading ? (
          <div className="py-12 text-center text-muted-foreground">Cargando...</div>
        ) : task ? (
          <>
            <DialogHeader className="pr-8">
              <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
                <DialogTitle className="text-lg sm:text-xl leading-tight">{task.title}</DialogTitle>
                <Select value={task.status} onValueChange={handleStatusChange}>
                  <SelectTrigger className="w-full sm:w-[160px] shrink-0">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(statusLabels).map(([key, { label }]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </DialogHeader>

            {/* Meta info */}
            <div className="flex flex-wrap gap-3 text-sm">
              <Badge className={statusLabels[task.status]?.color}>{statusLabels[task.status]?.label}</Badge>
              <span className="flex items-center gap-1"><Flag className="h-3.5 w-3.5" />{priorityLabels[task.priority]}</span>
              {task.area && <Badge variant="outline">{task.area}</Badge>}
              {/* Due date - editable */}
              <span className="flex items-center gap-1 text-muted-foreground">
                <Calendar className="h-3.5 w-3.5" />
                {task.due_date ? formatMX(task.due_date, "dd MMM yyyy") : "Sin fecha"}
                {isAssignedUser && (
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-5 w-5 ml-1"
                    onClick={() => {
                      setNewDueDate(task.due_date || "");
                      setDueDateReason("");
                      setEditingDueDate(true);
                    }}
                  >
                    <Pencil className="h-3 w-3" />
                  </Button>
                )}
              </span>
              {(task as any).clients?.name && (
                <span className="flex items-center gap-1 text-muted-foreground">
                  <User className="h-3.5 w-3.5" />{(task as any).clients.name}
                </span>
              )}
              <Button
                variant="outline"
                size="sm"
                onClick={() => setShowBlockTime(true)}
                className="gap-1"
              >
                <Clock className="h-3.5 w-3.5" /> Bloquear tiempo
              </Button>
            </div>

            {/* Due date edit inline */}
            {editingDueDate && (
              <div className="p-3 rounded-lg border bg-muted/20 space-y-2">
                <p className="text-sm font-medium">Cambiar fecha límite</p>
                <Input
                  type="date"
                  value={newDueDate}
                  onChange={(e) => setNewDueDate(e.target.value)}
                  className="w-full sm:w-[200px]"
                />
                <Textarea
                  value={dueDateReason}
                  onChange={(e) => setDueDateReason(e.target.value)}
                  placeholder="Motivo del cambio de fecha (obligatorio)..."
                  rows={2}
                  className="text-sm"
                />
                <div className="flex gap-2">
                  <Button size="sm" onClick={handleDueDateSave} disabled={!dueDateReason.trim()}>
                    Guardar
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setEditingDueDate(false)}>
                    Cancelar
                  </Button>
                </div>
              </div>
            )}

            {task.description && (
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{task.description}</p>
            )}

            {/* Criticality & Delay tracking */}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-3 rounded-lg border bg-muted/20">
              <div>
                <span className="text-xs text-muted-foreground block mb-1">Semáforo</span>
                <Select
                  value={(task as any).criticality_level || "normal"}
                  onValueChange={(v) => updateTask.mutate({ id: taskId, criticality_level: v } as any)}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {CRITICALITY_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div>
                <span className="text-xs text-muted-foreground block mb-1">Motivo de atraso</span>
                <Select
                  value={(task as any).delay_category || "__none__"}
                  onValueChange={(v) => updateTask.mutate({ id: taskId, delay_category: v === "__none__" ? null : v } as any)}
                >
                  <SelectTrigger className="h-8 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {DELAY_CATEGORIES.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {((task as any).delay_category) && (
                <div className="col-span-2 sm:col-span-1">
                  <span className="text-xs text-muted-foreground block mb-1">Notas</span>
                  <Textarea
                    className="text-xs min-h-[60px]"
                    placeholder="Describe la situación..."
                    defaultValue={(task as any).delay_notes || ""}
                    onBlur={(e) => updateTask.mutate({ id: taskId, delay_notes: e.target.value || null } as any)}
                  />
                </div>
              )}
            </div>

            {/* Assignees - editable with search */}
            <div>
              <h4 className="text-sm font-medium mb-2 flex items-center gap-2">
                <UserPlus className="h-4 w-4" /> Colaboradores
              </h4>
              <div className="flex flex-wrap gap-2 mb-2">
                {assignees.map((a: any) => (
                  <Badge key={a.id} variant="secondary" className="gap-1">
                    {a.profile?.full_name || a.user_id}
                    <X
                      className="h-3 w-3 cursor-pointer hover:text-destructive"
                      onClick={() => removeAssignee.mutate({ taskId: taskId!, userId: a.user_id })}
                    />
                  </Badge>
                ))}
              </div>
              <SearchableSelect
                options={sortedProfiles.filter(
                  (p) => !assignees.some((a: any) => a.user_id === p.value)
                )}
                value=""
                onValueChange={(uid) => addAssignee.mutate({ taskId: taskId!, userId: uid })}
                placeholder="Agregar colaborador..."
                searchPlaceholder="Buscar colaborador..."
                className="w-full sm:w-[250px]"
              />
            </div>

            <Separator />

            <Tabs defaultValue="comments" className="w-full">
              <TabsList className="w-full">
                <TabsTrigger value="comments" className="flex-1">
                  <MessageSquare className="h-4 w-4 mr-1" />Comentarios ({comments.length})
                </TabsTrigger>
                <TabsTrigger value="links" className="flex-1">
                  <Link className="h-4 w-4 mr-1" />Enlaces ({dropboxLinks.length})
                </TabsTrigger>
                <TabsTrigger value="files" className="flex-1">
                  <Paperclip className="h-4 w-4 mr-1" />Archivos ({documents.length})
                </TabsTrigger>
              </TabsList>

              {/* Comments tab */}
              <TabsContent value="comments" className="space-y-4 mt-4">
                <div className="space-y-3 max-h-[300px] overflow-y-auto">
                  {comments.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">Sin comentarios aún</p>
                  )}
                  {comments.map((c) => (
                    <div key={c.id} className="flex gap-3">
                      <Avatar className="h-8 w-8">
                        <AvatarFallback className="text-xs">
                          {c.profile?.full_name?.charAt(0) || "?"}
                        </AvatarFallback>
                      </Avatar>
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="text-sm font-medium">{c.profile?.full_name || "Usuario"}</span>
                          <span className="text-xs text-muted-foreground">
                            {formatMX(c.created_at, "dd MMM HH:mm")}
                          </span>
                        </div>
                        <p className="text-sm text-foreground whitespace-pre-wrap">
                          {renderCommentContent(c.content)}
                        </p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <MentionTextarea
                    value={commentText}
                    onChange={setCommentText}
                    profiles={orgProfiles ?? []}
                    placeholder="Escribe un comentario... usa @ para mencionar"
                    rows={2}
                    onMentionsChange={setCommentMentions}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
                        handleSendComment();
                      }
                    }}
                  />
                  <Button size="icon" onClick={handleSendComment} disabled={addComment.isPending || !commentText.trim()}>
                    <Send className="h-4 w-4" />
                  </Button>
                </div>
              </TabsContent>

              {/* Links tab */}
              <TabsContent value="links" className="space-y-4 mt-4">
                <div className="space-y-2">
                  {dropboxLinks.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">Sin enlaces de Dropbox</p>
                  )}
                  {dropboxLinks.map((link: any, i: number) => (
                    <div key={i} className="flex items-center gap-2 p-2 rounded-md border bg-muted/30">
                      <ExternalLink className="h-4 w-4 text-muted-foreground shrink-0" />
                      <a href={link.url} target="_blank" rel="noreferrer" className="text-sm text-primary hover:underline truncate flex-1">
                        {link.url}
                      </a>
                      <span className="text-xs text-muted-foreground shrink-0">
                        {link.added_at ? formatMX(link.added_at, "dd MMM") : ""}
                      </span>
                      <X className="h-4 w-4 cursor-pointer text-muted-foreground hover:text-destructive shrink-0" onClick={() => handleRemoveLink(i)} />
                    </div>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    value={newLink}
                    onChange={(e) => setNewLink(e.target.value)}
                    placeholder="https://www.dropbox.com/..."
                    className="flex-1"
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddDropboxLink(); } }}
                  />
                  <Button size="sm" variant="outline" onClick={handleAddDropboxLink}>
                    <Plus className="h-4 w-4 mr-1" />Agregar
                  </Button>
                  <Button size="sm" variant="outline" onClick={() => setShowDropboxPicker(true)} title="Seleccionar archivo de Dropbox">
                    <FolderOpen className="h-4 w-4" />
                  </Button>
                </div>
              </TabsContent>

              {/* Files tab */}
              <TabsContent value="files" className="space-y-4 mt-4">
                <div className="space-y-2">
                  {documents.length === 0 && (
                    <p className="text-sm text-muted-foreground text-center py-4">Sin archivos adjuntos</p>
                  )}
                  {documents.map((doc) => (
                    <div key={doc.id} className="flex items-center gap-2 p-2 rounded-md border bg-muted/30">
                      <Paperclip className="h-4 w-4 text-muted-foreground" />
                      <span className="text-sm truncate flex-1">{doc.name}</span>
                      <span className="text-xs text-muted-foreground">
                        {doc.file_size ? `${(doc.file_size / 1024).toFixed(0)} KB` : ""}
                      </span>
                      <span className="text-xs text-muted-foreground">
                        {formatMX(doc.created_at, "dd MMM")}
                      </span>
                    </div>
                  ))}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                  <label className="cursor-pointer">
                    <input type="file" className="hidden" accept={ACCEPTED_DOCUMENT_EXTENSIONS} onChange={handleFileUpload} disabled={uploading} />
                    <div className="flex items-center gap-2 p-3 border-2 border-dashed rounded-md text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors cursor-pointer">
                      <Upload className="h-4 w-4" />
                      {uploading ? "Subiendo..." : "Subir archivo"}
                    </div>
                  </label>
                  <label className="cursor-pointer">
                    <input
                      type="file"
                      className="hidden"
                      accept="image/*"
                      capture="environment"
                      onChange={async (e) => {
                        const capturedFile = e.target.files?.[0];
                        if (!capturedFile || !task) return;
                        e.target.value = "";
                        // Determine initial path from client folder
                        let initPath = "/Kawiil Mx";
                        if (task.client_id) {
                          const { data: client } = await supabase
                            .from("clients")
                            .select("dropbox_folder_path")
                            .eq("id", task.client_id)
                            .single();
                          if (client?.dropbox_folder_path) {
                            initPath = client.dropbox_folder_path;
                          }
                        }
                        // Rename file to scan_timestamp
                        const ext = capturedFile.name.split('.').pop() || 'jpg';
                        const renamed = new File([capturedFile], `scan_${Date.now()}.${ext}`, { type: capturedFile.type });
                        setScanInitialPath(initPath);
                        setScannedFile(renamed);
                        setShowDropboxUpload(true);
                      }}
                      disabled={uploading}
                    />
                    <div className="flex items-center gap-2 p-3 border-2 border-dashed rounded-md text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors cursor-pointer">
                      <Camera className="h-4 w-4" />
                      Escanear a Dropbox
                    </div>
                  </label>
                </div>
              </TabsContent>
            </Tabs>
          </>
        ) : (
          <div className="py-12 text-center text-muted-foreground">Tarea no encontrada</div>
        )}
      </DialogContent>
      {task && (
        <BlockTimeDialog
          open={showBlockTime}
          onOpenChange={setShowBlockTime}
          taskTitle={task.title}
          taskDueDate={task.due_date || undefined}
        />
      )}
      <DropboxFilePicker
        open={showDropboxPicker}
        onClose={() => setShowDropboxPicker(false)}
        initialPath="/Kawiil Mx"
        onSelect={handleDropboxPickerSelect}
      />
      <DropboxUploadDialog
        open={showDropboxUpload}
        onClose={() => { setShowDropboxUpload(false); setScannedFile(null); }}
        file={scannedFile}
        initialPath={scanInitialPath}
        onUploaded={(result) => {
          if (!task) return;
          const currentLinks = (task.dropbox_links as any[]) ?? [];
          const updatedLinks = [...currentLinks, {
            url: result.url,
            name: result.name,
            added_at: new Date().toISOString(),
          }];
          updateTask.mutate({ id: taskId!, dropbox_links: updatedLinks });
          setScannedFile(null);
        }}
      />
    </Dialog>
  );
}
