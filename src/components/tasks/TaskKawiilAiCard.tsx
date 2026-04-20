import { Sparkles, Zap, Clock, AlertTriangle } from "lucide-react";
import { KAWIIL_AI_GRADIENT, KAWIIL_AI_SOFT_BG } from "@/lib/kawiilAi";
import { isPastDueCalendarMX, formatMX } from "@/lib/dateUtils";
import { isTaskClosedStatus } from "@/lib/taskStatusGroups";
import { useTaskDependencies } from "@/hooks/useTaskDependencies";

interface SubtaskLike {
  id: string;
  status: string;
}

interface Props {
  task: {
    id: string;
    title: string;
    status: string;
    priority: string;
    due_date: string | null;
    estimated_hours?: number | null;
    time_spent_seconds?: number | null;
    criticality_level?: string | null;
  };
  subtasks: SubtaskLike[];
  onEscalate?: () => void;
  onPostpone?: () => void;
}

/**
 * Kawiil AI inline card para el sidebar del TaskDetailDialog v2.5.
 * Genera frase contextual heurística (sin LLM) basada en vencimiento, subtareas,
 * dependencias bloqueantes y horas. Acciones rápidas: Escalar / Posponer.
 */
export function TaskKawiilAiCard({ task, subtasks, onEscalate, onPostpone }: Props) {
  const { dependsOn } = useTaskDependencies(task.id);
  const blockingOpen = dependsOn.filter(
    (d) => d.related_task && !isTaskClosedStatus(d.related_task.status)
  ).length;

  const overdue = task.due_date && isPastDueCalendarMX(task.due_date);
  const subtaskTotal = subtasks.length;
  const subtaskClosed = subtasks.filter((s) => isTaskClosedStatus(s.status)).length;
  const subtaskOpen = subtaskTotal - subtaskClosed;
  const estimated = task.estimated_hours ?? 0;
  const registered = (task.time_spent_seconds ?? 0) / 3600;
  const overBudget = estimated > 0 && registered > estimated;

  const lines: string[] = [];
  if (overdue) {
    const dueStr = formatMX(task.due_date!, "dd MMM");
    lines.push(`Esta tarea está vencida desde el ${dueStr}.`);
  } else if (task.due_date) {
    lines.push(`Vence el ${formatMX(task.due_date, "dd MMM")}.`);
  }
  if (subtaskTotal > 0) {
    lines.push(
      subtaskOpen === 0
        ? `Las ${subtaskTotal} subtareas están completas, lista para cerrar.`
        : `Quedan ${subtaskOpen} de ${subtaskTotal} subtareas pendientes.`
    );
  }
  if (blockingOpen > 0) {
    lines.push(
      `${blockingOpen} dependencia${blockingOpen === 1 ? "" : "s"} bloqueante${
        blockingOpen === 1 ? " sigue abierta" : "s siguen abiertas"
      }.`
    );
  }
  if (overBudget) {
    lines.push(
      `Llevas ${registered.toFixed(1)}h vs ${estimated.toFixed(1)}h estimadas — revisar alcance.`
    );
  }
  if (lines.length === 0) {
    lines.push("Sin alertas. La tarea va al día con su responsable principal.");
  }

  const showEscalate = (overdue || blockingOpen > 0) && !!onEscalate;
  const showPostpone = !!onPostpone && !!task.due_date;

  return (
    <div
      className="rounded-xl border border-sky-200/60 dark:border-sky-500/30 overflow-hidden"
      style={{ background: KAWIIL_AI_SOFT_BG }}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b border-sky-200/60 dark:border-sky-500/30">
        <span
          className="inline-flex h-5 w-5 items-center justify-center rounded-md text-white"
          style={{ background: KAWIIL_AI_GRADIENT }}
        >
          <Sparkles className="h-3 w-3" />
        </span>
        <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-sky-700 dark:text-sky-300">
          Kawiil IA
        </span>
        <span className="ml-auto text-[9px] font-medium text-sky-700/80 dark:text-sky-300/80">
          v2.5
        </span>
      </div>
      <div className="px-3 py-2.5 space-y-2">
        <p className="text-[12px] leading-snug text-foreground/85">
          {lines.join(" ")}
        </p>
        {(showEscalate || showPostpone) && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {showEscalate && (
              <button
                type="button"
                onClick={onEscalate}
                className="inline-flex items-center gap-1 rounded-md bg-white/80 dark:bg-white/10 border border-sky-300/60 px-2 py-1 text-[10px] font-medium text-sky-700 dark:text-sky-200 hover:bg-white"
              >
                <AlertTriangle className="h-2.5 w-2.5" /> Escalar
              </button>
            )}
            {showPostpone && (
              <button
                type="button"
                onClick={onPostpone}
                className="inline-flex items-center gap-1 rounded-md bg-white/80 dark:bg-white/10 border border-sky-300/60 px-2 py-1 text-[10px] font-medium text-sky-700 dark:text-sky-200 hover:bg-white"
              >
                <Clock className="h-2.5 w-2.5" /> Posponer
              </button>
            )}
            <span className="ml-auto inline-flex items-center gap-1 text-[10px] text-sky-700/70 dark:text-sky-300/70">
              <Zap className="h-2.5 w-2.5" /> Heurística local
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
