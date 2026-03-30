import { useState, useMemo, useCallback } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Plus, ChevronDown, ChevronRight, Layers, GripVertical,
  Pencil, Check, X, Trash2, User, Calendar, CheckSquare,
} from "lucide-react";
import { TASK_STATUS_CONFIG, PRIORITY_CONFIG } from "@/lib/statusStyles";
import { formatMX } from "@/lib/dateUtils";
import { Checkbox } from "@/components/ui/checkbox";

export interface Phase {
  key: string;
  name: string;
  order: number;
  color?: string;
}

interface PhaseManagerProps {
  phases: Phase[];
  tasks: any[];
  profileMap: Map<string, string>;
  onPhasesChange: (phases: Phase[]) => void;
  onTaskClick: (taskId: string) => void;
  onAddTask?: (phaseKey?: string) => void;
  canDeleteTasks?: boolean;
  onDeleteTask?: (taskId: string) => void;
  selectionMode?: boolean;
  selectedTaskIds?: Set<string>;
  onToggleTaskSelection?: (taskId: string) => void;
}

const PHASE_COLORS = [
  "bg-blue-500/10 border-blue-500/30",
  "bg-emerald-500/10 border-emerald-500/30",
  "bg-amber-500/10 border-amber-500/30",
  "bg-purple-500/10 border-purple-500/30",
  "bg-rose-500/10 border-rose-500/30",
  "bg-cyan-500/10 border-cyan-500/30",
];

