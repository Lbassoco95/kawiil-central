import { useRef } from "react";
import { Calendar, User, Trash2, MessageSquare, Paperclip } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Progress } from "@/components/ui/progress";
import { useUpdateTask } from "@/hooks/useTasks";
import { TASK_STATUS_CONFIG } from "@/lib/statusStyles";
import { formatMX, isPastDueCalendarMX } from "@/lib/dateUtils";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { Task } from "@/hooks/useTasks";

interface TaskRowProps {
  task: Task;
  areaLabel?: string;
  areaColor?: string;
  assigneeName?: string | null;
  onOpen: (task: Task) => void;
  onDelete?: () => void;
  canDelete?: boolean;
}

const statusLabels = TASK_STATUS_CONFIG;

function priorityBarClass(priority: string) {
  switch (priority) {
    case "urgente":
      return "before:bg-destructive";
    case "alta":
      return "before:bg-amber-500";
    case "media":
      return "before:bg-sky-500";
    default:
      return "before:bg-muted-foreground/30";
  }
}

function getDateColor(dateStr: string) {
  const d = new Date(dateStr);
  const now = new Date();
  const weekFromNow = new Date();
  weekFromNow.setDate(weekFromNow.getDate() + 7);
  if (d < now) return "text-destructive font-medium";
  if (d <= weekFromNow) return "text-amber-600 dark:text-amber-400 font-medium";
  return "text-muted-foreground";
}

function checklistProgress(task: Task): { done: number; total: number; pct: number } | null {
  const checklist = (task as any).checklist as Array<{ completed?: boolean }> | undefined;
  if (!Array.isArray(checklist) || checklist.length === 0) return null;
  const total = checklist.length;
  const done = checklist.filter((i) => i?.completed).length;
  const pct = Math.round((done / total) * 100);
  return { done, total, pct };
}

export function TaskRow({
  task,
  areaLabel,
  areaColor,
  assigneeName,
  onOpen,
  onDelete,
  canDelete,
}: TaskRowProps) {
  const updateTask = useUpdateTask();
  const undoSnapshotStatus = useRef<string | null>(null);

  const handleComplete = (e: React.MouseEvent | React.KeyboardEvent) => {
    e.stopPropagation();
    if (task.status === "completada") return;
    undoSnapshotStatus.current = task.status;
    updateTask.mutate(
      { id: task.id, status: "completada" } as any,
      {
        onSuccess: () => {
          toast.success("Tarea completada", {
            description: task.title,
            action: undoSnapshotStatus.current
              ? {
                  label: "Deshacer",
                  onClick: () =>
                    updateTask.mutate({
                      id: task.id,
                      status: undoSnapshotStatus.current!,
                    } as any),
                }
              : undefined,
            duration: 5000,
          });
        },
        onError: (err: Error) => toast.error(err.message),
      },
    );
  };

  const progress = checklistProgress(task);
  const overdue = task.due_date ? isPastDueCalendarMX(task.due_date) : false;
  const status = statusLabels[task.status];

  const commentsCount = (task as any).comments_count;
  const attachmentsCount = ((task as any).dropbox_links?.length || 0);

  return (
    <div
      onClick={() => onOpen(task)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === "Enter") onOpen(task);
      }}
      className={cn(
        "group relative flex items-start gap-3 rounded-xl border border-border/60 bg-card px-4 py-3 cursor-pointer",
        "transition-all duration-150 hover:border-border hover:shadow-md hover:-translate-y-px",
        "before:absolute before:left-0 before:top-2 before:bottom-2 before:w-[3px] before:rounded-full",
        priorityBarClass(task.priority),
        overdue && "ring-1 ring-destructive/20",
      )}
    >
      <div className="pt-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
        <Checkbox
          checked={task.status === "completada"}
          onCheckedChange={() => handleComplete({ stopPropagation: () => {} } as any)}
          className="h-4 w-4"
          aria-label="Marcar como completada"
        />
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <h3
            className={cn(
              "text-sm font-medium text-foreground truncate max-w-full",
              task.status === "completada" && "line-through text-muted-foreground",
            )}
          >
            {task.title}
          </h3>
          {(task as any).criticality_level === "critico" && (
            <span className="text-[10px]" title="Crítico">🔴</span>
          )}
          {(task as any).criticality_level === "atencion" && (
            <span className="text-[10px]" title="Atención">🟡</span>
          )}
        </div>

        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {status && (
            <Badge
              variant="secondary"
              className={cn("text-[10px] border-0 px-1.5 py-0", status.color)}
            >
              {status.label}
            </Badge>
          )}
          {areaLabel && (
            <span className="inline-flex items-center gap-1.5 rounded bg-secondary/60 px-1.5 py-0.5 text-[10px] text-muted-foreground">
              <span
                className="inline-block h-1.5 w-1.5 rounded-full"
                style={{ background: areaColor || "hsl(var(--primary))" }}
              />
              {areaLabel}
            </span>
          )}
          {(task as any).clients?.name && (
            <span className="text-[10.5px] text-muted-foreground/80 truncate max-w-[160px]">
              {(task as any).clients.name}
            </span>
          )}
          {(task as any).projects?.name && (
            <span className="text-[10.5px] text-muted-foreground/70 truncate max-w-[140px]">
              · {(task as any).projects.name}
            </span>
          )}
          {assigneeName ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <User className="h-3 w-3" />
              {assigneeName}
            </span>
          ) : (
            <span className="text-[11px] font-medium text-destructive/70">Sin responsable</span>
          )}
          {commentsCount ? (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <MessageSquare className="h-3 w-3" />
              {commentsCount}
            </span>
          ) : null}
          {attachmentsCount > 0 && (
            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
              <Paperclip className="h-3 w-3" />
              {attachmentsCount}
            </span>
          )}
        </div>

        {progress && (
          <div className="mt-2 flex items-center gap-2">
            <Progress value={progress.pct} className="h-1.5 flex-1 max-w-[160px]" />
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {progress.done}/{progress.total} subtareas
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0 self-center">
        {task.due_date && (
          <span className={cn("inline-flex items-center gap-1 text-xs", getDateColor(task.due_date))}>
            <Calendar className="h-3 w-3" />
            {formatMX(task.due_date, "dd MMM")}
          </span>
        )}
        {canDelete && onDelete && (
          <button
            className="p-1 rounded text-muted-foreground/30 hover:text-destructive transition-colors opacity-0 group-hover:opacity-100"
            onClick={(e) => {
              e.stopPropagation();
              onDelete();
            }}
            aria-label="Eliminar tarea"
          >
            <Trash2 className="h-3.5 w-3.5" />
          </button>
        )}
      </div>
    </div>
  );
}
