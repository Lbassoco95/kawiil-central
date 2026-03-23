import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { DropboxFilePicker } from "@/components/projects/DropboxFilePicker";
import { DropboxUploadDialog } from "@/components/documents/DropboxUploadDialog";
import { BlockTimeDialog } from "@/components/microsoft/BlockTimeDialog";
import { DocumentPreviewDialog } from "@/components/documents/DocumentPreviewDialog";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Separator } from "@/components/ui/separator";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useTaskDetail, useAddComment, useUpdateTask } from "@/hooks/useTasks";
import { useAddTaskAssignee, useRemoveTaskAssignee } from "@/hooks/useTaskAssignees";
import { useCelulaOptions } from "@/hooks/useCelulaOptions";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  MessageSquare, Paperclip, Link, Calendar, User, Flag, Clock,
  Upload, ExternalLink, Send, Plus, X, UserPlus, FolderOpen, Pencil, Camera,
  Download, Eye, Link2, Loader2, Play, Pause, Timer, UserCheck, ChevronDown, ListChecks, Settings2
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

interface ChecklistItem {
  id: string;
  text: string;
  completed: boolean;
  assigned_to?: string | null;
  due_date?: string | null;
  task_id?: string | null;
}

interface Props {
  taskId: string | null;
  onClose: () => void;
}

import { TASK_STATUS_CONFIG, PRIORITY_CONFIG } from "@/lib/statusStyles";

const statusLabels = TASK_STATUS_CONFIG;

const priorityLabels: Record<string, string> = Object.fromEntries(
  Object.entries(PRIORITY_CONFIG).map(([k, v]) => [k, `${v.emoji} ${v.label}`])
);

