import { useState, useMemo, useCallback, type ReactNode } from "react";
import {
  DndContext,
  DragEndEvent,
  MouseSensor,
  PointerSensor,
  TouchSensor,
  pointerWithin,
  rectIntersection,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type CollisionDetection,
} from "@dnd-kit/core";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/components/ui/collapsible";
import {
  Plus, ChevronDown, ChevronRight, Layers, GripVertical,
  Pencil, Check, X, Trash2, User, Calendar, CheckSquare,
} from "lucide-react";
import { TASK_STATUS_CONFIG, PRIORITY_CONFIG } from "@/lib/statusStyles";
import { formatMX } from "@/lib/dateUtils";
import { Checkbox } from "@/components/ui/checkbox";
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";
import { isTaskClosedStatus } from "@/lib/taskStatusGroups";
import { projectPhaseColorClass } from "./projectPhaseVisual";

export interface Phase {
  key: string;
  name: string;
  order: number;
  color?: string;
}

const DROPPABLE_PREFIX = "phase-drop-";
const TASK_DRAG_PREFIX = "task-";

interface PhaseManagerProps {
  phases: Phase[];
  tasks: any[];
  profileMap: Map<string, string>;
  onPhasesChange: (phases: Phase[]) => void;
  onTaskClick: (taskId: string) => void;
  /** Persistir `phase_key` al soltar una tarea en una fase (o null en «sin fase»). */
  onTaskPhaseAssign?: (taskId: string, phaseKey: string | null) => void | Promise<void>;
  onAddTask?: (phaseKey?: string) => void;
  canDeleteTasks?: boolean;
  onDeleteTask?: (taskId: string) => void;
  selectionMode?: boolean;
  selectedTaskIds?: Set<string>;
  onToggleTaskSelection?: (taskId: string) => void;
  /** Contenido bajo «Agregar tarea» (p. ej. seguimiento de etapa en juicios) */
  renderPhaseFooter?: (phaseKey: string) => ReactNode;
  /** Oculta el bloque inferior «Agregar fase» (p. ej. juicios usan otro diálogo) */
  hideBuiltInAddPhase?: boolean;
  /** Mostrar texto de ayuda del arrastre de tareas */
  showTaskDragHint?: boolean;
}

/** Evita fallos al soltar: el puntero debe caer dentro de la fase; si no, por intersección de rectángulos. */
const phaseDropCollision: CollisionDetection = (args) => {
  const inside = pointerWithin(args);
  if (inside.length > 0) return inside;
  return rectIntersection(args);
};

export function PhaseTaskRow({
  task, profileMap, onClick, canDelete, onDelete, selectionMode, isSelected, onToggle, showCleanTitle, archived,
  grabCursor,
}: {
  task: any; profileMap: Map<string, string>; onClick: () => void;
  canDelete?: boolean; onDelete?: () => void;
  selectionMode?: boolean; isSelected?: boolean; onToggle?: () => void;
  showCleanTitle?: boolean;
  archived?: boolean;
  /** Cursor de arrastre cuando la fila vive dentro de un draggable de fases */
  grabCursor?: boolean;
}) {
  const title = showCleanTitle && task.phase_key ? task.title.replace(/^\[[^\]]+\]\s*/, "") : task.title;
  return (
    <div
      className={cn(
        "flex items-center gap-3 py-2.5 px-3 rounded-lg hover:bg-muted/50 transition-colors",
        grabCursor ? "cursor-grab active:cursor-grabbing" : "cursor-pointer",
        isSelected && "bg-primary/5",
        archived && "opacity-75 hover:opacity-90"
      )}
      onClick={() => selectionMode && onToggle ? onToggle() : onClick()}
    >
      {selectionMode && (
        <Checkbox
          checked={isSelected}
          onCheckedChange={onToggle}
          onClick={(e) => e.stopPropagation()}
          onPointerDown={(e) => e.stopPropagation()}
          className="shrink-0"
        />
      )}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-1.5 mb-0.5">
          <span className={cn("text-[13px] font-medium truncate", archived && "line-through text-muted-foreground")}>{title}</span>
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
        <Button
          variant="ghost"
          size="icon"
          className="h-7 w-7 shrink-0 text-destructive/60 hover:text-destructive"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </Button>
      )}
    </div>
  );
}