function TaskRow({
  task, profileMap, onClick, canDelete, onDelete, selectionMode, isSelected, onToggle, showCleanTitle,
}: {
  task: any; profileMap: Map<string, string>; onClick: () => void;
  canDelete?: boolean; onDelete?: () => void;
  selectionMode?: boolean; isSelected?: boolean; onToggle?: () => void;
  showCleanTitle?: boolean;
}) {
  const title = showCleanTitle && task.phase_key ? task.title.replace(/^\[[^\]]+\]\s*/, "") : task.title;
  return (
    <div
      className={`flex items-center gap-3 py-2.5 px-3 rounded-lg hover:bg-muted/50 transition-colors cursor-pointer ${isSelected ? "bg-primary/5" : ""}`}
      onClick={() => selectionMode && onToggle ? onToggle() : onClick()}
    >
      {selectionMode && (
        <Checkbox checked={isSelected} onCheckedChange={onToggle} onClick={(e) => e.stopPropagation()} className="shrink-0" />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className="text-[13px] font-medium truncate">{title}</span>
          <Badge className={`text-[9px] border-0 px-1 py-0 ${PRIORITY_CONFIG[task.priority as keyof typeof PRIORITY_CONFIG]?.color || "bg-secondary/60 text-muted-foreground"}`} variant="secondary">
            {PRIORITY_CONFIG[task.priority as keyof typeof PRIORITY_CONFIG]?.label || task.priority}
          </Badge>
          <Badge className={`text-[9px] border-0 px-1 py-0 ${TASK_STATUS_CONFIG[task.status as keyof typeof TASK_STATUS_CONFIG]?.color || "bg-secondary/60 text-muted-foreground"}`} variant="secondary">
            {TASK_STATUS_CONFIG[task.status as keyof typeof TASK_STATUS_CONFIG]?.label || task.status}
          </Badge>
        </div>
        <div className="flex items-center gap-3 text-[11px] text-muted-foreground">
          {task.assigned_to && profileMap.get(task.assigned_to) && (
            <span className="flex items-center gap-1"><User className="h-3 w-3" />{profileMap.get(task.assigned_to)}</span>
          )}
          {task.due_date && (
            <span className="flex items-center gap-1"><Calendar className="h-3 w-3" />{formatMX(task.due_date, "dd MMM")}</span>
          )}
        </div>
      </div>
      {canDelete && onDelete && (
        <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0 text-destructive/60 hover:text-destructive" onClick={(e) => { e.stopPropagation(); onDelete(); }}>
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

export function PhaseManager({
  phases, tasks, profileMap, onPhasesChange, onTaskClick, onAddTask,
  canDeleteTasks, onDeleteTask, selectionMode, selectedTaskIds, onToggleTaskSelection,
}: PhaseManagerProps) {
  const [collapsedPhases, setCollapsedPhases] = useState<Set<string>>(new Set());
  const [editingPhase, setEditingPhase] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [addingPhase, setAddingPhase] = useState(false);
  const [newPhaseName, setNewPhaseName] = useState("");

  const tasksByPhase = useMemo(() => {
    const map = new Map<string, any[]>();
    map.set("__none__", []);
    for (const p of phases) map.set(p.key, []);
    for (const t of tasks) {
      const key = t.phase_key || "__none__";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(t);
    }
    return map;
  }, [phases, tasks]);

  const sortedPhases = useMemo(() =>
    [...phases].sort((a, b) => a.order - b.order),
  [phases]);

  const unassignedTasks = tasksByPhase.get("__none__") || [];

  const toggleCollapse = (key: string) => {
    setCollapsedPhases((prev) => {
      const next = new Set(prev);
      next.has(key) ? next.delete(key) : next.add(key);
      return next;
    });
  };

  const handleAddPhase = () => {
    if (!newPhaseName.trim()) return;
    const key = `phase_${Date.now()}`;
    const maxOrder = phases.reduce((m, p) => Math.max(m, p.order), 0);
    onPhasesChange([...phases, { key, name: newPhaseName.trim(), order: maxOrder + 1 }]);
    setNewPhaseName("");
    setAddingPhase(false);
  };

  const handleRenamePhase = (key: string) => {
    if (!editName.trim()) { setEditingPhase(null); return; }
    onPhasesChange(phases.map((p) => p.key === key ? { ...p, name: editName.trim() } : p));
    setEditingPhase(null);
  };

  const handleDeletePhase = (key: string) => {
    onPhasesChange(phases.filter((p) => p.key !== key));
  };

  const handleMovePhase = (key: string, direction: "up" | "down") => {
    const sorted = [...phases].sort((a, b) => a.order - b.order);
    const idx = sorted.findIndex((p) => p.key === key);
    if (direction === "up" && idx > 0) {
      const temp = sorted[idx].order;
      sorted[idx].order = sorted[idx - 1].order;
      sorted[idx - 1].order = temp;
    } else if (direction === "down" && idx < sorted.length - 1) {
      const temp = sorted[idx].order;
      sorted[idx].order = sorted[idx + 1].order;
      sorted[idx + 1].order = temp;
    }
    onPhasesChange(sorted);
  };

  const phaseProgress = (phaseTasks: any[]) => {
    if (!phaseTasks.length) return 0;
    const completed = phaseTasks.filter((t) => t.status === "completada").length;
    return Math.round((completed / phaseTasks.length) * 100);
  };

  return (
    <div className="space-y-3">
      {sortedPhases.map((phase, idx) => {
        const phaseTasks = tasksByPhase.get(phase.key) || [];
        const isCollapsed = collapsedPhases.has(phase.key);
        const isEditing = editingPhase === phase.key;
        const progress = phaseProgress(phaseTasks);
        const completedCount = phaseTasks.filter((t) => t.status === "completada").length;
        const colorClass = PHASE_COLORS[idx % PHASE_COLORS.length];

        return (
          <div key={phase.key} className={`rounded-xl border ${colorClass} overflow-hidden`}>
            <div className="flex items-center gap-2 px-3 py-2.5">
              <button onClick={() => toggleCollapse(phase.key)} className="shrink-0">
                {isCollapsed ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
              </button>
              <GripVertical className="h-3.5 w-3.5 text-muted-foreground/40 shrink-0 cursor-grab" />
              <Layers className="h-3.5 w-3.5 text-primary shrink-0" />

              {isEditing ? (
                <div className="flex items-center gap-1.5 flex-1">
                  <Input
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") handleRenamePhase(phase.key); if (e.key === "Escape") setEditingPhase(null); }}
                    className="h-7 text-xs"
                    autoFocus
                  />
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => handleRenamePhase(phase.key)}>
                    <Check className="h-3 w-3" />
                  </Button>
                  <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => setEditingPhase(null)}>
                    <X className="h-3 w-3" />
                  </Button>
                </div>
              ) : (
                <span
                  className="text-sm font-semibold flex-1 cursor-pointer hover:text-primary transition-colors"
                  onDoubleClick={() => { setEditingPhase(phase.key); setEditName(phase.name); }}
                >
                  {phase.name}
                </span>
              )}

              <div className="flex items-center gap-2 shrink-0">
                <div className="hidden sm:flex items-center gap-1.5 w-24">
                  <Progress value={progress} className="h-1.5" />
                  <span className="text-[10px] text-muted-foreground w-8 text-right">{progress}%</span>
                </div>
                <Badge variant="secondary" className="text-[10px] px-1.5 py-0">
                  {completedCount}/{phaseTasks.length}
                </Badge>
                {!isEditing && (
                  <>
                    <Button size="icon" variant="ghost" className="h-6 w-6" onClick={() => { setEditingPhase(phase.key); setEditName(phase.name); }}>
                      <Pencil className="h-3 w-3" />
                    </Button>
                    <Button size="icon" variant="ghost" className="h-6 w-6 text-destructive/60 hover:text-destructive" onClick={() => handleDeletePhase(phase.key)}>
                      <Trash2 className="h-3 w-3" />
                    </Button>
                  </>
                )}
              </div>
            </div>

            {!isCollapsed && (
              <div className="px-2 pb-2">
                {phaseTasks.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-4">Sin tareas en esta fase</p>
                ) : (
                  <div className="space-y-0.5">
                    {phaseTasks.map((t) => (
                      <TaskRow
                        key={t.id}
                        task={t}
                        profileMap={profileMap}
                        onClick={() => onTaskClick(t.id)}
                        canDelete={canDeleteTasks}
                        onDelete={() => onDeleteTask?.(t.id)}
                        selectionMode={selectionMode}
                        isSelected={selectedTaskIds?.has(t.id)}
                        onToggle={() => onToggleTaskSelection?.(t.id)}
                        showCleanTitle
                      />
                    ))}
                  </div>
                )}
                {onAddTask && (
                  <Button variant="ghost" size="sm" className="w-full mt-1 text-xs text-muted-foreground hover:text-foreground" onClick={() => onAddTask(phase.key)}>
                    <Plus className="h-3 w-3 mr-1" /> Agregar tarea
                  </Button>
                )}
              </div>
            )}
          </div>
        );
      })}

      {/* Unassigned tasks */}
      {unassignedTasks.length > 0 && phases.length > 0 && (
        <div className="rounded-xl border border-border/50 overflow-hidden">
          <div className="flex items-center gap-2 px-3 py-2.5 bg-muted/30">
            <button onClick={() => toggleCollapse("__none__")} className="shrink-0">
              {collapsedPhases.has("__none__") ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
            </button>
            <CheckSquare className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
            <span className="text-sm font-medium text-muted-foreground flex-1">Sin fase asignada</span>
            <Badge variant="secondary" className="text-[10px]">{unassignedTasks.length}</Badge>
          </div>
          {!collapsedPhases.has("__none__") && (
            <div className="px-2 pb-2">
              {unassignedTasks.map((t) => (
                <TaskRow
                  key={t.id} task={t} profileMap={profileMap} onClick={() => onTaskClick(t.id)}
                  canDelete={canDeleteTasks} onDelete={() => onDeleteTask?.(t.id)}
                  selectionMode={selectionMode} isSelected={selectedTaskIds?.has(t.id)}
                  onToggle={() => onToggleTaskSelection?.(t.id)}
                />
              ))}
            </div>
          )}
        </div>
      )}

      {/* No phases: flat list */}
      {phases.length === 0 && (
        <div className="space-y-0.5">
          {tasks.map((t) => (
            <TaskRow
              key={t.id} task={t} profileMap={profileMap} onClick={() => onTaskClick(t.id)}
              canDelete={canDeleteTasks} onDelete={() => onDeleteTask?.(t.id)}
              selectionMode={selectionMode} isSelected={selectedTaskIds?.has(t.id)}
              onToggle={() => onToggleTaskSelection?.(t.id)}
            />
          ))}
        </div>
      )}

      {/* Add phase button */}
      {addingPhase ? (
        <div className="flex items-center gap-2 px-2">
          <Input
            value={newPhaseName}
            onChange={(e) => setNewPhaseName(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") handleAddPhase(); if (e.key === "Escape") setAddingPhase(false); }}
            placeholder="Nombre de la fase..."
            className="h-8 text-sm"
            autoFocus
          />
          <Button size="sm" onClick={handleAddPhase} disabled={!newPhaseName.trim()}>
            <Check className="h-3.5 w-3.5" />
          </Button>
          <Button size="sm" variant="ghost" onClick={() => { setAddingPhase(false); setNewPhaseName(""); }}>
            <X className="h-3.5 w-3.5" />
          </Button>
        </div>
      ) : (
        <Button variant="outline" size="sm" className="w-full text-xs" onClick={() => setAddingPhase(true)}>
          <Plus className="h-3.5 w-3.5 mr-1.5" /> Agregar fase
        </Button>
      )}
    </div>
  );
}