const CRITICALITY_OPTIONS = [
  { value: "normal", label: "🟢 Normal" },
  { value: "atencion", label: "🟡 Atención" },
  { value: "critico", label: "🔴 Crítico" },
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
  const { celulaLabelMap, getCelulaLabel } = useCelulaOptions();
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
  const [newSubtask, setNewSubtask] = useState("");
  const [newSubtaskAssignee, setNewSubtaskAssignee] = useState<string | null>(null);
  const [newSubtaskDueDate, setNewSubtaskDueDate] = useState("");
  const [showAdvanced, setShowAdvanced] = useState(false);

  // Buffered editable fields
  const [pendingChanges, setPendingChanges] = useState<Record<string, any>>({});
  const hasPendingChanges = Object.keys(pendingChanges).length > 0;

  const setPending = (field: string, value: any) => {
    setPendingChanges((prev) => ({ ...prev, [field]: value }));
  };

  const handleSaveChanges = () => {
    if (!hasPendingChanges) return;
    updateTask.mutate({ id: taskId, ...pendingChanges }, {
      onSuccess: () => {
        setPendingChanges({});
        toast.success("Cambios guardados");
      },
    });
  };

  // Reset pending changes when task changes
  useEffect(() => {
    setPendingChanges({});
  }, [taskId]);

  // Computed current values (pending override or task value)
  const currentTitle = pendingChanges.title ?? task?.title ?? "";
  const currentStatus = pendingChanges.status ?? task?.status ?? "pendiente";
  const currentPriority = pendingChanges.priority ?? task?.priority ?? "media";
  const currentAssignedTo = pendingChanges.assigned_to !== undefined ? pendingChanges.assigned_to : task?.assigned_to;
  const currentCriticality = pendingChanges.criticality_level ?? (task as any)?.criticality_level ?? "normal";
  const currentDelayCategory = pendingChanges.delay_category !== undefined ? pendingChanges.delay_category : (task as any)?.delay_category;
  const currentDelayNotes = pendingChanges.delay_notes !== undefined ? pendingChanges.delay_notes : (task as any)?.delay_notes;

  // Timer state
  const [timerRunning, setTimerRunning] = useState(false);
  const [displaySeconds, setDisplaySeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    if (task) setDisplaySeconds((task as any).time_spent_seconds || 0);
  }, [task?.id, (task as any)?.time_spent_seconds]);

  useEffect(() => {
    if (timerRunning) {
      timerRef.current = setInterval(() => setDisplaySeconds((s) => s + 1), 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [timerRunning]);

  const handleTimerToggle = useCallback(() => {
    if (timerRunning) {
      setTimerRunning(false);
      updateTask.mutate({ id: taskId!, time_spent_seconds: displaySeconds } as any);
    } else {
      setTimerRunning(true);
    }
  }, [timerRunning, displaySeconds, taskId, updateTask]);

  useEffect(() => {
    if (!taskId && timerRunning) setTimerRunning(false);
  }, [taskId]);

  const formatTimer = (totalSec: number) => {
    const h = Math.floor(totalSec / 3600);
    const m = Math.floor((totalSec % 3600) / 60);
    const s = totalSec % 60;
    return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  // Due date editing
  const [editingDueDate, setEditingDueDate] = useState(false);
  const [newDueDate, setNewDueDate] = useState("");
  const [dueDateReason, setDueDateReason] = useState("");

  const sortedProfiles = useMemo(
    () => (orgProfiles ?? []).map((p) => ({ value: p.user_id, label: p.full_name })).sort((a, b) => a.label.localeCompare(b.label, "es")),
    [orgProfiles]
  );

  if (!taskId) return null;

  const isAssignedUser = user && (task?.assigned_to === user.id || assignees.some((a: any) => a.user_id === user.id));

  // Checklist helpers
  const checklist: ChecklistItem[] = ((task?.checklist as any[]) ?? []).map((item: any, i: number) => ({
    id: item.id || `item-${i}`,
    text: item.text || "",
    completed: !!item.completed,
    assigned_to: item.assigned_to || null,
    due_date: item.due_date || null,
    task_id: item.task_id || null,
  }));
  const completedCount = checklist.filter((c) => c.completed).length;

  const updateChecklist = (newChecklist: ChecklistItem[]) => {
    updateTask.mutate({ id: taskId, checklist: newChecklist as any });
  };

  const toggleChecklistItem = (itemId: string) => {
    updateChecklist(checklist.map((c) => c.id === itemId ? { ...c, completed: !c.completed } : c));
  };

  const addChecklistItem = async () => {
    if (!newSubtask.trim()) return;
    const text = newSubtask.trim();
    const assignee = newSubtaskAssignee;
    const dueDate = newSubtaskDueDate || null;

    // Create a real task in the database for traceability
    try {
      const { data: profile } = await supabase
        .from("profiles")
        .select("organization_id")
        .eq("user_id", user!.id)
        .single();

      if (!profile) throw new Error("No profile");

      const { data: newTask, error } = await supabase
        .from("tasks")
        .insert({
          title: text,
          organization_id: profile.organization_id,
          created_by: user!.id,
          assigned_to: assignee,
          due_date: dueDate,
          client_id: task?.client_id || null,
          project_id: task?.project_id || null,
          status: "pendiente" as const,
          priority: "media" as const,
        })
        .select()
        .single();

      if (error) throw error;

      const newItem: ChecklistItem = {
        id: `item-${Date.now()}`,
        text,
        completed: false,
        assigned_to: assignee,
        due_date: dueDate,
        task_id: newTask.id,
      };

      updateChecklist([...checklist, newItem]);
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
    } catch (err: any) {
      toast.error("Error al crear subtarea: " + err.message);
      return;
    }

    setNewSubtask("");
    setNewSubtaskAssignee(null);
    setNewSubtaskDueDate("");
  };

  const removeChecklistItem = (itemId: string) => {
    updateChecklist(checklist.filter((c) => c.id !== itemId));
  };

  const MENTION_REGEX = /(@[a-zA-ZáéíóúñÁÉÍÓÚÑüÜ\w][a-zA-ZáéíóúñÁÉÍÓÚÑüÜ\w\s]*[a-zA-ZáéíóúñÁÉÍÓÚÑüÜ\w])/g;
  const LINK_REGEX = /📎\s*\[([^\]]+)\]\(([^)]+)\)/g;

  const renderCommentContent = (content: string) => {
    // First parse attachment links
    const elements: React.ReactNode[] = [];
    let lastIndex = 0;
    let linkMatch;
    const tempContent = content;
    const linkRegex = new RegExp(LINK_REGEX.source, "g");

    while ((linkMatch = linkRegex.exec(tempContent)) !== null) {
      const before = tempContent.slice(lastIndex, linkMatch.index);
      if (before) elements.push(...renderMentions(before, elements.length));
      elements.push(
        <a
          key={`link-${linkMatch.index}`}
          href={linkMatch[2]}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1 text-xs text-primary hover:underline break-all max-w-full"
        >
          📎 <span className="truncate max-w-[200px]">{linkMatch[1]}</span>
          <ExternalLink className="h-3 w-3 shrink-0 inline" />
        </a>
      );
      lastIndex = linkMatch.index + linkMatch[0].length;
    }
    const remaining = tempContent.slice(lastIndex);
    if (remaining) elements.push(...renderMentions(remaining, elements.length));
    return elements.length > 0 ? elements : content;
  };

  const renderMentions = (text: string, keyOffset: number): React.ReactNode[] => {
    const parts = text.split(MENTION_REGEX);
    return parts.map((part, i) => {
      if (part.startsWith("@")) {
        const name = part.slice(1);
        const isKnown = orgProfiles?.some((p) => p.full_name.toLowerCase() === name.toLowerCase());
        if (isKnown) return <span key={`m-${keyOffset}-${i}`} className="text-primary font-bold">{part}</span>;
      }
      return <span key={`t-${keyOffset}-${i}`}>{part}</span>;
    });
  };

  const handleStatusChange = (status: string) => setPending("status", status);

  const handleSendComment = () => {
    if (!commentText.trim() && commentAttachments.length === 0) return;
    let finalContent = commentText;
    if (commentAttachments.length > 0) {
      const attachmentLines = commentAttachments.map(a => `📎 [${a.name}](${a.url})`).join("\n");
      finalContent = finalContent ? `${finalContent}\n${attachmentLines}` : attachmentLines;
    }
    addComment.mutate({ taskId, content: finalContent, mentions: commentMentions }, {
      onSuccess: () => { setCommentText(""); setCommentMentions([]); setCommentAttachments([]); },
    });
  };

  const handleCommentFileUpload = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    setCommentUploading(true);
    try {
      for (const file of Array.from(files)) {
        if (file.size > 25 * 1024 * 1024) { toast.error(`${file.name} excede 25MB`); continue; }
        const path = `comment-attachments/${Date.now()}_${file.name}`;
        const { error } = await supabase.storage.from("documents").upload(path, file);
        if (error) throw error;
        const { data: urlData } = await supabase.storage.from("documents").createSignedUrl(path, 60 * 60 * 24 * 365);
        if (!urlData?.signedUrl) throw new Error("No se pudo generar URL");
        const isImage = file.type.startsWith("image/");
        setCommentAttachments(prev => [...prev, { type: isImage ? "image" : "link", name: file.name, url: urlData.signedUrl }]);
      }
    } catch (e: any) {
      toast.error("Error al subir archivo: " + e.message);
    } finally {
      setCommentUploading(false);
      if (commentFileInputRef.current) commentFileInputRef.current.value = "";
    }
  };

  const handleDocDownload = async (doc: any) => {
    if (!doc.file_path) return;
    try {
      const { data, error } = await supabase.storage.from("documents").createSignedUrl(doc.file_path, 60, { download: true });
      if (error) throw error;
      const a = document.createElement("a");
      a.href = data.signedUrl.startsWith("http") ? data.signedUrl : `${import.meta.env.VITE_SUPABASE_URL}/storage/v1${data.signedUrl}`;
      a.download = doc.name;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
    } catch (err: any) {
      toast.error("Error al descargar: " + err.message);
    }
  };

  const handleDueDateSave = () => {
    if (!dueDateReason.trim()) { toast.error("Debes indicar el motivo del cambio de fecha"); return; }
    const oldDate = task?.due_date ? formatMX(task.due_date, "dd MMM yyyy") : "Sin fecha";
    const newDateFormatted = newDueDate ? formatMX(newDueDate, "dd MMM yyyy") : "Sin fecha";
    updateTask.mutate({ id: taskId, due_date: newDueDate || null });
    addComment.mutate({ taskId, content: `📅 Fecha límite modificada: ${oldDate} → ${newDateFormatted}\nMotivo: ${dueDateReason}` });
    setEditingDueDate(false);
    setDueDateReason("");
    toast.success("Fecha límite actualizada");
  };

  const handleAddDropboxLink = () => {
    if (!newLink.trim() || !task) return;
    const currentLinks = (task.dropbox_links as any[]) ?? [];
    updateTask.mutate({ id: taskId, dropbox_links: [...currentLinks, { url: newLink.trim(), added_at: new Date().toISOString() }] });
    setNewLink("");
    toast.success("Enlace agregado");
  };

  const handleDropboxPickerSelect = (file: { name: string; url: string }) => {
    if (!task) return;
    const currentLinks = (task.dropbox_links as any[]) ?? [];
    updateTask.mutate({ id: taskId, dropbox_links: [...currentLinks, { url: file.url, name: file.name, added_at: new Date().toISOString() }] });
    toast.success(`"${file.name}" vinculado desde Dropbox`);
  };

  const handleRemoveLink = (index: number) => {
    if (!task) return;
    const currentLinks = (task.dropbox_links as any[]) ?? [];
    updateTask.mutate({ id: taskId, dropbox_links: currentLinks.filter((_, i) => i !== index) });
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !user) return;
    setUploading(true);
    try {
      const filePath = `tasks/${taskId}/${Date.now()}_${file.name}`;
      const { error: uploadError } = await supabase.storage.from("documents").upload(filePath, file);
      if (uploadError) throw uploadError;
      const { data: profile } = await supabase.from("profiles").select("organization_id").eq("user_id", user.id).single();
      await supabase.from("documents").insert({
        name: file.name, file_path: filePath, mime_type: file.type, file_size: file.size,
        task_id: taskId, organization_id: profile!.organization_id, uploaded_by: user.id, source: "supabase" as const,
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
  const areaLabel = task?.area ? getCelulaLabel(task.area) : null;

  return (
    <Dialog open={!!taskId} onOpenChange={() => onClose()}>
      <DialogContent className="sm:max-w-3xl gap-0 p-0 overflow-hidden">
        {isLoading ? (
          <div className="py-12 text-center text-muted-foreground">Cargando...</div>
        ) : task ? (
          <div className="flex flex-col max-h-[85vh]">
            {/* ── Header ── */}
            <div className="px-6 pt-5 pb-3 space-y-4">
              {/* Row 1: Editable title */}
              <DialogHeader className="p-0">
                <DialogTitle className="sr-only">Detalle de tarea</DialogTitle>
                <Input
                  value={currentTitle}
                  onChange={(e) => setPending("title", e.target.value)}
                  className="text-base font-semibold border-0 border-b border-transparent hover:border-border focus-visible:border-primary focus-visible:ring-0 px-0 h-auto py-1 rounded-none bg-transparent"
                  placeholder="Nombre de la tarea"
                />
              </DialogHeader>

              {/* Row 2: Main controls — Status, Priority, Assignee */}
              <div className="grid grid-cols-3 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Estado</label>
                  <Select value={currentStatus} onValueChange={handleStatusChange}>
                    <SelectTrigger className="h-8 text-xs w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(statusLabels).map(([key, { label }]) => (
                        <SelectItem key={key} value={key}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Prioridad</label>
                  <Select value={currentPriority} onValueChange={(v) => setPending("priority", v)}>
                    <SelectTrigger className="h-8 text-xs w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {Object.entries(priorityLabels).map(([key, label]) => (
                        <SelectItem key={key} value={key}>{label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide">Responsable</label>
                  <SearchableSelect
                    options={sortedProfiles}
                    value={currentAssignedTo || ""}
                    onValueChange={(uid) => setPending("assigned_to", uid || null)}
                    placeholder="Sin asignar"
                    searchPlaceholder="Buscar..."
                    className="h-8 w-full text-xs"
                  />
                </div>
              </div>

              {/* Row 3: Context info */}
              <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                {areaLabel && <span className="font-medium text-foreground/80">{areaLabel}</span>}
                {(task as any).clients?.name && (
                  <span className="flex items-center gap-1"><User className="h-3 w-3" />{(task as any).clients.name}</span>
                )}
                {(task as any).creator_profile && (
                  <span className="flex items-center gap-1"><UserCheck className="h-3 w-3" />Creada por: {(task as any).creator_profile.full_name}</span>
                )}
                {(task as any).started_at && <span>Inicio: {formatMX((task as any).started_at, "dd MMM HH:mm")}</span>}
                {(task as any).completed_at && <span>Completada: {formatMX((task as any).completed_at, "dd MMM HH:mm")}</span>}
              </div>

              {/* Row 4: Secondary actions — Date, Timer, Block time */}
              <div className="grid grid-cols-3 gap-3">
                <div className="flex items-center gap-2 p-2 rounded-md border bg-muted/30">
                  <Calendar className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <div className="flex-1 min-w-0">
                    <span className="text-xs">{task.due_date ? formatMX(task.due_date, "dd MMM yyyy") : "Sin fecha"}</span>
                  </div>
                  {isAssignedUser && (
                    <button className="hover:text-foreground text-muted-foreground" onClick={() => { setNewDueDate(task.due_date || ""); setDueDateReason(""); setEditingDueDate(true); }}>
                      <Pencil className="h-3 w-3" />
                    </button>
                  )}
                </div>
                <div className="flex items-center gap-2 p-2 rounded-md border bg-muted/30">
                  <Timer className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                  <span className="text-xs font-mono tabular-nums flex-1">{formatTimer(displaySeconds)}</span>
                  <button
                    className={`h-5 w-5 inline-flex items-center justify-center rounded ${timerRunning ? "text-destructive" : "hover:text-foreground text-muted-foreground"}`}
                    onClick={handleTimerToggle}
                  >
                    {timerRunning ? <Pause className="h-3 w-3" /> : <Play className="h-3 w-3" />}
                  </button>
                </div>
                <Button variant="outline" size="sm" onClick={() => setShowBlockTime(true)} className="gap-1.5 text-xs h-auto py-2">
                  <Clock className="h-3.5 w-3.5" /> Bloquear tiempo
                </Button>
              </div>

              {/* Save bar */}
              {hasPendingChanges && (
                <div className="flex items-center gap-2 p-2 rounded-md bg-primary/5 border border-primary/20">
                  <Button size="sm" onClick={handleSaveChanges} disabled={updateTask.isPending} className="h-7 text-xs gap-1">
                    {updateTask.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : null}
                    Guardar cambios
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setPendingChanges({})} className="h-7 text-xs">
                    Descartar
                  </Button>
                </div>
              )}
            </div>

            <Separator />

            {/* ── Scrollable body ── */}
            <div className="flex-1 overflow-y-auto px-6 py-4 space-y-4">
              {/* Due date edit */}
              {editingDueDate && (
                <div className="p-3 rounded-lg border bg-muted/20 space-y-2">
                  <p className="text-sm font-medium">Cambiar fecha límite</p>
                  <Input type="date" value={newDueDate} onChange={(e) => setNewDueDate(e.target.value)} className="w-full sm:w-[200px]" />
                  <Textarea value={dueDateReason} onChange={(e) => setDueDateReason(e.target.value)} placeholder="Motivo del cambio de fecha (obligatorio)..." rows={2} className="text-sm" />
                  <div className="flex gap-2">
                    <Button size="sm" onClick={handleDueDateSave} disabled={!dueDateReason.trim()}>Guardar</Button>
                    <Button size="sm" variant="outline" onClick={() => setEditingDueDate(false)}>Cancelar</Button>
                  </div>
                </div>
              )}

              {/* Description — always visible */}
              {task.description && (
                <div className="rounded-lg bg-muted/30 p-3">
                  <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">{task.description}</p>
                </div>
              )}

              {/* ── Subtareas ── */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <h4 className="text-sm font-medium flex items-center gap-1.5">
                    <ListChecks className="h-4 w-4" />
                    Subtareas
                    {checklist.length > 0 && (
                      <span className="text-xs text-muted-foreground font-normal ml-1">{completedCount}/{checklist.length}</span>
                    )}
                  </h4>
                </div>
                {checklist.length > 0 && (
                  <div className="h-1 rounded-full bg-muted mb-2 overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all"
                      style={{ width: `${checklist.length > 0 ? (completedCount / checklist.length) * 100 : 0}%` }}
                    />
                  </div>
                )}
                <div className="space-y-1">
                  {checklist.map((item) => {
                    const assigneeName = item.assigned_to ? orgProfiles?.find(p => p.user_id === item.assigned_to)?.full_name : null;
                    return (
                      <div key={item.id} className="flex items-start gap-2 group py-1">
                        <Checkbox
                          checked={item.completed}
                          onCheckedChange={() => toggleChecklistItem(item.id)}
                          className="mt-0.5"
                        />
                      <div className="flex-1 min-w-0">
                          {item.task_id ? (
                            <button
                              type="button"
                              className={`text-sm text-left hover:underline inline-flex items-center gap-1 ${item.completed ? "line-through text-muted-foreground" : "text-primary"}`}
                              onClick={() => {
                                onClose();
                                setTimeout(() => {
                                  const params = new URLSearchParams(window.location.search);
                                  params.set("taskId", item.task_id!);
                                  window.history.pushState({}, "", `${window.location.pathname}?${params}`);
                                  window.dispatchEvent(new PopStateEvent("popstate"));
                                }, 150);
                              }}
                            >
                              {item.text}
                              <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
                            </button>
                          ) : (
                            <span className={`text-sm ${item.completed ? "line-through text-muted-foreground" : "text-foreground"}`}>
                              {item.text}
                            </span>
                          )}
                          <div className="flex flex-wrap gap-1.5 mt-0.5">
                            {assigneeName && (
                              <Badge variant="outline" className="text-[10px] gap-0.5 px-1.5 py-0 h-4 font-normal">
                                <User className="h-2.5 w-2.5" />{assigneeName}
                              </Badge>
                            )}
                            {item.due_date && (
                              <Badge variant="outline" className="text-[10px] gap-0.5 px-1.5 py-0 h-4 font-normal">
                                <Calendar className="h-2.5 w-2.5" />{formatMX(item.due_date, "dd MMM yyyy")}
                              </Badge>
                            )}
                          </div>
                        </div>
                        <button
                          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity mt-0.5"
                          onClick={() => removeChecklistItem(item.id)}
                        >
                          <X className="h-3 w-3" />
                        </button>
                      </div>
                    );
                  })}
                </div>
                <div className="mt-2 space-y-2 p-2 rounded-md border bg-muted/20">
                  <Input
                    value={newSubtask}
                    onChange={(e) => setNewSubtask(e.target.value)}
                    placeholder="Nombre de la subtarea..."
                    className="h-8 text-sm"
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addChecklistItem(); } }}
                  />
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-0.5">
                      <label className="text-[10px] font-medium text-muted-foreground flex items-center gap-0.5"><User className="h-2.5 w-2.5" />Responsable</label>
                      <SearchableSelect
                        options={sortedProfiles}
                        value={newSubtaskAssignee || ""}
                        onValueChange={(uid) => setNewSubtaskAssignee(uid || null)}
                        placeholder="Asignar..."
                        searchPlaceholder="Buscar..."
                        className="h-7 w-full text-xs"
                      />
                    </div>
                    <div className="space-y-0.5">
                      <label className="text-[10px] font-medium text-muted-foreground flex items-center gap-0.5"><Calendar className="h-2.5 w-2.5" />Fecha límite</label>
                      <Input
                        type="date"
                        value={newSubtaskDueDate}
                        onChange={(e) => setNewSubtaskDueDate(e.target.value)}
                        className="h-7 text-xs"
                      />
                    </div>
                  </div>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1 w-full" onClick={addChecklistItem} disabled={!newSubtask.trim()}>
                    <Plus className="h-3 w-3" /> Crear subtarea
                  </Button>
                </div>
              </div>

              {/* ── Collaborators ── */}
              <div>
                <h4 className="text-sm font-medium mb-2 flex items-center gap-1.5">
                  <UserPlus className="h-4 w-4" /> Colaboradores
                </h4>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {assignees.map((a: any) => (
                    <Badge key={a.id} variant="secondary" className="gap-1 text-xs">
                      {a.profile?.full_name || a.user_id}
                      <X className="h-3 w-3 cursor-pointer hover:text-destructive" onClick={() => removeAssignee.mutate({ taskId: taskId!, userId: a.user_id })} />
                    </Badge>
                  ))}
                </div>
                <SearchableSelect
                  options={sortedProfiles.filter((p) => !assignees.some((a: any) => a.user_id === p.value))}
                  value=""
                  onValueChange={(uid) => addAssignee.mutate({ taskId: taskId!, userId: uid })}
                  placeholder="Agregar colaborador..."
                  searchPlaceholder="Buscar colaborador..."
                  className="w-full sm:w-[250px]"
                />
              </div>

              {/* ── Advanced: Criticality/Delay (collapsible) ── */}
              <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
                <CollapsibleTrigger asChild>
                  <button className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors">
                    <Settings2 className="h-3.5 w-3.5" />
                    Semáforo y atraso
                    <ChevronDown className={`h-3 w-3 transition-transform ${showAdvanced ? "rotate-180" : ""}`} />
                  </button>
                </CollapsibleTrigger>
                <CollapsibleContent className="mt-2">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-lg border bg-muted/20">
                    <div>
                      <span className="text-xs text-muted-foreground block mb-1">Semáforo</span>
                      <Select value={currentCriticality} onValueChange={(v) => setPending("criticality_level", v)}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {CRITICALITY_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground block mb-1">Motivo de atraso</span>
                      <Select value={currentDelayCategory || "__none__"} onValueChange={(v) => setPending("delay_category", v === "__none__" ? null : v)}>
                        <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                        <SelectContent>
                          {DELAY_CATEGORIES.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                        </SelectContent>
                      </Select>
                    </div>
                    {currentDelayCategory && (
                      <div className="col-span-full">
                        <span className="text-xs text-muted-foreground block mb-1">Notas</span>
                        <Textarea
                          className="text-xs min-h-[60px]"
                          placeholder="Describe la situación..."
                          value={currentDelayNotes || ""}
                          onChange={(e) => setPending("delay_notes", e.target.value || null)}
                        />
                      </div>
                    )}
                  </div>
                </CollapsibleContent>
              </Collapsible>

              <Separator />

              {/* ── Tabs ── */}
              <Tabs defaultValue="comments" className="w-full">
                <TabsList className="w-full">
                  <TabsTrigger value="comments" className="flex-1 text-xs">
                    <MessageSquare className="h-3.5 w-3.5 mr-1" />Comentarios ({comments.length})
                  </TabsTrigger>
                  <TabsTrigger value="links" className="flex-1 text-xs">
                    <Link className="h-3.5 w-3.5 mr-1" />Enlaces ({dropboxLinks.length})
                  </TabsTrigger>
                  <TabsTrigger value="files" className="flex-1 text-xs">
                    <Paperclip className="h-3.5 w-3.5 mr-1" />Archivos ({documents.length})
                  </TabsTrigger>
                </TabsList>

                {/* Comments tab */}
                <TabsContent value="comments" className="space-y-3 mt-3">
                  <div className="space-y-3 max-h-[250px] overflow-y-auto">
                    {comments.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">Sin comentarios aún</p>}
                    {comments.map((c) => (
                      <div key={c.id} className="flex gap-2.5">
                        <Avatar className="h-7 w-7">
                          <AvatarFallback className="text-[10px]">{c.profile?.full_name?.charAt(0) || "?"}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-2">
                            <span className="text-xs font-medium">{c.profile?.full_name || "Usuario"}</span>
                            <span className="text-[10px] text-muted-foreground">{formatMX(c.created_at, "dd MMM HH:mm")}</span>
                          </div>
                          <p className="text-sm text-foreground whitespace-pre-wrap break-words overflow-hidden">{renderCommentContent(c.content)}</p>
                        </div>
                      </div>
                    ))}
                  </div>

                  {commentAttachments.length > 0 && (
                    <div className="flex flex-wrap gap-1.5 p-2 rounded-md border border-border/50 bg-muted/30">
                      {commentAttachments.map((att, i) => (
                        <div key={i} className="relative group">
                          {att.type === "image" ? (
                            <img src={att.url} alt={att.name} className="h-12 w-auto rounded border border-border object-cover" />
                          ) : (
                            <span className="inline-flex items-center gap-1 text-[10px] bg-background px-2 py-1 rounded border">
                              {att.type === "dropbox" ? "📦" : "🔗"} {att.name}
                            </span>
                          )}
                          <button onClick={() => setCommentAttachments(prev => prev.filter((_, idx) => idx !== i))} className="absolute -top-1 -right-1 h-4 w-4 bg-destructive text-destructive-foreground rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity">
                            <X className="h-2.5 w-2.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  <div className="flex gap-1.5">
                    <div className="flex-1 min-w-0">
                      <MentionTextarea
                        value={commentText} onChange={setCommentText} profiles={orgProfiles ?? []}
                        placeholder="Escribe un comentario... usa @ para mencionar" rows={2}
                        onMentionsChange={setCommentMentions}
                        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSendComment(); }}
                      />
                    </div>
                    <div className="flex flex-col gap-0.5 shrink-0">
                      <input ref={commentFileInputRef} type="file" multiple className="hidden" onChange={(e) => handleCommentFileUpload(e.target.files)} />
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => commentFileInputRef.current?.click()} disabled={commentUploading} title="Adjuntar archivo">
                        {commentUploading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Paperclip className="h-3.5 w-3.5" />}
                      </Button>
                      <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => setShowCommentDropbox(true)} title="Seleccionar de Dropbox">
                        <svg className="h-3.5 w-3.5" viewBox="0 0 24 24" fill="currentColor"><path d="M6 2l6 3.75L6 9.5 0 5.75zm12 0l6 3.75-6 3.75-6-3.75zM0 13.25L6 9.5l6 3.75L6 17zm12 0l6-3.75 6 3.75L18 17zM6 18.25l6-3.75 6 3.75L12 22z" /></svg>
                      </Button>
                      <Popover open={showCommentLinkPopover} onOpenChange={setShowCommentLinkPopover}>
                        <PopoverTrigger asChild>
                          <Button size="icon" variant="ghost" className="h-7 w-7" title="Pegar enlace"><Link2 className="h-3.5 w-3.5" /></Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-64 p-2" align="end">
                          <div className="flex gap-1">
                            <input className="flex-1 text-xs border border-input rounded px-2 py-1 bg-background" placeholder="https://..." value={commentLinkInput}
                              onChange={(e) => setCommentLinkInput(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === "Enter" && commentLinkInput.trim()) {
                                  setCommentAttachments(prev => [...prev, { type: commentLinkInput.includes("dropbox.com") ? "dropbox" : "link", name: commentLinkInput.split("/").pop() || "Enlace", url: commentLinkInput.trim() }]);
                                  setCommentLinkInput(""); setShowCommentLinkPopover(false);
                                }
                              }}
                            />
                            <Button size="sm" className="h-7 px-2 text-xs" disabled={!commentLinkInput.trim()} onClick={() => {
                              setCommentAttachments(prev => [...prev, { type: commentLinkInput.includes("dropbox.com") ? "dropbox" : "link", name: commentLinkInput.split("/").pop() || "Enlace", url: commentLinkInput.trim() }]);
                              setCommentLinkInput(""); setShowCommentLinkPopover(false);
                            }}>Añadir</Button>
                          </div>
                        </PopoverContent>
                      </Popover>
                    </div>
                    <Button size="icon" className="h-8 w-8 shrink-0 self-end" onClick={handleSendComment} disabled={addComment.isPending || (!commentText.trim() && commentAttachments.length === 0)}>
                      <Send className="h-4 w-4" />
                    </Button>
                  </div>
                </TabsContent>

                {/* Links tab */}
                <TabsContent value="links" className="space-y-3 mt-3 min-w-0">
                  <div className="space-y-1.5 min-w-0">
                    {dropboxLinks.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">Sin enlaces de Dropbox</p>}
                    {dropboxLinks.map((link: any, i: number) => {
                      let shortUrl = link.url;
                      try {
                        const u = new URL(link.url);
                        const path = u.pathname.length > 25 ? u.pathname.slice(0, 22) + "…" : u.pathname;
                        shortUrl = u.hostname + path;
                      } catch {}
                      return (
                      <div key={i} className="flex w-full min-w-0 items-center gap-2 overflow-hidden rounded-md border bg-muted/30 p-2">
                        <ExternalLink className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noreferrer"
                          className="flex-1 min-w-0 truncate text-xs text-primary hover:underline"
                          title={link.url}
                        >
                          {link.name || shortUrl}
                        </a>
                        <span className="text-[10px] text-muted-foreground shrink-0 pt-0.5">{link.added_at ? formatMX(link.added_at, "dd MMM") : ""}</span>
                        <button
                          type="button"
                          className="shrink-0 text-muted-foreground hover:text-destructive"
                          onClick={() => handleRemoveLink(i)}
                          aria-label="Eliminar enlace"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                      );
                    })}
                  </div>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input value={newLink} onChange={(e) => setNewLink(e.target.value)} placeholder="https://www.dropbox.com/..." className="h-8 flex-1 min-w-0 text-sm"
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); handleAddDropboxLink(); } }}
                    />
                    <div className="flex gap-2 shrink-0">
                      <Button size="sm" variant="outline" className="h-8" onClick={handleAddDropboxLink}><Plus className="h-3.5 w-3.5 mr-1" />Agregar</Button>
                      <Button size="sm" variant="outline" className="h-8" onClick={() => setShowDropboxPicker(true)} title="Seleccionar archivo de Dropbox"><FolderOpen className="h-3.5 w-3.5" /></Button>
                    </div>
                  </div>
                </TabsContent>

                {/* Files tab */}
                <TabsContent value="files" className="space-y-3 mt-3">
                  <div className="space-y-1.5">
                    {documents.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">Sin archivos adjuntos</p>}
                    {documents.map((doc) => (
                      <div key={doc.id} className="flex items-center gap-2 p-2 rounded-md border bg-muted/30">
                        <Paperclip className="h-3.5 w-3.5 text-muted-foreground" />
                        <span className="text-xs truncate flex-1">{doc.name}</span>
                        <span className="text-[10px] text-muted-foreground">{doc.file_size ? `${(doc.file_size / 1024).toFixed(0)} KB` : ""}</span>
                        <span className="text-[10px] text-muted-foreground">{formatMX(doc.created_at, "dd MMM")}</span>
                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setPreviewDoc(doc)} title="Vista previa"><Eye className="h-3 w-3" /></Button>
                        <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => handleDocDownload(doc)} title="Descargar"><Download className="h-3 w-3" /></Button>
                      </div>
                    ))}
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <label className="cursor-pointer">
                      <input type="file" className="hidden" accept={ACCEPTED_DOCUMENT_EXTENSIONS} onChange={handleFileUpload} disabled={uploading} />
                      <div className="flex items-center gap-2 p-2.5 border-2 border-dashed rounded-md text-xs text-muted-foreground hover:border-primary hover:text-primary transition-colors cursor-pointer">
                        <Upload className="h-3.5 w-3.5" />{uploading ? "Subiendo..." : "Subir archivo"}
                      </div>
                    </label>
                    <label className="cursor-pointer">
                      <input type="file" className="hidden" accept="image/*" capture="environment" onChange={async (e) => {
                        const capturedFile = e.target.files?.[0];
                        if (!capturedFile || !task) return;
                        e.target.value = "";
                        let initPath = "/Kawiil Mx";
                        if (task.client_id) {
                          const { data: client } = await supabase.from("clients").select("dropbox_folder_path").eq("id", task.client_id).single();
                          if (client?.dropbox_folder_path) initPath = client.dropbox_folder_path;
                        }
                        const ext = capturedFile.name.split('.').pop() || 'jpg';
                        const renamed = new File([capturedFile], `scan_${Date.now()}.${ext}`, { type: capturedFile.type });
                        setScanInitialPath(initPath);
                        setScannedFile(renamed);
                        setShowDropboxUpload(true);
                      }} disabled={uploading} />
                      <div className="flex items-center gap-2 p-2.5 border-2 border-dashed rounded-md text-xs text-muted-foreground hover:border-primary hover:text-primary transition-colors cursor-pointer">
                        <Camera className="h-3.5 w-3.5" />Escanear a Dropbox
                      </div>
                    </label>
                  </div>
                </TabsContent>
              </Tabs>

            </div>
          </div>
        ) : (
          <div className="py-12 text-center text-muted-foreground">Tarea no encontrada</div>
        )}
      </DialogContent>
      {task && <BlockTimeDialog open={showBlockTime} onOpenChange={setShowBlockTime} taskTitle={task.title} taskDueDate={task.due_date || undefined} />}
      <DropboxFilePicker open={showDropboxPicker} onClose={() => setShowDropboxPicker(false)} initialPath="/Kawiil Mx" onSelect={handleDropboxPickerSelect} />
      <DropboxUploadDialog
        open={showDropboxUpload}
        onClose={() => { setShowDropboxUpload(false); setScannedFile(null); }}
        file={scannedFile}
        initialPath={scanInitialPath}
        onUploaded={(result) => {
          if (!task) return;
          const currentLinks = (task.dropbox_links as any[]) ?? [];
          updateTask.mutate({ id: taskId!, dropbox_links: [...currentLinks, { url: result.url, name: result.name, added_at: new Date().toISOString() }] });
          setScannedFile(null);
        }}
      />
      <DropboxFilePicker open={showCommentDropbox} onClose={() => setShowCommentDropbox(false)} onSelect={(file) => setCommentAttachments(prev => [...prev, { type: "dropbox", name: file.name, url: file.url }])} />
      <DocumentPreviewDialog open={!!previewDoc} onOpenChange={(o) => { if (!o) setPreviewDoc(null); }} document={previewDoc} />
    </Dialog>
  );
}
