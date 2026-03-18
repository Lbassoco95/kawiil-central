import { useState, useRef, useEffect, useCallback } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Separator } from "@/components/ui/separator";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  CalendarIcon, ChevronDown, Save, User,
  UserPlus, X, AlertTriangle, ListChecks, Plus, UserCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format, isPast, isToday } from "date-fns";
import { es } from "date-fns/locale";
import { STEP_STATUS_OPTIONS, type AccountingStep, type StepStatus, type ChecklistItem } from "@/hooks/useAccountingPeriods";
import { StepAssigneeSelect } from "./StepAssigneeSelect";
import { StepFileManager } from "./StepFileManager";
import { StepComments } from "./StepComments";
import { StepTimerControl, StepTimerBadge } from "./StepTimer";
import { DebouncedTextarea } from "@/components/shared/DebouncedTextarea";
import { DueDateReasonDialog } from "./DueDateReasonDialog";
import { useProfiles } from "@/hooks/useTasks";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { TaskDetailDialog } from "@/components/tasks/TaskDetailDialog";

import { STEP_STATUS_CONFIG } from "@/lib/statusStyles";

export interface UnifiedStepRowProps {
  step: AccountingStep;
  index: number;
  projectId: string;
  onSave: (updates: Partial<AccountingStep>) => void;
  onToggle?: (completed: boolean) => void;
  saving?: boolean;
  showTimer?: boolean;
  showCheckbox?: boolean;
  clientDropboxPath?: string;
  /** Extra content like appointment date fields */
  extraFields?: React.ReactNode;
  /** Comment step key override (e.g. for compliance tasks using `compliance_${id}`) */
  commentStepKey?: string;
  /** Client ID for linking subtasks to a client */
  clientId?: string;
}

