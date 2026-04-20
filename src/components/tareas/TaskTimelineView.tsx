import { useMemo } from "react";
import { GanttChartSquare } from "lucide-react";
import type { Task } from "@/hooks/useTasks";
import { cn } from "@/lib/utils";
import { UserAvatar } from "@/components/shared/UserAvatar";

interface TaskTimelineViewProps {
  tasks: Task[];
  profileMap?: Map<string, string | null>;
  /** Map opcional user_id → avatar_url para mostrar foto en la fila. */
  profileAvatarMap?: Map<string, string | null | undefined>;
  onOpen: (task: Task) => void;
  className?: string;
}

const PRIORITY_BAR: Record<string, string> = {
  urgente: "linear-gradient(90deg, hsl(var(--destructive)), hsl(0 84% 70%))",
  alta: "linear-gradient(90deg, hsl(38 95% 55%), hsl(25 95% 60%))",
  media: "linear-gradient(90deg, hsl(217 91% 60%), hsl(199 89% 60%))",
  baja: "linear-gradient(90deg, hsl(var(--muted-foreground) / 0.5), hsl(var(--muted-foreground) / 0.3))",
};

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function clampToWindow(start: Date, end: Date, winStart: Date, winEnd: Date) {
  const s = start < winStart ? winStart : start;
  const e = end > winEnd ? winEnd : end;
  return { s, e };
}

function formatShortDate(d: Date): string {
  return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short" });
}

export function TaskTimelineView({ tasks, profileMap, profileAvatarMap, onOpen, className }: TaskTimelineViewProps) {
  const { rows, days, todayLeftPct } = useMemo(() => {
    const today = startOfDay(new Date());
    const withDates = tasks
      .map((t) => {
        const due = t.due_date ? startOfDay(new Date(t.due_date)) : null;
        const created = (t as any).created_at
          ? startOfDay(new Date((t as any).created_at as string))
          : today;
        if (!due) return null;
        const start = created < due ? created : due;
        return { task: t, start, end: due };
      })
      .filter(Boolean) as { task: Task; start: Date; end: Date }[];

    if (withDates.length === 0) {
      return { rows: [], days: 30, todayLeftPct: 0 };
    }

    const minStart = withDates.reduce(
      (acc, r) => (r.start < acc ? r.start : acc),
      withDates[0].start,
    );
    const maxEnd = withDates.reduce(
      (acc, r) => (r.end > acc ? r.end : acc),
      withDates[0].end,
    );
    const todayMinus3 = new Date(today);
    todayMinus3.setDate(todayMinus3.getDate() - 3);
    const todayPlus30 = new Date(today);
    todayPlus30.setDate(todayPlus30.getDate() + 30);
    const winStart = minStart < todayMinus3 ? minStart : todayMinus3;
    const winEnd = maxEnd > todayPlus30 ? maxEnd : todayPlus30;

    const totalDays = Math.max(7, Math.round((winEnd.getTime() - winStart.getTime()) / DAY_MS));
    const todayLeftPct = Math.max(0, Math.min(100, ((today.getTime() - winStart.getTime()) / (totalDays * DAY_MS)) * 100));

    const rows = withDates
      .sort((a, b) => a.end.getTime() - b.end.getTime())
      .map(({ task, start, end }) => {
        const { s, e } = clampToWindow(start, end, winStart, winEnd);
        const leftPct = ((s.getTime() - winStart.getTime()) / (totalDays * DAY_MS)) * 100;
        const widthPct = Math.max(
          1.5,
          ((e.getTime() - s.getTime()) / (totalDays * DAY_MS)) * 100,
        );
        return { task, leftPct, widthPct, start, end };
      });

    return { rows, days: totalDays, todayLeftPct };
  }, [tasks]);

  if (rows.length === 0) {
    return (
      <div
        className={cn(
          "rounded-2xl border border-dashed border-border/60 bg-muted/20 px-6 py-12 text-center",
          className,
        )}
      >
        <div className="mx-auto mb-3 grid h-12 w-12 place-items-center rounded-2xl bg-primary/10 text-primary">
          <GanttChartSquare className="h-6 w-6" />
        </div>
        <p className="text-sm font-medium text-foreground">Sin tareas con fecha de vencimiento</p>
        <p className="mt-1 text-xs text-muted-foreground">
          La vista Timeline ordena las tareas por fecha de vencimiento. Asigna fechas para verlas aquí.
        </p>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "overflow-hidden rounded-2xl border border-border/60 bg-card/60 backdrop-blur-sm",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-border/40 px-4 py-2.5">
        <div className="flex items-center gap-2">
          <GanttChartSquare className="h-4 w-4 text-primary" />
          <h3 className="text-sm font-semibold text-foreground">Timeline · {rows.length} tareas</h3>
        </div>
        <p className="text-[11px] text-muted-foreground">
          Ventana ~{Math.round(days)} días · barra coloreada por prioridad
        </p>
      </div>

      <div className="relative">
        {/* Línea de "Hoy" */}
        <div
          aria-hidden
          className="pointer-events-none absolute top-0 bottom-0 z-10 w-px bg-primary/60"
          style={{ left: `calc(220px + (100% - 220px) * ${todayLeftPct / 100})` }}
        >
          <span className="absolute -top-0.5 left-0 -translate-x-1/2 rounded-full bg-primary px-1.5 py-px text-[9px] font-semibold uppercase tracking-wide text-primary-foreground">
            HOY
          </span>
        </div>

        <ul className="divide-y divide-border/40">
          {rows.map(({ task, leftPct, widthPct, end }) => {
            const assigneeName = task.assigned_to ? profileMap?.get(task.assigned_to) || null : null;
            const assigneeAvatar = task.assigned_to ? profileAvatarMap?.get(task.assigned_to) ?? null : null;
            const barBg = PRIORITY_BAR[task.priority || "media"] || PRIORITY_BAR.media;
            return (
              <li
                key={task.id}
                className="grid grid-cols-[220px_1fr] items-center gap-3 px-3 py-2 transition-colors hover:bg-muted/30"
              >
                <button
                  type="button"
                  onClick={() => onOpen(task)}
                  className="flex min-w-0 items-center gap-2 text-left"
                >
                  {assigneeName ? (
                    <UserAvatar
                      name={assigneeName}
                      avatarUrl={assigneeAvatar}
                      userId={task.assigned_to || assigneeName}
                      size="sm"
                      className="shrink-0"
                    />
                  ) : (
                    <span className="h-6 w-6 shrink-0 rounded-full bg-muted" aria-hidden />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] font-medium text-foreground">
                      {task.title}
                    </span>
                    <span className="block truncate text-[10px] text-muted-foreground">
                      {assigneeName ?? "Sin responsable"} · vence {formatShortDate(end)}
                    </span>
                  </span>
                </button>
                <div className="relative h-6">
                  <div className="absolute inset-y-2 left-0 right-0 rounded-full bg-muted/40" />
                  <button
                    type="button"
                    onClick={() => onOpen(task)}
                    className="absolute inset-y-1.5 rounded-full shadow-sm transition-transform hover:scale-y-110"
                    style={{
                      left: `${leftPct}%`,
                      width: `${widthPct}%`,
                      background: barBg,
                    }}
                    title={`${task.title} · ${formatShortDate(end)}`}
                    aria-label={`Tarea ${task.title} vence ${formatShortDate(end)}`}
                  />
                </div>
              </li>
            );
          })}
        </ul>
      </div>
    </div>
  );
}
