import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { Sparkles, AlertTriangle, CheckCircle2, Clock, ArrowRight } from "lucide-react";
import { isTaskClosedStatus } from "@/lib/taskStatusGroups";
import { isPastDueCalendarMX } from "@/lib/dateUtils";
import {
  KAWIIL_AI_GRADIENT,
  KAWIIL_AI_SOFT_BG,
  KAWIIL_AI_TEXT_GRADIENT_CLASS,
} from "@/lib/kawiilAi";
import { cn } from "@/lib/utils";

interface Props {
  projectId: string;
  projectName: string;
  status: string;
  endDate?: string | null;
  criticalityLevel?: string | null;
  /** Variant compact = sidebar; full = dentro del tab. */
  variant?: "compact" | "full";
}

interface TaskLite {
  id: string;
  status: string;
  due_date: string | null;
  priority: string;
}

/**
 * Mini-card heurística de Kawiil AI para proyectos. NO consume tokens de LLM:
 * sólo lee tareas del proyecto y deriva 2-4 frases accionables.
 *
 * Para análisis profundo seguimos usando `AISummaryCard` (con LLM) en la pestaña General.
 */
export function ProjectKawiilAiCard({
  projectId,
  projectName,
  status,
  endDate,
  criticalityLevel,
  variant = "compact",
}: Props) {
  const { user } = useAuth();
  const { data: tasks = [] } = useQuery<TaskLite[]>({
    queryKey: ["project-ai-tasks", projectId],
    enabled: !!user && !!projectId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("tasks")
        .select("id, status, due_date, priority")
        .eq("project_id", projectId);
      if (error) throw error;
      return (data ?? []) as TaskLite[];
    },
  });

  const insights = useMemo(() => {
    const total = tasks.length;
    const closed = tasks.filter((t) => isTaskClosedStatus(t.status)).length;
    const open = total - closed;
    const overdue = tasks.filter(
      (t) => !isTaskClosedStatus(t.status) && t.due_date && isPastDueCalendarMX(t.due_date),
    ).length;
    const urgent = tasks.filter(
      (t) => !isTaskClosedStatus(t.status) && (t.priority === "urgente" || t.priority === "alta"),
    ).length;
    const pct = total > 0 ? Math.round((closed / total) * 100) : 0;
    const projectOverdue = endDate ? isPastDueCalendarMX(endDate) && status !== "completado" : false;

    const lines: { tone: "ok" | "warn" | "danger"; text: string }[] = [];

    if (projectOverdue) {
      lines.push({
        tone: "danger",
        text: `Fecha de cierre vencida. Reagenda o sube semáforo a crítico.`,
      });
    }
    if (overdue > 0) {
      lines.push({
        tone: "danger",
        text: `${overdue} tarea${overdue > 1 ? "s" : ""} vencida${overdue > 1 ? "s" : ""}. Atender hoy.`,
      });
    }
    if (criticalityLevel === "critico") {
      lines.push({
        tone: "danger",
        text: `Semáforo crítico activo. Considera reunión de coordinación.`,
      });
    } else if (criticalityLevel === "atencion" && lines.length === 0) {
      lines.push({
        tone: "warn",
        text: `Semáforo en atención. Revisa bloqueos antes del próximo hito.`,
      });
    }
    if (urgent > 0 && lines.length < 2) {
      lines.push({
        tone: "warn",
        text: `${urgent} tarea${urgent > 1 ? "s" : ""} de prioridad alta o urgente sin cerrar.`,
      });
    }
    if (open > 0 && lines.length < 3) {
      lines.push({
        tone: "ok",
        text: `${open} tarea${open > 1 ? "s" : ""} en curso · ${pct}% del proyecto avanzado.`,
      });
    }
    if (lines.length === 0) {
      lines.push({
        tone: "ok",
        text: `Sin alertas. Mantén el ritmo y registra avances.`,
      });
    }

    return { lines, pct, total, closed, open, overdue };
  }, [tasks, endDate, status, criticalityLevel]);

  const compact = variant === "compact";

  return (
    <section
      className={cn(
        "rounded-lg border overflow-hidden",
        compact ? "" : "shadow-sm",
      )}
      style={{ background: KAWIIL_AI_SOFT_BG }}
    >
      <header
        className="flex items-center gap-2 px-3 py-2 text-white"
        style={{ background: KAWIIL_AI_GRADIENT }}
      >
        <Sparkles className="h-3.5 w-3.5" />
        <span className="text-[11px] font-semibold uppercase tracking-wider">Kawiil AI · Proyecto</span>
        <span className={cn("ml-auto text-[10px] font-medium opacity-90")}>
          {insights.pct}%
        </span>
      </header>
      <div className={cn("p-3 space-y-2", compact ? "text-xs" : "text-sm")}>
        <p className="text-[11px] text-muted-foreground line-clamp-1" title={projectName}>
          {projectName}
        </p>
        <ul className="space-y-1.5">
          {insights.lines.map((l, i) => {
            const Icon = l.tone === "danger" ? AlertTriangle : l.tone === "warn" ? Clock : CheckCircle2;
            const cls =
              l.tone === "danger"
                ? "text-red-600 dark:text-red-400"
                : l.tone === "warn"
                  ? "text-amber-600 dark:text-amber-400"
                  : "text-emerald-600 dark:text-emerald-400";
            return (
              <li key={i} className="flex gap-1.5">
                <Icon className={cn("h-3.5 w-3.5 mt-0.5 shrink-0", cls)} />
                <span className="text-foreground/85 leading-snug">{l.text}</span>
              </li>
            );
          })}
        </ul>
        <div className="grid grid-cols-3 gap-1 pt-1.5 border-t border-border/40 text-center">
          <div>
            <p className={cn("text-base font-semibold tabular-nums", KAWIIL_AI_TEXT_GRADIENT_CLASS)}>
              {insights.total}
            </p>
            <p className="text-[10px] text-muted-foreground">Total</p>
          </div>
          <div>
            <p className="text-base font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">
              {insights.closed}
            </p>
            <p className="text-[10px] text-muted-foreground">Cerradas</p>
          </div>
          <div>
            <p
              className={cn(
                "text-base font-semibold tabular-nums",
                insights.overdue > 0
                  ? "text-red-600 dark:text-red-400"
                  : "text-foreground/80",
              )}
            >
              {insights.overdue}
            </p>
            <p className="text-[10px] text-muted-foreground">Vencidas</p>
          </div>
        </div>
        {!compact && (
          <p className="text-[10px] text-muted-foreground inline-flex items-center gap-1 pt-1">
            Para análisis con LLM completo, usa el card "Resumen del proyecto"
            <ArrowRight className="h-2.5 w-2.5" />
          </p>
        )}
      </div>
    </section>
  );
}
