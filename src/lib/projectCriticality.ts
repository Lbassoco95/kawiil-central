import { isPastDueCalendarMX } from "@/lib/dateUtils";
import { isTaskClosedStatus } from "@/lib/taskStatusGroups";
import {
  complianceAnchorYmdFromProject,
  complianceDueDateIsActionable,
} from "@/lib/complianceDueDates";

export type Criticality = "normal" | "atencion" | "critico";

interface TaskLike {
  status: string;
  due_date?: string | null;
}

interface ProjectLike {
  start_date?: string | null;
  created_at?: string | null;
  end_date?: string | null;
}

/**
 * Deriva el semáforo del proyecto (normal / atención / crítico) a partir de las
 * tareas, en lugar de fijarlo a mano. Alineado con ProjectDelayPredictorCard:
 *  - 🔴 crítico: 6+ tareas vencidas
 *  - 🟡 atención: alguna tarea vencida, fecha objetivo ya pasada con trabajo abierto,
 *                 o 3+ tareas en revisión (bloqueos)
 *  - 🟢 normal: al corriente (o sin tareas abiertas)
 *
 * "Vencida" solo cuenta cuando la fecha es accionable respecto al ancla del
 * proyecto (misma regla que el predictor y los semáforos de cumplimiento).
 */
export function computeAutoCriticality(project: ProjectLike, tasks: TaskLike[]): Criticality {
  const open = tasks.filter((t) => !isTaskClosedStatus(t.status));
  if (open.length === 0) return "normal";

  const anchor = complianceAnchorYmdFromProject(project.start_date ?? null, project.created_at ?? null);
  const overdue = open.filter(
    (t) =>
      t.due_date &&
      complianceDueDateIsActionable(t.due_date, anchor) &&
      isPastDueCalendarMX(t.due_date),
  );
  const inReview = open.filter((t) => t.status === "en_revision");
  const endPassed = project.end_date ? isPastDueCalendarMX(project.end_date) : false;

  if (overdue.length >= 6) return "critico";
  if (overdue.length >= 1) return "atencion";
  if (endPassed) return "atencion";
  if (inReview.length >= 3) return "atencion";
  return "normal";
}
