import { useState, useRef, useEffect, useCallback } from "react";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Collapsible, CollapsibleContent, CollapsibleTrigger,
} from "@/components/ui/collapsible";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  CalendarIcon, ChevronDown, Save, User, Play, Pause, Timer,
  AlertTriangle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { format, isPast, isToday } from "date-fns";
import { es } from "date-fns/locale";
import { UserOrTextSingle, UserOrTextMulti } from "@/components/projects/UserOrTextInput";
import { StepFileManager } from "@/components/projects/StepFileManager";
import { useProfiles } from "@/hooks/useTasks";
import { supabase } from "@/integrations/supabase/client";
import { useQueryClient } from "@tanstack/react-query";

const STATUS_OPTIONS = [
  { value: "pendiente", label: "Pendiente" },
  { value: "en_progreso", label: "En progreso" },
  { value: "en_revision", label: "En revisión" },
  { value: "completada", label: "Completada" },
];

const STATUS_STYLES: Record<string, string> = {
  pendiente: "bg-muted text-muted-foreground",
  en_progreso: "bg-blue-100 text-blue-800 dark:bg-blue-900/30 dark:text-blue-400",
  en_revision: "bg-yellow-100 text-yellow-800 dark:bg-yellow-900/30 dark:text-yellow-400",
  completada: "bg-green-100 text-green-800 dark:bg-green-900/30 dark:text-green-400",
};

