import { useState, useRef, useEffect, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
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
  CalendarIcon, ChevronDown, Save, User, Play, Pause, Timer,
  UserPlus, X, AlertTriangle, ListChecks, Plus,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format, isPast, isToday } from "date-fns";
import { es } from "date-fns/locale";
import { STEP_STATUS_OPTIONS, type AccountingStep, type StepStatus, type ChecklistItem } from "@/hooks/useAccountingPeriods";
import { StepAssigneeSelect } from "./StepAssigneeSelect";
import { StepFileManager } from "./StepFileManager";
import { StepComments } from "./StepComments";
import { useProfiles } from "@/hooks/useTasks";

const STEP_STATUS_STYLES: Record<StepStatus, string> = {
  pendiente: "bg-muted text-muted-foreground",
  en_progreso: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  en_espera_cliente: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  completado: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
};

function formatTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return `${h.toString().padStart(2, "0")}:${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
}

function formatTimeCompact(totalSeconds: number): string {
  if (totalSeconds === 0) return "";
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
}

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
}

export function UnifiedStepRow({
  step, index, projectId, onSave, onToggle, saving,
  showTimer = true, showCheckbox = true, clientDropboxPath, extraFields,
}: UnifiedStepRowProps) {
  const [open, setOpen] = useState(false);
  const [timerRunning, setTimerRunning] = useState(false);
  const [displaySeconds, setDisplaySeconds] = useState(step.time_spent_seconds || 0);
  const [localStatus, setLocalStatus] = useState<StepStatus>((step.step_status as StepStatus) || "pendiente");
  const [localLabel, setLocalLabel] = useState(step.label);
  const [localDueDate, setLocalDueDate] = useState<Date | undefined>(step.due_date ? new Date(step.due_date) : undefined);
  const [localNotes, setLocalNotes] = useState(step.notes || "");
  const [localAssignee, setLocalAssignee] = useState<string | null>(step.assigned_to || null);
  const [localCollaborators, setLocalCollaborators] = useState<string[]>(step.collaborators || []);
  const [localChecklist, setLocalChecklist] = useState<ChecklistItem[]>(step.checklist || []);
  const [newSubtask, setNewSubtask] = useState("");
  const [hasChanges, setHasChanges] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const baseSecondsRef = useRef<number>(step.time_spent_seconds || 0);
  const { data: profiles = [] } = useProfiles();

  const savedTime = step.time_spent_seconds || 0;
  const isOverdue = localDueDate && !step.completed && isPast(localDueDate) && !isToday(localDueDate);

  useEffect(() => {
    if (!timerRunning) {
      baseSecondsRef.current = step.time_spent_seconds || 0;
      setDisplaySeconds(step.time_spent_seconds || 0);
    }
  }, [step.time_spent_seconds, timerRunning]);

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
    }
  }, [step.key]);

  const markChanged = () => setHasChanges(true);

  // Timer
  const startTimer = useCallback(() => {
    if (timerRunning) return;
    baseSecondsRef.current = displaySeconds;
    startTimeRef.current = Date.now();
    setTimerRunning(true);
    timerRef.current = setInterval(() => {
      const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
      setDisplaySeconds(baseSecondsRef.current + elapsed);
    }, 1000);
  }, [timerRunning, displaySeconds]);

  const stopTimer = useCallback(() => {
    if (!timerRunning) return;
    if (timerRef.current) clearInterval(timerRef.current);
    timerRef.current = null;
    setTimerRunning(false);
    const elapsed = Math.floor((Date.now() - startTimeRef.current) / 1000);
    const total = baseSecondsRef.current + elapsed;
    baseSecondsRef.current = total;
    setDisplaySeconds(total);
    onSave({ time_spent_seconds: total });
  }, [timerRunning, onSave]);

  useEffect(() => { return () => { if (timerRef.current) clearInterval(timerRef.current); }; }, []);

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

  const toggleChecklistItem = (itemId: string) => {
    setLocalChecklist(localChecklist.map((c) => c.id === itemId ? { ...c, completed: !c.completed } : c));
    markChanged();
  };

  const addChecklistItem = () => {
    if (!newSubtask.trim()) return;
    setLocalChecklist([...localChecklist, { id: `sub-${Date.now()}`, text: newSubtask.trim(), completed: false }]);
    setNewSubtask("");
    markChanged();
  };

  const removeChecklistItem = (itemId: string) => {
    setLocalChecklist(localChecklist.filter((c) => c.id !== itemId));
    markChanged();
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

  return (
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
              {(savedTime > 0 || timerRunning) && showTimer && (
                <Badge variant="outline" className={cn("text-[10px] sm:text-xs gap-1 font-mono hidden sm:inline-flex", timerRunning && "border-primary text-primary animate-pulse")}>
                  <Timer className="h-3 w-3" />{timerRunning ? formatTime(displaySeconds) : formatTimeCompact(savedTime)}
                </Badge>
              )}
              {localStatus !== "pendiente" && (
                <Badge variant="outline" className={cn("text-[10px] sm:text-xs px-1.5", STEP_STATUS_STYLES[localStatus] || STEP_STATUS_STYLES.pendiente)}>
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
          <div className="mt-3 ml-7 space-y-3 pb-1">
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
              <div className="flex items-center gap-3 rounded-md border border-border/50 bg-background px-3 py-2">
                <Timer className="h-4 w-4 text-muted-foreground" />
                <span className="font-mono text-sm font-medium flex-1">{formatTime(displaySeconds)}</span>
                <Button variant={timerRunning ? "destructive" : "default"} size="sm" className="h-7 text-xs gap-1" onClick={timerRunning ? stopTimer : startTimer}>
                  {timerRunning ? <><Pause className="h-3 w-3" />Pausar</> : <><Play className="h-3 w-3" />Iniciar</>}
                </Button>
              </div>
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
                    <Calendar mode="single" selected={localDueDate} onSelect={(d) => { setLocalDueDate(d); markChanged(); }} initialFocus className="p-3 pointer-events-auto" />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

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
                {localChecklist.map((item) => (
                  <div key={item.id} className="flex items-center gap-2 group py-0.5">
                    <Checkbox
                      checked={item.completed}
                      onCheckedChange={() => toggleChecklistItem(item.id)}
                    />
                    <span className={cn("text-xs flex-1", item.completed && "line-through text-muted-foreground")}>
                      {item.text}
                    </span>
                    <button
                      className="opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                      onClick={() => removeChecklistItem(item.id)}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                ))}
              </div>
              <div className="flex gap-2">
                <Input
                  value={newSubtask}
                  onChange={(e) => setNewSubtask(e.target.value)}
                  placeholder="Agregar subtarea..."
                  className="h-7 text-xs"
                  onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); addChecklistItem(); } }}
                />
                <Button size="sm" variant="outline" className="h-7 px-2" onClick={addChecklistItem} disabled={!newSubtask.trim()}>
                  <Plus className="h-3 w-3" />
                </Button>
              </div>
            </div>

            {extraFields}

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

            {/* Notes */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Notas</label>
              <Textarea
                className="text-xs min-h-[60px]"
                placeholder="Observaciones..."
                value={localNotes}
                onChange={(e) => { setLocalNotes(e.target.value); markChanged(); }}
              />
            </div>

            {/* Step Comments */}
            <StepComments projectId={projectId} stepKey={step.key} stepLabel={step.label} />

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
  );
}
