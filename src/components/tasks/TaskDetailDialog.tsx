import { useState } from "react";
import { DropboxFilePicker } from "@/components/projects/DropboxFilePicker";
import { BlockTimeDialog } from "@/components/microsoft/BlockTimeDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { useTaskDetail, useAddComment, useUpdateTask } from "@/hooks/useTasks";
import { useAddTaskAssignee, useRemoveTaskAssignee } from "@/hooks/useTaskAssignees";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  MessageSquare, Paperclip, Link, Calendar, User, Flag, Clock,
  Upload, ExternalLink, Send, Plus, X, UserPlus, AlertTriangle, FolderOpen
} from "lucide-react";
import { formatMX } from "@/lib/dateUtils";
import { MentionTextarea } from "./MentionTextarea";
import { useProfiles } from "@/hooks/useTasks";

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
  const [newLink, setNewLink] = useState("");
  const [uploading, setUploading] = useState(false);
  const [showBlockTime, setShowBlockTime] = useState(false);
  const [showDropboxPicker, setShowDropboxPicker] = useState(false);
  const { data: orgProfiles } = useProfiles();

  if (!taskId) return null;

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
            <span key={i} className="text-primary font-medium">
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
              {task.due_date && (
                <span className="flex items-center gap-1 text-muted-foreground">
                  <Calendar className="h-3.5 w-3.5" />
                  {formatMX(task.due_date, "dd MMM yyyy")}
                </span>
              )}
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

            {task.description && (
              <p className="text-sm text-muted-foreground whitespace-pre-wrap">{task.description}</p>
            )}

            {/* Criticality & Delay tracking */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 p-3 rounded-lg border bg-muted/20">
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

            {/* Assignees - editable */}
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
              <Select
                onValueChange={(uid) => addAssignee.mutate({ taskId: taskId!, userId: uid })}
                value=""
              >
                <SelectTrigger className="w-full sm:w-[250px]">
                  <SelectValue placeholder="Agregar colaborador..." />
                </SelectTrigger>
                <SelectContent>
                  {orgProfiles
                    ?.filter((p) => !assignees.some((a: any) => a.user_id === p.user_id))
                    .map((p) => (
                      <SelectItem key={p.user_id} value={p.user_id}>{p.full_name}</SelectItem>
                    ))}
                </SelectContent>
              </Select>
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
                <div>
                  <label className="cursor-pointer">
                    <input type="file" className="hidden" onChange={handleFileUpload} disabled={uploading} />
                    <div className="flex items-center gap-2 p-3 border-2 border-dashed rounded-md text-sm text-muted-foreground hover:border-primary hover:text-primary transition-colors cursor-pointer">
                      <Upload className="h-4 w-4" />
                      {uploading ? "Subiendo..." : "Subir archivo"}
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
    </Dialog>
  );
}