export function UnifiedStepRow({
  step, index, projectId, onSave, onToggle, saving,
  showTimer = true, showCheckbox = true, clientDropboxPath, extraFields,
  commentStepKey, clientId,
}: UnifiedStepRowProps) {
  const [open, setOpen] = useState(false);
  const [localStatus, setLocalStatus] = useState<StepStatus>((step.step_status as StepStatus) || "pendiente");
  const [localLabel, setLocalLabel] = useState(step.label);
  const [localDueDate, setLocalDueDate] = useState<Date | undefined>(step.due_date ? new Date(step.due_date) : undefined);
  const [localNotes, setLocalNotes] = useState(step.notes || "");
  const [localAssignee, setLocalAssignee] = useState<string | null>(step.assigned_to || null);
  const [localCollaborators, setLocalCollaborators] = useState<string[]>(step.collaborators || []);
  const [localChecklist, setLocalChecklist] = useState<ChecklistItem[]>(step.checklist || []);
  const [newSubtask, setNewSubtask] = useState("");
  const [newSubtaskAssignee, setNewSubtaskAssignee] = useState<string | null>(null);
  const [newSubtaskDueDate, setNewSubtaskDueDate] = useState<Date | undefined>(undefined);
  const [hasChanges, setHasChanges] = useState(false);
  const [selectedSubtaskId, setSelectedSubtaskId] = useState<string | null>(null);
  const { data: profiles = [] } = useProfiles();
  const { user } = useAuth();
  const queryClient = useQueryClient();

  // Due date reason dialog
  const [dueDateReasonOpen, setDueDateReasonOpen] = useState(false);
  const [pendingDueDate, setPendingDueDate] = useState<Date | undefined>(undefined);
  const hadPreviousDueDate = useRef(!!step.due_date);

  const savedTime = step.time_spent_seconds || 0;
  const isOverdue = localDueDate && !step.completed && isPast(localDueDate) && !isToday(localDueDate);

  // Only reset local state when step identity changes (not on every prop update)
  const stepKeyRef = useRef(step.key);
  useEffect(() => {
    if (stepKeyRef.current !== step.key) {
      stepKeyRef.current = step.key;
      setLocalStatus((step.step_status as StepStatus) || "pendiente");
      setLocalLabel(step.label);
      setLocalDueDate(step.due_date ? new Date(step.due_date) : undefined);
      setLocalNotes(step.notes || "");
      setLocalAssignee(step.assigned_to || null);
      setLocalCollaborators(step.collaborators || []);
      setLocalChecklist(step.checklist || []);
      setHasChanges(false);
      hadPreviousDueDate.current = !!step.due_date;
    }
  }, [step.key]);

  const markChanged = () => setHasChanges(true);

  const handleDueDateSelect = (d: Date | undefined) => {
    // If there was a previous due date and user is changing it, require reason
    if (hadPreviousDueDate.current && d && localDueDate && d.getTime() !== localDueDate.getTime()) {
      setPendingDueDate(d);
      setDueDateReasonOpen(true);
    } else {
      setLocalDueDate(d);
      hadPreviousDueDate.current = !!d;
      markChanged();
    }
  };

  const handleDueDateReasonConfirm = async (reason: string) => {
    const oldDate = localDueDate ? format(localDueDate, "dd/MM/yyyy") : "sin fecha";
    const newDate = pendingDueDate ? format(pendingDueDate, "dd/MM/yyyy") : "sin fecha";

    // Post automatic comment
    const stepKeyForComment = commentStepKey || step.key;
    try {
      const { data: orgId } = await supabase.rpc("get_user_org_id", { _user_id: user!.id });
      await supabase.from("project_comments").insert({
        project_id: projectId,
        user_id: user!.id,
        step_key: stepKeyForComment,
        content: `📅 Fecha límite cambiada de ${oldDate} a ${newDate}.\n**Motivo:** ${reason}`,
      });
    } catch { /* silent */ }

    setLocalDueDate(pendingDueDate);
    hadPreviousDueDate.current = !!pendingDueDate;
    markChanged();
    setDueDateReasonOpen(false);
    setPendingDueDate(undefined);
  };

  const handleDueDateReasonCancel = () => {
    setDueDateReasonOpen(false);
    setPendingDueDate(undefined);
  };

  const handleSave = () => {
    const updates: Partial<AccountingStep> = {
      label: localLabel,
      step_status: localStatus,
      due_date: localDueDate ? localDueDate.toISOString() : null,
      notes: localNotes || null,
      assigned_to: localAssignee,
      collaborators: localCollaborators,
      checklist: localChecklist,
    };
    // Auto-set started_at when moving from pendiente
    if (localStatus !== "pendiente" && !step.started_at) {
      updates.started_at = new Date().toISOString();
    }
    if (localStatus === "completado" && !step.completed && onToggle) {
      onToggle(true);
    }
    onSave(updates);
    setHasChanges(false);
  };

  // Checklist helpers
  const completedCount = localChecklist.filter((c) => c.completed).length;

  const toggleChecklistItem = async (itemId: string) => {
    const item = localChecklist.find((c) => c.id === itemId);
    if (!item) return;
    const newCompleted = !item.completed;
    const updatedList = localChecklist.map((c) => c.id === itemId ? { ...c, completed: newCompleted } : c);
    setLocalChecklist(updatedList);
    onSave({ checklist: updatedList });
    // Sync linked task status
    if (item.task_id) {
      try {
        await supabase.from("tasks").update({
          status: newCompleted ? "completada" : "pendiente",
          completed_at: newCompleted ? new Date().toISOString() : null,
        } as any).eq("id", item.task_id);
        queryClient.invalidateQueries({ queryKey: ["tasks"] });
        queryClient.invalidateQueries({ queryKey: ["project-tasks", projectId] });
      } catch { /* silent */ }
    }
  };

  const addChecklistItem = async () => {
    if (!newSubtask.trim()) return;
    const itemId = `sub-${Date.now()}`;
    let taskId: string | null = null;

    // Create linked task in the tasks table
    try {
      const { data: orgId } = await supabase.rpc("get_user_org_id", { _user_id: user!.id });
      const { data: taskData, error: taskError } = await supabase.from("tasks").insert({
        title: newSubtask.trim(),
        organization_id: orgId!,
        project_id: projectId,
        client_id: clientId || null,
        assigned_to: newSubtaskAssignee || localAssignee || null,
        due_date: newSubtaskDueDate ? newSubtaskDueDate.toISOString().split("T")[0] : null,
        created_by: user!.id,
        area: step.key,
      } as any).select("id").single();
      if (!taskError && taskData) {
        taskId = taskData.id;
      }
    } catch { /* continue without linked task */ }

    const newItem: ChecklistItem = {
      id: itemId,
      text: newSubtask.trim(),
      completed: false,
      assigned_to: newSubtaskAssignee || localAssignee || null,
      due_date: newSubtaskDueDate ? newSubtaskDueDate.toISOString() : null,
      task_id: taskId,
    };
    const updatedList = [...localChecklist, newItem];
    setLocalChecklist(updatedList);
    setNewSubtask("");
    setNewSubtaskAssignee(null);
    setNewSubtaskDueDate(undefined);
    onSave({ checklist: updatedList });
    if (taskId) {
      queryClient.invalidateQueries({ queryKey: ["tasks"] });
      queryClient.invalidateQueries({ queryKey: ["project-tasks", projectId] });
    }
  };

  const removeChecklistItem = async (itemId: string) => {
    const item = localChecklist.find((c) => c.id === itemId);
    const filteredList = localChecklist.filter((c) => c.id !== itemId);
    setLocalChecklist(filteredList);
    onSave({ checklist: filteredList });
    // Optionally mark linked task as cancelled/deleted - just update status
    if (item?.task_id) {
      try {
        await supabase.from("tasks").update({ status: "cancelada" } as any).eq("id", item.task_id);
        queryClient.invalidateQueries({ queryKey: ["tasks"] });
        queryClient.invalidateQueries({ queryKey: ["project-tasks", projectId] });
      } catch { /* silent */ }
    }
  };

  const handleDocumentAdded = (newIds: string[]) => {
    onSave({ document_ids: newIds });
  };

  const addCollaborator = (userId: string) => {
    if (localCollaborators.includes(userId)) return;
    setLocalCollaborators([...localCollaborators, userId]);
    markChanged();
  };

  const removeCollaborator = (userId: string) => {
    setLocalCollaborators(localCollaborators.filter((c) => c !== userId));
    markChanged();
  };

  const assigneeName = localAssignee
    ? profiles.find((p) => p.user_id === localAssignee)?.full_name?.split(" ")[0]
    : null;

  const resolvedStepKey = commentStepKey || step.key;

  return (
    <>
      <Collapsible open={open} onOpenChange={setOpen}>
        <div className={cn("rounded-lg border px-3 py-2 transition-colors", step.completed ? "bg-muted/40 opacity-70" : "bg-background")}>
          <CollapsibleTrigger asChild>
            <div className="flex items-start sm:items-center gap-2 sm:gap-3 cursor-pointer flex-wrap">
              <div className="flex items-center gap-2 flex-1 min-w-0">
                {showCheckbox && onToggle && (
                  <div onClick={(e) => e.stopPropagation()}>
                    <input
                      type="checkbox"
                      checked={step.completed}
                      onChange={(e) => onToggle(e.target.checked)}
                      className="h-4 w-4 rounded border-border"
                    />
                  </div>
                )}
                <span className="text-muted-foreground text-xs font-mono w-5 shrink-0">{index + 1}.</span>
                <span className={cn("text-sm font-medium truncate", step.completed && "line-through text-muted-foreground")}>
                  {step.label}
                </span>
              </div>
              <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end ml-auto">
                {/* Inline assignee selector - hidden on mobile when collapsed */}
                <div onClick={(e) => e.stopPropagation()} className="hidden sm:block">
                  <Select
                    value={localAssignee || "__none__"}
                    onValueChange={(v) => {
                      const newVal = v === "__none__" ? null : v;
                      setLocalAssignee(newVal);
                      onSave({ assigned_to: newVal });
                    }}
                  >
                    <SelectTrigger className="h-6 text-[10px] w-auto min-w-[100px] border-dashed gap-1 px-2">
                      <User className="h-3 w-3 shrink-0" />
                      <SelectValue placeholder="Sin asignar" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__none__">Sin asignar</SelectItem>
                      {profiles.map((p) => (
                        <SelectItem key={p.user_id} value={p.user_id}>{p.full_name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                {/* Mobile: show assignee name only */}
                {assigneeName && (
                  <span className="text-[10px] text-muted-foreground sm:hidden">{assigneeName}</span>
                )}
                {localCollaborators.length > 0 && (
                  <Badge variant="secondary" className="text-xs gap-1 hidden sm:inline-flex">
                    <UserPlus className="h-3 w-3" />+{localCollaborators.length}
                  </Badge>
                )}
                {isOverdue && (
                  <Badge variant="destructive" className="text-[10px] sm:text-xs gap-1 px-1.5">
                    <AlertTriangle className="h-3 w-3" />Vencida
                  </Badge>
                )}
                {showTimer && (
                  <StepTimerBadge savedSeconds={savedTime} timerRunning={false} displaySeconds={savedTime} />
                )}
                {localStatus !== "pendiente" && (
                  <Badge variant="outline" className={cn("text-[10px] sm:text-xs px-1.5", STEP_STATUS_CONFIG[localStatus]?.color || STEP_STATUS_CONFIG.pendiente.color)}>
                    {STEP_STATUS_OPTIONS.find((o) => o.value === localStatus)?.label}
                  </Badge>
                )}
                {localDueDate && !isOverdue && (
                  <span className="text-[10px] sm:text-xs text-muted-foreground hidden sm:inline">{format(localDueDate, "dd/MM/yy")}</span>
                )}
                <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform shrink-0", open && "rotate-180")} />
              </div>
            </div>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <div className="mt-4 ml-7 space-y-4 pb-2">
              {/* Editable name */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Nombre del paso</label>
                <Input
                  className="text-sm h-8"
                  value={localLabel}
                  onChange={(e) => { setLocalLabel(e.target.value); markChanged(); }}
                  placeholder="Nombre del paso..."
                />
              </div>

              {showTimer && (
                <StepTimerControl
                  initialSeconds={savedTime}
                  onStop={(total) => onSave({ time_spent_seconds: total })}
                />
              )}

              {/* Responsable + Estatus + Fecha límite */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <StepAssigneeSelect value={localAssignee} onChange={(v) => { setLocalAssignee(v); markChanged(); }} />
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground">Estatus</label>
                  <Select value={localStatus} onValueChange={(v) => { setLocalStatus(v as StepStatus); markChanged(); }}>
                    <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {STEP_STATUS_OPTIONS.map((opt) => (<SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-1">
                  <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                    <CalendarIcon className="h-3 w-3" /> Fecha límite
                  </label>
                  <Popover>
                    <PopoverTrigger asChild>
                      <Button variant="outline" className={cn(
                        "h-8 w-full justify-start text-left text-xs font-normal",
                        !localDueDate && "text-muted-foreground",
                        isOverdue && "border-destructive text-destructive"
                      )}>
                        <CalendarIcon className="mr-2 h-3 w-3" />
                        {localDueDate ? format(localDueDate, "PPP", { locale: es }) : "Seleccionar"}
                      </Button>
                    </PopoverTrigger>
                    <PopoverContent className="w-auto p-0" align="start">
                      <Calendar mode="single" selected={localDueDate} onSelect={handleDueDateSelect} initialFocus className="p-3 pointer-events-auto" />
                    </PopoverContent>
                  </Popover>
                </div>
              </div>

              <Separator className="my-1" />

              {/* Collaborators */}
              <div className="space-y-2">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <UserPlus className="h-3 w-3" /> Colaboradores
                </label>
                <div className="flex flex-wrap gap-1.5 mb-2">
                  {localCollaborators.map((uid) => {
                    const p = profiles.find((pr) => pr.user_id === uid);
                    return (
                      <Badge key={uid} variant="secondary" className="text-xs gap-1">
                        {p?.full_name || uid}
                        <X className="h-3 w-3 cursor-pointer hover:text-destructive" onClick={() => removeCollaborator(uid)} />
                      </Badge>
                    );
                  })}
                </div>
                <Select onValueChange={addCollaborator} value="">
                  <SelectTrigger className="h-8 text-xs w-full sm:w-[250px]">
                    <SelectValue placeholder="Agregar colaborador..." />
                  </SelectTrigger>
                  <SelectContent>
                    {profiles
                      .filter((p) => p.user_id !== localAssignee && !localCollaborators.includes(p.user_id))
                      .map((p) => (
                        <SelectItem key={p.user_id} value={p.user_id}>{p.full_name}</SelectItem>
                      ))}
                  </SelectContent>
                </Select>
              </div>

              {/* Subtareas */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                    <ListChecks className="h-3 w-3" /> Subtareas
                    {localChecklist.length > 0 && (
                      <span className="text-xs font-normal ml-1">{completedCount}/{localChecklist.length}</span>
                    )}
                  </label>
                </div>
                {localChecklist.length > 0 && (
                  <div className="h-1 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-primary rounded-full transition-all"
                      style={{ width: `${localChecklist.length > 0 ? (completedCount / localChecklist.length) * 100 : 0}%` }}
                    />
                  </div>
                )}
                <div className="space-y-1">
                  {localChecklist.map((item) => {
                    const itemAssigneeName = item.assigned_to
                      ? profiles.find((p) => p.user_id === item.assigned_to)?.full_name?.split(" ")[0]
                      : null;
                    return (
                      <div key={item.id} className="flex items-center gap-2 group py-0.5">
                        <Checkbox
                          checked={item.completed}
                          onCheckedChange={() => toggleChecklistItem(item.id)}
                        />
                        <span
                          className={cn(
                            "text-xs flex-1 cursor-pointer hover:underline",
                            item.completed && "line-through text-muted-foreground"
                          )}
                          onClick={() => item.task_id && setSelectedSubtaskId(item.task_id)}
                          title={item.task_id ? "Ver detalle de tarea" : undefined}
                        >
                          {item.text}
                        </span>
                        {itemAssigneeName && (
                          <span className="text-[10px] text-muted-foreground flex items-center gap-0.5">
                            <User className="h-2.5 w-2.5" />{itemAssigneeName}
                          </span>
                        )}
                        {item.due_date && (
                          <span className="text-[10px] text-muted-foreground">
                            {format(new Date(item.due_date), "dd MMM", { locale: es })}
                          </span>
                        )}
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
                {/* Add subtask form */}
                <div className="space-y-2 rounded-md border border-dashed border-border p-2">
                  <Input
                    value={newSubtask}
                    onChange={(e) => setNewSubtask(e.target.value)}
                    placeholder="Nueva subtarea..."
                    className="h-7 text-xs"
                    onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addChecklistItem(); } }}
                  />
                  {newSubtask.trim() && (
                    <div className="flex items-center gap-2 flex-wrap">
                      <Select
                        value={newSubtaskAssignee || "__none__"}
                        onValueChange={(v) => setNewSubtaskAssignee(v === "__none__" ? null : v)}
                      >
                        <SelectTrigger className="h-6 text-[10px] w-auto min-w-[120px] border-dashed gap-1 px-2">
                          <User className="h-3 w-3 shrink-0" />
                          <SelectValue placeholder="Responsable" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">Sin asignar</SelectItem>
                          {profiles.map((p) => (
                            <SelectItem key={p.user_id} value={p.user_id}>{p.full_name}</SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button variant="outline" className={cn("h-6 text-[10px] px-2 font-normal", !newSubtaskDueDate && "text-muted-foreground")}>
                            <CalendarIcon className="mr-1 h-3 w-3" />
                            {newSubtaskDueDate ? format(newSubtaskDueDate, "dd MMM", { locale: es }) : "Fecha"}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar mode="single" selected={newSubtaskDueDate} onSelect={setNewSubtaskDueDate} initialFocus className="p-3 pointer-events-auto" />
                        </PopoverContent>
                      </Popover>
                      <Button size="sm" variant="default" className="h-6 px-2 text-[10px]" onClick={addChecklistItem} disabled={!newSubtask.trim()}>
                        <Plus className="h-3 w-3 mr-0.5" /> Crear
                      </Button>
                    </div>
                  )}
                </div>
              </div>

              {extraFields}

              {/* Creator info */}
              {step.created_by_name && (
                <p className="text-xs text-muted-foreground flex items-center gap-1">
                  <UserCircle className="h-3 w-3" />
                  Creado por: {step.created_by_name}
                </p>
              )}

              {/* Dates info */}
              {step.started_at && (
                <p className="text-xs text-muted-foreground">
                  Iniciado: {format(new Date(step.started_at), "dd MMM yyyy HH:mm", { locale: es })}
                </p>
              )}
              {step.completed_at && (
                <p className="text-xs text-muted-foreground">
                  Completado: {format(new Date(step.completed_at), "dd MMM yyyy HH:mm", { locale: es })}
                </p>
              )}

              {/* Notes — debounced to avoid lag */}
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Notas</label>
                <DebouncedTextarea
                  className="text-xs min-h-[60px]"
                  placeholder="Observaciones..."
                  value={localNotes}
                  onChange={(val) => { setLocalNotes(val); markChanged(); }}
                />
              </div>

              {/* Step Comments */}
              <StepComments projectId={projectId} stepKey={resolvedStepKey} stepLabel={step.label} />

              {/* Files & Dropbox */}
              <StepFileManager
                documentIds={step.document_ids || []}
                onDocumentAdded={handleDocumentAdded}
                projectId={projectId}
                clientDropboxPath={clientDropboxPath}
                disabled={saving}
              />

              <div className="flex justify-end pt-3 mt-2 border-t border-border">
                <Button size="sm" onClick={handleSave} disabled={!hasChanges || saving}>
                  <Save className="h-4 w-4 mr-1" />Guardar
                </Button>
              </div>
            </div>
          </CollapsibleContent>
        </div>
      </Collapsible>

      <DueDateReasonDialog
        open={dueDateReasonOpen}
        onConfirm={handleDueDateReasonConfirm}
        onCancel={handleDueDateReasonCancel}
      />

      {selectedSubtaskId && (
        <TaskDetailDialog
          taskId={selectedSubtaskId}
          onClose={() => setSelectedSubtaskId(null)}
        />
      )}
    </>
  );
}
