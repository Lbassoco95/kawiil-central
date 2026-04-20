import { useMemo } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Clock,
  FileWarning,
  HeartPulse,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { Tables } from "@/integrations/supabase/types";
import { isPastDueCalendarMX, toDateStringMX } from "@/lib/dateUtils";
import { isTaskClosedStatus } from "@/lib/taskStatusGroups";
import { useMexicoToday } from "@/hooks/useMexicoToday";

type Client = Tables<"clients">;
type Project = Tables<"projects">;
type Task = Tables<"tasks">;
type Document = Tables<"documents">;

interface Props {
  client: Client;
  projects: Project[];
  tasks: Task[];
  documents: Document[];
}

interface Signal {
  key: string;
  label: string;
  value: string;
  delta: number;
  tone: "good" | "warning" | "bad" | "neutral";
}

/**
 * Health Score 0-100 determinístico para un cliente.
 *
 * Basado en señales reales (sin llamadas a IA):
 *  - Tareas vencidas, urgentes, antigüedad de actividad
 *  - Proyectos pausados/cancelados
 *  - Antigüedad de la última actualización
 *  - Estado del cliente
 *
 * El score parte de 100 y se restan puntos según la severidad de cada señal.
 */
export function ClientHealthScoreCard({ client, projects, tasks, documents }: Props) {
  const today = useMexicoToday();
  const todayYmd = toDateStringMX(today);

  const { score, signals, summary } = useMemo(() => {
    let s = 100;
    const items: Signal[] = [];

    // Estado del cliente
    if (client.status === "inactivo") {
      s -= 50;
      items.push({
        key: "status",
        label: "Estado del cliente",
        value: "Inactivo",
        delta: -50,
        tone: "bad",
      });
    } else if (client.status === "prospecto") {
      items.push({
        key: "status",
        label: "Estado del cliente",
        value: "Prospecto",
        delta: 0,
        tone: "neutral",
      });
    } else {
      items.push({
        key: "status",
        label: "Estado del cliente",
        value: "Activo",
        delta: 0,
        tone: "good",
      });
    }

    // Tareas en curso
    const openTasks = tasks.filter((t) => !isTaskClosedStatus(t.status));
    const overdue = openTasks.filter((t) => t.due_date && isPastDueCalendarMX(t.due_date));
    const urgent = openTasks.filter((t) => t.priority === "urgente");
    const oldOpen = openTasks.filter((t) => {
      const days = (today.getTime() - new Date(t.created_at).getTime()) / (1000 * 60 * 60 * 24);
      return days >= 30;
    });

    if (overdue.length > 0) {
      const penalty = Math.min(overdue.length * 5, 30);
      s -= penalty;
      items.push({
        key: "overdue",
        label: "Tareas vencidas",
        value: `${overdue.length} en curso`,
        delta: -penalty,
        tone: "bad",
      });
    } else {
      items.push({
        key: "overdue",
        label: "Tareas vencidas",
        value: "Ninguna",
        delta: 0,
        tone: "good",
      });
    }

    if (urgent.length > 0) {
      const penalty = Math.min(urgent.length * 3, 12);
      s -= penalty;
      items.push({
        key: "urgent",
        label: "Tareas urgentes abiertas",
        value: `${urgent.length}`,
        delta: -penalty,
        tone: "warning",
      });
    }

    if (oldOpen.length > 0) {
      const penalty = Math.min(oldOpen.length * 2, 10);
      s -= penalty;
      items.push({
        key: "old",
        label: "Tareas estancadas (>30 días)",
        value: `${oldOpen.length}`,
        delta: -penalty,
        tone: "warning",
      });
    }

    // Proyectos
    const activeProjects = projects.filter((p) => p.status === "activo");
    const pausedProjects = projects.filter((p) => p.status === "pausado");
    const projectsAtention = projects.filter((p: any) => p.criticality_level === "atencion" || p.criticality_level === "critico");

    if (pausedProjects.length > 0) {
      const penalty = Math.min(pausedProjects.length * 4, 15);
      s -= penalty;
      items.push({
        key: "paused",
        label: "Proyectos pausados",
        value: `${pausedProjects.length}`,
        delta: -penalty,
        tone: "warning",
      });
    }

    if (projectsAtention.length > 0) {
      const penalty = Math.min(projectsAtention.length * 6, 20);
      s -= penalty;
      items.push({
        key: "critical_proj",
        label: "Proyectos en atención/críticos",
        value: `${projectsAtention.length}`,
        delta: -penalty,
        tone: "bad",
      });
    }

    if (activeProjects.length > 0) {
      items.push({
        key: "active_proj",
        label: "Proyectos activos",
        value: `${activeProjects.length}`,
        delta: 0,
        tone: "neutral",
      });
    }

    // Última actividad: max(updated_at de proyectos, tasks, documents)
    const allTimes: number[] = [];
    for (const p of projects) {
      if (p.updated_at) allTimes.push(new Date(p.updated_at).getTime());
    }
    for (const t of tasks) {
      if (t.updated_at) allTimes.push(new Date(t.updated_at).getTime());
    }
    for (const d of documents) {
      if ((d as any).updated_at) allTimes.push(new Date((d as any).updated_at).getTime());
      if (d.created_at) allTimes.push(new Date(d.created_at).getTime());
    }
    const lastTouch = allTimes.length ? Math.max(...allTimes) : null;
    if (lastTouch) {
      const days = Math.round((today.getTime() - lastTouch) / (1000 * 60 * 60 * 24));
      if (days > 60) {
        s -= 15;
        items.push({
          key: "stale",
          label: "Sin actividad",
          value: `${days} días`,
          delta: -15,
          tone: "bad",
        });
      } else if (days > 30) {
        s -= 7;
        items.push({
          key: "stale",
          label: "Sin actividad",
          value: `${days} días`,
          delta: -7,
          tone: "warning",
        });
      } else {
        items.push({
          key: "stale",
          label: "Última actividad",
          value: `hace ${days} día${days === 1 ? "" : "s"}`,
          delta: 0,
          tone: "good",
        });
      }
    } else {
      s -= 10;
      items.push({
        key: "stale",
        label: "Sin actividad registrada",
        value: "—",
        delta: -10,
        tone: "warning",
      });
    }

    // Clamp
    const final = Math.max(0, Math.min(100, Math.round(s)));

    let summaryText: string;
    if (final >= 80) {
      summaryText = "Cliente saludable. Operación al día sin focos críticos.";
    } else if (final >= 60) {
      summaryText = "Cliente estable con señales menores que conviene atender.";
    } else if (final >= 40) {
      summaryText = "Atención requerida: hay focos abiertos que erosionan la relación.";
    } else {
      summaryText = "Riesgo alto. Requiere acción inmediata para recuperar el control.";
    }

    return { score: final, signals: items, summary: summaryText };
  }, [client, projects, tasks, documents, today, todayYmd]);

  const tone =
    score >= 80
      ? { ring: "ring-emerald-500/30", text: "text-emerald-700 dark:text-emerald-400", bar: "bg-emerald-500", chip: "bg-emerald-500/10" }
      : score >= 60
        ? { ring: "ring-amber-500/30", text: "text-amber-700 dark:text-amber-400", bar: "bg-amber-500", chip: "bg-amber-500/10" }
        : score >= 40
          ? { ring: "ring-orange-500/30", text: "text-orange-700 dark:text-orange-400", bar: "bg-orange-500", chip: "bg-orange-500/10" }
          : { ring: "ring-destructive/40", text: "text-destructive", bar: "bg-destructive", chip: "bg-destructive/10" };

  const Trend = score >= 70 ? TrendingUp : score >= 40 ? Activity : TrendingDown;

  return (
    <section
      className={cn(
        "glass-card relative overflow-hidden p-5 ring-1",
        tone.ring,
      )}
    >
      <div className="flex items-start gap-4">
        <div
          className={cn(
            "grid h-16 w-16 shrink-0 place-items-center rounded-2xl ring-1 ring-inset ring-border/30",
            tone.chip,
          )}
        >
          <HeartPulse className={cn("h-7 w-7", tone.text)} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-baseline gap-2">
            <h2 className="text-sm font-medium text-muted-foreground">Health Score</h2>
            <span className={cn("text-4xl font-bold tabular-nums", tone.text)}>{score}</span>
            <span className="text-xs text-muted-foreground">/100</span>
            <span className={cn("ml-auto inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wide", tone.text)}>
              <Trend className="h-3.5 w-3.5" />
              {score >= 80 ? "Saludable" : score >= 60 ? "Estable" : score >= 40 ? "Atención" : "Crítico"}
            </span>
          </div>
          <div className="mt-2 h-1.5 rounded-full bg-secondary/40 overflow-hidden">
            <div
              className={cn("h-full rounded-full transition-all", tone.bar)}
              style={{ width: `${score}%` }}
            />
          </div>
          <p className="mt-2 text-[12.5px] text-muted-foreground leading-snug">{summary}</p>
        </div>
      </div>

      <div className="mt-4 grid gap-1.5 sm:grid-cols-2">
        {signals.map((sig) => {
          const Icon =
            sig.tone === "bad" ? AlertTriangle : sig.tone === "warning" ? Clock : sig.tone === "good" ? CheckCircle2 : FileWarning;
          const cls =
            sig.tone === "bad"
              ? "text-destructive"
              : sig.tone === "warning"
                ? "text-amber-600 dark:text-amber-400"
                : sig.tone === "good"
                  ? "text-emerald-600 dark:text-emerald-400"
                  : "text-muted-foreground";
          return (
            <div
              key={sig.key}
              className="flex items-center gap-2 rounded-lg border border-border/40 bg-background/40 px-2.5 py-1.5"
            >
              <Icon className={cn("h-3.5 w-3.5 shrink-0", cls)} />
              <span className="text-[11.5px] text-muted-foreground truncate flex-1">{sig.label}</span>
              <span className={cn("text-[11.5px] font-medium tabular-nums shrink-0", cls)}>
                {sig.value}
                {sig.delta !== 0 && <span className="ml-1 text-[10px] opacity-70">({sig.delta > 0 ? "+" : ""}{sig.delta})</span>}
              </span>
            </div>
          );
        })}
      </div>

      <p className="mt-3 text-[10.5px] text-muted-foreground/70 italic">
        Score determinístico basado en datos del CRM. Se recalcula al instante con cada cambio.
      </p>
    </section>
  );
}
