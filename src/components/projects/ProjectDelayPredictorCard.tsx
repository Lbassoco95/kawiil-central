import { useMemo } from "react";
import {
  AlertTriangle,
  Activity,
  CalendarClock,
  CheckCircle2,
  Gauge,
  Hourglass,
  TrendingUp,
  Zap,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { isPastDueCalendarMX, formatDateMX } from "@/lib/dateUtils";
import {
  complianceAnchorYmdFromProject,
  complianceDueDateIsActionable,
} from "@/lib/complianceDueDates";
import { useMexicoToday } from "@/hooks/useMexicoToday";
import type { Tables } from "@/integrations/supabase/types";

type Task = Tables<"tasks">;
type Project = Tables<"projects">;

interface Props {
  project: Project;
  tasks: Task[];
}

type RiskLevel = "on_track" | "at_risk" | "delayed" | "critical";

interface Factor {
  key: string;
  label: string;
  value: string;
  Icon: typeof Gauge;
  tone: "good" | "warning" | "bad" | "neutral";
}

/**
 * Predictor determinístico de retraso de proyecto basado en:
 *  - Velocity = tareas completadas en últimas 4 semanas / 4
 *  - ETA = (tareas abiertas / velocity) semanas → fecha proyectada
 *  - Comparación contra end_date del proyecto
 *  - Tareas vencidas y bloqueos en revisión
 *
 * Sin llamadas a IA. Recalcula al instante con cada cambio en las tareas.
 */
export function ProjectDelayPredictorCard({ project, tasks }: Props) {
  const today = useMexicoToday();

  const data = useMemo(() => {
    const projectAnchorYmd = complianceAnchorYmdFromProject(project.start_date, project.created_at);

    const open = tasks.filter((t) => !isTaskClosedStatus(t.status));
    const closed = tasks.filter((t) => isTaskClosedStatus(t.status) && t.status === "completada");
    const overdue = open.filter(
      (t) =>
        t.due_date &&
        complianceDueDateIsActionable(t.due_date, projectAnchorYmd) &&
        isPastDueCalendarMX(t.due_date),
    );
    const inReview = open.filter((t) => t.status === "en_revision");
    const fourWeeksAgo = today.getTime() - 28 * 24 * 60 * 60 * 1000;
    const completedRecent = closed.filter((t) => {
      const ts = new Date((t as any).completed_at || t.updated_at || t.created_at).getTime();
      return ts >= fourWeeksAgo;
    });

    const velocityPerWeek = completedRecent.length / 4;
    const totalTasks = tasks.length;
    const progressPct = totalTasks > 0 ? Math.round((closed.length / totalTasks) * 100) : 0;

    let etaDate: Date | null = null;
    let etaDaysFromNow: number | null = null;
    if (open.length > 0 && velocityPerWeek > 0) {
      const weeksRemaining = open.length / velocityPerWeek;
      etaDaysFromNow = Math.ceil(weeksRemaining * 7);
      etaDate = new Date(today.getTime() + etaDaysFromNow * 24 * 60 * 60 * 1000);
    }

    const endDateStr = project.end_date;
    const endDate = endDateStr ? new Date(endDateStr) : null;

    let risk: RiskLevel = "on_track";
    let summary: string;
    let deltaDaysVsTarget: number | null = null;

    if (open.length === 0) {
      risk = "on_track";
      summary = "Todas las tareas del tablero están cerradas. Proyecto al corriente.";
    } else if (velocityPerWeek === 0) {
      risk = closed.length === 0 ? "at_risk" : "delayed";
      summary = closed.length === 0
        ? "Sin tareas completadas todavía. Aún no hay velocidad medible."
        : "Sin avance en las últimas 4 semanas. Velocidad estancada.";
    } else if (endDate) {
      deltaDaysVsTarget = etaDate ? Math.round((etaDate.getTime() - endDate.getTime()) / (1000 * 60 * 60 * 24)) : null;
      if (deltaDaysVsTarget !== null) {
        if (deltaDaysVsTarget <= -7) {
          risk = "on_track";
          summary = `Proyectado a terminar ~${Math.abs(deltaDaysVsTarget)} día${Math.abs(deltaDaysVsTarget) === 1 ? "" : "s"} antes de la fecha objetivo.`;
        } else if (deltaDaysVsTarget <= 7) {
          risk = "at_risk";
          summary = "Proyectado cerca de la fecha objetivo. Margen muy ajustado.";
        } else if (deltaDaysVsTarget <= 21) {
          risk = "delayed";
          summary = `Estimación supera la fecha objetivo por ${deltaDaysVsTarget} días.`;
        } else {
          risk = "critical";
          summary = `Riesgo alto: estimación supera la fecha objetivo por ${deltaDaysVsTarget} días.`;
        }
      } else {
        risk = "at_risk";
        summary = "No hay datos suficientes para estimar fecha. Revisa la carga del proyecto.";
      }
    } else {
      risk = etaDaysFromNow && etaDaysFromNow > 90 ? "delayed" : "at_risk";
      summary = etaDate
        ? `Sin fecha objetivo definida. Estimación de cierre: ${formatDateMX(etaDate.toISOString())}.`
        : "Sin fecha objetivo y sin velocidad medible. Define un end_date para proyectar.";
    }

    if (overdue.length >= 3 && (risk === "on_track" || risk === "at_risk")) risk = "delayed";
    if (overdue.length >= 6) risk = "critical";

    const factors: Factor[] = [
      {
        key: "velocity",
        label: "Velocidad (4 sem.)",
        value: velocityPerWeek === 0 ? "0 tareas/sem" : `${velocityPerWeek.toFixed(1)} tareas/sem`,
        Icon: Zap,
        tone: velocityPerWeek === 0 ? "bad" : velocityPerWeek >= 2 ? "good" : "warning",
      },
      {
        key: "open",
        label: "Tareas abiertas",
        value: `${open.length}`,
        Icon: Hourglass,
        tone: open.length === 0 ? "good" : open.length > 20 ? "bad" : "neutral",
      },
      {
        key: "overdue",
        label: "Vencidas",
        value: `${overdue.length}`,
        Icon: AlertTriangle,
        tone: overdue.length === 0 ? "good" : overdue.length >= 3 ? "bad" : "warning",
      },
      {
        key: "review",
        label: "En revisión (bloqueos)",
        value: `${inReview.length}`,
        Icon: Activity,
        tone: inReview.length === 0 ? "neutral" : inReview.length >= 3 ? "warning" : "neutral",
      },
      {
        key: "progress",
        label: "Progreso",
        value: `${progressPct}%`,
        Icon: CheckCircle2,
        tone: progressPct >= 70 ? "good" : progressPct >= 30 ? "warning" : "bad",
      },
    ];

    return {
      risk,
      summary,
      etaDate,
      etaDaysFromNow,
      endDate,
      deltaDaysVsTarget,
      velocityPerWeek,
      progressPct,
      open,
      closed,
      overdue,
      inReview,
      factors,
    };
  }, [tasks, project, today]);

  const riskTone =
    data.risk === "on_track"
      ? { ring: "ring-emerald-500/30", text: "text-emerald-700 dark:text-emerald-400", bar: "bg-emerald-500", chip: "bg-emerald-500/10", label: "En tiempo" }
      : data.risk === "at_risk"
        ? { ring: "ring-amber-500/30", text: "text-amber-700 dark:text-amber-400", bar: "bg-amber-500", chip: "bg-amber-500/10", label: "En riesgo" }
        : data.risk === "delayed"
          ? { ring: "ring-orange-500/30", text: "text-orange-700 dark:text-orange-400", bar: "bg-orange-500", chip: "bg-orange-500/10", label: "Atrasado" }
          : { ring: "ring-destructive/40", text: "text-destructive", bar: "bg-destructive", chip: "bg-destructive/10", label: "Crítico" };

  return (
    <section
      className={cn(
        "glass-card relative overflow-hidden p-5 ring-1",
        riskTone.ring,
      )}
    >
      <div className="flex items-start gap-4">
        <div
          className={cn(
            "grid h-16 w-16 shrink-0 place-items-center rounded-2xl ring-1 ring-inset ring-border/30",
            riskTone.chip,
          )}
        >
          <Gauge className={cn("h-7 w-7", riskTone.text)} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="text-sm font-medium text-muted-foreground">Predictor de retraso</h2>
            <span className={cn("ml-1 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide", riskTone.text)}>
              <TrendingUp className="h-3.5 w-3.5" />
              {riskTone.label}
            </span>
            {data.etaDate && (
              <span className="ml-auto inline-flex items-center gap-1 rounded-md border border-border/50 bg-background/60 px-2 py-0.5 text-[11px] tabular-nums text-foreground">
                <CalendarClock className="h-3 w-3 text-muted-foreground" />
                ETA: {formatDateMX(data.etaDate.toISOString())}
              </span>
            )}
          </div>

          <div className="mt-2 h-1.5 rounded-full bg-secondary/40 overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all", riskTone.bar)}
              style={{ width: `${data.progressPct}%` }}
            />
          </div>

          <p className="mt-2 text-[12.5px] text-muted-foreground leading-snug">{data.summary}</p>

          {data.endDate && (
            <p className="mt-1 text-[11px] text-muted-foreground">
              Fecha objetivo: <strong className="text-foreground">{formatDateMX(data.endDate.toISOString())}</strong>
              {data.deltaDaysVsTarget !== null && (
                <span className={cn("ml-1.5 font-medium", riskTone.text)}>
                  ({data.deltaDaysVsTarget > 0 ? "+" : ""}{data.deltaDaysVsTarget} días)
                </span>
              )}
            </p>
          )}
        </div>
      </div>

      <div className="mt-4 grid gap-1.5 sm:grid-cols-2 lg:grid-cols-3">
        {data.factors.map((f) => {
          const Icon = f.Icon;
          const cls =
            f.tone === "bad"
              ? "text-destructive"
              : f.tone === "warning"
                ? "text-amber-600 dark:text-amber-400"
                : f.tone === "good"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-muted-foreground";
          return (
            <div
              key={f.key}
              className="flex items-center gap-2 rounded-lg border border-border/40 bg-background/40 px-2.5 py-1.5"
            >
              <Icon className={cn("h-3.5 w-3.5 shrink-0", cls)} />
              <span className="text-[11.5px] text-muted-foreground truncate flex-1">{f.label}</span>
              <span className={cn("text-[11.5px] font-medium tabular-nums shrink-0", cls)}>{f.value}</span>
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-[10.5px] text-muted-foreground/70 italic">
        Estimación basada en velocidad histórica y tareas pendientes. No considera fases ni dependencias.
      </p>
    </section>
  );
}