function DraggableOpenTaskRow({
  task,
  profileMap,
  onClick,
  canDelete,
  onDelete,
  selectionMode,
  isSelected,
  onToggle,
  showCleanTitle,
  dragEnabled,
}: {
  task: any;
  profileMap: Map<string, string>;
  onClick: () => void;
  canDelete?: boolean;
  onDelete?: () => void;
  selectionMode?: boolean;
  isSelected?: boolean;
  onToggle?: () => void;
  showCleanTitle?: boolean;
  dragEnabled: boolean;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `${TASK_DRAG_PREFIX}${task.id}`,
    disabled: !dragEnabled,
    data: { type: "project-task", taskId: task.id },
  });

  return (
    <div
      ref={setNodeRef}
      {...(dragEnabled ? listeners : {})}
      {...(dragEnabled ? attributes : {})}
      className={cn(
        "flex items-stretch rounded-lg border border-transparent",
        dragEnabled && "cursor-grab active:cursor-grabbing touch-manipulation select-none",
        isDragging && "opacity-50 z-[1] ring-1 ring-primary/50 bg-muted/30"
      )}
    >
      {dragEnabled && (
        <span className="shrink-0 flex items-center pl-1 pr-0.5 text-muted-foreground pointer-events-none" aria-hidden>
          <GripVertical className="h-4 w-4" />
        </span>
      )}
      <div className="flex-1 min-w-0">
        <PhaseTaskRow
          task={task}
          profileMap={profileMap}
          onClick={onClick}
          canDelete={canDelete}
          onDelete={onDelete}
          selectionMode={selectionMode}
          isSelected={isSelected}
          onToggle={onToggle}
          showCleanTitle={showCleanTitle}
          grabCursor={dragEnabled}
        />
      </div>
    </div>
  );
}

