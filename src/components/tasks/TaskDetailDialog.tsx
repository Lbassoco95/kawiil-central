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
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import { UserAvatar } from "@/components/shared/UserAvatar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useTaskDetail, useAddComment, useUpdateTask, type Task } from "@/hooks/useTasks";
import { useAddTaskAssignee, useRemoveTaskAssignee } from "@/hooks/useTaskAssignees";
import { useCelulaOptions } from "@/hooks/useCelulaOptions";
import { ACTIVE_SUPABASE_URL, supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  MessageSquare, Paperclip, Link, Calendar, User, Clock,
  ExternalLink, Send, Plus, X, UserPlus, FolderOpen, Pencil, Camera,
  Download, Eye, Link2, Loader2, Play, Pause, Timer, UserCheck, ChevronDown, ListChecks, Settings2, Trash2, GitBranch,
  ChevronRight, Activity as ActivityIcon, CheckCircle2, FileText, RefreshCw,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import {
  RECURRENCE_PATTERN_OPTIONS,
  RECURRENCE_TYPE_OPTIONS,
  recurrencePatternLabel,
  recurrenceTypeLabel,
  calculateNextOccurrenceDate,
  formatRecurrenceDate,
} from "@/lib/recurrenceUtils";
import { formatMX, isPastDueCalendarMX } from "@/lib/dateUtils";
import { complianceAnchorYmdFromProject, complianceDueDateIsActionable } from "@/lib/complianceDueDates";
import { KAWIIL_TEAM_ROOT } from "@/lib/dropboxConfig";
import { isTaskClosedStatus } from "@/lib/taskStatusGroups";
import { extractDropboxFilenameFromUrl, getDropboxLinkDisplayLabel } from "@/lib/dropboxLinkLabel";
import { cn } from "@/lib/utils";
import { TaskDependenciesPanel } from "./TaskDependenciesPanel";
import { TaskKawiilAiCard } from "./TaskKawiilAiCard";
import { TaskAiBriefingCard } from "./TaskAiBriefingCard";
import { ACCEPTED_DOCUMENT_EXTENSIONS } from "@/lib/documentTypes";
import { sanitizeStorageFileName } from "@/lib/storageFilename";
import { getZipIntakeMarker } from "@/lib/fileIntake/zipMarkers";
import {
  invokeProcessDocumentForBinaryFile,
  postProcessUploadedDocument,
} from "@/lib/fileIntake/zipUploadPipeline";
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
import { useResolveDuplicateFilenames } from "@/hooks/useResolveDuplicateFilenames";
import { FileDropzone } from "@/components/shared/FileDropzone";
import { genericLimits, withLimits } from "@/lib/fileIntake/limits";
import { MentionTextarea } from "./MentionTextarea";
import { useProfiles } from "@/hooks/useTasks";
import { SearchableSelect } from "@/components/shared/SearchableSelect";
import { useUserRole } from "@/hooks/useUserRole";
import { useDeleteTask } from "@/hooks/useTasks";
import { DeleteConfirmDialog } from "@/components/shared/DeleteConfirmDialog";
import { DocumentChecklistButton } from "@/components/shared/DocumentChecklistButton";
import { createNotifications } from "@/lib/notificationHelpers";
import { renderTextWithMentionHighlights } from "@/lib/renderMentionHighlights";
import { useNavigate } from "react-router-dom";

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
  /** Diálogo apilado (subtarea); al ir a la tarea padre solo se cierra este nivel. */
  nested?: boolean;
}

// Nested subtask dialog state

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

