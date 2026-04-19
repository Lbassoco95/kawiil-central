import { useRef } from "react";
import { Calendar, Trash2, MessageSquare, Paperclip } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
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

type DueKind = "overdue" | "today" | "soon" | "future" | null;

function classifyDue(dateStr?: string | null): DueKind {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return null;
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const tomorrowStart = new Date(todayStart);
  tomorrowStart.setDate(tomorrowStart.getDate() + 1);
  const weekFromNow = new Date(todayStart);
  weekFromNow.setDate(weekFromNow.getDate() + 7);

  if (isPastDueCalendarMX(dateStr)) return "overdue";
  if (d >= todayStart && d < tomorrowStart) return "today";
  if (d <= weekFromNow) return "soon";
  return "future";
}

const DUE_PILL_STYLES: Record<Exclude<DueKind, null>, string> = {
  overdue:
    "bg-destructive/12 text-destructive ring-1 ring-destructive/25 font-semibold",
  today:
    "bg-warning/15 text-warning-foreground ring-1 ring-warning/30 font-medium",
  soon: "bg-amber-500/10 text-amber-600 ring-1 ring-amber-500/25 dark:text-amber-300",
  future: "bg-muted/50 text-muted-foreground",
};

const DUE_LABEL: Record<Exclude<DueKind, null>, string | null> = {
  overdue: "Vencida",
  today: "Hoy",
  soon: null,
  future: null,
};

function checklistProgress(task: Task): { done: number; total: number; pct: number } | null {
  const checklist = (task as any).checklist as Array<{ completed?: boolean }> | undefined;
  if (!Array.isArray(checklist) || checklist.length === 0) return null;
  const total = checklist.length;
  const done = checklist.filter((i) => i?.completed).length;
  const pct = Math.round((done / total) * 100);
  return { done, total, pct };
}

function initialsOf(name?: string | null): string {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function avatarGradient(seed?: string | null): string {
  // Pequeño hash para variar el gradient por persona, manteniendo paleta de marca.
  const palette = [
    ["hsl(var(--primary))", "hsl(var(--accent))"],
    ["hsl(var(--accent))", "hsl(var(--primary))"],
    ["hsl(217 91% 60%)", "hsl(262 83% 58%)"],
    ["hsl(157 72% 36%)", "hsl(199 89% 48%)"],
    ["hsl(38 92% 50%)", "hsl(25 95% 53%)"],
  ];
  let idx = 0;
  if (seed) {
    let h = 0;
    for (let i = 0; i < seed.length; i += 1) {
      h = (h * 31 + seed.charCodeAt(i)) >>> 0;
    }
    idx = h % palette.length;
  }
  const [from, to] = palette[idx];
  return `linear-gradient(135deg, ${from}, ${to})`;
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
  const dueKind = classifyDue(task.due_date);
  const overdue = dueKind === "overdue";
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
            <span
              className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground"
              title={assigneeName}
            >
              <span
                className="grid h-5 w-5 place-items-center rounded-full text-[9px] font-semibold uppercase text-white shadow-sm ring-1 ring-border/40"
                style={{ background: avatarGradient(assigneeName) }}
                aria-hidden
              >
                {initialsOf(assigneeName)}
              </span>
              <span className="truncate max-w-[120px]">{assigneeName}</span>
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
            <div
              className="relative h-1 w-[80px] overflow-hidden rounded-full bg-muted/60"
              role="progressbar"
              aria-valuenow={progress.pct}
              aria-valuemin={0}
              aria-valuemax={100}
              aria-label="Progreso de subtareas"
            >
              <div
                className="absolute inset-y-0 left-0 rounded-full"
                style={{
                  width: `${progress.pct}%`,
                  background:
                    "linear-gradient(90deg, hsl(var(--primary)), hsl(var(--accent)))",
                }}
              />
            </div>
            <span className="text-[10px] tabular-nums text-muted-foreground">
              {progress.done}/{progress.total} subtareas · {progress.pct}%
            </span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2 shrink-0 self-center">
        {task.due_date && dueKind && (
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]",
              DUE_PILL_STYLES[dueKind],
            )}
          >
            <Calendar className="h-3 w-3" />
            {DUE_LABEL[dueKind]
              ? `${DUE_LABEL[dueKind]} · ${formatMX(task.due_date, "dd MMM")}`
              : formatMX(task.due_date, "dd MMM")}
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