function ClosedTasksCollapsible({
  tasks: closedTasks,
  profileMap,
  onTaskClick,
  canDeleteTasks,
  onDeleteTask,
  selectionMode,
  selectedTaskIds,
  onToggleTaskSelection,
  showCleanTitle,
}: {
  tasks: any[];
  profileMap: Map<string, string>;
  onTaskClick: (id: string) => void;
  canDeleteTasks?: boolean;
  onDeleteTask?: (id: string) => void;
  selectionMode?: boolean;
  selectedTaskIds?: Set<string>;
  onToggleTaskSelection?: (id: string) => void;
  showCleanTitle?: boolean;
}) {
  if (closedTasks.length === 0) return null;
  return (
    <Collapsible defaultOpen={false} className="group mt-1 border-t border-border/30 pt-1">
      <CollapsibleTrigger className="flex w-full items-center gap-2 rounded-md px-2 py-2 text-left text-xs font-medium text-muted-foreground hover:bg-muted/40 transition-colors">
        <ChevronRight className="h-3.5 w-3.5 shrink-0 transition-transform duration-200 group-data-[state=open]:rotate-90" />
        Completadas o canceladas ({closedTasks.length})
      </CollapsibleTrigger>
      <CollapsibleContent className="space-y-0.5 pt-1 pb-1">
        {closedTasks.map((t) => (
          <PhaseTaskRow
            key={t.id}
            task={t}
            profileMap={profileMap}
            archived
            onClick={() => onTaskClick(t.id)}
            canDelete={canDeleteTasks}
            onDelete={() => onDeleteTask?.(t.id)}
            selectionMode={selectionMode}
            isSelected={selectedTaskIds?.has(t.id)}
            onToggle={() => onToggleTaskSelection?.(t.id)}
            showCleanTitle={showCleanTitle}
          />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

function DroppablePhaseShell({
  phaseKey,
  className,
  children,
  enabled,
}: {
  phaseKey: string;
  className?: string;
  children: React.ReactNode;
  enabled: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `${DROPPABLE_PREFIX}${phaseKey}`,
    disabled: !enabled,
  });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        className,
        enabled && isOver && "ring-2 ring-primary ring-offset-2 ring-offset-background"
      )}
    >
      {children}
    </div>
  );
}

export function PhaseManager({
  phases, tasks, profileMap, onPhasesChange, onTaskClick, onTaskPhaseAssign, onAddTask,
  canDeleteTasks, onDeleteTask, selectionMode, selectedTaskIds, onToggleTaskSelection,
  renderPhaseFooter, hideBuiltInAddPhase, showTaskDragHint = true,
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
  const unassignedOpen = unassignedTasks.filter((t) => !isTaskClosedStatus(t.status));
  const unassignedClosed = unassignedTasks.filter((t) => isTaskClosedStatus(t.status));

  const flatOpenTasks = phases.length === 0 ? tasks.filter((t) => !isTaskClosedStatus(t.status)) : [];
  const flatClosedTasks = phases.length === 0 ? tasks.filter((t) => isTaskClosedStatus(t.status)) : [];

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

  const showDnd = phases.length > 0 && !!onTaskPhaseAssign;
  const canDragTasks = showDnd && !selectionMode;

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(MouseSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 200, tolerance: 6 } })
  );

  const handleDragEnd = useCallback(
    (e: DragEndEvent) => {
      if (!onTaskPhaseAssign) return;
      const overId = e.over?.id;
      if (overId == null) return;
      const overStr = String(overId);
      if (!overStr.startsWith(DROPPABLE_PREFIX)) return;
      const targetRaw = overStr.slice(DROPPABLE_PREFIX.length);
      const targetKey = targetRaw === "__none__" ? null : targetRaw;

      const activeStr = String(e.active.id);
      if (!activeStr.startsWith(TASK_DRAG_PREFIX)) return;
      const taskId = activeStr.slice(TASK_DRAG_PREFIX.length);

      const task = tasks.find((t) => t.id === taskId);
      if (!task) return;
      const cur = task.phase_key ?? null;
      if (cur === targetKey) return;

      void Promise.resolve(onTaskPhaseAssign(taskId, targetKey)).catch(() => {});
    },
    [onTaskPhaseAssign, tasks]
  );

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={phaseDropCollision}
      onDragEnd={showDnd ? handleDragEnd : () => {}}
    >
    <div className="space-y-3">
      {showDnd && showTaskDragHint ? (
        <p className="text-[11px] text-muted-foreground px-0.5 -mt-1 mb-1">
          Mantén pulsada la fila de la tarea (≈6px) y suéltala sobre la fase destino o sobre «Sin fase asignada». En móvil, mantén presionado un instante antes de arrastrar.
        </p>
      ) : null}
      {sortedPhases.map((phase, idx) => {
        const phaseTasks = tasksByPhase.get(phase.key) || [];
        const openInPhase = phaseTasks.filter((t) => !isTaskClosedStatus(t.status));
        const closedInPhase = phaseTasks.filter((t) => isTaskClosedStatus(t.status));
        const isCollapsed = collapsedPhases.has(phase.key);
        const isEditing = editingPhase === phase.key;
        const progress = phaseProgress(phaseTasks);
        const completedCount = phaseTasks.filter((t) => t.status === "completada").length;
        const colorClass = projectPhaseColorClass(idx);
        const shellClass = `rounded-xl border ${colorClass} overflow-hidden`;
        const phaseFooter = renderPhaseFooter?.(phase.key);

        const phaseBody = (
          <>
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
                    {onAddTask && (
                      <Tooltip>
                        <TooltipTrigger asChild>
                          <Button
                            type="button"
                            size="icon"
                            variant="outline"
                            className="h-7 w-7 shrink-0"
                            onClick={(e) => {
                              e.stopPropagation();
                              onAddTask(phase.key);
                            }}
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </Button>
                        </TooltipTrigger>
                        <TooltipContent side="bottom" className="text-xs">
                          Agregar tarea en esta fase
                        </TooltipContent>
                      </Tooltip>
                    )}
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
              <div className="px-2 pb-2 space-y-2">
                {/* Pie de fase (p. ej. seguimiento de etapa en juicio) y tareas del tablero en el mismo flujo */}
                {phaseFooter}

                {phaseTasks.length > 0 ? (
                  <div className="space-y-0.5">
                    {openInPhase.length === 0 && closedInPhase.length > 0 && (
                      <p className="text-[11px] text-muted-foreground text-center py-2 px-2">
                        No hay tareas en curso en esta fase.
                      </p>
                    )}
                    {openInPhase.map((t) =>
                      showDnd ? (
                        <DraggableOpenTaskRow
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
                          dragEnabled={canDragTasks}
                        />
                      ) : (
                        <PhaseTaskRow
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
                      )
                    )}
                    <ClosedTasksCollapsible
                      tasks={closedInPhase}
                      profileMap={profileMap}
                      onTaskClick={onTaskClick}
                      canDeleteTasks={canDeleteTasks}
                      onDeleteTask={onDeleteTask}
                      selectionMode={selectionMode}
                      selectedTaskIds={selectedTaskIds}
                      onToggleTaskSelection={onToggleTaskSelection}
                      showCleanTitle
                    />
                  </div>
                ) : !phaseFooter ? (
                  <div className="min-h-[72px] flex items-center justify-center px-2 py-3 rounded-lg bg-muted/15">
                    <p className="text-xs text-muted-foreground text-center">
                      Sin tareas en esta fase — suelta aquí una tarea para asignarla
                    </p>
                  </div>
                ) : null}

                {onAddTask && (
                  <Button
                    variant="default"
                    size="sm"
                    className="w-full text-xs font-medium shadow-sm"
                    onClick={() => onAddTask(phase.key)}
                  >
                    <Plus className="h-3.5 w-3.5 mr-1.5" /> Agregar tarea
                  </Button>
                )}
              </div>
            )}
          </>
        );

        return showDnd ? (
          <DroppablePhaseShell key={phase.key} phaseKey={phase.key} enabled className={shellClass}>
            {phaseBody}
          </DroppablePhaseShell>
        ) : (
          <div key={phase.key} className={shellClass}>
            {phaseBody}
          </div>
        );
      })}

      {/* Unassigned tasks — siempre visible con fases para poder soltar y quitar fase */}
      {phases.length > 0 && (
        showDnd ? (
          <DroppablePhaseShell key="__unassigned__" phaseKey="__none__" enabled className="rounded-xl border border-border/50 overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-2.5 bg-muted/30">
              <button type="button" onClick={() => toggleCollapse("__none__")} className="shrink-0">
                {collapsedPhases.has("__none__") ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
              </button>
              <CheckSquare className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
              <span className="text-sm font-medium text-muted-foreground flex-1">Sin fase asignada</span>
              <Badge variant="secondary" className="text-[10px]">{unassignedTasks.length}</Badge>
            </div>
            {!collapsedPhases.has("__none__") && (
              <div className="px-2 pb-2 space-y-0.5">
                {unassignedOpen.length === 0 && unassignedClosed.length === 0 && (
                  <p className="text-xs text-muted-foreground text-center py-4 px-2">
                    Arrastra tareas aquí para quitarles la fase, o desde aquí hacia una fase de arriba.
                  </p>
                )}
                {unassignedOpen.length === 0 && unassignedClosed.length > 0 && (
                  <p className="text-[11px] text-muted-foreground text-center py-2 px-2">No hay tareas en curso sin fase.</p>
                )}
                {unassignedOpen.map((t) => (
                  <DraggableOpenTaskRow
                    key={t.id}
                    task={t}
                    profileMap={profileMap}
                    onClick={() => onTaskClick(t.id)}
                    canDelete={canDeleteTasks}
                    onDelete={() => onDeleteTask?.(t.id)}
                    selectionMode={selectionMode}
                    isSelected={selectedTaskIds?.has(t.id)}
                    onToggle={() => onToggleTaskSelection?.(t.id)}
                    dragEnabled={canDragTasks}
                  />
                ))}
                <ClosedTasksCollapsible
                  tasks={unassignedClosed}
                  profileMap={profileMap}
                  onTaskClick={onTaskClick}
                  canDeleteTasks={canDeleteTasks}
                  onDeleteTask={onDeleteTask}
                  selectionMode={selectionMode}
                  selectedTaskIds={selectedTaskIds}
                  onToggleTaskSelection={onToggleTaskSelection}
                />
                {onAddTask && (
                  <Button variant="outline" size="sm" className="w-full mt-2 text-xs" onClick={() => onAddTask()}>
                    <Plus className="h-3 w-3 mr-1" /> Agregar tarea sin fase
                  </Button>
                )}
              </div>
            )}
          </DroppablePhaseShell>
        ) : (
          (unassignedTasks.length > 0 ? (
            <div key="unassigned-no-dnd" className="rounded-xl border border-border/50 overflow-hidden">
              <div className="flex items-center gap-2 px-3 py-2.5 bg-muted/30">
                <button type="button" onClick={() => toggleCollapse("__none__")} className="shrink-0">
                  {collapsedPhases.has("__none__") ? <ChevronRight className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                </button>
                <CheckSquare className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                <span className="text-sm font-medium text-muted-foreground flex-1">Sin fase asignada</span>
                <Badge variant="secondary" className="text-[10px]">{unassignedTasks.length}</Badge>
              </div>
              {!collapsedPhases.has("__none__") && (
                <div className="px-2 pb-2 space-y-0.5">
                  {unassignedOpen.length === 0 && unassignedClosed.length > 0 && (
                    <p className="text-[11px] text-muted-foreground text-center py-2 px-2">No hay tareas en curso sin fase.</p>
                  )}
                  {unassignedOpen.map((t) => (
                    <PhaseTaskRow
                      key={t.id} task={t} profileMap={profileMap} onClick={() => onTaskClick(t.id)}
                      canDelete={canDeleteTasks} onDelete={() => onDeleteTask?.(t.id)}
                      selectionMode={selectionMode} isSelected={selectedTaskIds?.has(t.id)}
                      onToggle={() => onToggleTaskSelection?.(t.id)}
                    />
                  ))}
                  <ClosedTasksCollapsible
                    tasks={unassignedClosed}
                    profileMap={profileMap}
                    onTaskClick={onTaskClick}
                    canDeleteTasks={canDeleteTasks}
                    onDeleteTask={onDeleteTask}
                    selectionMode={selectionMode}
                    selectedTaskIds={selectedTaskIds}
                    onToggleTaskSelection={onToggleTaskSelection}
                  />
                  {onAddTask && (
                    <Button variant="outline" size="sm" className="w-full mt-2 text-xs" onClick={() => onAddTask()}>
                      <Plus className="h-3 w-3 mr-1" /> Agregar tarea sin fase
                    </Button>
                  )}
                </div>
              )}
            </div>
          ) : null)
        )
      )}

      {/* No phases: flat list */}
      {phases.length === 0 && (
        <div className="space-y-0.5">
          {flatOpenTasks.length === 0 && flatClosedTasks.length > 0 && (
            <p className="text-[11px] text-muted-foreground text-center py-2">No hay tareas en curso.</p>
          )}
          {flatOpenTasks.map((t) => (
            <PhaseTaskRow
              key={t.id} task={t} profileMap={profileMap} onClick={() => onTaskClick(t.id)}
              canDelete={canDeleteTasks} onDelete={() => onDeleteTask?.(t.id)}
              selectionMode={selectionMode} isSelected={selectedTaskIds?.has(t.id)}
              onToggle={() => onToggleTaskSelection?.(t.id)}
            />
          ))}
          <ClosedTasksCollapsible
            tasks={flatClosedTasks}
            profileMap={profileMap}
            onTaskClick={onTaskClick}
            canDeleteTasks={canDeleteTasks}
            onDeleteTask={onDeleteTask}
            selectionMode={selectionMode}
            selectedTaskIds={selectedTaskIds}
            onToggleTaskSelection={onToggleTaskSelection}
          />
        </div>
      )}

      {/* Add phase button */}
      {!hideBuiltInAddPhase && (addingPhase ? (
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
      ))}
    </div>
    </DndContext>
  );
}