const PERIODICITY_LABELS: Record<string, string> = {
  mensual: "Mensual",
  trimestral: "Trimestral",
  semestral: "Semestral",
  anual: "Anual",
  cuando_aplique: "Cuando aplique",
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

export interface ComplianceTaskRowProps {
  task: {
    id: string;
    title: string;
    description: string | null;
    status: string;
    priority: string;
    due_date: string | null;
    assigned_to: string | null;
    compliance_periodicity: string | null;
    compliance_period: string | null;
    checklist?: any;
    dropbox_links?: any;
  };
  projectId: string;
  clientDropboxPath?: string;
  urgencyBadge: React.ReactNode;
  onUpdate: () => void;
}

export function ComplianceTaskRow({ task, projectId, clientDropboxPath, urgencyBadge, onUpdate }: ComplianceTaskRowProps) {
  const [open, setOpen] = useState(false);
  const [localStatus, setLocalStatus] = useState(task.status);
  const [localDueDate, setLocalDueDate] = useState<Date | undefined>(task.due_date ? new Date(task.due_date) : undefined);
  const [localNotes, setLocalNotes] = useState(task.description || "");
  const [localAssignee, setLocalAssignee] = useState(task.assigned_to || "");
  const [localCollaborators, setLocalCollaborators] = useState<string[]>([]);
  const [hasChanges, setHasChanges] = useState(false);
  const [saving, setSaving] = useState(false);

  // Timer state
  const [timerRunning, setTimerRunning] = useState(false);
  const [displaySeconds, setDisplaySeconds] = useState(0);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const baseSecondsRef = useRef<number>(0);

  const { data: profiles = [] } = useProfiles();
  const queryClient = useQueryClient();

  const isOverdue = localDueDate && localStatus !== "completada" && isPast(localDueDate) && !isToday(localDueDate);

  useEffect(() => {
    setLocalStatus(task.status);
    setLocalDueDate(task.due_date ? new Date(task.due_date) : undefined);
    setLocalNotes(task.description || "");
    setLocalAssignee(task.assigned_to || "");
    setHasChanges(false);
  }, [task]);

  // Load collaborators (task_assignees)
  useEffect(() => {
    const loadCollaborators = async () => {
      const { data } = await supabase
        .from("task_assignees")
        .select("user_id")
        .eq("task_id", task.id);
      if (data) {
        setLocalCollaborators(data.map((d) => d.user_id));
      }
    };
    loadCollaborators();
  }, [task.id]);

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
  }, [timerRunning]);

  useEffect(() => { return () => { if (timerRef.current) clearInterval(timerRef.current); }; }, []);

  // Resolve assignee name for display
  const assigneeName = localAssignee
    ? profiles.find((p) => p.user_id === localAssignee)?.full_name?.split(" ")[0] || localAssignee
    : null;

  const handleSave = async () => {
    setSaving(true);
    try {
      // Find user_id if assignee is a name
      let assignedToId: string | null = null;
      if (localAssignee) {
        const matchedProfile = profiles.find(
          (p) => p.user_id === localAssignee || p.full_name === localAssignee
        );
        assignedToId = matchedProfile?.user_id || null;
      }

      await supabase
        .from("tasks")
        .update({
          status: localStatus as any,
          due_date: localDueDate ? localDueDate.toISOString().split("T")[0] : null,
          description: localNotes || null,
          assigned_to: assignedToId,
        })
        .eq("id", task.id);

      // Update collaborators
      await supabase.from("task_assignees").delete().eq("task_id", task.id);
      if (localCollaborators.length > 0) {
        await supabase.from("task_assignees").insert(
          localCollaborators.map((uid) => ({ task_id: task.id, user_id: uid }))
        );
      }

      setHasChanges(false);
      onUpdate();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className={cn(
        "rounded-lg border px-3 py-2 transition-colors",
        task.status === "completada" ? "bg-muted/40 opacity-70" : "bg-background"
      )}>
        <CollapsibleTrigger asChild>
          <div className="flex items-center gap-3 cursor-pointer">
            <div onClick={(e) => e.stopPropagation()}>
              <input
                type="checkbox"
                checked={task.status === "completada"}
                onChange={async () => {
                  const newStatus = task.status === "completada" ? "pendiente" : "completada";
                  await supabase.from("tasks").update({ status: newStatus } as any).eq("id", task.id);
                  onUpdate();
                }}
                className="h-4 w-4 rounded border-border"
              />
            </div>
            <span className={cn(
              "flex-1 text-sm font-medium",
              task.status === "completada" && "line-through text-muted-foreground"
            )}>
              {task.title}
            </span>
            <div className="flex items-center gap-1.5 shrink-0 flex-wrap justify-end">
              {/* Inline assignee selector on header */}
              <div onClick={(e) => e.stopPropagation()}>
                <Select
                  value={localAssignee || "__none__"}
                  onValueChange={async (v) => {
                    const newAssignee = v === "__none__" ? null : v;
                    setLocalAssignee(newAssignee || "");
                    await supabase.from("tasks").update({ assigned_to: newAssignee } as any).eq("id", task.id);
                    onUpdate();
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
              {localCollaborators.length > 0 && (
                <Badge variant="secondary" className="text-xs gap-1">
                  +{localCollaborators.length}
                </Badge>
              )}
              {isOverdue && (
                <Badge variant="destructive" className="text-xs gap-1">
                  <AlertTriangle className="h-3 w-3" />Vencida
                </Badge>
              )}
              {(displaySeconds > 0 || timerRunning) && (
                <Badge variant="outline" className={cn(
                  "text-xs gap-1 font-mono",
                  timerRunning && "border-primary text-primary animate-pulse"
                )}>
                  <Timer className="h-3 w-3" />
                  {timerRunning ? formatTime(displaySeconds) : formatTimeCompact(displaySeconds)}
                </Badge>
              )}
              {task.compliance_periodicity && (
                <Badge variant="outline" className="text-[10px]">
                  {PERIODICITY_LABELS[task.compliance_periodicity] || task.compliance_periodicity}
                </Badge>
              )}
              {task.compliance_period && (
                <span className="text-[10px] text-muted-foreground">{task.compliance_period}</span>
              )}
              {localStatus !== "pendiente" && localStatus !== "completada" && (
                <Badge variant="outline" className={cn("text-xs", STATUS_STYLES[localStatus])}>
                  {STATUS_OPTIONS.find((o) => o.value === localStatus)?.label}
                </Badge>
              )}
              {urgencyBadge}
              <ChevronDown className={cn("h-3.5 w-3.5 text-muted-foreground transition-transform", open && "rotate-180")} />
            </div>
          </div>
        </CollapsibleTrigger>
        <CollapsibleContent>
          <div className="mt-3 ml-7 space-y-3 pb-1">
            {/* Timer */}
            <div className="flex items-center gap-3 rounded-md border border-border/50 bg-background px-3 py-2">
              <Timer className="h-4 w-4 text-muted-foreground" />
              <span className="font-mono text-sm font-medium flex-1">{formatTime(displaySeconds)}</span>
              <Button
                variant={timerRunning ? "destructive" : "default"}
                size="sm"
                className="h-7 text-xs gap-1"
                onClick={timerRunning ? stopTimer : startTimer}
              >
                {timerRunning ? <><Pause className="h-3 w-3" />Pausar</> : <><Play className="h-3 w-3" />Iniciar</>}
              </Button>
            </div>

            {/* Responsable + Estatus + Fecha límite */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground flex items-center gap-1">
                  <User className="h-3 w-3" /> Responsable
                </label>
                <UserOrTextSingle
                  value={
                    localAssignee
                      ? profiles.find((p) => p.user_id === localAssignee)?.full_name || localAssignee
                      : ""
                  }
                  onChange={(val) => {
                    const matched = profiles.find((p) => p.full_name === val);
                    setLocalAssignee(matched ? matched.user_id : val);
                    markChanged();
                  }}
                  profiles={profiles}
                  placeholder="Escribir o seleccionar..."
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs font-medium text-muted-foreground">Estatus</label>
                <Select value={localStatus} onValueChange={(v) => { setLocalStatus(v); markChanged(); }}>
                  <SelectTrigger className="h-8 text-xs"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    {STATUS_OPTIONS.map((opt) => (
                      <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                    ))}
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
                    <Calendar
                      mode="single"
                      selected={localDueDate}
                      onSelect={(d) => { setLocalDueDate(d); markChanged(); }}
                      initialFocus
                      className="p-3 pointer-events-auto"
                    />
                  </PopoverContent>
                </Popover>
              </div>
            </div>

            {/* Collaborators */}
            <div className="space-y-2">
              <label className="text-xs font-medium text-muted-foreground">Colaboradores</label>
              <UserOrTextMulti
                values={localCollaborators.map((uid) => {
                  const p = profiles.find((pr) => pr.user_id === uid);
                  return p?.full_name || uid;
                })}
                onChange={(names) => {
                  const ids = names.map((name) => {
                    const p = profiles.find((pr) => pr.full_name === name);
                    return p?.user_id || name;
                  });
                  setLocalCollaborators(ids);
                  markChanged();
                }}
                profiles={profiles}
                placeholder="Agregar colaborador..."
              />
            </div>

            {/* Notes */}
            <div className="space-y-1">
              <label className="text-xs font-medium text-muted-foreground">Notas</label>
              <Textarea
                className="text-xs min-h-[60px] resize-none"
                placeholder="Observaciones..."
                value={localNotes}
                onChange={(e) => { setLocalNotes(e.target.value); markChanged(); }}
              />
            </div>

            {/* Files */}
            <StepFileManager
              documentIds={[]}
              onDocumentAdded={() => {}}
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
