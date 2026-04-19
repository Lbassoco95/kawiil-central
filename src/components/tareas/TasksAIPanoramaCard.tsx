import { useMemo } from "react";
import { Sparkles, AlertTriangle, ListChecks, Activity } from "lucide-react";
import { AISummaryCard } from "@/components/shared/AISummaryCard";
import { isPastDueCalendarMX } from "@/lib/dateUtils";
import { isTaskClosedStatus } from "@/lib/taskStatusGroups";
import type { Task } from "@/hooks/useTasks";

interface TasksAIPanoramaCardProps {
  tasks: Task[] | undefined;
  /** Mapa value→label de células (para distribución por área en el prompt). */
  getCelulaLabel: (value: string) => string;
  /** Identificador de cache (incluye usuario + scope área). */
  cacheKey: string;
  userId?: string;
  contextPrompt: string;
}

interface KpiProps {
  label: string;
  value: number;
  trend?: string;
  accent: "primary" | "destructive" | "warning" | "accent";
  icon: React.ComponentType<{ className?: string }>;
}

const ACCENT_BG: Record<KpiProps["accent"], string> = {
  primary: "linear-gradient(180deg, hsl(var(--primary)), hsl(var(--accent)))",
  destructive:
    "linear-gradient(180deg, hsl(var(--destructive)), hsl(var(--priority-high)))",
  warning:
    "linear-gradient(180deg, hsl(var(--warning)), hsl(var(--priority-medium)))",
  accent: "linear-gradient(180deg, hsl(var(--accent)), hsl(var(--primary)))",
};

const ACCENT_TEXT: Record<KpiProps["accent"], string> = {
  primary: "text-primary",
  destructive: "text-destructive",
  warning: "text-warning",
  accent: "text-accent",
};

function PanoramaKpi({ label, value, trend, accent, icon: Icon }: KpiProps) {
  return (
    <div className="relative overflow-hidden rounded-xl border border-border/60 bg-card/60 px-3 py-2.5 transition-all hover:border-border hover:shadow-sm">
      <span
        aria-hidden
        className="absolute left-0 top-0 h-full w-1 rounded-l-xl"
        style={{ background: ACCENT_BG[accent] }}
      />
      <div className="flex items-start justify-between gap-2 pl-2">
        <div className="min-w-0">
          <p className="text-[10.5px] font-medium uppercase tracking-wide text-muted-foreground">
            {label}
          </p>
          <p className="mt-0.5 text-xl font-semibold tabular-nums text-foreground">
            {value}
          </p>
          {trend ? (
            <p className="mt-0.5 truncate text-[10.5px] text-muted-foreground">
              {trend}
            </p>
          ) : null}
        </div>
        <div className={`shrink-0 rounded-lg bg-muted/50 p-1.5 ${ACCENT_TEXT[accent]}`}>
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
    </div>
  );
}

export function TasksAIPanoramaCard({
  tasks,
  getCelulaLabel,
  cacheKey,
  userId,
  contextPrompt,
}: TasksAIPanoramaCardProps) {
  const kpis = useMemo(() => {
    const list = (tasks ?? []) as Task[];
    const open = list.filter((t) => !isTaskClosedStatus(t.status));
    const overdue = open.filter(
      (t) => t.due_date && isPastDueCalendarMX(t.due_date),
    );

    const byCel = new Map<string, number>();
    for (const t of open) {
      if (!t.area) continue;
      byCel.set(t.area, (byCel.get(t.area) ?? 0) + 1);
    }
    let topCelulaLabel = "—";
    let topCelulaCount = 0;
    for (const [k, v] of byCel) {
      if (v > topCelulaCount) {
        topCelulaCount = v;
        topCelulaLabel = getCelulaLabel(k);
      }
    }

    return {
      total: open.length,
      overdue: overdue.length,
      topCelulaLabel,
      topCelulaCount,
    };
  }, [tasks, getCelulaLabel]);

  return (
    <section
      aria-label="Panorama de tareas"
      className="relative overflow-hidden rounded-2xl border border-border/70 p-4 sm:p-5 animate-fade-in"
      style={{
        background:
          "radial-gradient(ellipse 480px 180px at 0% 0%, hsl(var(--primary) / 0.08), transparent 70%), " +
          "radial-gradient(ellipse 380px 140px at 100% 100%, hsl(var(--accent) / 0.07), transparent 70%), " +
          "hsl(var(--card))",
      }}
    >
      <header className="mb-3 flex items-center gap-2">
        <div
          className="grid h-8 w-8 place-items-center rounded-lg border border-primary/20 text-primary"
          style={{
            background:
              "linear-gradient(135deg, hsl(var(--primary) / 0.15), hsl(var(--accent) / 0.15))",
          }}
        >
          <Sparkles className="h-4 w-4" />
        </div>
        <div>
          <h2 className="text-sm font-semibold text-foreground">
            Panorama Kawiil AI · Tareas
          </h2>
          <p className="text-[11px] text-muted-foreground">
            KPIs en tiempo real + síntesis IA con sugerencias.
          </p>
        </div>
      </header>

      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
        <PanoramaKpi
          label="Tareas abiertas"
          value={kpis.total}
          trend={kpis.total > 0 ? "Total en seguimiento" : "Sin tareas activas"}
          accent="primary"
          icon={ListChecks}
        />
        <PanoramaKpi
          label="Vencidas"
          value={kpis.overdue}
          trend={
            kpis.overdue > 0
              ? "Requieren acción inmediata"
              : "Sin retrasos hoy"
          }
          accent={kpis.overdue > 0 ? "destructive" : "primary"}
          icon={AlertTriangle}
        />
        <PanoramaKpi
          label="Célula con más carga"
          value={kpis.topCelulaCount}
          trend={kpis.topCelulaCount > 0 ? kpis.topCelulaLabel : "Distribuido"}
          accent="accent"
          icon={Activity}
        />
      </div>

      <div className="mt-4 border-t border-border/40 pt-3">
        <AISummaryCard
          cacheKey={cacheKey}
          contextPrompt={contextPrompt}
          title="Síntesis IA — sugerencias y prioridades"
          ready={!!tasks && tasks.length > 0}
          userId={userId}
        />
      </div>
    </section>
  );
}