export function TaskDetailDialog({ taskId, onClose, nested = false }: Props) {
  const navigate = useNavigate();
  const { task, isLoading, comments, assignees, documents } = useTaskDetail(taskId ?? undefined);
  const addComment = useAddComment();
  const updateTask = useUpdateTask();
  const addAssignee = useAddTaskAssignee();
  const removeAssignee = useRemoveTaskAssignee();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { celulaLabelMap, getCelulaLabel } = useCelulaOptions();
  const { canEditDueDates, canDeleteTasks } = useUserRole();
  const deleteTask = useDeleteTask();
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [commentText, setCommentText] = useState("");
  const [commentMentions, setCommentMentions] = useState<string[]>([]);
  const [commentAttachments, setCommentAttachments] = useState<CommentAttachment[]>([]);
  const [commentUploading, setCommentUploading] = useState(false);
  const [showCommentDropbox, setShowCommentDropbox] = useState(false);
  const [commentLinkInput, setCommentLinkInput] = useState("");
  const [showCommentLinkPopover, setShowCommentLinkPopover] = useState(false);
  const [pendingCommentFiles, setPendingCommentFiles] = useState<File[]>([]);
  const [pendingFileTabFiles, setPendingFileTabFiles] = useState<File[]>([]);
  const [dupOpen, setDupOpen] = useState(false);
  const [dupName, setDupName] = useState("");
  const dupResolver = useRef<((c: DuplicateResolutionChoice) => void) | null>(null);

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

  const resolveBatchDuplicateNames = useResolveDuplicateFilenames(duplicatePrompt);

  const fileTabLimits = withLimits(genericLimits, { accept: ACCEPTED_DOCUMENT_EXTENSIONS });
  const [newLink, setNewLink] = useState("");
  const [uploading, setUploading] = useState(false);
  const [showBlockTime, setShowBlockTime] = useState(false);
  const [selectedSubtaskId, setSelectedSubtaskId] = useState<string | null>(null);
  const [showDropboxPicker, setShowDropboxPicker] = useState(false);
  const { data: orgProfiles } = useProfiles();
  const [scannedFile, setScannedFile] = useState<File | null>(null);
  const [showDropboxUpload, setShowDropboxUpload] = useState(false);
  const [scanInitialPath, setScanInitialPath] = useState(KAWIIL_TEAM_ROOT);
  const [previewDoc, setPreviewDoc] = useState<any>(null);
  const [newSubtask, setNewSubtask] = useState("");
  const [newSubtaskAssignee, setNewSubtaskAssignee] = useState<string | null>(null);
  const [newSubtaskDueDate, setNewSubtaskDueDate] = useState("");
  /** Célula de la subtarea: heredar de la tarea, sin área, o un slug concreto. */
  const [newSubtaskArea, setNewSubtaskArea] = useState<"__parent__" | "__none__" | string>("__parent__");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [activeTab, setActiveTab] = useState<"comments" | "links" | "files">("comments");

  // Recurrence editing state
  const [showRecurrenceEdit, setShowRecurrenceEdit] = useState(false);
  const [editRecurrencePattern, setEditRecurrencePattern] = useState<string>("weekly");
  const [editRecurrenceType, setEditRecurrenceType] = useState<string>("on_complete");

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

  // Reset pending changes y formulario de subtarea al cambiar de tarea
  useEffect(() => {
    setPendingChanges({});
    setNewSubtask("");
    setNewSubtaskAssignee(null);
    setNewSubtaskDueDate("");
    setNewSubtaskArea("__parent__");
    setShowRecurrenceEdit(false);
  }, [taskId]);

  // Sincronizar valores de edición de recurrencia con la tarea cargada
  useEffect(() => {
    if (task) {
      setEditRecurrencePattern((task as any).recurrence_pattern ?? "weekly");
      setEditRecurrenceType((task as any).recurrence_type ?? "on_complete");
    }
  }, [task?.id, (task as any)?.recurrence_pattern, (task as any)?.recurrence_type]);

  // Computed current values (pending override or task value)
  const currentTitle = pendingChanges.title ?? task?.title ?? "";
  const currentStatus = pendingChanges.status ?? task?.status ?? "pendiente";
  const currentPriority = pendingChanges.priority ?? task?.priority ?? "media";
  const currentAssignedTo = pendingChanges.assigned_to !== undefined ? pendingChanges.assigned_to : task?.assigned_to;
  const currentCriticality = pendingChanges.criticality_level ?? (task as any)?.criticality_level ?? "normal";
  const currentDelayCategory = pendingChanges.delay_category !== undefined ? pendingChanges.delay_category : (task as any)?.delay_category;
  const currentDelayNotes = pendingChanges.delay_notes !== undefined ? pendingChanges.delay_notes : (task as any)?.delay_notes;
  const currentArea = pendingChanges.area !== undefined ? pendingChanges.area : task?.area;

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

  // Subtareas reales (children por parent_task_id) — fuente de verdad para "Subtareas N/total" v2.5
  const { data: childSubtasks = [] } = useQuery({
    queryKey: ["task-subtasks", taskId],
    enabled: !!user && !!taskId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("id, title, status, due_date, assigned_to, completed_at, priority")
        .eq("parent_task_id", taskId!)
        .order("created_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });

  // Actividad de la tarea (activity_log)
  const { data: taskActivity = [] } = useQuery({
    queryKey: ["task-activity", taskId],
    enabled: !!user && !!taskId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("activity_log")
        .select("id, user_id, action, details, created_at")
        .eq("entity_type", "task")
        .eq("entity_id", taskId!)
        .order("created_at", { ascending: false })
        .limit(30);
      if (error) throw error;
      return data ?? [];
    },
  });

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

  const toggleChecklistItem = async (itemId: string) => {
    const item = checklist.find((c) => c.id === itemId);
    if (!item) return;
    const newCompleted = !item.completed;
    if (item.task_id) {
      try {
        await supabase.from("tasks").update({
          status: newCompleted ? "completada" : "pendiente",
          completed_at: newCompleted ? new Date().toISOString() : null,
        } as any).eq("id", item.task_id);
        queryClient.invalidateQueries({ queryKey: ["tasks"] });
        queryClient.invalidateQueries({ queryKey: ["task", item.task_id] });
      } catch (e: any) {
        toast.error("No se pudo actualizar la subtarea: " + (e.message || "error"));
        return;
      }
    }
    updateChecklist(checklist.map((c) => c.id === itemId ? { ...c, completed: newCompleted } : c));
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

      const subtaskArea: string | null =
        newSubtaskArea === "__parent__"
          ? (currentArea ?? null)
          : newSubtaskArea === "__none__"
            ? null
            : newSubtaskArea;

      const { data: newTask, error } = await supabase
        .from("tasks")
        .insert({
          title: text,
          organization_id: profile.organization_id,
          created_by: user!.id,
          assigned_to: assignee,
          due_date: dueDate,
          area: subtaskArea,
          client_id: task?.client_id || null,
          project_id: task?.project_id || null,
          status: "pendiente" as const,
          priority: "media" as const,
          parent_task_id: taskId,
          is_subtask: true,
        })
        .select()
        .single();

      if (error) throw error;

      if (assignee) {
        const parentTitle = task?.title ?? "Tarea";
        const origin = typeof window !== "undefined" ? window.location.origin : "";
        const parentLink = origin ? `${origin}/tareas?taskId=${taskId}` : "";
        await createNotifications([
          {
            user_id: assignee,
            type: "task_assigned",
            title: `Subtarea de «${parentTitle}»: te asignaron «${text}»`,
            body: parentLink ? `Tarea principal: ${parentLink}` : undefined,
            entity_type: "task",
            entity_id: taskId,
            source_user_id: user!.id,
          },
        ]);
      }

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
      queryClient.invalidateQueries({ queryKey: ["task-subtasks", taskId] });
    } catch (err: any) {
      toast.error("Error al crear subtarea: " + err.message);
      return;
    }

    setNewSubtask("");
    setNewSubtaskAssignee(null);
    setNewSubtaskDueDate("");
    setNewSubtaskArea("__parent__");
  };

  const removeChecklistItem = (itemId: string) => {
    updateChecklist(checklist.filter((c) => c.id !== itemId));
  };

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

  const renderMentions = (text: string, keyOffset: number): React.ReactNode[] =>
    renderTextWithMentionHighlights(text, `cm-${keyOffset}`);

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

  const handleCommentFileUpload = async (files: File[]) => {
    if (!files || files.length === 0) return;
    const filesToUse = await resolveBatchDuplicateNames(files);
    if (filesToUse.length === 0) return;
    setPendingCommentFiles(filesToUse);
    setCommentUploading(true);
    try {
      for (const file of filesToUse) {
        if (file.size > 25 * 1024 * 1024) { toast.error(`${file.name} excede 25MB`); continue; }
        const safeName = sanitizeStorageFileName(file.name);
        const path = `comment-attachments/${Date.now()}_${safeName}`;
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
      setPendingCommentFiles([]);
    }
  };

  const handleDocDownload = async (doc: any) => {
    if (!doc.file_path) return;
    try {
      const { data, error } = await supabase.storage.from("documents").createSignedUrl(doc.file_path, 60, { download: true });
      if (error) throw error;
      const a = document.createElement("a");
      a.href = data.signedUrl.startsWith("http")
        ? data.signedUrl
        : `${ACTIVE_SUPABASE_URL}/storage/v1${data.signedUrl}`;
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
    const url = newLink.trim();
    const derived = extractDropboxFilenameFromUrl(url);
    updateTask.mutate({
      id: taskId,
      dropbox_links: [...currentLinks, { url, added_at: new Date().toISOString(), ...(derived ? { name: derived } : {}) }],
    });
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

  const handleFileUpload = async (files: File[]) => {
    if (!files || files.length === 0 || !user) return;
    const queue = await resolveBatchDuplicateNames(files);
    if (queue.length === 0) return;
    setPendingFileTabFiles(queue);
    setUploading(true);
    let ok = 0;
    let failed = 0;
    try {
      const { data: profile } = await supabase.from("profiles").select("organization_id").eq("user_id", user.id).single();
      const usedNames = new Set(documents.map((d: { name: string }) => filenameKey(d.name)));
      for (const raw of queue) {
        let file = raw;
        try {
          const conflict = documents.find(
            (d: { id: string; name: string }) => filenameKey(d.name) === filenameKey(file.name)
          );
          if (conflict) {
            const choice = await duplicatePrompt(file.name);
            if (choice === "skip") continue;
            if (choice === "copy") {
              file = fileWithName(file, nextDistinctFilename(file.name, usedNames));
            } else {
              await replaceSupabaseStoredDocumentFile({
                documentId: conflict.id,
                file,
                pathDirectoryPrefix: `tasks/${taskId}`,
              });
              await postProcessUploadedDocument(conflict.id, file);
              if (getZipIntakeMarker(file)?.kind !== "server_deferred") {
                supabase.functions
                  .invoke("process-document", { body: { document_id: conflict.id } })
                  .catch(() => {});
              }
              if (getZipIntakeMarker(file)?.kind === "from_expanded_zip") {
                invokeProcessDocumentForBinaryFile(file, conflict.id);
              }
              ok += 1;
              continue;
            }
          }
          const safeName = sanitizeStorageFileName(file.name);
          const filePath = `tasks/${taskId}/${Date.now()}_${safeName}`;
          const { error: uploadError } = await supabase.storage.from("documents").upload(filePath, file);
          if (uploadError) throw uploadError;
          const lower = file.name.toLowerCase();
          const isZip =
            lower.endsWith(".zip") ||
            file.type === "application/zip" ||
            file.type === "application/x-zip-compressed";
          const mime = isZip ? file.type || "application/zip" : mimeTypeForFile(file);
          const marker = getZipIntakeMarker(file);
          const { data: doc, error: docInsErr } = await supabase
            .from("documents")
            .insert({
              name: file.name,
              file_path: filePath,
              mime_type: mime || null,
              file_size: file.size,
              task_id: taskId,
              organization_id: profile!.organization_id,
              uploaded_by: user.id,
              source: "supabase" as const,
              metadata: marker?.kind === "server_deferred" ? { zip_container: true } : {},
            })
            .select("id")
            .single();
          if (docInsErr) throw docInsErr;
          if (doc?.id) {
            await postProcessUploadedDocument(doc.id, file);
            if (getZipIntakeMarker(file)?.kind !== "server_deferred") {
              supabase.functions
                .invoke("process-document", { body: { document_id: doc.id } })
                .catch(() => {});
            }
            if (marker?.kind === "from_expanded_zip") {
              invokeProcessDocumentForBinaryFile(file, doc.id);
            }
          }
          usedNames.add(filenameKey(file.name));
          ok += 1;
        } catch (err: any) {
          failed += 1;
          console.error("[TaskDetailDialog] upload fallo", file.name, err);
        }
      }
      queryClient.invalidateQueries({ queryKey: ["task-documents", taskId] });
      if (ok > 0) toast.success(`${ok} archivo(s) subidos correctamente`);
      if (failed > 0) toast.error(`${failed} archivo(s) fallaron`);
    } finally {
      setUploading(false);
      setPendingFileTabFiles([]);
    }
  };

  const dropboxLinks = (task?.dropbox_links as any[]) ?? [];
  const areaLabel = currentArea ? getCelulaLabel(String(currentArea)) : null;
  const parentTask =
    task != null
      ? ((task as Task & { parent_task?: { id: string; title: string } | null }).parent_task ?? null)
      : null;

  const goToParentTask = (parentId: string) => {
    navigate(`/tareas?taskId=${parentId}`);
    if (nested) onClose();
  };

  // ── v2.5 derived UI helpers ──
  const currentEstimatedHours = pendingChanges.estimated_hours !== undefined
    ? pendingChanges.estimated_hours
    : (task as any)?.estimated_hours ?? null;
  const registeredHours = (displaySeconds || 0) / 3600;
  const proj = (task as any)?.projects as
    | { name?: string; area?: string | null; start_date?: string | null; created_at?: string }
    | undefined;
  const taskProjectAnchorYmd = proj
    ? complianceAnchorYmdFromProject(proj.start_date ?? null, proj.created_at ?? null)
    : null;
  const overdueBadge =
    !!task?.due_date &&
    isPastDueCalendarMX(task.due_date) &&
    !isTaskClosedStatus(currentStatus) &&
    (!proj || complianceDueDateIsActionable(task.due_date, taskProjectAnchorYmd));
  const isPreAnchorOpenDue =
    !!task?.due_date &&
    !!taskProjectAnchorYmd &&
    task.due_date < taskProjectAnchorYmd &&
    !isTaskClosedStatus(currentStatus);
  const displayPriorityForPills = isPreAnchorOpenDue ? "media" : currentPriority;
  const subtaskTotal = childSubtasks.length;
  const subtaskClosed = childSubtasks.filter((s: any) => isTaskClosedStatus(s.status)).length;
  const subtaskProgressPct = subtaskTotal === 0 ? 0 : Math.round((subtaskClosed / subtaskTotal) * 100);

  const projectChip = (task as any)?.projects?.name as string | undefined;
  const clientChip = (task as any)?.clients?.name as string | undefined;

  const priorityTagLabel =
    displayPriorityForPills === "urgente" ? "P1 · URGENTE" :
    displayPriorityForPills === "alta" ? "P2 · ALTA" :
    displayPriorityForPills === "media" ? "P3 · MEDIA" : "P4 · BAJA";
  const priorityPillClass =
    displayPriorityForPills === "urgente" ? "prio-pill p1" :
    displayPriorityForPills === "alta" ? "prio-pill p2" :
    displayPriorityForPills === "media" ? "prio-pill p3" : "prio-pill p4";

  return (
    <Dialog open={!!taskId} onOpenChange={() => onClose()}>
      <DialogContent className="kwv24 sm:max-w-[min(1180px,96vw)] w-full h-[92vh] sm:h-[92vh] sm:max-h-[92vh] gap-0 p-0 sm:p-0 pt-0 sm:pt-0 overflow-hidden flex flex-col">
        <DialogTitle className="sr-only">Detalle de tarea</DialogTitle>
        {isLoading ? (
          <div className="py-12 text-center text-muted-foreground">Cargando...</div>
        ) : task ? (
          <div className="kwv24-dr flex-1 min-h-0">
            {/* ── Header v2.4 (dr-head) ── */}
            <div className="dr-head">
              <div className="bc">
                {clientChip && (
                  <>
                    <strong title={clientChip}>{clientChip}</strong>
                    <span className="sep">›</span>
                  </>
                )}
                {projectChip && (
                  <>
                    <strong title={projectChip}>{projectChip}</strong>
                    <span className="sep">›</span>
                  </>
                )}
                <span>Tarea</span>
                {parentTask && (
                  <>
                    <span className="sep">›</span>
                    <button
                      type="button"
                      className="inline-flex items-center gap-1 text-primary hover:underline"
                      onClick={() => goToParentTask(parentTask.id)}
                      title="Abrir tarea principal"
                    >
                      <GitBranch className="h-3 w-3" />
                      Sub de «{parentTask.title.length > 26 ? parentTask.title.slice(0, 26) + "…" : parentTask.title}»
                    </button>
                  </>
                )}
              </div>
              <div className="actions">
                <Select value={currentStatus} onValueChange={handleStatusChange}>
                  <SelectTrigger className="h-8 text-xs w-[140px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(statusLabels).map(([key, { label }]) => (
                      <SelectItem key={key} value={key}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {currentStatus !== "completada" && (
                  <Button
                    size="sm"
                    className="h-8 gap-1 text-xs"
                    onClick={() => updateTask.mutate({ id: taskId, status: "completada" })}
                    disabled={updateTask.isPending}
                    title="Marcar como completada"
                  >
                    <CheckCircle2 className="h-3.5 w-3.5" /> Completar
                  </Button>
                )}
                {hasPendingChanges && (
                  <Button size="sm" onClick={handleSaveChanges} disabled={updateTask.isPending} className="h-8 text-xs gap-1">
                    {updateTask.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
                    Guardar
                  </Button>
                )}
                {hasPendingChanges && (
                  <Button size="sm" variant="ghost" onClick={() => setPendingChanges({})} className="h-8 text-xs">
                    Descartar
                  </Button>
                )}
                {canDeleteTasks && (
                  <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-destructive" onClick={() => setShowDeleteConfirm(true)} title="Eliminar tarea">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                )}
              </div>
            </div>

            {/* ── Body 2-column v2.4 ── */}
            <div className="dr-body">

            {/* ── Main column (dr-main) ── */}
            <div className="dr-main">
              {/* Title block v2.4 */}
              <div className="dr-title">
                <div className="prio-strip">
                  <span className={priorityPillClass}>
                    <span className="dot" />
                    {priorityTagLabel}
                  </span>
                  {areaLabel && <span style={{ opacity: 0.6 }}>· {areaLabel}</span>}
                </div>
                <h1>
                  <input
                    value={currentTitle}
                    onChange={(e) => setPending("title", e.target.value)}
                    placeholder="Nombre de la tarea"
                  />
                </h1>
                <div className="meta-pills">
                  {task.due_date && (
                    <span className={`pill ${overdueBadge ? "overdue" : ""}`}>
                      <Calendar className="h-3 w-3" />
                      <strong>Vence</strong>
                      {formatMX(task.due_date, "dd MMM yyyy")}
                      {overdueBadge && <span>· VENCIDA</span>}
                    </span>
                  )}
                  {(task as any).creator_profile && (
                    <span className="pill">
                      <UserCheck className="h-3 w-3" />
                      {(task as any).creator_profile.full_name}
                    </span>
                  )}
                  {subtaskTotal > 0 && (
                    <span className="pill">
                      <ListChecks className="h-3 w-3" />
                      <strong>Subtareas</strong>
                      {subtaskClosed}/{subtaskTotal}
                    </span>
                  )}
                </div>
              </div>

              <div className="space-y-5">
              {/* Due date edit */}
              {editingDueDate && (
                <div className="p-3 rounded-lg border bg-muted/20 space-y-2">
                  <p className="text-sm font-medium">Cambiar fecha límite</p>
                  <Input type="date" value={newDueDate} onChange={(e) => setNewDueDate(e.target.value)} className="w-full sm:w-[200px]" />
                  <Textarea value={dueDateReason} onChange={(e) => setDueDateReason(e.target.value)} placeholder="Motivo del cambio de fecha (obligatorio)..." rows={2} className="text-sm" />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      onClick={handleDueDateSave}
                      disabled={!dueDateReason.trim() || updateTask.isPending || addComment.isPending}
                    >
                      {updateTask.isPending || addComment.isPending ? "Guardando..." : "Guardar"}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setEditingDueDate(false)}
                      disabled={updateTask.isPending || addComment.isPending}
                    >
                      Cancelar
                    </Button>
                  </div>
                </div>
              )}

              {/* Description — always visible */}
              {task.description && (
                <section className="dr-section">
                  <h3>
                    <FileText className="h-3 w-3" /> Descripción
                  </h3>
                  <div className="desc">{task.description}</div>
                </section>
              )}

              {/* ── Subtareas ── */}
              <section className="dr-section">
                <div className="flex items-center justify-between gap-2 flex-wrap mb-2">
                  <h3>
                    <ListChecks className="h-3 w-3" /> Subtareas
                    {checklist.length > 0 && (
                      <span className="count">{completedCount}/{checklist.length}</span>
                    )}
                  </h3>
                  <DocumentChecklistButton
                    className="h-6 text-[10px] px-2"
                    checklist={checklist}
                    assignedTo={task?.assigned_to ?? null}
                    onInsert={(updated) => updateChecklist(updated)}
                  />
                </div>
                {checklist.length > 0 && (
                  <div className="time-bar mb-2">
                    <div
                      className="fill"
                      style={{ width: `${checklist.length > 0 ? (completedCount / checklist.length) * 100 : 0}%` }}
                    />
                  </div>
                )}
                <div className="checklist">
                  {checklist.map((item) => {
                    const assigneeName = item.assigned_to ? orgProfiles?.find(p => p.user_id === item.assigned_to)?.full_name : null;
                    return (
                      <div key={item.id} className={cn("check-item group", item.completed && "done")}>
                        <input
                          type="checkbox"
                          checked={item.completed}
                          onChange={() => void toggleChecklistItem(item.id)}
                          className="h-3.5 w-3.5 accent-primary cursor-pointer"
                        />
                        <div className="label min-w-0">
                          {item.task_id ? (
                            <button
                              type="button"
                              className={cn(
                                "text-left hover:underline inline-flex items-center gap-1",
                                item.completed ? "text-muted-foreground" : "text-primary"
                              )}
                              onClick={() => setSelectedSubtaskId(item.task_id!)}
                            >
                              {item.text}
                              <ExternalLink className="h-3 w-3 shrink-0 opacity-60" />
                            </button>
                          ) : (
                            <span>{item.text}</span>
                          )}
                          {item.due_date && (
                            <span className="who ml-2 inline-flex items-center gap-0.5">
                              <Calendar className="h-2.5 w-2.5" />{formatMX(item.due_date, "dd MMM")}
                            </span>
                          )}
                        </div>
                        {assigneeName && <span className="who">{assigneeName}</span>}
                        <button
                          className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
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
                  <div className="space-y-0.5">
                    <label className="text-[10px] font-medium text-muted-foreground">Área / Célula</label>
                    <Select value={newSubtaskArea} onValueChange={(v) => setNewSubtaskArea(v)}>
                      <SelectTrigger className="h-7 w-full text-xs">
                        <SelectValue placeholder="Célula..." />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__parent__">Igual que la tarea principal</SelectItem>
                        <SelectItem value="__none__">Sin área</SelectItem>
                        {Object.entries(celulaLabelMap).map(([value, label]) => (
                          <SelectItem key={value} value={value}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <Button size="sm" variant="outline" className="h-7 text-xs gap-1 w-full" onClick={addChecklistItem} disabled={!newSubtask.trim()}>
                    <Plus className="h-3 w-3" /> Crear subtarea
                  </Button>
                </div>
              </section>

              {/* ── Collaborators ── */}
              <section className="dr-section">
                <h3>
                  <UserPlus className="h-3 w-3" /> Colaboradores
                  {assignees.length > 0 && <span className="count">{assignees.length}</span>}
                </h3>
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
              </section>

              {/* ── Advanced: Criticality/Delay (collapsible) ── */}
              <section className="dr-section">
                <Collapsible open={showAdvanced} onOpenChange={setShowAdvanced}>
                  <CollapsibleTrigger asChild>
                    <button className="w-full">
                      <h3 className="cursor-pointer hover:text-foreground transition-colors">
                        <Settings2 className="h-3 w-3" /> Semáforo y atraso
                        <ChevronDown className={cn("h-3 w-3 ml-auto transition-transform", showAdvanced && "rotate-180")} />
                      </h3>
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
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
              </section>

              {/* ── Recurrencia ── */}
              <section className="dr-section">
                <Collapsible open={showRecurrenceEdit} onOpenChange={setShowRecurrenceEdit}>
                  <CollapsibleTrigger asChild>
                    <button className="w-full">
                      <h3 className="cursor-pointer hover:text-foreground transition-colors">
                        <RefreshCw className="h-3 w-3" />
                        Recurrencia
                        {task?.is_recurring && (
                          <Badge variant="secondary" className="ml-auto text-[10px] px-1.5 py-0 h-4">
                            {recurrencePatternLabel((task as any).recurrence_pattern ?? "")}
                          </Badge>
                        )}
                        <ChevronDown className={cn("h-3 w-3 ml-1 transition-transform", showRecurrenceEdit && "rotate-180")} />
                      </h3>
                    </button>
                  </CollapsibleTrigger>
                  <CollapsibleContent>
                    <div className="p-3 rounded-lg border bg-muted/20 space-y-3 mt-2">
                      {/* Toggle activar/desactivar */}
                      <div className="flex items-center justify-between">
                        <span className="text-xs text-muted-foreground">Tarea recurrente</span>
                        <Switch
                          checked={!!task?.is_recurring}
                          onCheckedChange={(checked) => {
                            updateTask.mutate({
                              id: taskId!,
                              is_recurring: checked,
                              recurrence_pattern: checked ? editRecurrencePattern : null,
                              recurrence_type: checked ? editRecurrenceType : null,
                              next_recurrence_date:
                                checked && task?.due_date
                                  ? calculateNextOccurrenceDate(task.due_date, editRecurrencePattern)
                                  : null,
                            });
                          }}
                        />
                      </div>

                      {task?.is_recurring && (
                        <>
                          <div>
                            <span className="text-xs text-muted-foreground block mb-1">Frecuencia</span>
                            <Select
                              value={editRecurrencePattern}
                              onValueChange={(v) => {
                                setEditRecurrencePattern(v);
                                updateTask.mutate({
                                  id: taskId!,
                                  recurrence_pattern: v,
                                  next_recurrence_date: task?.due_date
                                    ? calculateNextOccurrenceDate(task.due_date, v)
                                    : undefined,
                                });
                              }}
                            >
                              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {RECURRENCE_PATTERN_OPTIONS.map((o) => (
                                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>

                          <div>
                            <span className="text-xs text-muted-foreground block mb-1">Crear siguiente ocurrencia</span>
                            <Select
                              value={editRecurrenceType}
                              onValueChange={(v) => {
                                setEditRecurrenceType(v);
                                updateTask.mutate({ id: taskId!, recurrence_type: v });
                              }}
                            >
                              <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                              <SelectContent>
                                {RECURRENCE_TYPE_OPTIONS.map((o) => (
                                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                            <p className="text-[11px] text-muted-foreground mt-1">
                              {RECURRENCE_TYPE_OPTIONS.find((o) => o.value === editRecurrenceType)?.description}
                            </p>
                          </div>

                          {(task as any).next_recurrence_date && (
                            <p className="text-[11px] text-muted-foreground">
                              Próxima ocurrencia:{" "}
                              <span className="text-foreground font-medium">
                                {formatRecurrenceDate((task as any).next_recurrence_date)}
                              </span>
                            </p>
                          )}
                        </>
                      )}
                    </div>
                  </CollapsibleContent>
                </Collapsible>
              </section>

              <Separator />

              {/* ── Tabs v2.4 ── */}
              <div className="dr-tabs">
                <button
                  type="button"
                  className={cn(activeTab === "comments" && "active")}
                  onClick={() => setActiveTab("comments")}
                >
                  <MessageSquare className="h-3.5 w-3.5" /> Comentarios ({comments.length})
                </button>
                <button
                  type="button"
                  className={cn(activeTab === "links" && "active")}
                  onClick={() => setActiveTab("links")}
                >
                  <Link className="h-3.5 w-3.5" /> Enlaces ({dropboxLinks.length})
                </button>
                <button
                  type="button"
                  className={cn(activeTab === "files" && "active")}
                  onClick={() => setActiveTab("files")}
                >
                  <Paperclip className="h-3.5 w-3.5" /> Archivos ({documents.length})
                </button>
              </div>

              {activeTab === "comments" && (
                <div className="space-y-3 mt-3">
                  <div className="comment-list max-h-[260px] overflow-y-auto">
                    {comments.length === 0 && (
                      <p className="text-sm text-muted-foreground text-center py-4">Sin comentarios aún</p>
                    )}
                    {comments.map((c) => (
                      <div key={c.id} className="comment">
                        <UserAvatar
                          name={c.profile?.full_name}
                          avatarUrl={c.profile?.avatar_url}
                          userId={c.user_id}
                          size="md"
                          className="shrink-0"
                        />
                        <div className="body">
                          <div className="head">
                            <span className="who">{c.profile?.full_name || "Usuario"}</span>
                            <span className="when">{formatMX(c.created_at, "dd MMM HH:mm")}</span>
                          </div>
                          <div className="text">{renderCommentContent(c.content)}</div>
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

                  <div className="comment-composer">
                    <div className="flex-1 min-w-0">
                      <MentionTextarea
                        value={commentText} onChange={setCommentText} profiles={orgProfiles ?? []}
                        placeholder="Escribe un comentario... usa @ para mencionar" rows={2}
                        onMentionsChange={setCommentMentions}
                        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) handleSendComment(); }}
                      />
                    </div>
                    <div className="flex flex-col gap-0.5 shrink-0">
                      <FileDropzone
                        files={pendingCommentFiles}
                        onChange={handleCommentFileUpload}
                        limits={genericLimits}
                        variant="button"
                        disabled={commentUploading}
                        showChips={false}
                        buttonSize="icon"
                        buttonVariant="ghost"
                        className="shrink-0"
                        enableFolderPicker
                      />
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
                                  const u = commentLinkInput.trim();
                                  const isDbx = u.includes("dropbox.com");
                                  const attName = isDbx
                                    ? extractDropboxFilenameFromUrl(u) ?? getDropboxLinkDisplayLabel(u)
                                    : u.split("/").pop() || "Enlace";
                                  setCommentAttachments(prev => [...prev, { type: isDbx ? "dropbox" : "link", name: attName, url: u }]);
                                  setCommentLinkInput(""); setShowCommentLinkPopover(false);
                                }
                              }}
                            />
                            <Button size="sm" className="h-7 px-2 text-xs" disabled={!commentLinkInput.trim()} onClick={() => {
                              const u = commentLinkInput.trim();
                              const isDbx = u.includes("dropbox.com");
                              const attName = isDbx
                                ? extractDropboxFilenameFromUrl(u) ?? getDropboxLinkDisplayLabel(u)
                                : u.split("/").pop() || "Enlace";
                              setCommentAttachments(prev => [...prev, { type: isDbx ? "dropbox" : "link", name: attName, url: u }]);
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
                </div>
              )}

              {activeTab === "links" && (
                <div className="space-y-3 mt-3 min-w-0">
                  <div className="space-y-1.5 min-w-0">
                    {dropboxLinks.length === 0 && <p className="text-sm text-muted-foreground text-center py-4">Sin enlaces de Dropbox</p>}
                    {dropboxLinks.map((link: any, i: number) => {
                      const label = getDropboxLinkDisplayLabel(link.url, link.name);
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
                          {label}
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
                </div>
              )}

              {activeTab === "files" && (
                <div className="space-y-3 mt-3">
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
                    <FileDropzone
                      files={pendingFileTabFiles}
                      onChange={handleFileUpload}
                      limits={fileTabLimits}
                      variant="area"
                      disabled={uploading}
                      showChips={false}
                      hint={uploading ? "Subiendo..." : "Subir archivos"}
                      subhint="Arrastra varios archivos, una carpeta o un .zip (se expande)"
                      className="text-xs"
                      enableFolderPicker
                    />
                    <label className="cursor-pointer">
                      <input type="file" className="hidden" accept="image/*" capture="environment" onChange={async (e) => {
                        const capturedFile = e.target.files?.[0];
                        if (!capturedFile || !task) return;
                        e.target.value = "";
                        let initPath = KAWIIL_TEAM_ROOT;
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
                </div>
              )}

              </div>
            </div>

            {/* ── Sidebar v2.4 (dr-rail) ── */}
            <aside className="dr-rail hidden md:flex">
              {/* Briefing IA (LLM) */}
              <TaskAiBriefingCard
                task={task as any}
                subtasks={childSubtasks as any}
                clientName={clientChip ?? null}
                projectName={projectChip ?? null}
                assigneeName={
                  currentAssignedTo
                    ? orgProfiles?.find((p) => p.user_id === currentAssignedTo)?.full_name ?? null
                    : null
                }
              />

              {/* Kawiil IA (heurística local) */}
              <TaskKawiilAiCard
                task={task as any}
                subtasks={childSubtasks as any}
              />

              {/* Asignación */}
              <section className="rc space-y-2.5">
                <h4>
                  <UserCheck className="h-3 w-3" /> Asignación
                </h4>
                <div className="space-y-2">
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-0.5">Responsable</label>
                    <SearchableSelect
                      options={sortedProfiles}
                      value={currentAssignedTo || ""}
                      onValueChange={(uid) => setPending("assigned_to", uid || null)}
                      placeholder="Sin responsable"
                      searchPlaceholder="Buscar persona..."
                      className="h-8 w-full text-xs"
                    />
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-0.5">Área / Célula</label>
                    <Select value={currentArea ? String(currentArea) : "__none__"} onValueChange={(v) => setPending("area", v === "__none__" ? null : v)}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue placeholder="Sin área" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__none__">Sin área</SelectItem>
                        {Object.entries(celulaLabelMap).map(([value, label]) => (
                          <SelectItem key={value} value={value}>{label}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div>
                    <label className="text-[10px] text-muted-foreground block mb-0.5">Prioridad</label>
                    <Select value={currentPriority} onValueChange={(v) => setPending("priority", v)}>
                      <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="urgente">P1 · Urgente</SelectItem>
                        <SelectItem value="alta">P2 · Alta</SelectItem>
                        <SelectItem value="media">P3 · Media</SelectItem>
                        <SelectItem value="baja">P4 · Baja</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  {assignees.length > 0 && (
                    <div>
                      <label className="text-[10px] text-muted-foreground block mb-1">Colaboradores ({assignees.length})</label>
                      <div className="flex flex-wrap gap-1">
                        {assignees.map((a: any) => (
                          <UserAvatar
                            key={a.id}
                            name={a.profile?.full_name}
                            email={a.profile?.email}
                            avatarUrl={a.profile?.avatar_url}
                            userId={a.user_id}
                            size="sm"
                            className="border border-background -ml-1 first:ml-0"
                          />
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </section>

              {/* Tiempo */}
              <section className="rc space-y-2.5">
                <h4>
                  <Clock className="h-3 w-3" /> Tiempo
                </h4>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <span className="text-[10px] text-muted-foreground">Registrado</span>
                    {(task as any).estimated_hours ? (
                      <span className="text-[10px] text-muted-foreground">de {(task as any).estimated_hours}h estimadas</span>
                    ) : null}
                  </div>
                  <div className="flex items-baseline gap-2">
                    <span className="font-mono text-base font-semibold tabular-nums">{formatTimer(displaySeconds)}</span>
                    {timerRunning && <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-medium animate-pulse">● en curso</span>}
                  </div>
                  {(task as any).estimated_hours ? (
                    (() => {
                      const estSec = Number((task as any).estimated_hours) * 3600;
                      const pct = estSec > 0 ? Math.min(100, Math.round((displaySeconds / estSec) * 100)) : 0;
                      const over = displaySeconds > estSec;
                      return (
                        <div className="mt-1.5">
                          <div className="h-1 rounded-full bg-muted overflow-hidden">
                            <div
                              className={cn(
                                "h-full rounded-full transition-all",
                                over ? "bg-red-500" : pct > 80 ? "bg-amber-500" : "bg-emerald-500",
                              )}
                              style={{ width: `${pct}%` }}
                            />
                          </div>
                          <p className="text-[10px] text-muted-foreground mt-0.5">{pct}%{over ? " · sobrepasado" : ""}</p>
                        </div>
                      );
                    })()
                  ) : null}
                </div>

                <div className="flex gap-1.5">
                  <Button
                    size="sm"
                    variant={timerRunning ? "default" : "outline"}
                    className="flex-1 h-8 text-xs gap-1"
                    onClick={handleTimerToggle}
                  >
                    {timerRunning ? <><Pause className="h-3 w-3" /> Pausar</> : <><Play className="h-3 w-3" /> Iniciar</>}
                  </Button>
                  <Button size="sm" variant="outline" className="h-8 px-2 text-xs gap-1" onClick={() => setShowBlockTime(true)} title="Bloquear tiempo en Outlook">
                    <Timer className="h-3 w-3" />
                  </Button>
                </div>

                <div>
                  <label className="text-[10px] text-muted-foreground block mb-0.5">Horas estimadas</label>
                  <Input
                    type="number"
                    step="0.5"
                    min="0"
                    inputMode="decimal"
                    placeholder="—"
                    className="h-8 text-xs"
                    value={pendingChanges.estimated_hours ?? (task as any).estimated_hours ?? ""}
                    onChange={(e) => {
                      const v = e.target.value;
                      setPending("estimated_hours", v === "" ? null : Number(v));
                    }}
                  />
                </div>

                {task.due_date && (
                  <div className="pt-1.5 border-t border-border/50">
                    <div className="flex items-center justify-between mb-1">
                      <span className="text-[10px] text-muted-foreground">Vencimiento</span>
                      {canEditDueDates && (
                        <button
                          type="button"
                          onClick={() => { setEditingDueDate(true); setNewDueDate(task.due_date || ""); }}
                          className="text-[10px] text-primary hover:underline"
                        >
                          Cambiar
                        </button>
                      )}
                    </div>
                    <span className={cn(
                      "inline-flex items-center gap-1 text-xs font-medium",
                      overdueBadge ? "text-red-600 dark:text-red-400" : "text-foreground",
                    )}>
                      <Calendar className="h-3 w-3" />
                      {formatMX(task.due_date, "dd MMM yyyy")}
                    </span>
                  </div>
                )}
              </section>

              {/* Dependencias */}
              <TaskDependenciesPanel
                taskId={taskId}
                projectId={task.project_id || null}
                onOpenTask={(id) => setSelectedSubtaskId(id)}
              />

              {/* Actividad reciente */}
              {taskActivity.length > 0 && (
                <section className="rc">
                  <h4>
                    <ActivityIcon className="h-3 w-3" /> Actividad
                  </h4>
                  <div className="activity" style={{ maxHeight: 200, overflowY: "auto" }}>
                    {taskActivity.slice(0, 8).map((a: any, i: number) => {
                      const det = a.details && typeof a.details === "object" ? a.details as Record<string, unknown> : null;
                      const viaAi = det?.source === "kawiil_ai";
                      const convId = typeof det?.conversation_id === "string" ? det.conversation_id : null;
                      return (
                        <div key={a.id} className={`act-item ${i === 0 ? "highlight" : ""}`}>
                          <div className="who">
                            <span>{a.action}</span>
                            {viaAi ? (
                              <span className="block text-xs font-normal text-muted-foreground">
                                vía Kawiil AI
                                {convId ? ` · ref. chat ${convId.slice(0, 8)}…` : ""}
                              </span>
                            ) : null}
                          </div>
                          <div className="when">{formatMX(a.created_at, "dd MMM HH:mm")}</div>
                        </div>
                      );
                    })}
                  </div>
                </section>
              )}
            </aside>
            </div>
          </div>
        ) : (
          <div className="py-12 text-center text-muted-foreground">Tarea no encontrada</div>
        )}
      </DialogContent>
      {task && <BlockTimeDialog open={showBlockTime} onOpenChange={setShowBlockTime} taskTitle={task.title} taskDueDate={task.due_date || undefined} />}
      <DropboxFilePicker open={showDropboxPicker} onClose={() => setShowDropboxPicker(false)} initialPath={KAWIIL_TEAM_ROOT} onSelect={handleDropboxPickerSelect} />
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
          setShowDropboxUpload(false);
        }}
      />
      <DropboxFilePicker open={showCommentDropbox} onClose={() => setShowCommentDropbox(false)} onSelect={(file) => setCommentAttachments(prev => [...prev, { type: "dropbox", name: file.name, url: file.url }])} />
      <DocumentPreviewDialog open={!!previewDoc} onOpenChange={(o) => { if (!o) setPreviewDoc(null); }} document={previewDoc} />
      <TaskDetailDialog nested taskId={selectedSubtaskId} onClose={() => setSelectedSubtaskId(null)} />
      <DeleteConfirmDialog
        open={showDeleteConfirm}
        onOpenChange={setShowDeleteConfirm}
        title="¿Eliminar esta tarea?"
        description="Se eliminará permanentemente esta tarea y todos sus datos asociados."
        onConfirm={async () => {
          try {
            await deleteTask.mutateAsync(taskId!);
            toast.success("Tarea eliminada");
            setShowDeleteConfirm(false);
            onClose();
          } catch (e: any) {
            toast.error("Error al eliminar: " + e.message);
          }
        }}
        isPending={deleteTask.isPending}
      />
      <DuplicateFileResolutionDialog
        open={dupOpen}
        fileName={dupName}
        onResolve={onDupResolve}
      />
    </Dialog>
  );
}
